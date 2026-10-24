"""How much more footage do we need, and which index tricks help? Leave-one-video-out (LOVO) on at-spot frames.

1. Coverage: per spot, frames, videos, sessions, and LOVO accuracy.
2. Learning curves: accuracy vs number of training videos per floor, and vs frames per spot.
3. Index variants compared under the same LOVO protocol.

Usage:
    python ml/analyze.py --dataset data/dataset data/dataset_new data/dataset_f2
"""
import argparse
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from build_index import center_by_video  # noqa: E402
from common import cap_per_label, floor_of, load_frames, vote  # noqa: E402
from embed import embed_cached  # noqa: E402
from eval import at_spot  # noqa: E402

CAP = 60
AT_SPOT_S = 6


def session(video):
    """Filming sessions on Saturday, from the clip numbers."""
    if video.startswith("IMG_29") or video in ("IMG_4521", "IMG_4522"):
        return "8am"
    if video.startswith("IMG_86"):
        return "9am"
    return "10am"


def norm(x):
    return x / np.linalg.norm(x, axis=-1, keepdims=True)


def run(rows, V, train_idx, query_idx, variant="center"):
    """Returns per-query (truth, top3) for one split."""
    train_idx = [i for i in train_idx]
    labels = [rows[i]["label"] for i in train_idx]
    T, Q = V[train_idx], V[query_idx]
    if variant == "session":
        mu = T.mean(0)
        T, Q = center_by_video(T, [session(rows[i]["video"]) for i in train_idx]), norm(Q - mu)
    elif variant != "raw":
        mu = T.mean(0)
        T, Q = center_by_video(T, [rows[i]["video"] for i in train_idx]), norm(Q - mu)
    if variant == "center+dba":
        # database-side augmentation: blend each vector with its 2 nearest same-spot neighbors
        S = T @ T.T
        same = np.array(labels)[:, None] == np.array(labels)[None, :]
        S[~same] = -1
        nn = np.argsort(-S, 1)[:, :3]  # includes itself
        T = norm(T[nn].mean(1))
    out = []
    for qi, q in zip(query_idx, Q):
        sims = T @ q
        if variant == "center+weighted":
            top = np.argsort(-sims)[:10]
            score = defaultdict(float)
            for i in top:
                score[labels[i]] += np.exp(sims[i] / 0.05)
            top3 = sorted(score, key=lambda l: -score[l])[:3]
        else:
            top3 = [l for l, _, _ in vote(sims, labels, 10)[:3]]
        out.append((rows[qi]["label"], top3))
    return out


def summarize(results):
    n = len(results)
    if not n:
        return {"n": 0, "top1": float("nan"), "top3": float("nan"), "floor": float("nan")}
    return {"n": n, "top1": sum(t == p[0] for t, p in results) / n, "top3": sum(t in p for t, p in results) / n,
            "floor": sum(floor_of(t) == floor_of(p[0]) for t, p in results) / n}


def lovo(rows, V, videos, variant="center", train_filter=None):
    results = []
    for held in videos:
        train = [i for i, r in enumerate(rows) if r["video"] != held and (not train_filter or train_filter(r))]
        train = capped(rows, train)
        seen = {rows[i]["label"] for i in train}
        q = [i for i in at_spot_idx(rows, held) if rows[i]["label"] in seen]
        if q:
            results += run(rows, V, train, q, variant)
    return results


def capped(rows, idx):
    keep = {id(r) for r in cap_per_label([rows[i] for i in idx], CAP)}
    return [i for i in idx if id(rows[i]) in keep]


_at_spot_cache = {}


def at_spot_idx(rows, video):
    if video not in _at_spot_cache:
        pos = {id(r): i for i, r in enumerate(rows)}
        _at_spot_cache[video] = [pos[id(r)] for r in at_spot([r for r in rows if r["video"] == video], AT_SPOT_S)]
    return _at_spot_cache[video]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, nargs="+", default=[Path("data/dataset")])
    args = ap.parse_args()
    rows = [r for d in args.dataset for r in load_frames(d)]
    V = embed_cached("dinov2", [r["path"] for r in rows])
    videos = sorted({r["video"] for r in rows})

    # 1. coverage and per-spot LOVO accuracy
    res = lovo(rows, V, videos)
    per = defaultdict(list)
    for t, p in res:
        per[t].append((t, p))
    spots = defaultdict(lambda: {"frames": 0, "videos": set(), "sessions": set()})
    for r in rows:
        s = spots[r["label"]]
        s["frames"] += 1
        s["videos"].add(r["video"])
        s["sessions"].add(session(r["video"]))
    print("1. COVERAGE (LOVO accuracy on at-spot frames; '-' = only one video, can't test)\n")
    print(f"{'spot':18}{'frames':>7}{'videos':>7}{'sessions':>9}{'top1':>7}{'top3':>7}{'n':>5}")
    for floor in ("B1", "F1", "F2"):
        for l in sorted(s for s in spots if s.startswith(floor)):
            s, r = spots[l], summarize(per[l])
            acc = f"{r['top1']:>7.2f}{r['top3']:>7.2f}{r['n']:>5}" if r["n"] else f"{'-':>7}{'-':>7}{0:>5}"
            print(f"{l:18}{s['frames']:>7}{len(s['videos']):>7}{','.join(sorted(s['sessions'])):>9}{acc}")
        f = summarize([x for x in res if x[0].startswith(floor)])
        print(f"{floor + ' overall':18}{'':23}{f['top1']:>7.2f}{f['top3']:>7.2f}{f['n']:>5}\n")
    o = summarize(res)
    print(f"ALL: top1 {o['top1']:.3f} top3 {o['top3']:.3f} floor {o['floor']:.3f} (n={o['n']})\n")

    # 2a. accuracy vs number of training videos on the same floor (other floors fully included)
    print("2a. LEARNING CURVE: top3 vs training videos on the query's floor (3 random draws each)\n")
    rng = random.Random(0)
    for floor in ("B1", "F2"):
        fv = sorted({r["video"] for r in rows if r["label"].startswith(floor)})
        line = []
        for m in range(1, len(fv)):
            acc = []
            for held in fv:
                others = [v for v in fv if v != held]
                for _ in range(3):
                    pick = set(rng.sample(others, m))
                    keep = lambda r, pick=pick, held=held: not r["label"].startswith(floor) or r["video"] in pick
                    train = capped(rows, [i for i, r in enumerate(rows) if r["video"] != held and keep(r)])
                    seen = {rows[i]["label"] for i in train}
                    q = [i for i in at_spot_idx(rows, held) if rows[i]["label"] in seen and rows[i]["label"].startswith(floor)]
                    if q:
                        acc += run(rows, V, train, q)
            s = summarize(acc)
            line.append(f"{m} video{'s' if m > 1 else ' '}: top1 {s['top1']:.2f} top3 {s['top3']:.2f}")
        print(f"  {floor} ({len(fv)} videos): " + " | ".join(line))

    # 2b. accuracy vs frames per spot, all videos
    print("\n2b. LEARNING CURVE: frames per spot (same videos, subsampled)\n")
    for cap in (5, 10, 20, 40, 60):
        global CAP
        CAP = cap
        s = summarize(lovo(rows, V, videos))
        print(f"  cap {cap:>3}: top1 {s['top1']:.3f} top3 {s['top3']:.3f} floor {s['floor']:.3f}")
    CAP = 60

    # 3. index variants
    print("\n3. INDEX VARIANTS (LOVO, all floors)\n")
    for variant in ("raw", "center", "center+weighted", "center+dba"):
        s = summarize(lovo(rows, V, videos, variant))
        print(f"  {variant:18} top1 {s['top1']:.3f} top3 {s['top3']:.3f} floor {s['floor']:.3f}")
    s = summarize(lovo(rows, V, videos, train_filter=lambda r: True))
    walk_at_spot = set(id(r) for v in videos for r in [rows[i] for i in at_spot_idx(rows, v)])
    s2 = summarize(lovo(rows, V, videos, train_filter=lambda r: id(r) in walk_at_spot))
    print(f"  {'train at-spot only':18} top1 {s2['top1']:.3f} top3 {s2['top3']:.3f} floor {s2['floor']:.3f}")


if __name__ == "__main__":
    main()
