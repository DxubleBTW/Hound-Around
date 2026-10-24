"""Spot predictors compared in eval.py. Each fit(vecs, labels) then predict(q) -> [(label, score)] best first.

knn    top-k voting over the whole index (the baseline the API uses)
hier   PIGEON-style hierarchy: vote the floor first (or take it from OCR), then vote the spot within that floor
probe  linear classifier on frozen embeddings. smooth=True uses PIGEON's distance label smoothing with walking meters
       in place of haversine km: the target for a frame spreads to nearby spots, so near misses cost less.
combo  average of probe probabilities and knn vote shares
"""
import numpy as np
import torch

from common import floor_of, vote

TAU_M = 8.0  # smoothing temperature in meters (PIGEON uses 75 km at planet scale)


def neighborhood_rank(sims, labels, dist, radius=8, ocr_floor=None, k=10):
    """Top-k voting as the API runs it. Spots within `radius` walking meters of the winner (same floor) pool their
    votes into its confidence: when the vote splits between look-alike neighbors like the F2 east corridor, the route
    still starts in the right place. A floor read from a room sign restricts the vote to that floor.
    Returns ([(label, votes)], confidence)."""
    idx = np.arange(len(labels))
    if ocr_floor is not None:
        on = np.array([floor_of(l) == ocr_floor for l in labels])
        if on.any():
            idx = idx[on]
    ranked = vote(sims[idx], [labels[i] for i in idx], k)
    best = ranked[0][0]
    pooled = sum(v for l, v, _ in ranked
                 if l == best or (radius and floor_of(l) == floor_of(best) and dist.get((best, l), 1e9) <= radius))
    return [(l, v) for l, v, _ in ranked], pooled / k


class Knn:
    def __init__(self, k=10):
        self.k = k

    def fit(self, vecs, labels):
        self.vecs, self.labels = vecs, list(labels)
        return self

    def predict(self, q, ocr_floor=None):
        ranked = vote(self.vecs @ q, self.labels, self.k)
        return [(l, v / self.k) for l, v, _ in ranked]


class ClassNN(Knn):
    """Score each spot by its single best-matching frame. Spots with few frames facing the query's direction
    still win if one of them matches well, where top-k voting lets big spots crowd them out."""

    def predict(self, q, ocr_floor=None):
        sims = self.vecs @ q
        best = {}
        for l, s in zip(self.labels, sims):
            best[l] = max(best.get(l, -1.0), float(s))
        ranked = sorted(best.items(), key=lambda x: -x[1])
        return [(l, s) for l, s in ranked[:10]]


class CropKnn(Knn):
    """Index full frames plus left and right crops. A photo turned partway from any training view still shares a
    side wall with it, so matching crop to crop recovers views the full-frame vector misses."""

    def fit(self, crops, labels):
        # crops: [n_crops, N, D]
        self.n = len(crops)
        return super().fit(np.concatenate(crops), list(labels) * self.n)

    def predict(self, qcrops, ocr_floor=None):
        sims = np.max([self.vecs @ q for q in qcrops], axis=0)
        ranked = vote(sims, self.labels, self.k)
        return [(l, v / self.k) for l, v, _ in ranked]


class Hier(Knn):
    def __init__(self, k=10, k_floor=20):
        super().__init__(k)
        self.k_floor = k_floor

    def fit(self, vecs, labels):
        super().fit(vecs, labels)
        self.floors = np.array([floor_of(l) for l in self.labels])
        return self

    def predict(self, q, ocr_floor=None):
        sims = self.vecs @ q
        floor = ocr_floor
        if floor is None:
            fv = {}
            for l, v, s in vote(sims, self.labels, self.k_floor):
                fv[floor_of(l)] = fv.get(floor_of(l), 0) + v
            floor = max(fv, key=fv.get)
        mask = self.floors == floor
        if not mask.any():
            return super().predict(q)
        idx = np.flatnonzero(mask)
        ranked = vote(sims[idx], [self.labels[i] for i in idx], self.k)
        return [(l, v / self.k) for l, v, _ in ranked]


class Probe:
    def __init__(self, smooth=True, dist=None, epochs=300, lr=1e-2, wd=1e-4):
        self.smooth, self.dist, self.epochs, self.lr, self.wd = smooth, dist or {}, epochs, lr, wd

    def fit(self, vecs, labels):
        self.classes = sorted(set(labels))
        ci = {c: i for i, c in enumerate(self.classes)}
        y = np.array([ci[l] for l in labels])
        T = np.eye(len(self.classes), dtype=np.float32)
        if self.smooth:
            for a in self.classes:
                row = np.array([np.exp(-self.dist[a, b] / TAU_M) if (a, b) in self.dist else float(a == b)
                                for b in self.classes], dtype=np.float32)
                T[ci[a]] = row / row.sum()
        X = torch.tensor(vecs, dtype=torch.float32)
        Y = torch.tensor(T[y])
        torch.manual_seed(0)
        self.lin = torch.nn.Linear(X.shape[1], len(self.classes))
        opt = torch.optim.Adam(self.lin.parameters(), lr=self.lr, weight_decay=self.wd)
        for _ in range(self.epochs):
            opt.zero_grad()
            loss = -(Y * torch.log_softmax(self.lin(X) * 10, 1)).sum(1).mean()
            loss.backward()
            opt.step()
        return self

    @torch.no_grad()
    def proba(self, q):
        return torch.softmax(self.lin(torch.tensor(q, dtype=torch.float32)) * 10, -1).numpy()

    def predict(self, q, ocr_floor=None):
        p = self.proba(q)
        order = np.argsort(-p)
        return [(self.classes[i], float(p[i])) for i in order[:10]]


class Combo:
    def __init__(self, dist, k=10):
        self.knn, self.probe = Knn(k), Probe(True, dist)

    def fit(self, vecs, labels):
        self.knn.fit(vecs, labels)
        self.probe.fit(vecs, labels)
        return self

    def predict(self, q, ocr_floor=None):
        score = dict(zip(self.probe.classes, 0.5 * self.probe.proba(q)))
        for l, share in self.knn.predict(q):
            score[l] = score.get(l, 0) + 0.5 * share
        return sorted(score.items(), key=lambda x: -x[1])[:10]
