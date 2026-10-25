# CLAUDE.md, Hound Around (DS+X 2026, one building: CDS, 665 Comm Ave)

Goal: phone photo → recognize hallway spot + floor → route to a room → user corrects if wrong.
Stack: FastAPI (Python 3.11) on a Hugging Face Docker Space · React+Vite+Tailwind on Vercel (auto-deploys `main`) ·
DINOv2-small + numpy cosine, top-10 voting · EasyOCR for room numbers / floor numerals · networkx routing ·
SQLite corrections.

Current state, live links, accuracy and open tasks: docs/STATUS.md. Read it before starting work.

## Hard rules
- The API contract in docs/contract.md is law. Never rename fields or add endpoints without asking; additions
  (like `legs`, `tier`, `previous`) go into contract.md in the same PR.
- Node IDs look like F2_hall_e2 / B1_core_elev and come from data/graph.json. Never invent nodes.
- Floors in scope: B1, F1, F2 only.
- Never commit anything under data/ (frames, videos, floor plans, graph, index, keypoints). The repo is public;
  a photo map of a building is a security risk. Private data lives in a private HF dataset.
- The frontend never receives the graph or a floor plan: only the user's own route, normalized per leg.
- No GPS, no network location, no storing user photos. Delete the image after embedding.
- Every change ends with a command that proves it works (pytest, npm test, curl).
- Work on a branch and open a PR; teammates review. No force-push. No new dependencies without asking.

## How it works now
1. `api/main.py`: EXIF-rotate → RGB → thumbnail 512 → `ml/backend.py` `Backend.locate`.
2. `ml/embedder.py`: DINOv2-small CLS, 384-d, L2-normalized, letterboxed to 224×224 (no center crop).
   `MODEL_NAME` changes when preprocessing changes; it invalidates recognition.json and the correction context.
   `HOUND_EMBEDDER=megaloc` switches to MegaLoc (8,448-d, **square resize** to 322×322, `squash()`); the index
   width is read from `index.npz` (`index.dim`, `backend.dim`), never assumed, and the backend refuses to start if
   the embedder and index disagree. `python -m ml.build_index --pca 1024` stores a PCA inside the index and the
   backend applies it to every query (`model_name` gains `+pca1024`).
3. Index (`ml/build_index.py`): up to 250 phone frames per spot (40 for 360 clips), each stored as whole + left +
   right crops, plus a per-row `heading` array (the direction the matched frames face).
4. `ml/index.py` vote: cosine top-10; a correction that is the #1 neighbor wins.
5. Confidence: `ml/calibration.py` maps five features (vote confidence, raw share, top similarity, margin to the
   next spot, top-3 floors split) to P(correct). Tiers: P ≥ 0.7 and one floor → auto; ≥ 0.5 → picker;
   else ask for a second photo (`/locate` with `previous=<photo_id>` adds both photos' votes, then picker).
   Refit the constants with `ml/research/calibrate.py` whenever the index or descriptor changes.
6. OCR runs only when unsure or floors disagree; a read floor/room re-votes on that floor.
7. Routing (`api/routing.py`): shortest path on `cost`; accessible = no stairs. Turns need ≥ 45° (≥ 150° = turn
   around); a destination door beside the corridor says "on your left/right". `/route` also returns `legs`
   (one per floor, points normalized to that leg) for the drawn path.

## API contract (summary; full version in docs/contract.md)
- POST /locate (multipart image, optional `previous`) → {photo_id, spot, floor, heading, confidence, top3, ocr_room,
  ocr_floor, ms, p_correct, tier}
- GET /route?from=&to=&accessible=&heading= → {steps:[{instruction, meters, node}], total_meters, est_seconds, legs}
- POST /correct {photo_id, true_spot} → {ok, index_size}
- GET /health → {ok, index_size, model}

## Environment (Windows)
- venv: .venv (Python 3.11 via uv, torch 2.6 + CUDA 12.4, RTX 3050 6 GB). Check `torch.cuda.is_available()`
  before long runs: the laptop's GPU mode must be Standard or CUDA silently falls back to CPU.
- PYTHONIOENCODING=utf-8 for EasyOCR. ffmpeg via winget; iPhone HDR clips need tone-mapping to SDR.
- mediapipe 1.x / OpenCV 5.x: use the mediapipe Tasks face detector.
- Deploy archives use `git -c core.autocrlf=false archive` (CRLF broke start.sh once).

## Data pipeline (pipeline/, see pipeline/README.md)
- extract_frames.py → frames at 2 fps + whisper transcript → label_frames.py → labels.csv + train/<spot>/ →
  blur_faces.py (always blur before frames leave the laptop) → `python -m ml.build_index`.
- Graph: data/graph_walksheets.json + data/graph_patch.json → `pipeline/api_graph.py` → graph.json + rooms.json.

## Deploy (backend; ask the data lead first)
1. Record the Space and dataset revisions (rollback = both together).
2. Index/graph change → upload to the private dataset → restart the Space. Code change → archive api, ml (minus
   ml/research), scripts, Dockerfile, requirements → upload to the Space. Preprocessing changes ship code and
   index together.
3. `python scripts/smoke_backend.py --url <space> --origin <frontend> --from-node 164 --to-room B62 --wait-seconds 90`,
   plus one real /locate. Never call /correct on live for testing.

## Evaluation (25% of the rubric: Data Science Application)
- Leave-one-video-out on our walking footage (`ml/research/matching_sweep.py`, `backend_eval.py`,
  `calibrate.py`). Report top-1 / top-3 / floor and n on the same query set as the baseline.
- These numbers describe our own footage; outsider photos are the presentable test set. Never tune on them.
  Slides and video use measured numbers only.
- Next model step: MegaLoc (place-recognition descriptor) beat DINOv2 on the same query set (n=1758, LOVO:
  top-1 36.8 → 48.2%, top-3 59.5 → 74.9%, floor 81.2 → 89.4%). The code path is in (`HOUND_EMBEDDER`, PCA in
  the index); still to do before it ships: pick cap/PCA size, CPU latency on 2 threads (/locate ≈ 1 s incl.
  OCR), rebuild index + headings, refit `ml/calibration.py`, upload code + index together, smoke-test.
