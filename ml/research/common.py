"""Shared helpers: dataset loading, floors, graph distances, voting."""
import csv
import json
from collections import defaultdict
from pathlib import Path

import networkx as nx
import numpy as np

FLOORS = {"B1": -1, "F1": 1, "F2": 2}
FLOOR_PENALTY_M = 50  # distance charged per floor when a guess lands on the wrong floor


def floor_of(label):
    return FLOORS.get(label.split("_")[0])


def load_frames(dataset):
    """Kept frames from <dataset>/labels.csv as dicts with path, label, video, t."""
    dataset = Path(dataset)
    rows = []
    with open(dataset / "labels.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["status"] != "keep":
                continue
            path = dataset / "train" / r["label"] / r["file"]
            if path.exists():
                rows.append({"path": path, "label": r["label"], "video": r["video"], "t": float(r["t_sec"])})
    return rows


def cap_per_label(rows, cap):
    """Evenly spaced subsample so no spot has more than `cap` frames (the B1 walk over-represents B1)."""
    by = defaultdict(list)
    for r in rows:
        by[r["label"]].append(r)
    out = []
    for items in by.values():
        items.sort(key=lambda r: (r["video"], r["t"]))
        if cap and len(items) > cap:
            idx = np.linspace(0, len(items) - 1, cap).round().astype(int)
            items = [items[i] for i in idx]
        out.extend(items)
    return out


def load_graph(path="data/graph.json"):
    g = json.loads(Path(path).read_text())
    G = nx.Graph()
    for n in g["nodes"]:
        G.add_node(n["id"])
    for e in g["edges"]:
        m = e.get("meters", 0)
        if e.get("vertical"):
            m += FLOOR_PENALTY_M * abs(floor_of(e["from"]) - floor_of(e["to"])) if floor_of(e["from"]) and floor_of(e["to"]) else FLOOR_PENALTY_M
        G.add_edge(e["from"], e["to"], weight=m)
    return G


def distance_table(G, labels):
    """Walking meters between every pair of labels; None where a label isn't in the graph."""
    labels = list(labels)
    D = {}
    for a in labels:
        if a not in G:
            continue
        lengths = nx.single_source_dijkstra_path_length(G, a, weight="weight")
        for b in labels:
            if b in lengths:
                D[a, b] = lengths[b]
    return D


def vote(sims, labels, k):
    """Top-k neighbor voting. Returns [(label, votes, sim_sum)] best first; ties go to higher total similarity."""
    top = np.argpartition(-sims, min(k, len(sims) - 1))[:k]
    tally = defaultdict(lambda: [0, 0.0])
    for i in top:
        tally[labels[i]][0] += 1
        tally[labels[i]][1] += float(sims[i])
    return sorted(((l, v, s) for l, (v, s) in tally.items()), key=lambda x: (-x[1], -x[2]))
