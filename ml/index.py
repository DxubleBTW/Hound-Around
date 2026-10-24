"""In-memory vector index: load/save ``index.npz``, vote, corrections.

Contract (docs/contract.md, steering ml.md):

``index.npz``: ``vecs`` float16 ``[N,384]`` (L2-normalized), ``labels`` str
``[N]``, ``source`` str ``[N]`` in ``{"video", "correction"}``.

Correction votes are **weighted higher** so a single corrected exemplar flips
the very next near-identical query (design.md §3). See
:data:`CORRECTION_WEIGHT`.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ml.embedder import DIM, normalize

# A correction vote counts as this many video votes (design.md §3).
CORRECTION_WEIGHT = 3


class VectorIndex:
    """Holds the L2-normalized exemplar vectors with their labels and sources.

    Vectors are stored as float32 in memory for cosine math (dot product);
    they are persisted as float16 to match the contract.
    """

    def __init__(self, vecs=None, labels=None, source=None):
        if vecs is None:
            vecs = np.zeros((0, DIM), dtype=np.float32)
        self.vecs = np.asarray(vecs, dtype=np.float32).reshape(-1, DIM)
        self.labels = list(labels or [])
        self.source = list(source or [])
        if not (len(self.labels) == len(self.source) == self.vecs.shape[0]):
            raise ValueError('Index vecs/labels/source length mismatch')

    def __len__(self):
        return self.vecs.shape[0]

    # -- persistence ------------------------------------------------------
    @classmethod
    def load(cls, path) -> 'VectorIndex':
        data = np.load(Path(path), allow_pickle=False)
        return cls(
            vecs=np.asarray(data['vecs'], dtype=np.float32),
            labels=[str(x) for x in data['labels']],
            source=[str(x) for x in data['source']],
        )

    def save(self, path) -> None:
        np.savez(
            Path(path),
            vecs=self.vecs.astype(np.float16),
            labels=np.asarray(self.labels, dtype=object).astype('U') if self.labels
            else np.zeros((0,), dtype='U1'),
            source=np.asarray(self.source, dtype=object).astype('U') if self.source
            else np.zeros((0,), dtype='U1'),
        )

    # -- correction / snapshot -------------------------------------------
    def with_appended(self, vector, label, source) -> 'VectorIndex':
        """Return a NEW index with one row appended; does not mutate self."""
        vector = normalize(np.asarray(vector, dtype=np.float32).reshape(-1))
        if vector.shape != (DIM,):
            raise ValueError(f'Correction vector must be {DIM}-d')
        vecs = np.vstack([self.vecs, vector[None, :]]).astype(np.float32)
        return VectorIndex(vecs=vecs, labels=self.labels + [label],
                           source=self.source + [source])

    def copy(self) -> 'VectorIndex':
        """Deep copy; snapshots must not alias arrays that later mutate."""
        return VectorIndex(vecs=self.vecs.copy(),
                           labels=list(self.labels), source=list(self.source))

    # -- retrieval / voting ----------------------------------------------
    def vote(self, query, k=10):
        """Top-k weighted vote for a normalized query vector.

        Returns ``(ranked, neighbors)`` where ``ranked`` is a list of
        ``{'spot', 'votes', 'sim'}`` sorted by votes desc then summed
        similarity desc, and ``neighbors`` is a list of ``(label, source,
        sim)`` for the top-k rows (used for OCR floor override).
        """
        query = normalize(np.asarray(query, dtype=np.float32).reshape(-1))
        if len(self) == 0:
            return [], []
        sims = self.vecs @ query  # vectors already normalized -> cosine.
        k = min(k, len(self))
        # Highest similarities first.
        top = np.argsort(-sims, kind='stable')[:k]
        neighbors = [(self.labels[i], self.source[i], float(sims[i])) for i in top]
        tally: dict[str, dict] = {}
        for label, source, sim in neighbors:
            weight = CORRECTION_WEIGHT if source == 'correction' else 1
            bucket = tally.setdefault(
                label, {'spot': label, 'votes': 0, 'sim': 0.0, 'corrected': False})
            bucket['votes'] += weight
            bucket['sim'] += sim
            if source == 'correction':
                bucket['corrected'] = True
        # Votes desc; ties break toward a correction (design §3), then by
        # summed similarity (steering ml.md step 4).
        ranked = sorted(tally.values(),
                        key=lambda b: (b['votes'], b['corrected'], b['sim']), reverse=True)
        return ranked, neighbors
