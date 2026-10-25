"""'Where to film next' coverage heat map: each spot colored by how much it needs more footage.

Recreates the 1:57 PM handoff map (hound_coverage_map.html/png) from the current datasets so the two compare
directly. Need score per spot, 0 (covered) to 1 (film first):
    no footage                       1.00
    under 20 frames                  +0.35
    untestable (only one video)      +0.25
    one filming session              +0.15
    no one-spot pan clip             +0.15
    weak top-3 (LOVO, below 50%)     +0.6 * (0.5 - top3)
capped at 1. "Film first" = need >= 0.9. Dark ring = demo-route spot.

Private: it is a map of the building. Written under data/, never committed or published.

Usage:
    python ml/research/coverage_map.py --dataset data/dataset data/dataset_new data/dataset_f2 data/dataset_r3
"""
import argparse
import csv
import html
import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import analyze as A  # noqa: E402
from common import load_frames  # noqa: E402
from embed import embed_cached  # noqa: E402
from heatmap import per_spot  # noqa: E402

FLOORS = [("F1", "Ground floor"), ("F2", "Second floor"), ("B1", "Lower level")]
DEMO = {"F1_entry_east", "F1_entry_west", "F1_hall_w", "F1_core_elev", "F1_hall_e", "F1_podium_elev", "F1_lobby_e",
        "F1_room164", "F1_lobby", "F2_hall_e1", "F2_podium_elev", "F2_hall_e4", "F2_hall_e2", "F2_hall_e3", "F2_hall_w",
        "F2_core_elev", "F2_class48b", "F2_class48c", "F2_class20", "F2_class48a"}
SIGN_TYPES = {"room", "restroom"}
FILM_FIRST = 0.9


def one_spot_clips(datasets):
    """Videos whose kept frames all carry one label: a stand-still pan clip of that spot."""
    labels = defaultdict(set)
    for d in datasets:
        with open(Path(d) / "labels.csv", newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["status"] == "keep":
                    labels[r["video"]].add(r["label"])
    return {next(iter(v)) for v in labels.values() if len(v) == 1}


def need(spot, s, clips):
    if not s or not s["frames"]:
        return 1.0, ["no footage"]
    score, why = 0.0, []
    if s["frames"] < 20:
        score, why = score + 0.35, why + [f"only {s['frames']} frames"]
    if len(s["sessions"]) < 2:
        score, why = score + 0.15, why + ["one session"]
    if spot not in clips:
        score, why = score + 0.15, why + ["no one-spot clip"]
    if not s["n"]:
        score, why = score + 0.25, why + ["untestable (1 video)"]
    else:
        top3 = s["top3"] / s["n"]
        if top3 < 0.5:
            score += 0.6 * (0.5 - top3)
            why.append(f"top-3 {top3:.0%}")
    return min(score, 1.0), why


def advice(spot, score, node):
    sign = "; door number sign close-up" if node.get("type") in SIGN_TYPES else ""
    if score >= 1.0:
        return "15 s pan clip (none yet)" + sign
    if score >= FILM_FIRST:
        return "15 s pan clip, other time of day" + sign
    if score >= 0.35:
        return "pan clip if passing" + sign
    return "covered" + sign


def color(score):
    # green -> amber -> red, the same ramp as the handoff map
    stops = [(0.0, (0x2f, 0x9e, 0x6a)), (0.5, (0xe0, 0xa5, 0x26)), (1.0, (0xd2, 0x3f, 0x31))]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if score <= b:
            t = (score - a) / (b - a)
            return "#%02x%02x%02x" % tuple(round(x + (y - x) * t) for x, y in zip(ca, cb))
    return "#d23f31"


def build(stats, graph, clips):
    nodes = {n["id"]: n for n in graph["nodes"]}
    spots = {}
    for i, n in nodes.items():
        if i.split("_")[0] not in dict(FLOORS):
            continue
        score, why = need(i, stats.get(i), clips)
        s = stats.get(i)
        spots[i] = {"need": score, "why": why, "frames": s["frames"] if s else 0, "videos": len(s["videos"]) if s else 0,
                    "top3": (s["top3"] / s["n"]) if s and s["n"] else None, "advice": advice(i, score, n),
                    "tests": 3 if i in DEMO else 2}
    return spots


def write_png(spots, graph, path, stamp):
    import matplotlib.pyplot as plt
    nodes = {n["id"]: n for n in graph["nodes"]}
    fig, axes = plt.subplots(len(FLOORS), 1, figsize=(14, 17), facecolor="#f7f5f2")
    fig.suptitle(f"Where to film next (red = film first, dark ring = demo route) — PRIVATE, don't publish\n{stamp}",
                 x=0.02, ha="left", fontsize=14)
    for ax, (floor, name) in zip(axes, FLOORS):
        ids = [i for i in spots if i.startswith(floor + "_")]
        for e in graph["edges"]:
            if e["from"] in ids and e["to"] in ids:
                a, b = nodes[e["from"]], nodes[e["to"]]
                ax.plot([a["x"], b["x"]], [a["y"], b["y"]], color="#c9c1b8", lw=2.5, zorder=1, solid_capstyle="round")
        for i in ids:
            n, s = nodes[i], spots[i]
            ax.scatter(n["x"], n["y"], s=120 + 260 * s["need"], color=color(s["need"]), zorder=2,
                       edgecolor="#1d1b19" if i in DEMO else "white", linewidth=2.2 if i in DEMO else 1.2)
            if s["need"] >= 0.3 or i in DEMO:
                ax.annotate(i[len(floor) + 1:], (n["x"], n["y"]), xytext=(0, 9), textcoords="offset points",
                            ha="center", fontsize=8, color="#3d3935")
        first = sum(spots[i]["need"] >= FILM_FIRST for i in ids)
        ax.set_title(f"{floor} · {name} — {first} spots to film first", loc="left", fontsize=12)
        ax.set_facecolor("#f7f5f2")
        ax.invert_yaxis()
        ax.set_aspect("equal")
        ax.axis("off")
    fig.tight_layout()
    fig.savefig(path, dpi=110, facecolor=fig.get_facecolor())
    plt.close(fig)


def pct(x):
    return "" if x is None else f"{x:.0%}"


def write_html(spots, graph, path, stamp, summary):
    nodes = {n["id"]: n for n in graph["nodes"]}
    panels = []
    for floor, name in FLOORS:
        ids = [i for i in spots if i.startswith(floor + "_")]
        xs, ys = [nodes[i]["x"] for i in ids], [nodes[i]["y"] for i in ids]
        x0, y0, x1, y1 = min(xs) - 40, min(ys) - 40, max(xs) + 40, max(ys) + 40
        parts = [f'<svg viewBox="{x0} {y0} {x1 - x0} {y1 - y0}" role="img" aria-label="{floor} coverage">']
        for e in graph["edges"]:
            if e["from"] in ids and e["to"] in ids:
                a, b = nodes[e["from"]], nodes[e["to"]]
                parts.append(f'<line x1="{a["x"]}" y1="{a["y"]}" x2="{b["x"]}" y2="{b["y"]}" class="edge"/>')
        for i in ids:
            n, s = nodes[i], spots[i]
            tip = (f"{i} — need {s['need']:.2f}: {', '.join(s['why']) or 'covered'}. {s['frames']} frames, "
                   f"{s['videos']} video(s). Film: {s['advice']}. Test photos: {s['tests']}.")
            cls = "dot demo" if i in DEMO else "dot"
            parts.append(f'<circle cx="{n["x"]}" cy="{n["y"]}" r="{8 + 6 * s["need"]:.1f}" fill="{color(s["need"])}" '
                         f'class="{cls}"><title>{html.escape(tip)}</title></circle>')
            if s["need"] >= 0.3 or i in DEMO:
                parts.append(f'<text x="{n["x"]}" y="{n["y"] - 16}" class="lbl">{i[len(floor) + 1:]}</text>')
        parts.append("</svg>")
        first = sum(spots[i]["need"] >= FILM_FIRST for i in ids)
        panels.append(f'<section class="panel"><h2>{floor} · {name}</h2><div class="meta">{len(ids)} spots · '
                      f'{first} need filming first</div><div class="wrap">{"".join(parts)}</div></section>')
    rows = sorted(spots.items(), key=lambda kv: -kv[1]["need"])
    table = "".join(
        f'<tr><td>{i}</td><td><span class="pill" style="background:{color(s["need"])}">{s["need"]:.2f}</span></td>'
        f'<td>{s["frames"]}</td><td>{s["videos"]}</td><td>{pct(s["top3"])}</td>'
        f'<td>{html.escape(", ".join(s["why"]) or "covered")}</td><td>{html.escape(s["advice"])}</td></tr>'
        for i, s in rows if s["need"] >= 0.35)
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coverage Heat Map</title>
<style>
:root{{--bg:#f7f5f2;--panel:#fff;--ink:#1d1b19;--muted:#6b6560;--line:#d9d3cc;--edge:#c9c1b8;--ring:#1d1b19}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#141312;--panel:#1d1b19;--ink:#f1ede8;--muted:#a39c95;--line:#36322e;--edge:#4a443e;--ring:#f1ede8}}}}
:root[data-theme="dark"]{{--bg:#141312;--panel:#1d1b19;--ink:#f1ede8;--muted:#a39c95;--line:#36322e;--edge:#4a443e;--ring:#f1ede8}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}}
main{{max-width:1180px;margin:0 auto;padding:24px 16px 48px}}h1{{font-size:26px;margin:0 0 4px}}.sub,.meta{{color:var(--muted)}}
.sub{{margin:0 0 14px}}.legend{{display:flex;flex-wrap:wrap;gap:16px;color:var(--muted);font-size:13px;margin-bottom:16px}}
.bar{{display:inline-block;width:170px;height:10px;border-radius:5px;vertical-align:-1px;margin-right:8px;background:linear-gradient(90deg,#2f9e6a,#e0a526,#d23f31)}}
.panel{{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:16px}}
.panel h2{{font-size:17px;margin:0 0 2px}}.meta{{font-size:13px;margin-bottom:6px}}svg{{width:100%;height:auto;display:block}}
.edge{{stroke:var(--edge);stroke-width:3;stroke-linecap:round}}.dot{{stroke:var(--panel);stroke-width:2}}.demo{{stroke:var(--ring);stroke-width:3}}
.lbl{{font-size:11px;fill:var(--muted);text-anchor:middle}}.wrap{{overflow-x:auto}}
table{{width:100%;border-collapse:collapse;font-size:13.5px}}th,td{{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{color:var(--muted);font-weight:600}}.pill{{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600;color:#fff}}
</style></head><body><main>
<h1>Where to film next</h1>
<p class="sub">Private: a map of the building. Don't publish or commit it. {html.escape(stamp)}.</p>
<p class="sub">{html.escape(summary)}</p>
<div class="legend"><span><span class="bar"></span>need: covered → film first</span><span>dark ring = demo route spot</span>
<span>Hover a dot for details (desktop)</span></div>
{"".join(panels)}
<section class="panel"><h2>Spots that still need footage</h2><div class="wrap"><table>
<tr><th>Spot</th><th>Need</th><th>Frames</th><th>Videos</th><th>Top-3</th><th>Why</th><th>Film</th></tr>{table}</table></div></section>
</main></body></html>"""
    path.write_text(page, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, nargs="+", required=True)
    ap.add_argument("--graph", type=Path, default=Path("data/graph.json"))
    ap.add_argument("--out", type=Path, default=Path("data/reports/coverage"))
    args = ap.parse_args()

    graph = json.loads(args.graph.read_text())
    scope = {n["id"] for n in graph["nodes"] if n["id"].split("_")[0] in dict(FLOORS)}
    rows = [r for d in args.dataset for r in load_frames(d) if r["label"] in scope]
    V = embed_cached("dinov2", [r["path"] for r in rows])
    results = A.lovo(rows, V, sorted({r["video"] for r in rows}), variant="raw")
    stats = per_spot(rows, results)
    for r in rows:
        stats[r["label"]].setdefault("sessions", set()).add(A.session(r["video"]))
    spots = build(stats, graph, one_spot_clips(args.dataset))

    o = A.summarize(results)
    stamp = (f"{datetime.now():%a %b %d, %I:%M %p}, from {len(rows):,} frames in {len({r['video'] for r in rows})} "
             f"videos and leave-one-video-out accuracy")
    summary = (f"Top-1 {o['top1']:.0%}, top-3 {o['top3']:.0%}, floor {o['floor']:.0%} on {o['n']:,} at-spot frames. "
               f"{sum(s['need'] >= FILM_FIRST for s in spots.values())} of {len(spots)} spots need filming first.")
    args.out.mkdir(parents=True, exist_ok=True)
    write_png(spots, graph, args.out / "hound_coverage_map.png", stamp)
    write_html(spots, graph, args.out / "hound_coverage_map.html", stamp, summary)
    (args.out / "coverage.json").write_text(json.dumps(spots, indent=2))
    print(summary)
    for floor, _ in FLOORS:
        first = sorted(i for i, s in spots.items() if i.startswith(floor) and s["need"] >= FILM_FIRST)
        print(f"  {floor} film first: {', '.join(first) or 'none'}")
    print(f"wrote {args.out}/hound_coverage_map.png and .html")


if __name__ == "__main__":
    main()
