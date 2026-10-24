"""Run the production ml.backend.Backend on real footage, leave-one-video-out, per floor.

The backend's embedder and OCR reader are injectable, so this feeds it cached real DINOv2 vectors and cached real
EasyOCR reads: the decision logic under test is exactly what the API runs. Scores the final returned spot (not
top3[0]), and distances are walking meters only.

Correction test ("it just learned from you"): for each held-out at-spot frame the backend gets wrong, apply one
correction with that frame's vector, then query the next frame of the same spot 0.5 s later in the same video.

Usage (needs a finished `ml/research/floor_report.py` run for the OCR cache):
    python -m ml.research.backend_eval --dataset data/dataset data/dataset_new data/dataset_f2 --graph data/graph.json
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import analyze as A  # noqa: E402
from common import distance_table, floor_of, load_frames  # noqa: E402
from embed import embed_cached  # noqa: E402
from floor_report import frame_key  # noqa: E402

from ml.backend import Backend  # noqa: E402
from ml.index import VectorIndex  # noqa: E402

NEAR_M = 10
UNSURE = 0.6


def meters_table(graph, labels):
    """Walking meters only: vertical (elevator/stair) edges count their `meters`, never routing `cost`."""
    import networkx as nx
    G = nx.Graph()
    for e in graph["edges"]:
        G.add_edge(e["from"], e["to"], weight=float(e.get("meters", 0)))
    D = {}
    for a in labels:
        if a in G:
            for b, d in nx.single_source_dijkstra_path_length(G, a, weight="weight").items():
                D[a, b] = d
    return D


def evaluate(rows, V, graph, ocr, videos, make_backend):
    D = meters_table(graph, {r["label"] for r in rows})
    stats = defaultdict(lambda: defaultdict(int))
    flips = defaultdict(lambda: [0, 0])
    hijack = [0, 0]  # other-spot frames that flipped to the corrected label
    for held in videos:
        train = A.capped(rows, [i for i, r in enumerate(rows) if r["video"] != held])
        seen = {rows[i]["label"] for i in train}
        index = VectorIndex(V[train], [rows[i]["label"] for i in train], ["video"] * len(train))
        backend = make_backend(index, graph, ocr)
        queries = [i for i in A.at_spot_idx(rows, held) if rows[i]["label"] in seen]
        by_t = {(rows[i]["label"], rows[i]["t"]): i for i, r in enumerate(rows) if r["video"] == held}
        for i in queries:
            y = rows[i]["label"]
            out = backend.locate(i)
            spot, top = out["spot"], [t["spot"] for t in out["top3"]]
            near = spot == y or (floor_of(spot) == floor_of(y) and D.get((y, spot), 1e9) <= NEAR_M)
            picker = out["confidence"] < UNSURE or len({floor_of(s) for s in top}) > 1
            for key in (floor_of(y), "all"):
                s = stats[key]
                s["n"] += 1
                s["exact"] += spot == y
                s["near"] += near
                s["floor"] += floor_of(spot) == floor_of(y)
                s["picker"] += picker
                s["spot_in_picker"] += spot in top
                s["user"] += (y in top) if picker else near
            nxt = by_t.get((y, rows[i]["t"] + 0.5))
            if spot != y and nxt is not None:
                others = [j for j in queries if rows[j]["label"] != y][::max(1, len(queries) // 5)][:5]
                before = {j: backend.locate(j)["spot"] for j in others}
                snap = backend.snapshot()
                backend.apply_correction(backend.prepare_correction(out["vector"], y))
                flips[floor_of(y)][0] += backend.locate(nxt)["spot"] == y
                flips[floor_of(y)][1] += 1
                for j in others:
                    hijack[0] += before[j] != y and backend.locate(j)["spot"] == y
                    hijack[1] += 1
                backend.restore(snap)
    return stats, flips, hijack


def print_table(name, stats, flips, hijack):
    print(name)
    print(f"  {'floor':6}{'n':>6}{'exact':>8}{'near':>8}{'floor':>8}{'picker':>8}{'user':>8}{'learns':>9}")
    for key, label in ((-1, "B1"), (1, "F1"), (2, "F2"), ("all", "all")):
        s = stats[key]
        if not s["n"]:
            continue
        f = flips[key] if key != "all" else [sum(v[0] for v in flips.values()), sum(v[1] for v in flips.values())]
        learn = f"{f[0] / f[1]:>9.0%}" if f[1] else f"{'-':>9}"
        print(f"  {label:6}{s['n']:>6}" + "".join(f"{s[m] / s['n']:>8.0%}"
                                             for m in ("exact", "near", "floor", "picker", "user")) + learn)
    miss = stats["all"]["n"] - stats["all"]["spot_in_picker"]
    print(f"  returned spot missing from top3 (review N03): {miss}")
    print(f"  corrections that hijacked another spot's frame: {hijack[0]}/{hijack[1]}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, nargs="+", default=[Path("data/dataset")])
    ap.add_argument("--graph", type=Path, default=Path("data/graph.json"))
    args = ap.parse_args()
    graph = json.loads(args.graph.read_text())
    nodes = {n["id"] for n in graph["nodes"]}
    rows = [r for d in args.dataset for r in load_frames(d) if r["label"] in nodes]
    V = embed_cached("dinov2", [r["path"] for r in rows])
    cache = json.loads(Path("data/cache/ocr_frames.json").read_text())
    ocr = [tuple(cache.get(frame_key(r), (None, None))) for r in rows]
    videos = sorted({r["video"] for r in rows})

    def make(index, graph, ocr):
        return Backend(index, graph, {}, embed_fn=lambda i: V[i], ocr_reader=lambda i: ocr[i])

    print_table("ml.backend (main)", *evaluate(rows, V, graph, ocr, videos, make))


if __name__ == "__main__":
    main()
