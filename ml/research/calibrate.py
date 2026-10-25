"""Calibrated confidence and the three-tier flow, measured leave-one-video-out.

For every held-out at-spot frame, run the shipped backend (cached vectors, cached OCR) and record features
the API can compute for free: backend confidence, the winner's raw vote share, the top similarity, the margin
between the winner's best similarity and the best other spot's, and whether the top 3 span floors. A logistic
model on those features, fit out-of-fold (grouped by video so a video never scores itself), turns them into
P(the returned spot is right, within 10 m on the right floor).

Then the tiers: P >= HIGH picks automatically, LOW <= P < HIGH shows the picker, P < LOW (or floors disagree)
asks for a second photo. The second photo is simulated with another frame of the same spot from the same held-out
video at least FUSE_DT seconds away (360 clips: a different yaw), and the two photos' votes are added.

Usage:
    python -m ml.research.calibrate --dataset data/dataset data/dataset_new data/dataset_f2 data/dataset_r3 \
        data/dataset_fri data/dataset_360
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import analyze as A  # noqa: E402
from backend_eval import NEAR_M, meters_table  # noqa: E402
from common import floor_of, load_frames  # noqa: E402
from embed import embed_cached  # noqa: E402
from floor_report import frame_key  # noqa: E402

from ml.backend import Backend  # noqa: E402
from ml.index import VectorIndex  # noqa: E402

FUSE_DT = 3.0
FEATURES = ["confidence", "share", "top_sim", "margin", "span"]


def features(backend, vector, out):
    ranked, neighbors = backend.index.vote(vector, k=backend.top_k)
    best = defaultdict(float)
    for label, _, sim in neighbors:
        best[label] = max(best[label], sim)
    winner = out["spot"]
    other = max([s for l, s in best.items() if l != winner], default=0.0)
    span = len({floor_of(t["spot"]) for t in out["top3"]}) > 1
    return {"confidence": out["confidence"], "share": ranked[0]["votes"] / backend.top_k,
            "top_sim": neighbors[0][2], "margin": best.get(winner, 0.0) - other, "span": float(span),
            "tally": {r["spot"]: r["votes"] for r in ranked}}


def collect(rows, views, V, graph, ocr, videos, rooms=None):
    D = meters_table(graph, {r["label"] for r in rows})
    near = lambda y, s: s == y or (floor_of(s) == floor_of(y) and D.get((y, s), 1e9) <= NEAR_M)  # noqa: E731
    out = []
    for held in videos:
        train = A.capped(rows, [i for i, r in enumerate(rows) if r["video"] != held])
        seen = {rows[i]["label"] for i in train}
        index = VectorIndex(np.concatenate([X[train] for X in views]), [rows[i]["label"] for i in train] * len(views),
                            ["video"] * len(train) * len(views))
        # locate(), feature extraction and partner simulation reuse identical
        # votes. Cache those immutable fold results, including masked OCR votes.
        original_vote, votes = index.vote, {}
        def cached_vote(query, k=10, mask=None, return_rows=False):
            key = (np.asarray(query).tobytes(), k, None if mask is None else mask.tobytes())
            if key not in votes:
                votes[key] = original_vote(query, k=k, mask=mask, return_rows=True)
            result = votes[key]
            return result if return_rows else result[:2]
        index.vote = cached_vote
        backend = Backend(index, graph, {}, embed_fn=lambda i: V[i], ocr_reader=lambda i: ocr[i], rooms=rooms)
        queries = [i for i in A.at_spot_idx(rows, held) if rows[i]["label"] in seen]
        for i in queries:
            res = backend.locate(i)
            y = rows[i]["label"]
            f = features(backend, V[i], res)
            partners = [j for j in queries if rows[j]["label"] == y and abs(rows[j]["t"] - rows[i]["t"]) >= FUSE_DT]
            fused = None
            if partners:
                j = max(partners, key=lambda j: abs(rows[j]["t"] - rows[i]["t"]))
                second = backend.locate(j)
                g = features(backend, V[j], second)
                tally = defaultdict(int)
                for t in (f["tally"], g["tally"]):
                    for s, v in t.items():
                        tally[s] += v
                ranked = sorted(tally, key=tally.get, reverse=True)
                fused = {"near": near(y, ranked[0]), "top3": y in ranked[:3]}
            out.append({**{k: f[k] for k in FEATURES}, "video": held, "label": y, "spot": res["spot"],
                        "near": near(y, res["spot"]), "exact": res["spot"] == y,
                        "in_top3": y in [t["spot"] for t in res["top3"]], "fused": fused})
        print(f'calibrated fold {held}: {len(queries)} queries, {len(out)} total', flush=True)
    return out


def out_of_fold(records):
    from sklearn.linear_model import LogisticRegression
    X = np.array([[r[k] for k in FEATURES] for r in records])
    y = np.array([r["near"] for r in records])
    videos = np.array([r["video"] for r in records])
    p = np.zeros(len(records))
    for v in np.unique(videos):
        test = videos == v
        model = LogisticRegression(max_iter=1000).fit(X[~test], y[~test])
        p[test] = model.predict_proba(X[test])[:, 1]
    final = LogisticRegression(max_iter=1000).fit(X, y)
    return p, final


def reliability(p, y, bins=(0, .3, .5, .6, .7, .8, .9, 1.01)):
    rows = []
    for lo, hi in zip(bins, bins[1:]):
        m = (p >= lo) & (p < hi)
        if m.any():
            rows.append((f"{lo:.1f}-{min(hi, 1):.1f}", int(m.sum()), float(p[m].mean()), float(y[m].mean())))
    return rows


def tiers(records, p, low, high):
    """User success per tier: auto = returned spot near; picker = truth in top 3; second photo = fused result
    near, else picker on the fused top 3 (no third photo). Frames without a partner fall back to the picker."""
    t = defaultdict(lambda: [0, 0])
    for r, q in zip(records, p):
        if q >= high and not r["span"]:
            t["auto"][0] += 1
            t["auto"][1] += r["near"]
        elif q >= low:
            t["picker"][0] += 1
            t["picker"][1] += r["in_top3"]
        else:
            t["second"][0] += 1
            fused = r["fused"]
            t["second"][1] += (fused["near"] or fused["top3"]) if fused else r["in_top3"]
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, nargs="+", required=True)
    ap.add_argument("--graph", type=Path, default=Path("data/graph.json"))
    ap.add_argument("--rooms", type=Path, default=Path("data/rooms.json"))
    ap.add_argument("--cap", type=int, default=250)
    ap.add_argument("--model", choices=("dinov2", "megaloc"), default="dinov2")
    ap.add_argument("--out", type=Path, default=Path("data/reports/calibration.json"))
    args = ap.parse_args()
    A.CAP = args.cap
    graph = json.loads(args.graph.read_text())
    nodes = {n["id"] for n in graph["nodes"]}
    rows = [r for d in args.dataset for r in load_frames(d) if r["label"] in nodes]
    paths = [r["path"] for r in rows]
    V = embed_cached(args.model, paths, prep="pad" if args.model == "dinov2" else "center")
    views = ([V] + [embed_cached("dinov2", paths, crop=c, prep="pad") for c in ("left", "right")]
             if args.model == "dinov2" else [V])
    cache = json.loads(Path("data/cache/ocr_frames.json").read_text())
    ocr = [tuple(cache.get(frame_key(r), (None, None))) for r in rows]
    videos = sorted({r["video"] for r in rows})

    rooms = json.loads(args.rooms.read_text()) if args.rooms.exists() else []
    records = collect(rows, views, V, graph, ocr, videos, rooms=rooms)
    y = np.array([r["near"] for r in records], dtype=float)
    p, model = out_of_fold(records)
    conf = np.array([r["confidence"] for r in records])
    n = len(records)
    print(f"n={n}  near={y.mean():.1%}  exact={np.mean([r['exact'] for r in records]):.1%}  "
          f"in_top3={np.mean([r['in_top3'] for r in records]):.1%}")
    print("\nreliability  bin  n  mean_pred  actual   (raw confidence | calibrated)")
    for name, score in (("raw", conf), ("calibrated", p)):
        print(f"  {name}")
        for b, k, mp, acc in reliability(score, y):
            print(f"    {b:9} {k:5} {mp:8.2f} {acc:8.2f}")
    with_partner = [r for r in records if r["fused"]]
    print(f"\nsecond photo (n={len(with_partner)} with a partner frame): single near "
          f"{np.mean([r['near'] for r in with_partner]):.1%} -> fused near "
          f"{np.mean([r['fused']['near'] for r in with_partner]):.1%}")
    grid = []
    print("\n  low  high   auto%  auto_ok  picker%  picker_ok  second%  second_ok  user_success")
    for low in (0.3, 0.4, 0.5):
        for high in (0.7, 0.8, 0.9):
            t = tiers(records, p, low, high)
            success = sum(v[1] for v in t.values()) / n
            cells = []
            for k in ("auto", "picker", "second"):
                m, ok = t[k]
                cells += [m / n, ok / m if m else 0]
            grid.append({"low": low, "high": high, "tiers": {k: list(v) for k, v in t.items()}, "user": success})
            print(f"  {low:.1f}  {high:.1f}  " + "  ".join(f"{c:7.1%}" for c in cells) + f"  {success:10.1%}")
    old = sum((r["in_top3"] if (r["confidence"] < 0.6 or r["span"]) else r["near"]) for r in records) / n
    print(f"\ncurrent flow (picker below 0.6 or floors split): user success {old:.1%}")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "model": args.model, "n": n, "features": FEATURES, "coef": model.coef_[0].tolist(), "intercept": float(model.intercept_[0]),
        "current_user_success": old, "grid": grid}, indent=1))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
