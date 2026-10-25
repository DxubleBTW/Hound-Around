"""Review sorted-out frames in the browser: keep, relabel or drop them, then apply the decisions to the datasets.

Reads every data/<dataset>/labels.csv that label_frames.py wrote. Decisions autosave to <dataset>/review.csv and
change nothing until Apply, which moves each decided frame into train/<node>/ or reject_review/ and rewrites
labels.csv, so build_index, eval and ml/research pick the result up unchanged. Applying twice is a no-op, and
review.csv survives a label_frames re-run (apply again afterwards).

Suggestions: every frame is embedded once with DINOv2 (cached in data/cache/review_embeddings.npz) and gets a
top-10 vote over the currently kept frames from OTHER videos, so a kept frame never just echoes its own walk.

Usage:
    python pipeline/review_frames.py --data data              # http://127.0.0.1:8765, local only
    python pipeline/review_frames.py --data data --no-suggest # skip DINOv2
    python pipeline/review_frames.py --data data --device cpu   # if the GPU is asleep and embedding hangs
    python pipeline/review_frames.py --data data --apply      # apply saved decisions without the UI
"""
import argparse
import csv
import json
import os
import shutil
import sys
import threading
import webbrowser
from collections import Counter
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # run as a script from anywhere and still import ml/

VALID_FLOORS = (-1, 1, 2)  # same scope as ml/build_index.py
DROP_DIR = "reject_review"
DECISION_FIELDS = ["file", "decision", "label", "decided_at"]
TOP_K = 10


def frame_dir(dataset, row):
    """Where label_frames.py (or a previous apply) put this frame."""
    return dataset / ("train/" + row["label"] if row["status"] == "keep" else row["status"])


def find_datasets(data_dir):
    return sorted(p.parent for p in Path(data_dir).glob("*/labels.csv") if (p.parent / "train").is_dir())


def read_rows(dataset):
    with open(dataset / "labels.csv", newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        return reader.fieldnames, list(reader)


def write_csv(path, fields, rows):
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)  # never leave a half-written labels.csv behind


def read_decisions(dataset):
    path = dataset / "review.csv"
    if not path.exists():
        return {}
    with open(path, newline="", encoding="utf-8") as fh:
        return {r["file"]: r for r in csv.DictReader(fh)}


def save_decisions(dataset, decisions):
    write_csv(dataset / "review.csv", DECISION_FIELDS, sorted(decisions.values(), key=lambda r: r["file"]))


def load_nodes(data_dir):
    graph = json.loads((Path(data_dir) / "graph.json").read_text())
    return {n["id"]: n.get("label", "") for n in graph["nodes"] if n.get("floor") in VALID_FLOORS}


def apply_decisions(dataset, nodes):
    """Move decided frames and rewrite labels.csv. Returns counts per outcome."""
    fields, rows = read_rows(dataset)
    decisions = read_decisions(dataset)
    counts = Counter()
    for row in rows:
        d = decisions.get(row["file"])
        if not d:
            continue
        if d["decision"] == "keep":
            if d["label"] not in nodes:
                counts["skipped_not_in_graph"] += 1
                continue
            target = {"status": "keep", "label": d["label"]}
        else:
            target = {"status": DROP_DIR, "label": row["label"]}
        if row["status"] == target["status"] and row["label"] == target["label"]:
            counts["unchanged"] += 1
            continue
        src = frame_dir(dataset, row) / row["file"]
        if not src.exists():
            counts["missing_file"] += 1
            continue
        if target["label"] != row["label"]:
            # A relabel invalidates the walk-order heading and the voice source.
            row["heading"], row["label_source"] = "", "review"
        row.update(target)
        dest = frame_dir(dataset, row)
        dest.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest / row["file"]))
        counts["kept" if target["status"] == "keep" else "dropped"] += 1
    write_csv(dataset / "labels.csv", fields, rows)
    return counts


class Suggester:
    """DINOv2 vectors per frame (background thread) and cross-video top-10 votes over kept frames."""

    def __init__(self, data_dir, device=None):
        self.device = device
        self.cache_path = Path(data_dir) / "cache" / "review_embeddings.npz"
        self.vectors = {}  # (dataset, file, mtime_ns) -> vector
        self.lock = threading.Lock()
        self.done, self.total, self.error = 0, 0, None
        if self.cache_path.exists():
            data = np.load(self.cache_path, allow_pickle=False)
            self.vectors = {tuple(k.split("|")[:2]) + (int(k.split("|")[2]),): v for k, v in zip(data["keys"], data["vecs"])}

    def start(self, frames):
        todo = [f for f in frames if f["key"] not in self.vectors]
        self.total = len(todo)  # set before the page's first poll
        if todo:
            threading.Thread(target=self._embed, args=(todo,), daemon=True).start()

    def _embed(self, todo):
        from PIL import Image
        try:
            from ml.embedder import Dinov2Embedder
            embed = Dinov2Embedder(device=self.device)
            for i in range(0, len(todo), 32):
                if i and i % 640 == 0:
                    self._save()  # a crash or Ctrl+C keeps what was embedded so far
                # An Apply during embedding moves files; those frames get embedded on the next start.
                chunk = [f for f in todo[i:i + 32] if f["path"].exists()]
                images = []
                for f in chunk:
                    with Image.open(f["path"]) as img:
                        images.append(img.convert("RGB"))
                vecs = embed(images) if images else []
                with self.lock:
                    self.vectors.update({f["key"]: v for f, v in zip(chunk, vecs)})
                self.done = min(i + 32, len(todo))
            self._save()
        except Exception as exc:  # the UI still works without suggestions
            self.error = repr(exc)

    def _save(self):
        with self.lock:
            keys = ["|".join(map(str, k)) for k in self.vectors]
            vecs = np.stack(list(self.vectors.values())).astype(np.float32)
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(self.cache_path, keys=np.asarray(keys), vecs=vecs)

    def suggest(self, frames, effective):
        """effective maps frame id -> label it will train under (None = not kept). Returns id -> top 3."""
        with self.lock:
            have = [f for f in frames if f["key"] in self.vectors]
            if not have:
                return {}
            mat = np.stack([self.vectors[f["key"]] for f in have])
        labels = np.array([effective.get(f["id"]) or "" for f in have])
        videos = np.unique([f["dataset"] + "/" + f["video"] for f in have], return_inverse=True)[1]
        kept = labels != ""
        if not kept.any():
            return {}
        bank, bank_labels, bank_videos = mat[kept].T, labels[kept], videos[kept]
        k = min(TOP_K, kept.sum())
        out = {}
        # Blocks of rows with argpartition: a full sort per frame took ~1 min per request on ~15k frames.
        for start in range(0, len(have), 1024):
            sims = mat[start:start + 1024] @ bank
            sims[videos[start:start + 1024, None] == bank_videos[None, :]] = -np.inf  # other videos only
            part = np.argpartition(-sims, k - 1, axis=1)[:, :k]
            for f, row, idx in zip(have[start:start + 1024], sims, part):
                top = idx[np.argsort(-row[idx])]  # same order as a full sort
                top = top[np.isfinite(row[top])]
                votes = Counter(bank_labels[top])
                out[f["id"]] = [{"spot": s, "votes": v} for s, v in votes.most_common(3)]
        return out


class Review:
    def __init__(self, data_dir, suggest=True, device=None):
        self.data_dir = Path(data_dir).resolve()
        self.nodes = load_nodes(self.data_dir)
        self.lock = threading.Lock()
        self.reload()
        self.suggester = Suggester(self.data_dir, device) if suggest else None
        if self.suggester:
            self.suggester.start(self.frames)

    def reload(self):
        self.datasets = {d.name: d for d in find_datasets(self.data_dir)}
        self.decisions = {name: read_decisions(d) for name, d in self.datasets.items()}
        self.frames = []
        for name, dataset in self.datasets.items():
            for row in read_rows(dataset)[1]:
                path = frame_dir(dataset, row) / row["file"]
                if not path.exists():
                    continue
                self.frames.append({
                    "id": name + "/" + row["file"], "dataset": name, "file": row["file"], "video": row["video"],
                    "t": float(row["t_sec"] or 0), "label": row["label"], "status": row["status"],
                    "sharpness": row.get("sharpness"), "path": path,
                    "url": "/img/" + path.relative_to(self.data_dir).as_posix(),
                    "key": (name, row["file"], path.stat().st_mtime_ns)})
        self.frames.sort(key=lambda f: (f["dataset"], f["video"], f["t"]))

    def effective_labels(self):
        out = {}
        for f in self.frames:
            d = self.decisions[f["dataset"]].get(f["file"])
            if d:
                out[f["id"]] = d["label"] if d["decision"] == "keep" else None
            else:
                out[f["id"]] = f["label"] if f["status"] == "keep" and f["label"] in self.nodes else None
        return out

    def state(self):
        with self.lock:
            suggestions = self.suggester.suggest(self.frames, self.effective_labels()) if self.suggester else {}
            frames = [{k: v for k, v in f.items() if k not in ("path", "key")} for f in self.frames]
            for f in frames:
                f["decision"] = self.decisions[f["dataset"]].get(f["file"])
                f["suggest"] = suggestions.get(f["id"], [])
        s = self.suggester
        return {"frames": frames, "nodes": self.nodes,
                "embedding": {"done": s.done, "total": s.total, "error": s.error} if s else None}

    def decide(self, ids, decision, label=None):
        if decision not in ("keep", "drop", "clear"):
            raise ValueError("decision must be keep, drop or clear")
        if decision == "keep" and label not in self.nodes:
            raise ValueError(f"{label!r} is not a B1/F1/F2 node in graph.json")
        by_id = {f["id"]: f for f in self.frames}
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.lock:
            touched = set()
            for frame_id in ids:
                f = by_id[frame_id]
                decisions = self.decisions[f["dataset"]]
                if decision == "clear":
                    decisions.pop(f["file"], None)
                else:
                    decisions[f["file"]] = {"file": f["file"], "decision": decision,
                                            "label": label if decision == "keep" else "", "decided_at": now}
                touched.add(f["dataset"])
            for name in touched:
                save_decisions(self.datasets[name], self.decisions[name])

    def apply(self):
        with self.lock:
            counts = {name: dict(apply_decisions(d, self.nodes)) for name, d in self.datasets.items()}
            self.reload()
        return counts


def make_handler(review, port):
    page = (Path(__file__).parent / "review_frames.html").read_bytes()
    allowed = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, body, ctype="application/json"):
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            if path == "/":
                return self.send(200, page, "text/html; charset=utf-8")
            if path == "/api/state":
                return self.send(200, review.state())
            if path.startswith("/img/"):
                file = (review.data_dir / path[5:]).resolve()
                # Only frames inside data/, never anything else on disk.
                if file.suffix.lower() == ".jpg" and file.is_relative_to(review.data_dir) and file.is_file():
                    return self.send(200, file.read_bytes(), "image/jpeg")
            self.send(404, {"error": "not found"})

        def do_POST(self):
            # Block other sites open in the same browser from moving files via localhost.
            if self.headers.get("Origin") not in allowed:
                return self.send(403, {"error": "local page only"})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                if self.path == "/api/decide":
                    review.decide(body["ids"], body["decision"], body.get("label"))
                    return self.send(200, {"ok": True})
                if self.path == "/api/apply":
                    return self.send(200, {"ok": True, "applied": review.apply()})
            except (KeyError, ValueError) as exc:
                return self.send(400, {"error": str(exc)})
            self.send(404, {"error": "not found"})

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("data"))
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-suggest", action="store_true", help="skip DINOv2 suggestions")
    # GPU when available. A sleeping laptop GPU can hang CUDA calls with no error: use --device cpu then.
    ap.add_argument("--device", default=None, help="cuda or cpu (default: cuda if available)")
    ap.add_argument("--apply", action="store_true", help="apply saved decisions and exit")
    args = ap.parse_args()

    if args.apply:
        nodes = load_nodes(args.data)
        for dataset in find_datasets(args.data):
            print(dataset.name, dict(apply_decisions(dataset, nodes)))
        print("Rebuild the index (python -m ml.build_index) to use the changes.")
        return

    review = Review(args.data, suggest=not args.no_suggest, device=args.device)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(review, args.port))
    url = f"http://127.0.0.1:{args.port}"
    print(f"{len(review.frames)} frames from {len(review.datasets)} datasets. Reviewing at {url} (Ctrl+C to stop)")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
