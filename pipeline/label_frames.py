"""Label frames from spoken-callout anchors, drop blurry and duplicate frames, sort into a dataset folder.

anchors.json maps each video to [[t_sec, node_id, source_note], ...]. A frame takes the label of the last anchor
at or before its timestamp. For one-spot clips a single [0, node_id, note] anchor labels the whole clip.

Usage:
    python pipeline/label_frames.py --frames data/frames --anchors data/anchors.json --nodes data/graph.json --out data/dataset
--nodes accepts graph.json (uses node ids) or a plain text file with one node id per line.
Writes <out>/labels.csv in the format in docs/contract.md.
"""
import argparse
import csv
import json
import re
import shutil
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

BLUR_THRESHOLD = 300  # Laplacian variance at 96 px wide; below this is motion blur, floor or blank wall
DUP_THRESHOLD = 4     # mean abs difference of an 8x8 grayscale grid vs the previous frame
EXCLUDE = {"F1_service_corridor", "F1_loading_dock"}  # restricted areas never go in the index


def load_nodes(path):
    if path.suffix == ".json":
        return {n["id"] for n in json.loads(path.read_text())["nodes"]}
    return {line.strip() for line in path.read_text().splitlines() if line.strip()}


def frame_stats(img):
    h, w = img.shape[:2]
    # Bilinear, not area: area averaging smooths frames and roughly doubles the blurry/duplicate rejects
    small = cv2.resize(img, (96, round(96 * h / w)), interpolation=cv2.INTER_LINEAR)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
    sharpness = cv2.Laplacian(gray, cv2.CV_32F)[1:-1, 1:-1].var()
    gh, gw = gray.shape
    grid = gray[[gh * k // 8 for k in range(8)]][:, [gw * k // 8 for k in range(8)]]  # point samples
    return sharpness, grid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=Path, required=True)
    ap.add_argument("--anchors", type=Path, required=True)
    ap.add_argument("--nodes", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    anchors = json.loads(args.anchors.read_text())
    nodes = load_nodes(args.nodes)
    counts = Counter()
    rows = []
    for video, video_anchors in anchors.items():
        files = sorted((args.frames / video).glob("*.jpg"))
        if not files:
            print(f"skip {video}: no frames")
            continue
        video_anchors = sorted(video_anchors)
        prev_grid = None
        next_spot = {}  # heading = the next different spot along the walk
        for i, a in enumerate(video_anchors):
            later = [b[1] for b in video_anchors[i + 1:] if b[1] != a[1]]
            next_spot[i] = later[0] if later else ""
        for f in files:
            n = int(re.search(r"_(\d+)\.jpg$", f.name).group(1))
            t = (n - 1) / 2
            idx = max(i for i, a in enumerate(video_anchors) if a[0] <= t) if video_anchors[0][0] <= t else 0
            label, note = video_anchors[idx][1], video_anchors[idx][2]
            img = cv2.imread(str(f))
            sharpness, grid = frame_stats(img)
            dup = prev_grid is not None and float(np.abs(grid - prev_grid).mean()) < DUP_THRESHOLD
            prev_grid = grid
            in_graph = label in nodes
            if label in EXCLUDE:
                status = "exclude_restricted"
            elif sharpness < BLUR_THRESHOLD:
                status = "reject_blurry"
            elif dup:
                status = "reject_duplicate"
            elif not in_graph:
                status = "review_not_in_graph"
            else:
                status = "keep"
            dest = args.out / ("train/" + label if status == "keep" else status)
            dest.mkdir(parents=True, exist_ok=True)
            yaw = re.search(r"(_y\d{3})_\d+\.jpg$", f.name)  # split_360.py crops share one video and t
            name = f"{label}__{video}{yaw.group(1) if yaw else ''}_t{t:05.1f}.jpg"
            shutil.copy2(f, dest / name)
            rows.append([name, video, t, label, note.split(":")[0].split(" ")[0], in_graph,
                         round(sharpness), dup, status, next_spot[idx]])
            counts[status] += 1
            if status == "keep":
                counts["spot:" + label] += 1

    args.out.mkdir(parents=True, exist_ok=True)
    with open(args.out / "labels.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "video", "t_sec", "label", "label_source", "in_graph", "sharpness", "dup_of_prev", "status", "heading"])
        w.writerows(rows)
    print({k: v for k, v in counts.items() if not k.startswith("spot:")})
    spots = sorted((k[5:], v) for k, v in counts.items() if k.startswith("spot:"))
    print(f"{len(spots)} spots kept:", ", ".join(f"{s} {v}" for s, v in spots))
    thin = [s for s, v in spots if v < 20]
    if thin:
        print("under 20 frames (re-film):", ", ".join(thin))


if __name__ == "__main__":
    main()
