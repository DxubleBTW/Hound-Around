---
inclusion: always
---

# Product: Hound Around

Hound Around is an indoor wayfinding web app for one building: the BU Center for
Computing & Data Sciences (CDS), 665 Comm Ave. It is a DS+X 2026 hackathon
project.

## The one-breath pitch

Snap a photo in a CDS hallway. The app recognizes the hallway spot and floor,
routes you to your room (with an accessible mode that avoids stairs), and if the
recognition is wrong you tap the right spot and it learns.

## The core loop (never break it)

**photo → spot → route → correction.**

- **photo**: the phone is the only input. No GPS, no network location, no
  tracking. The photo is resized to ~512 px and stripped of EXIF on the phone
  before upload.
- **spot**: the backend embeds the photo, votes over a vector index, and returns
  a node id (e.g. `F2_hall_e2`), a floor, a heading, a confidence, and a top-3
  list. The photo is discarded after embedding.
- **route**: networkx routing over the verified graph returns turn-by-turn
  steps; the UI shows only the next steps, never a building map.
- **correction**: if wrong, the user picks the true spot; `POST /correct`
  updates the in-memory index so the next near-identical photo is right.

## Scope (hard limits)

- One building only: CDS.
- Floors **B1 (lower level, floor -1), F1, F2** only. The event has no access to
  floor 3+.
- A phone web page, not a native app.
- Location comes only from the photo.

## What already exists (built before Kiro, with other tools)

- **`pipeline/`** — Windows data tools (`extract_frames.py`, `label_frames.py`,
  `blur_faces.py`). Faces are blurred before frames leave the laptop.
- **`api/`** — the FastAPI backend implementing the four contract endpoints,
  the ML handoff boundary (`api/recognition.py`), and routing (`api/routing.py`).
- **`frontend/`** — the first React + Vite + Tailwind phone app with the four
  screens and a mock API fallback.
- **`docs/`** — `contract.md` (law), `dataset.md`, and the role docs.
- **`tests/test_backend.py`** — the synthetic pytest suite.

## What Kiro adds

- The spec under `.kiro/specs/hound-around-completion/`
  (requirements, design, tasks).
- These steering docs and the agent hooks under `.kiro/`.
- The upcoming `ml/` package (embedder, OCR, index, build_index, backend
  factory, eval), its synthetic-only tests, frontend finishing (real API wiring,
  error/loading states, blur check), property-based tests, and the submission
  write-up.

Kiro does **not** claim credit for the pre-existing backend, pipeline, or first
frontend. `KIRO.md` at the repo root keeps this account honest and current.
