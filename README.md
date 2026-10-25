# Hound Around

**Never lost around here.** Snap a photo of where you're standing in BU's Center for Computing & Data Sciences. Hound Around recognizes the hallway and floor, then routes you to your room. Wrong? Tap the right spot and it learns.

DS+X / Hackachusetts project, built at BU Spark! DS+X 2026 (College Hack track).

Live app: [https://www.hound-around.tech](https://www.hound-around.tech)

Navigation reliability features and rollout requirements are documented in
[feature setup](docs/navigation-features-proposal.md): manual starting-room selection,
public destination suggestions, configured school/building selection, optional
calibrated photo rejection, persistent correction vectors, and automated checks.
Actual detection thresholds, persistent hosting storage, additional school data,
and deployment settings still require operator setup and real-data verification.

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

The approved model runtime dependencies are in `requirements.txt`: CPU `torch`/`torchvision`,
`transformers` with `facebook/dinov2-small`, EasyOCR, and Hugging Face Hub. The Dockerfile
installs them and downloads weights at build time. `requirements-dev.txt` now installs
only the shared API and test dependencies from `requirements-core.txt`, so tests/CI
do not download the models. Install the full runtime separately when running real
recognition locally. CLIP and chart dependencies remain experiments-only in
`requirements-experiments.txt` and are not shipped.

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

The Dockerfile serves the real API on Python 3.11, port 7860, as the non-root
user `app`. It installs CPU model dependencies and downloads the selected embedder
and OCR weights at build time. Use `--build-arg EMBEDDER=megaloc` for the pinned
MegaLoc descriptor; repository defaults also support DINOv2. The private index
must match the configured model and projection.

At startup, `HOUND_DATA_REPO` and the `HF_TOKEN` secret fetch a pinned private
runtime snapshot. No photos, graph, rooms, index or private calibration enter the
public Space code or image build context. Configure explicit production CORS
origins and keep one Uvicorn worker. Trusted proxy settings determine the peer
used by the POST rate limiter; test those settings against the deployed Space.

[Recognition reliability and rollout](docs/recognition-reliability.md) covers
versioned confidence, atomic package activation, strict manifests, bounded
inference, correction retries and privacy-preserving measurements. Missing
confidence calibration uses the picker; incompatible artifacts report not ready.
Coordinate backend deployment with the data lead and roll code/data back together.

**Corrections need persistent storage.** The API can now replay compatible correction
vectors and versions from SQLite after restart. Set `HOUND_STATE_DIR` to a private
persistent volume and use a unique `HOUND_DATASET_ID` per building. The default
temporary Space filesystem still loses that database when it is replaced. Base
index/model/graph changes isolate old corrections for review; they are not silently
applied to a new mapping package. See the feature setup guide before deploying.

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
