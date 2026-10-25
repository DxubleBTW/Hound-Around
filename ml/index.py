"""In-memory vector index: load/save ``index.npz``, vote, corrections.

Contract (docs/contract.md, steering ml.md):

``index.npz``: ``vecs`` float16 ``[N,D]`` (L2-normalized; D = 384 for DINOv2-small,
8,448 for MegaLoc, or the PCA width), ``labels`` str ``[N]``, ``source`` str ``[N]``
in ``{"video", "correction"}``, optional ``heading`` str ``[N]`` and, when the
builder fitted a PCA, ``pca_mean`` ``[D0]`` + ``pca_components`` ``[D, D0]``
(:class:`ml.embedder.Projector`). ``dim`` is read from the data, never assumed.

Correction votes are **weighted higher** so a single corrected exemplar flips
the very next near-identical query (design.md §3). See
:data:`CORRECTION_WEIGHT`.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ml.embedder import DIM, INDEX_VIEWS, Projector, normalize

# A correction vote counts as this many video votes (design.md §3): 3 frames'
# worth, and every video frame is len(INDEX_VIEWS) rows. Scaling it keeps one
# correction learning as often as before multi-view (83% next-frame flips,
# 2.9% hijacks vs 3.7% before; ml/research/backend_eval.py).
CORRECTION_WEIGHT = 3 * len(INDEX_VIEWS)


class VectorIndex:
    """Holds the L2-normalized exemplar vectors with their labels and sources.

    Vectors are stored as float32 in memory for cosine math (dot product);
    they are persisted as float16 to match the contract.
    """

    def __init__(self, vecs=None, labels=None, source=None, heading=None, pca=None, dim=None,
                 model_name='', views_per_frame=len(INDEX_VIEWS)):
        if vecs is None:
            vecs = np.zeros((0, dim or (pca.out_dim if pca else DIM)), dtype=np.float32)
        vecs = np.asarray(vecs, dtype=np.float32)
        if vecs.ndim != 2:
            raise ValueError('Index vecs must be a 2-d [N, D] array')
        self.vecs = vecs
        self.dim = int(vecs.shape[1])
        # The PCA that produced these rows (queries must go through the same one), or None.
        self.pca = pca
        self.model_name = model_name
        self.views_per_frame = int(views_per_frame)
        if pca is not None and pca.out_dim != self.dim:
            raise ValueError(f'Index is {self.dim}-d but its PCA projects to {pca.out_dim}-d')
        self.labels = list(labels or [])
        self.source = list(source or [])
        # Node each row's frame faces ('' when unknown). Matched rows face the
        # way the photo does, so their majority heading is the user's facing.
        self.heading = list(heading) if heading is not None else [''] * len(self.labels)
        if not (len(self.labels) == len(self.source) == len(self.heading) == self.vecs.shape[0]):
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
            heading=[str(x) for x in data['heading']] if 'heading' in data.files else None,
            pca=Projector.from_npz(data),
            model_name=str(data['model_name']) if 'model_name' in data.files else '',
            views_per_frame=int(data['views_per_frame']) if 'views_per_frame' in data.files else len(INDEX_VIEWS),
        )

    def save(self, path) -> None:
        np.savez(
            Path(path),
            vecs=self.vecs.astype(np.float16),
            labels=np.asarray(self.labels, dtype=object).astype('U') if self.labels
            else np.zeros((0,), dtype='U1'),
            source=np.asarray(self.source, dtype=object).astype('U') if self.source
            else np.zeros((0,), dtype='U1'),
            heading=np.asarray(self.heading, dtype=object).astype('U') if self.heading
            else np.zeros((0,), dtype='U1'),
            **(self.pca.npz_fields() if self.pca is not None else {}),
            model_name=self.model_name, views_per_frame=self.views_per_frame,
        )

    # -- correction / snapshot -------------------------------------------
    def with_appended(self, vector, label, source) -> 'VectorIndex':
        """Return a NEW index with one row appended; does not mutate self."""
        vector = normalize(np.asarray(vector, dtype=np.float32).reshape(-1))
        if vector.shape != (self.dim,):
            raise ValueError(f'Correction vector must be {self.dim}-d')
        vecs = np.vstack([self.vecs, vector[None, :]]).astype(np.float32)
        return VectorIndex(vecs=vecs, labels=self.labels + [label],
                           source=self.source + [source], heading=self.heading + [''], pca=self.pca,
                           model_name=self.model_name, views_per_frame=self.views_per_frame)

    def copy(self) -> 'VectorIndex':
        """Deep copy; snapshots must not alias arrays that later mutate."""
        return VectorIndex(vecs=self.vecs.copy(), labels=list(self.labels),
                           source=list(self.source), heading=list(self.heading), pca=self.pca,
                           model_name=self.model_name, views_per_frame=self.views_per_frame)

    # -- retrieval / voting ----------------------------------------------
    def vote(self, query, k=10, mask=None, return_rows=False):
        """Top-k weighted vote for a normalized query vector.

        Returns ``(ranked, neighbors)`` where ``ranked`` is a list of
        ``{'spot', 'votes', 'sim'}`` sorted by votes desc then summed
        similarity desc, and ``neighbors`` is a list of ``(label, source,
        sim)`` for the top-k rows (used for OCR floor override).
        ``mask`` (bool ``[N]``) restricts the vote to those rows, e.g. one
        floor after OCR reads a room sign. ``return_rows`` also returns the
        top-k row indices (for their headings).
        """
        query = normalize(np.asarray(query, dtype=np.float32).reshape(-1))
        rows = np.arange(len(self)) if mask is None else np.flatnonzero(mask)
        if len(rows) == 0:
            return ([], [], []) if return_rows else ([], [])
        # Full-width MegaLoc rows are large: avoid copying the whole index on
        # every unmasked query. Masked OCR votes still select their floor rows.
        sims = (self.vecs if mask is None else self.vecs[rows]) @ query
        k = min(k, len(rows))
        # Highest similarities first; on equal similarity a correction sorts
        # ahead of video rows, so a corrected copy of a frame that many video
        # rows duplicate is never pushed out of the top k (review N02).
        is_video = np.array([self.source[i] != 'correction' for i in rows])
        top = rows[np.lexsort((is_video, -sims))[:k]]
        sims = self.vecs[top] @ query
        neighbors = [(self.labels[i], self.source[i], float(s)) for i, s in zip(top, sims)]
        # A person-labeled view that is the query's single nearest neighbor
        # takes precedence over the video vote. A similarity threshold can't
        # gate this: on real frames, 10% of photos of other spots reach 0.90
        # with some frame, while half of same-view retakes fall below it.
        precedence = neighbors[0][0] if neighbors[0][1] == 'correction' else None
        tally: dict = {}
        for label, source, sim in neighbors:
            weight = CORRECTION_WEIGHT if source == 'correction' else 1
            bucket = tally.setdefault(
                label, {'spot': label, 'votes': 0, 'sim': 0.0, 'corrected': False})
            bucket['votes'] += weight
            bucket['sim'] += sim
            if source == 'correction':
                bucket['corrected'] = True
        # Nearest-neighbor correction first, then votes desc; ties break toward
        # a correction (design §3), then by summed similarity (steering ml.md
        # step 4). Confidence stays votes/k, so one correction usually leads
        # the top-3 picker rather than claiming certainty.
        ranked = sorted(tally.values(),
                        key=lambda b: (b['spot'] == precedence, b['votes'], b['corrected'], b['sim']),
                        reverse=True)
        return (ranked, neighbors, top.tolist()) if return_rows else (ranked, neighbors)
