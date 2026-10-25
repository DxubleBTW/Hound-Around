"""Confusion-matrix heatmap and per-spot accuracy floor maps (gameplan section 6, admin and evaluation view).

Same protocol as analyze.py: leave-one-video-out on at-spot frames, plain top-10 voting over raw DINOv2 vectors
(what ml/index.py ships), at most 60 training frames per spot. Spots seen in only one video can't be tested and
show gray. Team-only output: it reveals the building layout, so it is written under data/ and never committed.

Usage:
    python ml/research/heatmap.py --dataset data/dataset data/dataset_new data/dataset_f2 --out data/reports/before
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import analyze as A  # noqa: E402
from common import floor_of, load_frames  # noqa: E402
from embed import embed_cached  # noqa: E402

FLOORS = ("B1", "F1", "F2")


def per_spot(rows, results):
    stats = defaultdict(lambda: {"frames": 0, "videos": set(), "n": 0, "top1": 0, "top3": 0, "floor": 0})
    for r in rows:
        stats[r["label"]]["frames"] += 1
        stats[r["label"]]["videos"].add(r["video"])
    for truth, top3 in results:
        s = stats[truth]
        s["n"] += 1
        s["top1"] += top3[0] == truth
        s["top3"] += truth in top3
        s["floor"] += floor_of(top3[0]) == floor_of(truth)
    return stats


def confusion_figure(results, spots, path):
    import matplotlib.pyplot as plt
    index = {s: i for i, s in enumerate(spots)}
    m = np.zeros((len(spots), len(spots)))
    for truth, top3 in results:
        if top3[0] in index:
            m[index[truth], index[top3[0]]] += 1
    rows = m.sum(1, keepdims=True)
    m = np.divide(m, rows, out=np.zeros_like(m), where=rows > 0)
    fig, ax = plt.subplots(figsize=(max(8, len(spots) * 0.28), max(7, len(spots) * 0.26)))
    im = ax.imshow(m, cmap="magma", vmin=0, vmax=1)
    ax.set_xticks(range(len(spots)), spots, rotation=90, fontsize=7)
    ax.set_yticks(range(len(spots)), spots, fontsize=7)
    ax.set_xlabel("predicted (top-1)")
    ax.set_ylabel("true spot")
    # Floor blocks: anything off the diagonal block is a wrong-floor answer.
    edges = [i for i in range(1, len(spots)) if floor_of(spots[i]) != floor_of(spots[i - 1])]
    for e in edges:
        ax.axhline(e - 0.5, color="cyan", lw=0.8)
        ax.axvline(e - 0.5, color="cyan", lw=0.8)
    fig.colorbar(im, ax=ax, fraction=0.03, label="share of that spot's photos")
    ax.set_title("Hound Around: leave-one-video-out confusion (rows sum to 1)")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def floor_figure(stats, graph, path):
    import matplotlib.pyplot as plt
    nodes = {n["id"]: n for n in graph["nodes"]}
    fig, axes = plt.subplots(1, len(FLOORS), figsize=(18, 6))
    cmap = plt.get_cmap("RdYlGn")
    for ax, floor in zip(axes, FLOORS):
        ids = [i for i in nodes if i.startswith(floor + "_")]
        for e in graph["edges"]:
            a, b = nodes.get(e["from"]), nodes.get(e["to"])
            if a and b and e["from"] in ids and e["to"] in ids:
                ax.plot([a["x"], b["x"]], [a["y"], b["y"]], color="#bbb", lw=1, zorder=1)
        for i in ids:
            n, s = nodes[i], stats.get(i)
            tested = s and s["n"]
            color = cmap(s["top1"] / s["n"]) if tested else "#888"
            size = 30 + (min(s["frames"], 120) * 2 if s else 0)
            ax.scatter(n["x"], n["y"], s=size, color=color, edgecolor="k", lw=0.5, zorder=2)
            if s:
                tag = f"{s['top1'] / s['n']:.0%}" if tested else f"{len(s['videos'])}v"
                ax.annotate(f"{i[len(floor) + 1:]}\n{tag}", (n["x"], n["y"]), fontsize=6, ha="center",
                            va="bottom", xytext=(0, 5), textcoords="offset points")
        ax.set_title(f"{floor}: top-1 by spot (gray = untested, size = frames)")
        ax.invert_yaxis()
        ax.set_aspect("equal")
        ax.axis("off")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, nargs="+", required=True)
    ap.add_argument("--graph", type=Path, default=Path("data/graph.json"))
    ap.add_argument("--out", type=Path, default=Path("data/reports/heatmap"))
    args = ap.parse_args()

    graph = json.loads(args.graph.read_text())
    in_scope = {n["id"] for n in graph["nodes"] if n["id"].split("_")[0] in FLOORS}
    rows = [r for d in args.dataset for r in load_frames(d) if r["label"] in in_scope]
    V = embed_cached("dinov2", [r["path"] for r in rows])
    results = A.lovo(rows, V, sorted({r["video"] for r in rows}), variant="raw")
    stats = per_spot(rows, results)

    args.out.mkdir(parents=True, exist_ok=True)
    spots = sorted({t for t, _ in results}, key=lambda s: (FLOORS.index(s.split("_")[0]), s))
    confusion_figure(results, spots, args.out / "confusion.png")
    floor_figure(stats, graph, args.out / "floors.png")

    o = A.summarize(results)
    summary = {"frames": len(rows), "videos": len({r["video"] for r in rows}), "spots": len(stats),
               "tested_spots": len(spots), "queries": o["n"], "top1": o["top1"], "top3": o["top3"], "floor": o["floor"],
               "per_floor": {f: A.summarize([x for x in results if x[0].startswith(f)]) for f in FLOORS},
               "untested": sorted(s for s in stats if not stats[s]["n"]),
               "thin": sorted(s for s in stats if stats[s]["frames"] < 20),
               "top_confusions": Counter((t, p[0]) for t, p in results if p[0] != t).most_common(10)}
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2, default=list))
    print(f"{summary['frames']} frames, {summary['videos']} videos, {summary['spots']} spots "
          f"({summary['tested_spots']} testable)")
    print(f"LOVO top1 {o['top1']:.3f}  top3 {o['top3']:.3f}  floor {o['floor']:.3f}  (n={o['n']})")
    for f, r in summary["per_floor"].items():
        print(f"  {f}: top1 {r['top1']:.2f} top3 {r['top3']:.2f} floor {r['floor']:.2f} n={r['n']}")
    print("untested (one video):", ", ".join(summary["untested"]) or "none")
    print("under 20 frames:", ", ".join(summary["thin"]) or "none")
    print("most common mix-ups:", "; ".join(f"{t}->{p} x{n}" for (t, p), n in summary["top_confusions"]))
    print(f"wrote {args.out}/confusion.png, floors.png, summary.json")


if __name__ == "__main__":
    main()
