"""Build index.npz for the API from labeled, face-blurred frames.

Only spots that exist in graph.json go in (the API rejects unknown nodes). Each spot is capped to an evenly spaced
sample. --center subtracts every video's mean vector to strip a filming session's lighting signature, with queries
centered by the global mean `mu`. It helped one held-out split but lost under leave-one-video-out (floor 0.68 vs
0.75 raw: centering a one-spot clip erases that spot), so it's off by default and `mu` is zero.

Usage:
    python ml/build_index.py --dataset data/dataset data/dataset_new data/dataset_f2 --out data/index.npz
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import cap_per_label, load_frames  # noqa: E402
from embed import embed_cached  # noqa: E402

CAP = 60


def center_by_video(vecs, videos):
    out = vecs.copy()
    groups = defaultdict(list)
    for i, v in enumerate(videos):
        groups[v].append(i)
    for idx in groups.values():
        out[idx] -= vecs[idx].mean(0)
    return out / np.linalg.norm(out, axis=1, keepdims=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, nargs="+", default=[Path("data/dataset")])
    ap.add_argument("--graph", type=Path, default=Path("data/graph.json"))
    ap.add_argument("--cap", type=int, default=CAP)
    ap.add_argument("--out", type=Path, default=Path("data/index.npz"))
    ap.add_argument("--center", action="store_true", help="per-video centering (see docstring)")
    args = ap.parse_args()

    nodes = {n["id"] for n in json.loads(args.graph.read_text())["nodes"]}
    rows = [r for d in args.dataset for r in load_frames(d)]
    skipped = Counter(r["label"] for r in rows if r["label"] not in nodes)
    rows = cap_per_label([r for r in rows if r["label"] in nodes], args.cap)

    raw = embed_cached("dinov2", [r["path"] for r in rows])
    vecs = center_by_video(raw, [r["video"] for r in rows]) if args.center else raw
    mu = raw.mean(0) if args.center else np.zeros(raw.shape[1])
    labels = np.array([r["label"] for r in rows])
    np.savez(args.out, vecs=vecs.astype(np.float16), labels=labels,
             source=np.array(["video"] * len(rows)), mu=mu.astype(np.float32))

    counts = Counter(labels)
    print(f"{args.out}: {len(rows)} vectors, {len(counts)} spots")
    for floor in ("B1", "F1", "F2"):
        spots = sorted(l for l in counts if l.startswith(floor))
        print(f"  {floor}: {len(spots)} spots, {sum(counts[s] for s in spots)} vectors")
    if skipped:
        print("not in graph, left out: " + ", ".join(f"{l} ({n})" for l, n in skipped.most_common()))


if __name__ == "__main__":
    main()
