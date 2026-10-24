"""create_backend: the ML handoff object the API serializes.

Mirrors ``api/recognition.py:StubBackend`` field-for-field. Wired through
``HOUND_ML_FACTORY=ml.backend:create_backend``. The embedder and OCR reader are
**injectable** so synthetic tests run without torch/transformers/easyocr; the
real DINOv2/EasyOCR implementations are only constructed (and only import their
heavy deps) when no injection is supplied.
"""
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

import networkx as nx
import numpy as np

from ml.embedder import DIM, MODEL_NAME, as_embed_fn
from ml.index import VectorIndex
from ml.errors import UnrecognizedLocation
from ml.rejection import load_threshold, threshold_value

TOP_K = 10
# When the vote is this uncertain, OCR may help (design.md §4 / steering).
# The user reports look-alike hallways getting mixed up -- exactly the
# middling-confidence case. Running OCR whenever the vote is not clearly
# confident (and always when top3 spans floors) lets a readable door sign
# correct the floor. Raised from 0.8 -> 0.85 so a 0.8 vote (8/10, one stray
# neighbor on another floor) also consults the sign. OCR still stays GATED:
# a clearly-confident single-floor vote (>= 0.85, e.g. 9/10) skips it, so the
# EasyOCR pass (the main latency cost; the whole /locate call must stay under
# the ~1s CPU budget) does not run on every query.
OCR_CONFIDENCE_GATE = 0.85
# Votes for spots within this many walking meters of the winner (same floor)
# count toward its confidence. Look-alike neighbors (F2's east corridor) split
# the vote, yet the route starts in the same place. On real footage, leave-one-
# video-out, this cut picker prompts from 82% to 62% of photos while user
# success rose 55% -> 57% (ml/research/floor_report.py).
NEIGHBORHOOD_M = 8


class Backend:
    """Recognition backend implementing the ML handoff interface.

    Parameters mirror what ``create_backend`` builds, but every heavy piece is
    injectable for tests:

    - ``embed_fn``: callable ``(image|list) -> normalized float32 (384,)/(N,384)``.
    - ``ocr_reader``: callable ``(image) -> (room|None, floor|None)`` or ``None``.
    """

    def __init__(self, index: VectorIndex, graph: dict, headings: dict,
                 embed_fn, ocr_reader=None, model_name: str = MODEL_NAME,
                 top_k: int = TOP_K, min_similarity=None, rooms=None):
        self.index = index
        self._embed = embed_fn
        self._ocr = ocr_reader
        self._model_name = model_name
        self.top_k = top_k
        self.min_similarity = None if min_similarity is None else threshold_value(min_similarity)
        # node id -> floor, and adjacency, from graph.json. Same edge rules as
        # api/routing.py: verify=true edges are skipped there, so a heading
        # across one would fail the API's graph check (review N06).
        self._floor = {n['id']: n['floor'] for n in graph.get('nodes', [])}
        self._neighbors: dict[str, set] = {n['id']: set() for n in graph.get('nodes', [])}
        walk = nx.Graph()
        for edge in graph.get('edges', []):
            a, b = edge.get('from'), edge.get('to')
            if a in self._neighbors and b in self._neighbors and not edge.get('verify', False):
                self._neighbors[a].add(b)
                if not edge.get('one_way', False):
                    self._neighbors[b].add(a)
                if not edge.get('vertical', False):
                    walk.add_edge(a, b, weight=float(edge.get('meters', 0)))
        # spot -> spots within NEIGHBORHOOD_M walking meters on the same floor.
        self._nearby = {
            n: set(nx.single_source_dijkstra_path_length(walk, n, cutoff=NEIGHBORHOOD_M, weight='weight'))
            for n in walk.nodes}
        # label -> most common labels.csv heading (design.md §3 / steering §6).
        self._heading = headings
        # OCR room number -> floor, from rooms.json when available (contract:
        # [{"room":"164","floor":1,"node":"F1_room164"}, ...]). Optional and
        # guarded: the backend never hard-depends on rooms.json. Used to trust
        # an OCR-read room that maps to a real node on a known floor, even when
        # the sign carried no "Floor N" numeral. Only floors in scope
        # (B1/F1/F2) and nodes that exist in the graph are kept.
        self._room_floor: dict = {}
        for entry in (rooms or []):
            room = entry.get('room')
            floor = entry.get('floor')
            node = entry.get('node')
            if (room is None or floor not in (-1, 1, 2)
                    or node not in self._floor):
                continue
            self._room_floor[str(room)] = floor

    # -- handoff interface -----------------------------------------------
    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def size(self) -> int:
        return len(self.index)

    def locate(self, image) -> dict:
        # Embed, then drop the image reference immediately (never retained).
        vector = np.asarray(self._embed(image), dtype=np.float32).reshape(-1)
        if len(self.index) == 0:
            # Never invent a location (review N07); the API turns this into an error.
            raise RuntimeError('Recognition index is empty')
        ranked, neighbors = self.index.vote(vector, k=self.top_k)
        # Vote agreement is not evidence that a photo belongs to this building:
        # even an unrelated image has ten nearest neighbors. Gate by similarity
        # before OCR or location voting can turn it into a confident answer.
        if self.min_similarity is not None and (
                not neighbors or not np.isfinite(neighbors[0][2])
                or neighbors[0][2] < self.min_similarity):
            raise UnrecognizedLocation('Location not recognized')
        spot = ranked[0]['spot']
        floor = self._floor.get(spot, 1)
        confidence = self._confidence(ranked)

        # OCR gate: only when uncertain or the top3 span multiple floors.
        floors_in_top3 = {self._floor.get(r['spot']) for r in ranked[:3]}
        ocr_room, ocr_floor = None, None
        if self._ocr is not None and (confidence < OCR_CONFIDENCE_GATE or len(floors_in_top3) > 1):
            ocr_room, ocr_floor = self._ocr(image)
            # Trust the OCR room too: if it maps to a real room on a known
            # floor (rooms.json), that floor is at least as authoritative as a
            # "Floor N" numeral and covers signs that only show a room number.
            target_floor = self._room_floor.get(ocr_room) if ocr_room else None
            if target_floor is None:
                target_floor = ocr_floor
            if target_floor is not None and target_floor != floor:
                # The sign's floor wins: re-vote over that floor's rows only, so
                # the returned spot is top3[0] and the picker can offer it
                # (review N03).
                mask = np.array([self._floor.get(l) == target_floor for l in self.index.labels])
                if mask.any():
                    ranked, _ = self.index.vote(vector, k=self.top_k, mask=mask)
                    spot, floor = ranked[0]['spot'], target_floor
                    confidence = self._confidence(ranked)

        top3 = [{'spot': r['spot'], 'votes': int(r['votes'])} for r in ranked[:3]]
        return self._result(vector, spot, floor, confidence, top3, ocr_room, ocr_floor)

    def prepare_correction(self, vector, label) -> VectorIndex:
        # New index with the corrected vector appended, source="correction".
        # Does not mutate the live index.
        return self.index.with_appended(vector, label, 'correction')

    def apply_correction(self, prepared: VectorIndex) -> None:
        self.index = prepared

    def snapshot(self) -> VectorIndex:
        # Deep copy so later mutations never alias the snapshot.
        return self.index.copy()

    def restore(self, snapshot: VectorIndex) -> None:
        self.index = snapshot.copy()

    # -- helpers ----------------------------------------------------------
    def _confidence(self, ranked):
        """Winner's votes plus votes for spots within NEIGHBORHOOD_M of it, / k."""
        winner = ranked[0]['spot']
        floor = self._floor.get(winner)
        near = {s for s in self._nearby.get(winner, ()) if self._floor.get(s) == floor}
        votes = sum(r['votes'] for r in ranked if r['spot'] == winner or r['spot'] in near)
        return min(1.0, votes / self.top_k)

    def _choose_heading(self, spot):
        """Most common labels.csv heading for the spot, if a graph neighbor."""
        if spot is None:
            return None
        candidate = self._heading.get(spot)
        if candidate is not None and candidate in self._neighbors.get(spot, set()):
            return candidate
        return None

    def _result(self, vector, spot, floor, confidence, top3, ocr_room, ocr_floor):
        return {
            'spot': spot,
            'floor': floor,
            'heading': self._choose_heading(spot) if spot else None,
            'confidence': float(confidence),
            'top3': top3,
            'ocr_room': ocr_room,
            'ocr_floor': ocr_floor,
            'vector': vector.astype(np.float32),
        }


def manifest_paths(data_dir: Path) -> list:
    """Every labels.csv the pipeline produced (review N05).

    ``pipeline/label_frames.py --out data/<dataset>`` writes
    ``data/<dataset>/labels.csv`` with frames in ``data/<dataset>/train/``; one
    dataset per filming batch. A top-level ``data/labels.csv`` (frames in
    ``data/dataset/train``) is still accepted.
    """
    data_dir = Path(data_dir)
    found = sorted(p for p in data_dir.glob('*/labels.csv') if (p.parent / 'train').is_dir())
    legacy = data_dir / 'labels.csv'
    return ([legacy] if legacy.exists() else []) + found


def load_headings(labels_csv: Path) -> dict:
    """Most common ``heading`` per label among keep rows of labels.csv."""
    counts: dict[str, Counter] = {}
    if not labels_csv.exists():
        return {}
    with open(labels_csv, newline='') as handle:
        for row in csv.DictReader(handle):
            if row.get('status') != 'keep':
                continue
            label = row.get('label')
            heading = (row.get('heading') or '').strip()
            if not label or not heading:
                continue
            counts.setdefault(label, Counter())[heading] += 1
    return {label: counter.most_common(1)[0][0] for label, counter in counts.items()}


def create_backend(data_dir, embedder=None, ocr_reader=None, top_k: int = TOP_K, index_path=None):
    """Factory called once at startup with ``data_dir`` (pathlib.Path).

    By default loads ``index.npz``/``graph.json``/``labels.csv`` from
    ``data_dir``, builds the real DINOv2 embedder and EasyOCR reader (heavy
    imports happen only here). Tests inject ``embedder`` and ``ocr_reader`` to
    avoid torch/easyocr; they may also pass an in-memory index via the module
    helpers.
    """
    data_dir = Path(data_dir)

    # Fail closed (review N07): without a usable index the API must not start
    # and report ready while answering with invented locations.
    index_path = Path(index_path) if index_path else data_dir / 'index.npz'
    if not index_path.exists():
        raise FileNotFoundError(f'{index_path} is missing; build it with python -m ml.build_index')
    index = VectorIndex.load(index_path)
    if len(index) == 0:
        raise ValueError(f'{index_path} has no vectors')

    graph_path = data_dir / 'graph.json'
    graph = json.loads(graph_path.read_text()) if graph_path.exists() else {'nodes': [], 'edges': []}

    # rooms.json is optional: used only to trust an OCR-read room's floor.
    rooms = []
    rooms_path = data_dir / 'rooms.json'
    if rooms_path.exists():
        try:
            loaded = json.loads(rooms_path.read_text())
            if isinstance(loaded, list):
                rooms = loaded
        except (ValueError, OSError):
            rooms = []

    headings = {}
    for manifest in manifest_paths(data_dir):
        headings.update(load_headings(manifest))

    embed_fn = _resolve_embedder(embedder)
    reader = _resolve_ocr(ocr_reader)

    model_name = getattr(embedder, 'model_name', MODEL_NAME) if embedder is not None else MODEL_NAME
    return Backend(index, graph, headings, embed_fn, ocr_reader=reader,
                   model_name=model_name, top_k=top_k,
                   min_similarity=load_threshold(data_dir, index_path, model_name),
                   rooms=rooms)


def _resolve_embedder(embedder):
    """Return a batch-capable embed callable, constructing DINOv2 if needed.

    An embedder is a callable handling a single PIL image or a list, returning
    L2-normalized float32 ``(384,)`` / ``(N, 384)``. :class:`ml.embedder.Dinov2Embedder`
    and the test fakes both satisfy this. A per-image-only callable can opt into
    wrapping by setting ``batched = False``.
    """
    if embedder is None:
        from ml.embedder import Dinov2Embedder  # lazy: imports torch here
        embedder = Dinov2Embedder()
    if getattr(embedder, 'batched', True):
        return embedder
    return as_embed_fn(embedder)


def _resolve_ocr(ocr_reader):
    """Return an OCR reader, or a no-op when easyocr is unavailable."""
    if ocr_reader is not None:
        return ocr_reader
    try:
        from ml.ocr import EasyOcrReader  # lazy: imports easyocr here
        return EasyOcrReader()
    except Exception:
        # easyocr not installed / model download blocked: no OCR backup.
        from ml.ocr import NullOcrReader
        return NullOcrReader()
