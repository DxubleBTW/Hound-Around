"""Run with uvicorn api.main:app. Data is supplied outside Git."""
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from io import BytesIO
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
from threading import BoundedSemaphore, Lock, RLock
import time
import uuid
import warnings
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
import numpy as np
from pydantic import BaseModel, ConfigDict, Field
from python_multipart.exceptions import MultipartParseError
from starlette.concurrency import run_in_threadpool
from starlette.formparsers import MultiPartException, MultiPartParser

from api.corrections import CorrectionStore, index_context
from api.recognition import StubBackend, load_backend
from api.routing import Router
from ml.errors import UnrecognizedLocation
from ml.artifacts import runtime_directory, validate_manifest
from ml.metrics import Metrics

MAX_UPLOAD = 2 * 1024 * 1024
MAX_BODY = MAX_UPLOAD + 64 * 1024  # Multipart headers/boundary allowance.
logger = logging.getLogger(__name__)


class MemoryMultipartParser(MultiPartParser):
    spool_max_size = MAX_BODY


class UploadLimit:
    """Bound incoming bodies before Starlette can spool uploads to disk."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] != 'POST':
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > MAX_BODY:
                await JSONResponse({'detail': 'Request too large'}, status_code=413)(scope, receive, send)
                return
            if not message.get('more_body', False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()

        await self.app(scope, replay, send)


class RecognitionLease:
    """Keep admission until the worker exits, even if its HTTP task is cancelled."""
    def __init__(self, gate):
        self.gate = gate
        self.lock = Lock()
        self.active = True
        self.running = False

    def _release(self):
        if self.active:
            self.active = False
            self.gate.release()

    def run(self, function, *args):
        with self.lock:
            if not self.active:
                raise RuntimeError('Recognition request ended before inference started')
            self.running = True
        try:
            return function(*args)
        finally:
            with self.lock:
                self.running = False
                self._release()

    def request_finished(self):
        with self.lock:
            if not self.running:
                self._release()


class RecognitionAdmission:
    """Reject excess recognition work before buffering any upload body."""
    def __init__(self, app, gate):
        self.app, self.gate = app, gate

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] != 'POST' or scope['path'] != '/locate':
            return await self.app(scope, receive, send)
        if not self.gate.acquire(blocking=False):
            scope.setdefault('state', {})['recognition_busy'] = True
            return await JSONResponse({'detail': 'Recognition is busy; retry shortly'}, status_code=503,
                                      headers={'Retry-After': '1'})(scope, receive, send)
        lease = RecognitionLease(self.gate)
        scope.setdefault('state', {})['recognition_lease'] = lease
        try:
            await self.app(scope, receive, send)
        finally:
            lease.request_finished()


class Correction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    photo_id: str
    true_spot: str


class Vote(BaseModel):
    spot: str
    votes: int = Field(ge=0)


class MatchResult(BaseModel):
    spot: str
    floor: Literal[-1, 1, 2]
    heading: str | None
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    top3: list[Vote] = Field(min_length=1, max_length=3)
    ocr_room: str | None
    ocr_floor: Literal[-1, 1, 2] | None
    # Calibrated P(right spot) and what the app should do next (ml/calibration.py).
    # Null from backends without calibration; the app then uses `confidence`.
    p_correct: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    tier: Literal['auto', 'picker', 'second'] | None = None


def create_app(data_dir=None, matcher=None, router=None, clock=time.monotonic,
               cache_limit=512, ttl_seconds=600, allowed_origins=None, state_dir=None):
    data_root = Path(data_dir or os.getenv('HOUND_DATA_DIR', 'data'))
    data_dir = runtime_directory(data_root)
    state_dir = Path(state_dir or os.getenv('HOUND_STATE_DIR') or data_root)
    if cache_limit < 1 or ttl_seconds <= 0:
        raise ValueError('Cache size and TTL must be positive')
    lock = RLock()
    model_lock = RLock()
    admission = BoundedSemaphore(1)
    metrics = Metrics()
    rate_lock = RLock()
    cache = OrderedDict()
    requests = OrderedDict()
    state = {'matcher': matcher, 'router': router, 'db': None, 'version': 0, 'rollback': None,
             'store': None, 'base_snapshot': None, 'size': 0}

    def prune():
        now = clock()
        for key in list(cache):
            if cache[key]['expires'] <= now:
                del cache[key]

    @asynccontextmanager
    async def lifespan(app):
        package_valid = True
        try:
            manifest = validate_manifest(data_dir)
            if manifest is None:
                logger.warning('Runtime manifest absent; package compatibility is not verified')
        except (OSError, ValueError) as error:
            logger.error('Runtime package unavailable: %s', error)
            state['matcher'] = state['router'] = None
            package_valid = False
        if package_valid and state['router'] is None and (data_dir / 'graph.json').exists():
            graph = json.loads((data_dir / 'graph.json').read_text())
            rooms = json.loads((data_dir / 'rooms.json').read_text())
            state['router'] = Router(graph, rooms)
        if state['matcher'] is None and state['router'] is not None:
            factory = os.getenv('HOUND_ML_FACTORY')
            stub_spot = os.getenv('HOUND_STUB_SPOT')
            if factory and stub_spot:
                raise ValueError('Choose a real ML factory or an explicit stub, not both')
            if factory:
                try:
                    state['matcher'] = load_backend(factory, data_dir)
                except (OSError, ValueError) as error:
                    # e.g. index.npz not fetched yet: stay up and report 503
                    # rather than crash or answer with invented locations.
                    logger.error('Recognition backend unavailable: %s', error)
            elif stub_spot:
                state['matcher'] = StubBackend(state['router'].nodes[stub_spot])
        state_dir.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(state_dir / 'corrections.sqlite', check_same_thread=False)
        db.execute('PRAGMA foreign_keys = ON')
        db.execute('CREATE TABLE IF NOT EXISTS corrections ('
                   'photo_id TEXT PRIMARY KEY, true_spot TEXT, predicted TEXT, '
                   'confidence REAL, created_at TEXT)')
        db.commit()
        state['db'] = db
        try:
            model, routes = state['matcher'], state['router']
            if model is not None and routes is not None:
                store = CorrectionStore(db, index_context(data_dir, model, routes), getattr(model, 'dim', 384))
                state['store'] = store
                if state['base_snapshot'] is None:
                    state['base_snapshot'] = model.snapshot()
                else:
                    model.restore(state['base_snapshot'])
                state['rollback'] = None
                try:
                    for photo_id, label, vector in store.records():
                        if label not in routes.nodes:
                            raise ValueError('Stored correction references an unknown node')
                        snapshot = model.snapshot()
                        model.apply_correction(model.prepare_correction(vector, label))
                        state['rollback'] = (photo_id, snapshot)
                except Exception:
                    model.restore(state['base_snapshot'])
                    raise
                state['version'] = store.version
                state['size'] = model.size
                if hasattr(model, 'metrics'):
                    model.metrics = metrics
            yield
        finally:
            cache.clear()
            requests.clear()
            db.close()
            state['db'] = None
            state['store'] = None

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(UploadLimit)
    app.add_middleware(RecognitionAdmission, gate=admission)
    origins = allowed_origins if allowed_origins is not None else [
        x.strip() for x in os.getenv('HOUND_CORS_ORIGINS', 'http://localhost:5173').split(',') if x.strip()]
    if '*' in origins:
        raise ValueError('CORS requires explicit origins')
    app.add_middleware(CORSMiddleware, allow_origins=origins,
                       allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])

    @app.middleware('http')
    async def rate_limit(request: Request, call_next):
        if request.method == 'POST':
            # Use the direct peer; do not trust user-supplied forwarded IPs.
            peer = request.client.host if request.client else 'unknown'
            now = clock()
            with rate_lock:
                for key in list(requests):
                    if now - requests[key][0] >= 60:
                        del requests[key]
                started, count = requests.get(peer, (now, 0))
                if count >= 30:
                    return JSONResponse({'detail': 'Too many requests'}, status_code=429,
                                        headers={'Retry-After': '60'})
                if len(requests) >= 4096 and peer not in requests:
                    return JSONResponse({'detail': 'Server busy'}, status_code=429)
                requests[peer] = (started, count + 1)
        return await call_next(request)

    @app.middleware('http')
    async def aggregate_requests(request: Request, call_next):
        operation = {'/locate': 'locate', '/route': 'route', '/correct': 'correct'}.get(request.url.path)
        if operation is None:
            return await call_next(request)
        started = time.perf_counter()
        outcome = 'failed'
        try:
            response = await call_next(request)
            if response.status_code < 400:
                outcome = 'ok'
            elif operation == 'locate' and response.status_code == 503:
                outcome = 'busy' if getattr(request.state, 'recognition_busy', False) else 'unavailable'
            elif operation == 'locate' and response.status_code == 422:
                outcome = 'rejected' if getattr(request.state, 'recognition_rejected', False) else 'invalid'
            return response
        finally:
            metrics.observe(operation, time.perf_counter() - started)
            metrics.increment(f'{operation}.{outcome}')

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        logger.error('Backend request failed: %s', type(exc).__name__)
        return JSONResponse({'detail': 'Internal server error'}, status_code=500)

    @app.get('/health')
    def health():
        with lock:
            prune()
            model = state['matcher']
            ready = model is not None and state['router'] is not None
            return JSONResponse({'ok': ready, 'index_size': state['size'] if model else 0,
                                 'model': model.model_name if model else 'unconfigured'},
                                status_code=200 if ready else 503)

    def locate(raw, previous_id=None):
        started = time.perf_counter()
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(BytesIO(raw)) as original:
                    if original.format not in ('JPEG', 'PNG', 'WEBP'):
                        raise ValueError('Unsupported image format')
                    if original.width * original.height > 20_000_000:
                        raise ValueError('Image dimensions too large')
                    original.load()
                    image = ImageOps.exif_transpose(original).convert('RGB')
                    image.info.clear()
        except (UnidentifiedImageError, OSError, ValueError,
                Image.DecompressionBombWarning, Image.DecompressionBombError):
            raise HTTPException(422, 'Invalid or unsupported image') from None
        try:
            image.thumbnail((512, 512))
            metrics.observe('decode', time.perf_counter() - started)
            waiting = time.perf_counter()
            with model_lock:
                metrics.observe('model_wait', time.perf_counter() - waiting)
                model = state['matcher']
                if model is None or state['router'] is None:
                    raise HTTPException(503, 'Recognition data not ready')
                # Second photo of the same spot: fuse with the first photo's
                # vector (kept for corrections). An expired id falls back to a
                # single-photo answer rather than an error.
                with lock:
                    prune()
                    previous = cache.get(previous_id) if previous_id else None
                try:
                    result = dict(model.locate(image, previous=previous['vector'].copy())
                                  if previous else model.locate(image))
                except UnrecognizedLocation:
                    raise HTTPException(422, {
                        'code': 'unrecognized_location',
                        'message': 'Location not recognized. Take another hallway photo or choose a starting location.',
                    }) from None
                vector = np.asarray(result.pop('vector'), dtype=np.float32)
                norm = np.linalg.norm(vector.astype(np.float64))
                if (vector.shape != (getattr(model, 'dim', 384),) or not np.isfinite(vector).all()
                        or not np.isfinite(norm) or norm == 0):
                    raise ValueError('Invalid ML vector')
                vector = (vector / norm).astype(np.float32)
                # Enforce the public contract even if the ML result has diagnostics.
                fields = ('spot', 'floor', 'heading', 'confidence', 'top3', 'ocr_room', 'ocr_floor')
                result = MatchResult(**{field: result[field] for field in fields},
                                     p_correct=result.get('p_correct'), tier=result.get('tier')).model_dump()
                if result['spot'] not in state['router'].nodes:
                    raise ValueError('ML returned unknown node')
                nodes = state['router'].nodes
                if (nodes[result['spot']]['floor'] != result['floor']
                        or any(vote['spot'] not in nodes for vote in result['top3'])
                        or (result['heading'] is not None and not state['router'].graph.has_edge(
                            result['spot'], result['heading']))):
                    raise ValueError('ML result disagrees with graph')
                with lock:
                    prune()
                    while len(cache) >= cache_limit:
                        cache.popitem(last=False)
                    photo_id = 'p_' + uuid.uuid4().hex
                    cache[photo_id] = {'vector': vector.copy(), 'predicted': result['spot'],
                                       'confidence': result['confidence'], 'expires': clock() + ttl_seconds}
                    return {**result, 'photo_id': photo_id,
                            'ms': round((time.perf_counter() - started) * 1000)}
        finally:
            image.close()

    @app.post('/locate', openapi_extra={'requestBody': {'required': True, 'content': {
        'multipart/form-data': {'schema': {'type': 'object', 'required': ['image'],
                                           'properties': {'image': {'type': 'string', 'format': 'binary'},
                                                          'previous': {'type': 'string'}}}}}}})
    async def locate_endpoint(request: Request):
        try:
            if not request.headers.get('content-type', '').lower().startswith('multipart/form-data'):
                raise HTTPException(415, 'Multipart image required')
            try:
                form = await MemoryMultipartParser(request.headers, request.stream(), max_files=1,
                                                   max_fields=1, max_part_size=MAX_BODY).parse()
            except (MultiPartException, MultipartParseError):
                raise HTTPException(422, 'Invalid multipart upload') from None
            try:
                upload = form.get('image')
                if upload is None or not hasattr(upload, 'read'):
                    raise HTTPException(422, 'Multipart image field required')
                raw = await upload.read(MAX_UPLOAD + 1)
                if len(raw) > MAX_UPLOAD:
                    raise HTTPException(413, 'Image exceeds 2 MB')
                previous = form.get('previous')
                if previous is not None and (not isinstance(previous, str)
                                             or not re.fullmatch(r'p_[0-9a-f]{32}', previous)):
                    raise HTTPException(422, 'Invalid previous photo id')
                return await run_in_threadpool(request.state.recognition_lease.run, locate, raw, previous)
            finally:
                await form.close()
        except HTTPException as error:
            if isinstance(error.detail, dict) and error.detail.get('code') == 'unrecognized_location':
                request.state.recognition_rejected = True
            raise

    @app.get('/route')
    def route_endpoint(start: str = Query(alias='from'), to: str = Query(),
                       accessible: bool = False, heading: str | None = None):
        route_service = state['router']
        if route_service is None:
            raise HTTPException(503, 'Routing data not ready')
        try:
            return route_service.route(start, to, accessible, heading)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None

    @app.post('/correct')
    def correct(body: Correction):
        with model_lock:
            with lock:
                prune()
                model, routes, db = state['matcher'], state['router'], state['db']
                if model is None or routes is None or db is None:
                    raise HTTPException(503, 'Recognition data not ready')
                if body.true_spot not in routes.nodes:
                    raise HTTPException(422, 'Unknown node')
                receipt = state['store'].receipt(body.photo_id)
                if receipt is not None:
                    label, size = receipt
                    if label != body.true_spot:
                        raise HTTPException(409, 'Photo already corrected to another location')
                    return {'ok': True, 'index_size': size if size is not None else model.size}
                entry = cache.get(body.photo_id)
                if entry is None:
                    raise HTTPException(410, 'Photo expired or unknown; take another photo')
            # Wide descriptor copies and storage I/O must not block readiness.
            # The model lock serializes every index/DB mutation; health reads
            # only the committed cached size under the separate state lock.
            prepared = model.prepare_correction(entry['vector'], body.true_spot)
            snapshot = model.snapshot()
            try:
                with db:
                    db.execute('INSERT INTO corrections VALUES (?, ?, ?, ?, ?)',
                               (body.photo_id, body.true_spot, entry['predicted'], entry['confidence'],
                                datetime.now(timezone.utc).isoformat()))
                    model.apply_correction(prepared)
                    state['store'].add(body.photo_id, entry['vector'], model.size)
            except Exception:
                model.restore(snapshot)
                raise
            with lock:
                state['rollback'] = (body.photo_id, snapshot)
                state['version'] = state['store'].version
                cache.pop(body.photo_id, None)
                state['size'] = model.size
                return {'ok': True, 'index_size': model.size}

    def rollback_last_correction():
        """Local operator hook, deliberately not a new public API endpoint."""
        with model_lock:
            with lock:
                if state['rollback'] is None:
                    raise ValueError('No correction to roll back')
                photo_id, snapshot = state['rollback']
                model, db = state['matcher'], state['db']
            current = model.snapshot()
            try:
                with db:
                    state['store'].remove(photo_id)
                    model.restore(snapshot)
            except Exception:
                model.restore(current)
                raise
            with lock:
                # Invalidate vectors computed against the replaced index version.
                cache.clear()
                state['rollback'] = None
                state['version'] = state['store'].version
                state['size'] = model.size
                return state['version']

    app.state.metrics_snapshot = metrics.snapshot
    app.state.rollback_last_correction = rollback_last_correction
    app.state.index_version = lambda: state['version']
    return app


app = create_app()
