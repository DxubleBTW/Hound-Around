"""Walk sheets for a 360 filming round: one route per floor through every node, numbered stops, colored by need.

The route starts at the main elevator lobby and is the shortest walk (networkx TSP approximation, walking meters)
that reaches every node on the floor; corridors you pass twice are marked "pass". A 360 camera sees every
direction, so each corridor needs one pass, not one per direction. Stops are colored by the coverage map's need
score (red = film first). The "say" column spells IDs out so whisper transcribes them (it heard "core elev" as
"core error" and "hall NE" as "hall and E").

Private: it is a map of the building. Written under data/ and shared only as a private file.

Usage:
    python pipeline/walk_sheet_360.py --graph data/graph.json --coverage data/reports/coverage_after/coverage.json
"""
import argparse
import html
import json
import re
from pathlib import Path

import networkx as nx

FLOORS = [("F1", "Ground floor"), ("F2", "Second floor"), ("B1", "Lower level")]
WORDS = {"B1": "B one", "F1": "F one", "F2": "F two", "elev": "elevator", "e": "east", "w": "west", "n": "north",
         "s": "south", "ne": "north east", "nw": "north west", "comm": "communication", "mid": "middle",
         "stair": "stair", "class": "class", "teal": "teal", "far": "far"}
FILM_FIRST = 0.9


def say(node_id):
    """'F2_hall_ne' -> 'F two, hall, north east'; 'F2_class48a' -> 'F two, class, forty-eight A'."""
    numbers = {"20": "twenty", "24": "twenty-four", "48": "forty-eight", "70": "seventy", "164": "one sixty-four"}
    parts = node_id.split("_")
    out = [WORDS[parts[0]]]
    for p in parts[1:]:
        m = re.fullmatch(r"([a-z]+)(\d+)([a-z]?)", p)
        if m:
            word, num, letter = m.groups()
            out.append(" ".join(x for x in (WORDS.get(word, word), numbers.get(num, num), letter.upper()) if x))
        else:
            out.append(WORDS.get(p, p))
    return ", ".join(out)


def color(need):
    stops = [(0.0, (0x2f, 0x9e, 0x6a)), (0.5, (0xe0, 0xa5, 0x26)), (1.0, (0xd2, 0x3f, 0x31))]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if need <= b:
            t = (need - a) / (b - a)
            return "#%02x%02x%02x" % tuple(round(x + (y - x) * t) for x, y in zip(ca, cb))
    return "#d23f31"


def floor_route(graph, floor):
    nodes = {n["id"]: n for n in graph["nodes"] if n["id"].startswith(floor + "_")}
    G = nx.Graph()
    for e in graph["edges"]:
        if not e.get("vertical") and e["from"] in nodes and e["to"] in nodes:
            G.add_edge(e["from"], e["to"], weight=max(e.get("meters", 1), 0.5))
    start = f"{floor}_core_elev"
    walk = nx.approximation.traveling_salesman_problem(G, weight="weight", cycle=False)
    # Rotate/flip so the walk starts at the elevator lobby, where every floor's filming begins.
    if start in walk and walk[0] != start:
        i = walk.index(start)
        head, tail = walk[:i + 1][::-1], walk[i + 1:]
        # Walk the shorter side first, then come back through the lobby to the other side.
        first, second = sorted([head, [start] + tail], key=len)
        walk = first + nx.shortest_path(G, first[-1], start, weight="weight")[1:] + second[1:] if first[0] == start \
            else head + tail
    meters = sum(G[a][b]["weight"] for a, b in zip(walk, walk[1:]))
    return nodes, G, walk, meters


def stops_from(walk, coverage):
    seen, stops = set(), []
    for step, node in enumerate(walk):
        if node in seen:
            continue
        seen.add(node)
        stops.append({"n": len(stops) + 1, "id": node, "need": coverage.get(node, {}).get("need", 1.0)})
    return stops


def floor_svg(nodes, walk, stops, rooms_by_node):
    xs, ys = [n["x"] for n in nodes.values()], [n["y"] for n in nodes.values()]
    x0, y0, x1, y1 = min(xs) - 50, min(ys) - 50, max(xs) + 50, max(ys) + 50
    num = {s["id"]: s for s in stops}
    parts = [f'<svg viewBox="{x0} {y0} {x1 - x0} {y1 - y0}" role="img"><title>walk route</title>']
    pts = " ".join(f'{nodes[i]["x"]},{nodes[i]["y"]}' for i in walk)
    parts.append(f'<polyline points="{pts}" class="route"/>')
    for i, n in nodes.items():
        s = num[i]
        ring = ' class="first"' if s["need"] >= FILM_FIRST else ""
        parts.append(f'<circle cx="{n["x"]}" cy="{n["y"]}" r="14" fill="{color(s["need"])}"{ring}>'
                     f'<title>{html.escape(i)}: {html.escape(n.get("label", ""))}</title></circle>')
        parts.append(f'<text x="{n["x"]}" y="{n["y"] + 4}" class="num">{s["n"]}</text>')
        short = i.split("_", 1)[1] + (f" ({', '.join(rooms_by_node[i])})" if i in rooms_by_node else "")
        parts.append(f'<text x="{n["x"]}" y="{n["y"] - 20}" class="lbl">{html.escape(short)}</text>')
    parts.append("</svg>")
    return "".join(parts)


def write_png(graph, coverage, routes, path):
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(len(FLOORS), 1, figsize=(14, 18), facecolor="white")
    fig.suptitle("360 walk: follow the numbers, stop 3 s at each dot and say its name (red ring = film first). PRIVATE",
                 x=0.02, ha="left", fontsize=13)
    for ax, (floor, name) in zip(axes, FLOORS):
        nodes, G, walk, meters, stops = routes[floor]
        ax.plot([nodes[i]["x"] for i in walk], [nodes[i]["y"] for i in walk], color="#4a7fd4", lw=2, alpha=0.5, zorder=1)
        for s in stops:
            n = nodes[s["id"]]
            ax.scatter(n["x"], n["y"], s=320, color=color(s["need"]), zorder=2,
                       edgecolor="#b00020" if s["need"] >= FILM_FIRST else "white", linewidth=3 if s["need"] >= FILM_FIRST else 1)
            ax.text(n["x"], n["y"], str(s["n"]), ha="center", va="center", fontsize=8, color="white", weight="bold", zorder=3)
            ax.annotate(s["id"].split("_", 1)[1], (n["x"], n["y"]), xytext=(0, 11), textcoords="offset points",
                        ha="center", fontsize=7, color="#333")
        ax.set_title(f"{floor} · {name}: {len(stops)} stops, ~{meters:.0f} m, start at {floor}_core_elev",
                     loc="left", fontsize=11)
        ax.invert_yaxis()
        ax.set_aspect("equal")
        ax.axis("off")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph", type=Path, default=Path("data/graph.json"))
    ap.add_argument("--coverage", type=Path, default=Path("data/reports/coverage_after/coverage.json"))
    ap.add_argument("--rooms", type=Path, default=Path("data/rooms.json"))
    ap.add_argument("--out", type=Path, default=Path("data/reports/walk360"))
    args = ap.parse_args()

    graph = json.loads(args.graph.read_text())
    coverage = json.loads(args.coverage.read_text()) if args.coverage.exists() else {}
    rooms_by_node = {}
    if args.rooms.exists():
        for r in json.loads(args.rooms.read_text()):
            rooms_by_node.setdefault(r["node"], []).append(r["room"])
    labels = {n["id"]: n for n in graph["nodes"]}

    routes, panels = {}, []
    for floor, name in FLOORS:
        nodes, G, walk, meters = floor_route(graph, floor)
        stops = stops_from(walk, coverage)
        routes[floor] = (nodes, G, walk, meters, stops)
        rows = []
        for s in stops:
            n = labels[s["id"]]
            extra = []
            if s["id"] in rooms_by_node:
                extra.append("room " + ", ".join(rooms_by_node[s["id"]]) + ": point at the number sign")
            elif n.get("type") == "room":
                extra.append("read the door number aloud")
            if s["need"] >= FILM_FIRST:
                extra.append("film first: hold 5 s")
            rows.append(f'<tr><td class="n" style="background:{color(s["need"])}">{s["n"]}</td>'
                        f'<td><b>{html.escape(s["id"])}</b><br><span class="m">{html.escape(n.get("label", ""))}</span></td>'
                        f'<td>"{html.escape(say(s["id"]))}"</td><td>{html.escape("; ".join(extra))}</td></tr>')
        first = sum(s["need"] >= FILM_FIRST for s in stops)
        panels.append(f'<section><h2>{floor} · {name}</h2><p class="m">{len(stops)} stops · about {meters:.0f} m of '
                      f'walking · start at the main elevators · {first} film-first spots</p>'
                      f'<div class="map">{floor_svg(nodes, walk, stops, rooms_by_node)}</div>'
                      f'<table><tr><th>#</th><th>Spot</th><th>Say</th><th>Also</th></tr>{"".join(rows)}</table></section>')

    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>360 Walk Sheets</title>
<style>
:root{{--bg:#fff;--ink:#1d1b19;--muted:#6b6560;--line:#ddd;--route:#4a7fd4}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#141312;--ink:#f1ede8;--muted:#a39c95;--line:#36322e}}}}
:root[data-theme="dark"]{{--bg:#141312;--ink:#f1ede8;--muted:#a39c95;--line:#36322e}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif}}
main{{max-width:1100px;margin:0 auto;padding:16px}}h1{{font-size:22px;margin:0 0 6px}}h2{{font-size:18px;margin:28px 0 2px}}
.m{{color:var(--muted);font-size:13px}}ol{{padding-left:20px}}
.map{{overflow-x:auto;border:1px solid var(--line);border-radius:12px;margin:8px 0}}svg{{width:100%;min-width:640px;height:auto;display:block}}
.route{{fill:none;stroke:var(--route);stroke-width:4;stroke-opacity:.45;stroke-linejoin:round}}
circle{{stroke:var(--bg);stroke-width:2}}circle.first{{stroke:#b00020;stroke-width:5}}
.num{{font-size:13px;font-weight:700;fill:#fff;text-anchor:middle}}.lbl{{font-size:11px;fill:var(--muted);text-anchor:middle}}
table{{width:100%;border-collapse:collapse;font-size:14px}}td,th{{border-bottom:1px solid var(--line);padding:6px;text-align:left;vertical-align:top}}
td.n{{color:#fff;font-weight:700;text-align:center;width:32px;border-radius:6px}}
</style></head><body><main>
<h1>360 walk sheets</h1>
<p class="m">Private: a map of the building. Don't publish or share outside the team. Colors = how much footage each spot still needs (red = film first, from the latest coverage map).</p>
<ol>
<li>Record one continuous 360 video per floor. Camera on a stick above head height, front lens facing where you walk.</li>
<li>Walk the numbers in order at a slow, steady pace down the middle of the corridor. One pass is enough: the camera sees both directions.</li>
<li>At each dot: stop, say the "Say" words clearly, hold still about 3 s (5 s on red rings), then move on.</li>
<li>Passing a dot you already did: keep walking, say nothing. If you stop mid-corridor, say "pause".</li>
<li>Stairs and elevators between floors: stop recording, start a new video on the next floor.</li>
<li>Export the stitched equirectangular MP4 from the camera app at full resolution.</li>
</ol>
{"".join(panels)}
</main></body></html>"""
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "walk_360.html").write_text(page, encoding="utf-8")
    write_png(graph, coverage, routes, args.out / "walk_360.png")
    for floor, _ in FLOORS:
        nodes, G, walk, meters, stops = routes[floor]
        print(f"{floor}: {len(stops)} stops, ~{meters:.0f} m: " + " > ".join(s["id"].split("_", 1)[1] for s in stops))
    print(f"wrote {args.out}/walk_360.html and walk_360.png")


if __name__ == "__main__":
    main()
