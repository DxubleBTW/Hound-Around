# CLAUDE.md, Hound Around (DS+X 2026, one building: CDS, 665 Comm Ave)

Goal: phone photo → recognize hallway spot + floor → route to a room → user corrects if wrong.
Stack: FastAPI (Python 3.11) on Hugging Face Spaces · React+Vite+Tailwind on Vercel · DINOv2-small + numpy cosine, top-10 voting · EasyOCR for room numbers / floor numerals · networkx routing · SQLite corrections.

Current state, live links, accuracy and open tasks: docs/STATUS.md. Read it before starting work.

## Hard rules
- The API contract in docs/contract.md is law. Never rename fields or add endpoints without asking.
- Node IDs look like F2_hall_e2 / B1_core_elev and come from data/graph.json. Never invent nodes.
- Floors in scope: B1, F1, F2 only (event has no access to floor 3+).
- Never commit anything under data/ (frames, videos, floor plans). Only index.npz vectors ship.
- No GPS, no network location, no storing user photos. Delete the image after embedding.
- Every change ends with a command I can run to prove it works (pytest, curl, or npm run dev).
- Prefer the simplest thing that works by 3 PM Saturday. No new dependencies without asking.

## Environment (Windows)
- venv: D:\Projects\hound-around\.venv (Python 3.11, torch 2.6 + CUDA 12.4, RTX 3050 6 GB). Use device "cuda" when available, fall back to CPU.
- Set PYTHONIOENCODING=utf-8 before running EasyOCR (its progress bar crashes cp1252 consoles).
- mediapipe is 1.x and OpenCV is 5.x: use the mediapipe Tasks face detector, not mp.solutions.
- ffmpeg is installed via winget (Gyan.FFmpeg). iPhone HDR clips (color_transfer arib-std-b67) need tone-mapping to SDR.

## Data pipeline (pipeline/, see pipeline/README.md)
- extract_frames.py → frames at 2 fps + whisper transcript. label_frames.py → labels.csv + train/<spot>/ folders. blur_faces.py → faces blurred in place.
- Always blur before frames leave the laptop. Model weights live in pipeline/models/ (gitignored).
- Private inputs stay in data/ (gitignored): anchors.json, nodes.txt, graph.json, rooms.json.

## API contract (summary; full version in docs/contract.md)
- POST /locate (multipart image) → {photo_id, spot, floor, heading, confidence, top3:[{spot,votes}], ocr_room, ocr_floor, ms}
- GET /route?from=&to=&accessible=&heading= → {steps:[{instruction, meters, node}], total_meters, est_seconds}. `to` accepts a node id or a room number via data/rooms.json.
- POST /correct {photo_id, true_spot} → {ok, index_size}
- GET /health → {ok, index_size, model}

## Data files
- data/graph.json: nodes {id, floor, type, label, x, y, landmark}, edges {from, to, meters, instruction, stairs, vertical}. Podium elevators serve LL–L5; tower (core) elevators serve all levels.
- data/rooms.json: [{room, floor, node, name}], including event aliases (Room 164 = opening/closing ceremony).
- data/labels.csv: file,video,t_sec,label,label_source,in_graph,sharpness,dup_of_prev,status,heading
- data/index.npz: vecs float16 [N,384] L2-normalized, labels [N], source [N] ("video"|"correction")
- corrections.sqlite: corrections(photo_id, true_spot, predicted, confidence, created_at)

## Evaluation (this is 25% of the rubric: Data Science Application)
- Splits: train = Saturday-morning runs, val = one held-out run per floor, test = outsider still photos (TEST_<node>_NN.jpg). Never mix.
- Report: top-1 spot, top-3 spot, floor accuracy, median graph-distance error (m), p50/p95 latency.
- Compare: color-histogram baseline vs CLIP ViT-B/32 vs DINOv2-small; k = 1/5/10/20; OCR on/off.
