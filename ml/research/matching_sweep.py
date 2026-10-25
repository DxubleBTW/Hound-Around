"""Matching-upgrade sweep: every config under the same leave-one-video-out protocol and query set as the baseline.

A config = query preprocessing + index views + per-spot cap. Index views are extra rows per training frame
(e.g. full + left + right crops) with the same label; the cap counts frames, not rows.

Usage:
    python ml/research/matching_sweep.py --steps 1 2
    python ml/research/matching_sweep.py --dataset data/dataset data/dataset_360 ...
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import analyze as A  # noqa: E402
from common import cap_per_label, load_frames, vote  # noqa: E402
from embed import embed_cached  # noqa: E402

DATASETS = ["data/dataset", "data/dataset_new", "data/dataset_f2", "data/dataset_r3"]
K = 10


def lovo(rows, Q, views, cap, videos, k=K):
    """Q: [N, D] query vectors per frame. views: list of [N, D] index vectors per frame (one row each)."""
    results = []
    labels_all = np.array([r["label"] for r in rows])
    pos = {id(r): i for i, r in enumerate(rows)}
    for held in videos:
        train = [pos[id(r)] for r in cap_per_label([r for r in rows if r["video"] != held], cap)]
        seen = set(labels_all[train])
        q = [i for i in A.at_spot_idx(rows, held) if rows[i]["label"] in seen]
        if not q:
            continue
        T = np.concatenate([v[train] for v in views])
        labels = list(labels_all[train]) * len(views)
        S = Q[q] @ T.T
        for qi, sims in zip(q, S):
            results.append((rows[qi]["label"], [l for l, _, _ in vote(sims, labels, k)[:3]]))
    return results


def configs(step):
    """name -> (query (crop, prep) list averaged, index [(crop, prep)], cap)."""
    c = "center"
    full = [("full", c)]
    if step == 0:
        return {"baseline cap60": (full, full, 60)}
    if step == 1:
        return {f"cap {n}": (full, full, n) for n in (60, 120, 250, 500, 0)}
    if step == 2:
        out = {}
        for p in ("center", "pad", "native"):
            out[f"{p} q+i"] = ([("full", p)], [("full", p)], 250)
            out[f"{p} multiview"] = ([("full", p)], [("full", p), ("left", p), ("right", p)], 250)
        out["native q / multiview+center i"] = ([("full", "native")], [("full", "native"), ("left", "native"),
                                                                      ("right", "native"), ("full", c)], 250)
        out["TTA native+center / multiview"] = ([("full", "native"), ("full", c)],
                                               [("full", "native"), ("left", "native"), ("right", "native")], 250)
        return out
    if step == 3:  # run with --model megaloc / boq; `center` means their own square resize
        return {"square cap250": (full, full, 250),
                "native cap250": ([("full", "native")], [("full", "native")], 250),
                "native multiview cap250": ([("full", "native")],
                                            [("full", "native"), ("left", "native"), ("right", "native")], 250)}
    raise ValueError(step)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", nargs="+", default=DATASETS)
    ap.add_argument("--steps", nargs="+", type=int, default=[0, 1, 2])
    ap.add_argument("--model", default="dinov2")
    ap.add_argument("--out", type=Path, default=Path("data/reports/matching_sweep.json"))
    args = ap.parse_args()
    rows = [r for d in args.dataset for r in load_frames(d)]
    paths = [r["path"] for r in rows]
    videos = sorted({r["video"] for r in rows})
    print(f"{len(rows)} frames, {len(videos)} videos", flush=True)
    vec = {}

    def get(crop, prep):
        if (crop, prep) not in vec:
            vec[crop, prep] = embed_cached(args.model, paths, crop=crop, prep=prep)
        return vec[crop, prep]

    report = json.loads(args.out.read_text()) if args.out.exists() else {}
    for step in args.steps:
        print(f"\nSTEP {step}")
        for name, (qspec, ispec, cap) in configs(step).items():
            t = time.time()
            Q = A.norm(sum(get(*s) for s in qspec))
            views = [get(*s) for s in ispec]
            s = A.summarize(lovo(rows, Q, views, cap, videos))
            print(f"  {name:34} top1 {s['top1']:.3f} top3 {s['top3']:.3f} floor {s['floor']:.3f} n={s['n']}"
                  f"  ({time.time() - t:.0f}s)", flush=True)
            report[f"{args.model} | {name}"] = {**s, "datasets": args.dataset}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
