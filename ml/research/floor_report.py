"""Per-floor success rates for the logic the API runs, under leave-one-video-out on at-spot frames.

Success measures:
  exact     top-1 is the true spot
  near      top-1 is within NEAR_M walking meters on the same floor (the route still starts in the right place)
  floor     top-1 is on the true floor
  picker    share of photos where the app shows the top-3 picker (confidence < 0.6 or top 3 span floors)
  user      what the user ends up with: a confident answer that is near, or a picker that contains the true spot

Usage:
    python ml/floor_report.py --dataset data/dataset data/dataset_new data/dataset_f2 --graph data/graph.json
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import analyze as A  # noqa: E402
from common import distance_table, floor_of, load_frames, load_graph  # noqa: E402
from embed import embed_cached  # noqa: E402
from methods import neighborhood_rank  # noqa: E402

NEAR_M = 10
UNSURE = 0.6


def frame_key(r):
    return f"{r['video']}@{r['t']}"  # survives relabeling, unlike the file path


def ocr_floors(rows, idx, cache=Path("data/cache/ocr_frames.json")):
    done = json.loads(cache.read_text()) if cache.exists() else {}
    todo = [i for i in idx if frame_key(rows[i]) not in done]
    if todo:
        from PIL import Image
        from ocr import read_room
        for n, i in enumerate(todo):
            done[frame_key(rows[i])] = read_room(Image.open(rows[i]["path"]))
            if n % 200 == 0:
                print(f"  OCR {n}/{len(todo)}", flush=True)
                cache.write_text(json.dumps(done))
        cache.write_text(json.dumps(done))
    return {i: done[frame_key(rows[i])] for i in idx}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, nargs="+", default=[Path("data/dataset")])
    ap.add_argument("--graph", type=Path, default=Path("data/graph.json"))
    args = ap.parse_args()

    nodes = {n["id"] for n in json.loads(args.graph.read_text())["nodes"]}
    rows = [r for d in args.dataset for r in load_frames(d) if r["label"] in nodes]
    V = embed_cached("dinov2", [r["path"] for r in rows])
    D = distance_table(load_graph(args.graph), {r["label"] for r in rows})
    videos = sorted({r["video"] for r in rows})
    all_q = sorted({i for v in videos for i in A.at_spot_idx(rows, v)})
    ocr = ocr_floors(rows, all_q)
    read = [i for i in all_q if ocr[i][1] is not None]
    right = sum(ocr[i][1] == floor_of(rows[i]["label"]) for i in read)
    print(f"OCR read a room number on {len(read)}/{len(all_q)} test frames, floor right on {right}/{len(read)}\n")

    configs = {"baseline (top-10 vote)": dict(radius=0, use_ocr=False),
               "+ neighborhood votes (step 2)": dict(radius=8, use_ocr=False),
               "+ OCR floor (step 3)": dict(radius=8, use_ocr=True)}
    for name, cfg in configs.items():
        stats = defaultdict(lambda: defaultdict(int))
        for held in videos:
            train = A.capped(rows, [i for i, r in enumerate(rows) if r["video"] != held])
            labels = [rows[i]["label"] for i in train]
            T = V[train]
            seen = set(labels)
            for i in A.at_spot_idx(rows, held):
                y = rows[i]["label"]
                if y not in seen:
                    continue
                of = ocr[i][1] if cfg["use_ocr"] else None
                ranked, conf = neighborhood_rank(T @ V[i], labels, D, cfg["radius"], of)
                top = [l for l, _ in ranked[:3]]
                near = top[0] == y or ((y, top[0]) in D and D[y, top[0]] <= NEAR_M and floor_of(y) == floor_of(top[0]))
                picker = conf < UNSURE or len({floor_of(l) for l in top}) > 1
                for key in (floor_of(y), "all"):
                    s = stats[key]
                    s["n"] += 1
                    s["exact"] += top[0] == y
                    s["near"] += near
                    s["floor"] += floor_of(top[0]) == floor_of(y)
                    s["top3"] += y in top
                    s["picker"] += picker
                    s["user"] += (y in top) if picker else near
        print(name)
        print(f"  {'floor':6}{'n':>6}{'exact':>8}{'near':>8}{'top3':>8}{'floor':>8}{'picker':>8}{'user':>8}")
        for key, label in ((-1, "B1"), (1, "F1"), (2, "F2"), ("all", "all")):
            s = stats[key]
            if s["n"]:
                print(f"  {label:6}{s['n']:>6}" + "".join(f"{s[m] / s['n']:>8.0%}"
                                                     for m in ("exact", "near", "top3", "floor", "picker", "user")))
        print()


if __name__ == "__main__":
    main()
