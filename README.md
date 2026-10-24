# Hound Around

**Never lost around here.** Snap a photo of where you're standing in BU's Center for Computing & Data Sciences. Hound Around recognizes the hallway and floor, then routes you to your room. Wrong? Tap the right spot and it learns.

DS+X / Hackachusetts project, built at BU Spark! DS+X 2026 (College Hack track).

Live app: [https://www.hound-around.tech](https://www.hound-around.tech)

## The problem

Indoor navigation apps that rely on GPS fall apart inside large buildings: GPS does not work indoors, Wi-Fi positioning needs infrastructure we do not control, and floor plans alone do not tell you where you are *right now*. Visitors to the CDS building (665 Comm Ave) regularly get lost between look-alike floors. Hound Around solves this using only a single photo, with no GPS, no Wi-Fi positioning, and no tracking.

## How it works

The core loop, which nobody is allowed to break: **photo → spot → route → correction.**

1. **Photo.** You snap a photo in the hallway. The phone web app shrinks it to at most 512 px and strips EXIF metadata before anything leaves the device (`frontend/src/lib/image.js`).
2. **Spot.** The backend embeds the image into a 384-dimensional vector with **DINOv2-small** (CLS token, L2-normalized), compares it by cosine similarity against the labeled index, and takes the **top-10 neighbors**. Those neighbors **vote** for a spot; the winner is the top-voted spot and `confidence = winning_votes / 10`. When the vote is uncertain (confidence below 0.8 or the top candidates span more than one floor), **EasyOCR** reads the room number and floor numeral from signage and can override the floor. This covers the F1/F2 look-alike problem where the two floors share finishes near the elevators.
3. **Route.** The backend routes you from your spot to your room over a **networkx** directed graph built from the floor plan. Accessible mode drops stair edges, unverified edges are excluded, and path cost uses `cost` where supplied otherwise meters. It returns turn-by-turn steps with estimated time at 1.2 m/s (0.9 m/s accessible).
4. **Correction.** If the spot is wrong, you tap the right one. The backend stores your query vector under the corrected label with a higher vote weight, so a single correction flips the very next near-identical query. Corrections update the in-memory index immediately.

The photo is discarded right after embedding: only a normalized vector and prediction metadata are cached. The data contract that every part builds against is in [`docs/contract.md`](docs/contract.md).

## Results

Real evaluation runs on the private test split and requires the ML dependencies and private data, which are not in this public repo. **The numbers below are placeholders and must not be cited until a real eval is run.**

| Metric | Value | How to reproduce |
| --- | --- | --- |
| Top-1 spot accuracy | TBD (pending real eval) | `python -m ml.eval --split test` |
| Top-3 spot accuracy | TBD (pending real eval) | `python -m ml.eval --split test` |
| Floor accuracy (with OCR gate) | TBD (pending real eval) | `python -m ml.eval --split test` |
| Median CPU latency per `/locate` | TBD (pending real eval) | `python -m ml.eval --split test` |
| Test set size `n` | n = TBD (set by the private test split) | `python -m ml.eval --split test` |

Dataset provenance, counts, biases and splits are documented in [`docs/dataset.md`](docs/dataset.md). No accuracy number is reported here until it comes from a real eval run on the private split.

## Ethics and privacy

- **No private data in this repo.** No building photos, videos, floor plans, `graph.json`, `rooms.json`, `index.npz`, labels, or model weights are published here. The GitHub repo is public; private files are never committed.
- **Faces are blurred** before any frame is used, in the data pipeline on the laptop (`pipeline/blur_faces.py`).
- **User photos are discarded** right after matching. The backend caches only a normalized vector and prediction metadata, never the image.
- **EXIF is stripped** and the image is shrunk to at most 512 px in the browser before upload.
- **No GPS, no Wi-Fi positioning, no tracking.** Location comes only from the photo.
- **No public map, graph, or dataset.** The routing graph is built from the Data Sciences Center Draft Project Impact Report (KPMB Architects, 2019), used only to build the graph and never displayed or published.

## Setup

Use Python 3.11 for the backend and ML. All commands below run from the repository root unless noted.

### Backend (`api/`)

```sh
python -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
.venv/bin/python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

On Windows use `.venv\Scripts\python.exe`. Supply private `data/graph.json` and `data/rooms.json` in the agreed formats; `HOUND_DATA_DIR` can point elsewhere. Tests use a synthetic graph and generated solid-color images, never real photographs. See [`api/README.md`](api/README.md) for the full contract, ML handoff interface, and configuration.

### ML (`ml/`)

The ML package (`ml/embedder.py`, `ml/ocr.py`, `ml/index.py`, `ml/build_index.py`, `ml/backend.py`, `ml/eval.py`) needs model dependencies that are **not** in `requirements.txt` and **require team approval** before install: `torch` (CPU wheels, ~200 MB), `transformers` with `facebook/dinov2-small` (~85 MB weights), and `easyocr` with its models (~90 MB lib + ~100 MB models). `CLIP ViT-B/32` (~350 MB) is used only for the eval baseline and is never shipped. See the dependency table in [`.kiro/specs/hound-around-completion/design.md`](.kiro/specs/hound-around-completion/design.md) §8.

Once those are approved and installed, with private frames and `labels.csv` in place:

```sh
python -m ml.build_index         # labels.csv -> data/index.npz
python -m ml.eval --split test   # metrics on the private test split
```

ML unit tests are synthetic-only and run under `python -m pytest -q` without private data or a GPU.

### Frontend (`frontend/`)

```sh
cd frontend
npm ci
npm run build
```

Set `VITE_API_URL` to the backend URL (for example the HF Space URL) for a real build; when it is unset the app uses built-in mock data. A `.env.example` is provided.

### Docker / Hugging Face Space

The root `Dockerfile` builds the backend on `python:3.11-slim`, port 7860, as the non-root user `app`, with `HOUND_DATA_DIR=/app/data`. `.dockerignore` lets only `requirements.txt`, `api/`, and `ml/` enter the build context; no data, images, or weights are ever in the context.

Deployment is a **public** HF Space (the code is already public) that at startup downloads `graph.json`, `rooms.json`, and `index.npz` from a **private** HF dataset repo using an `HF_TOKEN` Space secret (`huggingface_hub`). Private files never enter the public Space repo. The ML model weights (`facebook/dinov2-small` + EasyOCR) are downloaded at **build time** so cold start does not pull them.

The following Dockerfile and Space changes are gated on approval of the ML dependencies and network access, and are documented but **not applied** here (see design §6):

- Install CPU-only `torch`, `transformers`, `easyocr`, and `huggingface_hub`.
- Download `facebook/dinov2-small` and the EasyOCR model weights at build time (no download at cold start).
- `COPY` the `ml/` package into the image.
- Set these environment variables on the Space:
  - `HOUND_ML_FACTORY=ml.backend:create_backend`
  - `HOUND_DATA_DIR=/app/data` (already set in the Dockerfile)
  - `HOUND_CORS_ORIGINS=https://www.hound-around.tech,https://hound-around.tech,https://hound-around-theta.vercel.app,http://localhost:5173`
  - `HF_TOKEN` (secret) plus the private dataset repo id
- Run a single Uvicorn worker (corrections live in one in-memory index).

**Rate limit behind the HF proxy.** The backend caps POSTs at 30/min per peer IP. Behind the HF proxy every request arrives from the proxy IP, so all judges would share one bucket. The fix (design §7) is to run Uvicorn with `--proxy-headers` and a trusted-hosts allowlist so the real client IP is resolved for the HF proxy only (never trusting arbitrary forwarded headers), and to raise the limit for the demo window as a safety net. This must be tested against the deployed Space.

**Corrections reset on restart.** Corrections live in memory plus a SQLite log on the Space's temporary disk; they reset when the Space restarts, which is acceptable for the demo (design §6, `api/README.md`).

## Repo layout

| Path | What |
| --- | --- |
| `docs/contract.md` | Data formats and API everyone builds against (law) |
| `docs/dataset.md` | Dataset card: collection, counts, biases, splits |
| `api/` | FastAPI backend: `/health`, `/locate`, `/route`, `/correct` ([details](api/README.md)) |
| `ml/` | Recognition package: embedder, OCR, index, build_index, backend, eval |
| `pipeline/` | Video → frames → labels → face blur ([how to run](pipeline/README.md)) |
| `frontend/` | React + Vite + Tailwind phone web app |
| `.kiro/` | Kiro steering, specs, and hooks |
| `CLAUDE.md` | Project rules for coding agents |
| `KIRO.md` | How Kiro was used on this project |

## Team

Hound Around was built by the BU Spark! DS+X 2026 team. Roles and owners are listed in [`docs/roles/README.md`](docs/roles/README.md): data lead, ML lead, backend lead (David), front-end lead, and product/pitch lead.
