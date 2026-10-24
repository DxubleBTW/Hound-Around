"""Evaluate spot recognition and print the experiments table.

Val mode (default): hold out frames from the training videos. A spot filmed in two passes (the B1 walk goes out and
back) holds out its last pass; a one-pass spot holds out its last 25% of frames, with a 2 s gap dropped before it so
near-identical neighbors don't leak. Val frames still come from the same session as train, so treat val accuracy as
an upper bound. The real number is the outsider test set.

Session mode (--val-videos): hold out whole videos, e.g. a later walk of the same floor. This is the honest val
number, and holding out a walk filmed in the opposite direction measures the direction gap.

Test mode (--test DIR): train on every kept frame, query outsider photos named TEST_<node>_NN.jpg.

Usage:
    python ml/eval.py --dataset data/dataset
    python ml/eval.py --dataset data/dataset data/dataset_new --val-videos IMG_8627,IMG_8628
    python ml/eval.py --dataset data/dataset --test data/test --ocr
"""
import argparse
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import cap_per_label, distance_table, floor_of, load_frames, load_graph  # noqa: E402
from embed import embed_cached  # noqa: E402
from methods import ClassNN, Combo, CropKnn, Hier, Knn, Probe  # noqa: E402

CAP = 60
UNSURE = 0.6
SEGMENT_GAP_S = 3.0
HOLDOUT_FRAC = 0.25
BUFFER_S = 2.0


def split(rows):
    by = defaultdict(list)
    for r in rows:
        by[r["label"]].append(r)
    train, val = [], []
    for items in by.values():
        items.sort(key=lambda r: (r["video"], r["t"]))
        segs = [[items[0]]]
        for prev, cur in zip(items, items[1:]):
            new = cur["video"] != prev["video"] or cur["t"] - prev["t"] > SEGMENT_GAP_S
            (segs.append([cur]) if new else segs[-1].append(cur))
        if len(segs) >= 2:
            val += segs[-1]
            train += [r for s in segs[:-1] for r in s]
        elif len(items) >= 8:
            cut = items[int(len(items) * (1 - HOLDOUT_FRAC))]["t"]
            val += [r for r in items if r["t"] >= cut]
            train += [r for r in items if r["t"] < cut - BUFFER_S]
        else:
            train += items  # too few frames to hold any out
    return train, val


def at_spot(rows, seconds):
    """Keep frames within `seconds` of the callout that started their segment. Walk frames after that show the
    camera moving toward the next spot while still carrying the previous spot's label."""
    by = defaultdict(list)
    for r in rows:
        by[r["video"], r["label"]].append(r)
    keep = []
    for items in by.values():
        items.sort(key=lambda r: r["t"])
        start = items[0]["t"]
        for prev, cur in zip([None] + items, items):
            if prev and cur["t"] - prev["t"] > SEGMENT_GAP_S:
                start = cur["t"]
            if cur["t"] - start <= seconds:
                keep.append(cur)
    return keep


def load_test(test_dir):
    rows = []
    for p in sorted(Path(test_dir).glob("TEST_*.*")):
        m = re.match(r"TEST_(.+)_\d+$", p.stem)
        if m:
            rows.append({"path": p, "label": m.group(1)})
    return rows


def score(method, Q, truth, D, ocr_floors=None):
    hits1 = hits3 = floor_ok = unsure = conf_right = conf_n = 0
    errs, ms = [], []
    for i, q in enumerate(Q):
        t0 = time.perf_counter()
        pred = method.predict(q, ocr_floors[i] if ocr_floors else None)
        ms.append((time.perf_counter() - t0) * 1000)
        top = [l for l, _ in pred[:3]]
        y = truth[i]
        hits1 += top[0] == y
        hits3 += y in top
        floor_ok += floor_of(top[0]) == floor_of(y)
        if (y, top[0]) in D:
            errs.append(D[y, top[0]])
        if pred[0][1] < UNSURE:
            unsure += 1
        else:
            conf_n += 1
            conf_right += top[0] == y
    n = len(Q)
    return {"top1": hits1 / n, "top3": hits3 / n, "floor": floor_ok / n,
            "med_err_m": float(np.median(errs)) if errs else float("nan"),
            "unsure": unsure / n, "acc_when_sure": conf_right / conf_n if conf_n else float("nan"),
            "ms": float(np.median(ms))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, nargs="+", default=[Path("data/dataset")])
    ap.add_argument("--graph", type=Path, default=Path("data/graph.json"))
    ap.add_argument("--test", type=Path, help="folder of outsider TEST_<node>_NN.jpg photos")
    ap.add_argument("--val-videos", help="comma-separated videos to hold out as queries")
    ap.add_argument("--floor", help="only use spots on this floor (B1, F1, F2)")
    ap.add_argument("--at-spot", type=float, help="only query frames this many seconds after a callout")
    ap.add_argument("--train-at-spot", type=float, help="same filter for training frames")
    ap.add_argument("--ocr", action="store_true", help="also run the OCR-on rows (slow)")
    ap.add_argument("--models", default="hist,clip,dinov2,dinov2_mean")
    args = ap.parse_args()

    rows = [r for d in args.dataset for r in load_frames(d)]
    if args.floor:
        rows = [r for r in rows if r["label"].startswith(args.floor + "_")]
    if args.test:
        train, query = cap_per_label(rows, CAP), load_test(args.test)
    elif args.val_videos:
        held = set(args.val_videos.split(","))
        train = [r for r in rows if r["video"] not in held]
        if args.train_at_spot:
            train = at_spot(train, args.train_at_spot)
        train = cap_per_label(train, CAP)
        seen = {r["label"] for r in train}
        query = [r for r in rows if r["video"] in held and r["label"] in seen]
        if args.at_spot:
            query = at_spot(query, args.at_spot)
    else:
        train, query = split(rows)
        train = cap_per_label(train, CAP)
    labels = [r["label"] for r in train]
    truth = [r["label"] for r in query]
    mode = "outsider test" if args.test else f"held-out videos {args.val_videos}" if args.val_videos else "held-out val"
    print(f"train {len(train)} frames / {len(set(labels))} spots, query {len(query)} ({mode})\n")
    D = distance_table(load_graph(args.graph), set(labels) | set(truth))
    missing = sorted({l for l in set(labels) | set(truth) if not any(k[0] == l for k in D)})
    if missing:
        print(f"not in graph, excluded from distance error: {', '.join(missing)}\n")

    ocr_floors = None
    if args.ocr:
        from PIL import Image
        from ocr import read_room
        ocr_floors = [read_room(Image.open(r["path"]))[1] for r in query]
        read = sum(f is not None for f in ocr_floors)
        right = sum(f == floor_of(y) for f, y in zip(ocr_floors, truth) if f is not None)
        print(f"OCR read a room number in {read}/{len(query)} queries, floor right in {right}/{read}\n")

    results = []
    vecs = {}
    for m in args.models.split(","):
        V = embed_cached(m, [r["path"] for r in train])
        Q = embed_cached(m, [r["path"] for r in query])
        vecs[m] = (V, Q)
        results.append((f"{m} knn k=10", score(Knn(10).fit(V, labels), Q, truth, D)))

    if "dinov2" in vecs:
        V, Q = vecs["dinov2"]
        for k in (1, 5, 20):
            results.append((f"dinov2 knn k={k}", score(Knn(k).fit(V, labels), Q, truth, D)))
        results.append(("dinov2 best frame per spot", score(ClassNN().fit(V, labels), Q, truth, D)))
        tp, qp = [r["path"] for r in train], [r["path"] for r in query]
        Vc = [V] + [embed_cached("dinov2", tp, crop=c) for c in ("left", "right")]
        Qc = np.stack([Q] + [embed_cached("dinov2", qp, crop=c) for c in ("left", "right")], 1)
        for k in (5, 10):
            results.append((f"dinov2 crops knn k={k}", score(CropKnn(k).fit(Vc, labels), Qc, truth, D)))
        results.append(("dinov2 hier (floor, then spot)", score(Hier().fit(V, labels), Q, truth, D)))
        results.append(("dinov2 probe one-hot", score(Probe(False).fit(V, labels), Q, truth, D)))
        results.append(("dinov2 probe dist-smoothed", score(Probe(True, D).fit(V, labels), Q, truth, D)))
        results.append(("dinov2 combo (probe + knn)", score(Combo(D).fit(V, labels), Q, truth, D)))
        if ocr_floors:
            results.append(("dinov2 hier + OCR floor", score(Hier().fit(V, labels), Q, truth, D, ocr_floors)))

    cols = ["top1", "top3", "floor", "med_err_m", "unsure", "acc_when_sure", "ms"]
    print(f"{'method':34}" + "".join(f"{c:>14}" for c in cols))
    for name, r in results:
        print(f"{name:34}" + "".join(f"{r[c]:>14.3f}" if c != "ms" else f"{r[c]:>14.2f}" for c in cols))


if __name__ == "__main__":
    main()
