"""Regression tests use events, synthetic vectors and generated images only."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import json
import sqlite3

from fastapi.testclient import TestClient
import numpy as np
import pytest

from api.main import create_app
from ml.backend import Backend
from ml.calibration import COEF, INTERCEPT, Model
from ml.index import VectorIndex
from ml.metrics import Metrics
from test_backend import FakeML, locate, router
from test_persistent_corrections import make_app, save_correction


def ocr_backend():
    # Unmasked top ten all come from F1; OCR must retrieve F2's own rows.
    query = np.zeros(384, dtype=np.float32)
    query[0] = 1
    other = query.copy()
    other[0], other[1] = .8, .6
    index = VectorIndex(np.stack([query] * 10 + [other] * 4),
                        ['F1_a'] * 10 + ['F2_b'] * 4, ['video'] * 14,
                        [''] * 10 + ['F2_c'] * 4)
    graph = {'nodes': [{'id': spot, 'floor': floor} for spot, floor in
                       [('F1_a', 1), ('F2_b', 2), ('F2_c', 2)]],
             'edges': [{'from': 'F2_b', 'to': 'F2_c', 'meters': 2}]}
    observed = []
    backend = Backend(index, graph, {}, lambda image: query,
                      ocr_reader=lambda image: (None, 2),
                      confidence_model=Model(COEF, INTERCEPT), feature_observer=observed.append)
    # Force OCR via the confidence gate without changing the actual ranking.
    backend._confidence = lambda ranked, k=None: .5
    return backend, query, observed


def test_ocr_reranking_updates_heading_and_calibration_evidence():
    backend, _, observed = ocr_backend()
    result = backend.locate(None)
    assert result['spot'] == result['top3'][0]['spot'] == 'F2_b'
    assert result['floor'] == 2 and result['heading'] == 'F2_c'
    assert observed[0]['share'] == .4
    assert observed[0]['top_sim'] == pytest.approx(.8)
    assert observed[0]['margin'] == pytest.approx(.8)
    assert result['p_correct'] == round(backend.confidence_model.predict(observed[0]), 3)


def test_second_photo_fusion_cannot_undo_current_room_sign_floor():
    backend, previous, _ = ocr_backend()
    result = backend.locate(None, previous=previous)
    assert result['spot'] == 'F2_b' and result['floor'] == 2
    assert result['top3'] == [{'spot': 'F2_b', 'votes': 8}]
    assert result['heading'] == 'F2_c'
    assert result['tier'] == 'picker' and result['p_correct'] is None


def test_busy_inference_does_not_block_health_or_route_and_slot_recovers(tmp_path, router):
    entered, release = Event(), Event()
    class Slow(FakeML):
        def locate(self, image):
            entered.set()
            assert release.wait(5), 'Test did not release inference'
            return super().locate(image)
    app = create_app(tmp_path, Slow(router.nodes['test_hall']), router)
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=4) as pool:
        pending = pool.submit(locate, client)
        try:
            assert entered.wait(3)
            health = pool.submit(client.get, '/health')
            assert health.result(timeout=1).status_code == 200
            route = pool.submit(client.get, '/route', params={'from': 'test_entry', 'to': 'TEST'})
            assert route.result(timeout=1).status_code == 200
            busy = pool.submit(locate, client).result(timeout=1)
            assert busy.status_code == 503 and busy.headers['retry-after'] == '1'
        finally:
            release.set()
        assert pending.result(timeout=3).status_code == 200
        assert locate(client).status_code == 200
        summary = app.state.metrics_snapshot()
        assert summary['outcomes']['locate.busy'] == 1
        assert summary['outcomes']['locate.ok'] == 2


def test_inference_slot_is_released_after_model_failure(tmp_path, router):
    model = FakeML(router.nodes['test_hall'])
    original = model.locate
    model.locate = lambda image: (_ for _ in ()).throw(RuntimeError('synthetic'))
    with TestClient(create_app(tmp_path, model, router), raise_server_exceptions=False) as client:
        assert locate(client).status_code == 500
        model.locate = original
        assert locate(client).status_code == 200


def test_waiting_correction_does_not_hold_health_state_lock(tmp_path, router):
    entered, release = Event(), Event()
    model = FakeML(router.nodes['test_hall'])
    with TestClient(create_app(tmp_path, model, router)) as client, ThreadPoolExecutor(max_workers=3) as pool:
        photo_id = locate(client).json()['photo_id']
        original = model.locate
        def slow(image):
            entered.set()
            assert release.wait(5)
            return original(image)
        model.locate = slow
        pending = pool.submit(locate, client)
        try:
            assert entered.wait(3)
            correction = pool.submit(client.post, '/correct', json={'photo_id': photo_id, 'true_spot': 'test_entry'})
            assert pool.submit(client.get, '/health').result(timeout=1).status_code == 200
        finally:
            release.set()
        assert pending.result(timeout=3).status_code == 200
        assert correction.result(timeout=3).json() == {'ok': True, 'index_size': 1}
        assert client.get('/health').json()['index_size'] == 1


def test_slow_correction_copy_allows_health_and_cache_expiry(tmp_path, router):
    entered, release = Event(), Event()
    model = FakeML(router.nodes['test_hall'])
    original = model.prepare_correction
    def slow(vector, label):
        entered.set()
        assert release.wait(5)
        return original(vector, label)
    model.prepare_correction = slow
    now = [0.0]
    with TestClient(create_app(tmp_path, model, router, clock=lambda: now[0])) as client, ThreadPoolExecutor(max_workers=2) as pool:
        photo_id = locate(client).json()['photo_id']
        payload = {'photo_id': photo_id, 'true_spot': 'test_entry'}
        correction = pool.submit(client.post, '/correct', json=payload)
        try:
            assert entered.wait(3)
            now[0] = 1000  # health may prune the photo while its correction prepares
            response = pool.submit(client.get, '/health').result(timeout=1)
            assert response.json()['index_size'] == 0
        finally:
            release.set()
        assert correction.result(timeout=3).json() == {'ok': True, 'index_size': 1}
        assert client.post('/correct', json=payload).json() == {'ok': True, 'index_size': 1}


def test_admission_rejects_before_reading_the_upload_body():
    import asyncio
    from threading import BoundedSemaphore
    from api.main import RecognitionAdmission
    gate = BoundedSemaphore(1)
    gate.acquire()
    messages = []
    async def forbidden(*args):
        raise AssertionError('Busy requests must not read or forward the upload')
    async def send(message):
        messages.append(message)
    scope = {'type': 'http', 'method': 'POST', 'path': '/locate'}
    asyncio.run(RecognitionAdmission(forbidden, gate)(scope, forbidden, send))
    assert messages[0]['status'] == 503
    assert scope['state']['recognition_busy'] is True
    gate.release()


def test_cancelled_http_task_does_not_release_a_running_workers_admission():
    import asyncio
    from threading import BoundedSemaphore
    from starlette.concurrency import run_in_threadpool
    from api.main import RecognitionAdmission
    gate = BoundedSemaphore(1)
    entered, release = Event(), Event()
    def blocking():
        entered.set()
        assert release.wait(5)
    async def inner(scope, receive, send):
        await run_in_threadpool(scope['state']['recognition_lease'].run, blocking)
    async def exercise():
        task = asyncio.create_task(RecognitionAdmission(inner, gate)(
            {'type': 'http', 'method': 'POST', 'path': '/locate'}, None, None))
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert not gate.acquire(blocking=False)
        finally:
            release.set()
        assert await asyncio.to_thread(gate.acquire, True, 3)
        gate.release()
    asyncio.run(exercise())


def test_correction_receipt_survives_restart_and_rejects_different_payload(tmp_path, router):
    data, state = tmp_path / 'base', tmp_path / 'state'
    with TestClient(make_app(data, state, router)) as client:
        first = save_correction(client)
        first_reply = client.post('/correct', json={'photo_id': first, 'true_spot': 'test_entry'}).json()
        save_correction(client)
        assert client.get('/health').json()['index_size'] == 12
    with TestClient(make_app(data, state, router)) as client:
        assert client.post('/correct', json={'photo_id': first, 'true_spot': 'test_entry'}).json() == first_reply
        assert client.post('/correct', json={'photo_id': first, 'true_spot': 'test_hall'}).status_code == 409
        assert client.get('/health').json()['index_size'] == 12
        assert client.app.state.index_version() == 2
    with sqlite3.connect(state / 'corrections.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM correction_vectors').fetchone()[0] == 2


def test_duplicate_concurrent_corrections_learn_once_and_rollback_removes_receipt(tmp_path, router):
    data, state = tmp_path / 'base', tmp_path / 'state'
    with TestClient(make_app(data, state, router)) as client, ThreadPoolExecutor(max_workers=2) as pool:
        photo_id = locate(client).json()['photo_id']
        payload = {'photo_id': photo_id, 'true_spot': 'test_entry'}
        requests = [pool.submit(client.post, '/correct', json=payload) for _ in range(2)]
        assert [request.result(timeout=3).json() for request in requests] == [
            {'ok': True, 'index_size': 11}, {'ok': True, 'index_size': 11}]
        assert client.app.state.index_version() == 1
        client.app.state.rollback_last_correction()
        assert client.post('/correct', json=payload).status_code == 410
        assert client.get('/health').json()['index_size'] == 10


def test_wide_descriptor_corrections_and_receipts_survive_restart(tmp_path, router):
    vector = np.ones(12, dtype=np.float32) / np.sqrt(12)
    def app():
        index = VectorIndex(np.stack([vector] * 10), ['test_hall'] * 10, ['video'] * 10)
        model = Backend(index, {'nodes': list(router.nodes.values()), 'edges': []}, {},
                        lambda image: vector.copy(), model_name='synthetic-wide')
        return create_app(tmp_path, model, router)
    with TestClient(app()) as client:
        photo_id = locate(client).json()['photo_id']
        payload = {'photo_id': photo_id, 'true_spot': 'test_entry'}
        receipt = client.post('/correct', json=payload)
        assert receipt.status_code == 200
    with TestClient(app()) as client:
        assert locate(client).json()['spot'] == 'test_entry'
        assert client.post('/correct', json=payload).json() == receipt.json()
        assert client.get('/health').json()['index_size'] == 11


def test_metrics_are_bounded_copy_only_aggregates():
    metrics = Metrics()
    for _ in range(200):
        metrics.observe('embedding', .02)
        metrics.increment('locate.ok')
    snapshot = metrics.snapshot()
    assert snapshot['timings']['embedding'][3] == 200
    assert len(snapshot['timings']['embedding']) == len(snapshot['buckets_ms']) + 1
    snapshot['timings']['embedding'][3] = 0
    assert metrics.snapshot()['timings']['embedding'][3] == 200
    for key in ('F1_room164', 'user@example.com', 'photo_id'):
        assert key not in json.dumps(snapshot)
        with pytest.raises(ValueError):
            metrics.increment(key)
