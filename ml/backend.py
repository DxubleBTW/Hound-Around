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

import numpy as np

from ml.embedder import DIM, MODEL_NAME, as_embed_fn
from ml.index import VectorIndex

TOP_K = 10
# When the vote is this uncertain, OCR may help (design.md §4 / steering).
OCR_CONFIDENCE_GATE = 0.8


class Backend:
    """Recognition backend implementing the ML handoff interface.

    Parameters mirror what ``create_backend`` builds, but every heavy piece is
    injectable for tests:

    - ``embed_fn``: callable ``(image|list) -> normalized float32 (384,)/(N,384)``.
    - ``ocr_reader``: callable ``(image) -> (room|None, floor|None)`` or ``None``.
    """

    def __init__(self, index: VectorIndex, graph: dict, headings: dict,
                 embed_fn, ocr_reader=None, model_name: str = MODEL_NAME,
                 top_k: int = TOP_K):
        self.index = index
        self._embed = embed_fn
        self._ocr = ocr_reader
        self._model_name = model_name
        self.top_k = top_k
        # node id -> floor, and adjacency, from graph.json.
        self._floor = {n['id']: n['floor'] for n in graph.get('nodes', [])}
        self._neighbors: dict[str, set] = {n['id']: set() for n in graph.get('nodes', [])}
        for edge in graph.get('edges', []):
            a, b = edge.get('from'), edge.get('to')
            if a in self._neighbors and b in self._neighbors:
                self._neighbors[a].add(b)
                if not edge.get('one_way', False):
                    self._neighbors[b].add(a)
        # label -> most common labels.csv heading (design.md §3 / steering §6).
        self._heading = headings

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
        ranked, neighbors = self.index.vote(vector, k=self.top_k)
        if not ranked:
            # Empty index: return a valid-but-zero-confidence placeholder.
            spot = next(iter(self._floor), None)
            floor = self._floor.get(spot, 1) if spot else 1
            return self._result(vector, spot, floor, 0.0,
                                [{'spot': spot, 'votes': 0}] if spot else [], None, None)

        winner = ranked[0]
        spot = winner['spot']
        votes = winner['votes']
        confidence = min(1.0, votes / self.top_k)
        top3 = [{'spot': r['spot'], 'votes': int(r['votes'])} for r in ranked[:3]]
        floor = self._floor.get(spot, 1)

        # OCR gate: only when uncertain or the top3 span multiple floors.
        floors_in_top3 = {self._floor.get(r['spot']) for r in ranked[:3]}
        ocr_room, ocr_floor = None, None
        if self._ocr is not None and (confidence < OCR_CONFIDENCE_GATE or len(floors_in_top3) > 1):
            ocr_room, ocr_floor = self._ocr(image)
            if ocr_floor is not None and ocr_floor != floor:
                # OCR floor wins: best-voted neighbor on that floor, lower conf.
                spot, floor, confidence = self._apply_floor_override(
                    ranked, neighbors, ocr_floor, spot, floor, confidence)

        heading = self._choose_heading(spot)
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
    def _apply_floor_override(self, ranked, neighbors, ocr_floor, spot, floor, confidence):
        """Pick best-voted spot on the OCR floor; lower confidence."""
        on_floor = [r for r in ranked if self._floor.get(r['spot']) == ocr_floor]
        if on_floor:
            best = on_floor[0]  # ranked is already votes-desc, sim-desc.
            spot = best['spot']
            floor = ocr_floor
            # Disagreement means less certainty: halve the confidence.
            confidence = min(confidence, best['votes'] / self.top_k) * 0.5
        return spot, floor, confidence

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


def create_backend(data_dir, embedder=None, ocr_reader=None, top_k: int = TOP_K):
    """Factory called once at startup with ``data_dir`` (pathlib.Path).

    By default loads ``index.npz``/``graph.json``/``labels.csv`` from
    ``data_dir``, builds the real DINOv2 embedder and EasyOCR reader (heavy
    imports happen only here). Tests inject ``embedder`` and ``ocr_reader`` to
    avoid torch/easyocr; they may also pass an in-memory index via the module
    helpers.
    """
    data_dir = Path(data_dir)

    index_path = data_dir / 'index.npz'
    index = VectorIndex.load(index_path) if index_path.exists() else VectorIndex()

    graph_path = data_dir / 'graph.json'
    graph = json.loads(graph_path.read_text()) if graph_path.exists() else {'nodes': [], 'edges': []}

    headings = load_headings(data_dir / 'labels.csv')

    embed_fn = _resolve_embedder(embedder)
    reader = _resolve_ocr(ocr_reader)

    model_name = getattr(embedder, 'model_name', MODEL_NAME) if embedder is not None else MODEL_NAME
    return Backend(index, graph, headings, embed_fn, ocr_reader=reader,
                   model_name=model_name, top_k=top_k)


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
