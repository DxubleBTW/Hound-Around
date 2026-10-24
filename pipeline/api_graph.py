"""Make the API's graph.json and rooms.json from the walk-sheet graph plus a private patch file.

- Drops floors the event can't use (the API only accepts B1, F1, F2).
- Adds nodes found on video but missing from the walk sheets (patch "add_nodes" / "add_edges").
- verify edges: the API skips `verify: true`, which strands the spots behind them. Edges walked on video are marked
  confirmed. With "keep_unconfirmed", the rest stay routable and are tagged `assumed` so the walk can still check them.
- Writes rooms.json from the patch's "rooms".

Usage:
    python pipeline/api_graph.py --graph data/graph_walksheets.json --patch data/graph_patch.json --out data
"""
import argparse
import json
from pathlib import Path

FLOORS = (-1, 1, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph", type=Path, default=Path("data/graph_walksheets.json"))
    ap.add_argument("--patch", type=Path, default=Path("data/graph_patch.json"))
    ap.add_argument("--out", type=Path, default=Path("data"))
    args = ap.parse_args()

    g = json.loads(args.graph.read_text())
    patch = json.loads(args.patch.read_text())
    g["nodes"] = [n for n in g["nodes"] if n["floor"] in FLOORS] + patch.get("add_nodes", [])
    ids = {n["id"] for n in g["nodes"]}
    edges = [e for e in g["edges"] if e["from"] in ids and e["to"] in ids] + patch.get("add_edges", [])

    confirmed = {frozenset(c[:2]): c[2] for c in patch.get("confirmed_by_video", [])}
    stats = {"confirmed": 0, "assumed": 0, "still_skipped": 0}
    for e in edges:
        if not e.get("verify"):
            continue
        key = frozenset((e["from"], e["to"]))
        if key in confirmed:
            e["verify"], e["confirmed_by"] = False, confirmed[key]
            stats["confirmed"] += 1
        elif patch.get("keep_unconfirmed"):
            e["verify"], e["assumed"] = False, True
            stats["assumed"] += 1
        else:
            stats["still_skipped"] += 1
    g["edges"] = edges

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "graph.json").write_text(json.dumps(g, indent=1))
    rooms = [r for r in patch.get("rooms", []) if r["node"] in ids]
    (args.out / "rooms.json").write_text(json.dumps(rooms, indent=1))
    print(f"{len(g['nodes'])} nodes, {len(edges)} edges; verify edges: {stats}; {len(rooms)} rooms")


if __name__ == "__main__":
    main()
