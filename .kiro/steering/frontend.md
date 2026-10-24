---
inclusion: fileMatch
fileMatchPattern: 'frontend/**'
---

# Frontend guidance (workstream E)

Applies when working in `frontend/**`. Grounded in `docs/roles/frontend.md`,
`docs/contract.md`, `api/routing.py` (authoritative instruction text),
`frontend/src/api.js`, and `.kiro/specs/hound-around-completion/design.md`.
Keep changes surgical; the shapes in `api.js` already match the contract.

## API wiring

- Use the **real API when `VITE_API_URL` is set**; fall back to **mock** data
  when it is unset (both demo paths — straight-to-route and top-3 picker — stay
  visible in mock). Keep the mock fallback working.
- Never re-derive or rewrite instruction prose on the client. The Route screen
  renders `step.instruction` verbatim.

## Loading, timeout, cancel

- Show **"Sending…"** then **"Matching…"** during `/locate`.
- Apply an **~8 s timeout** with retry. Never show a stale result.
- **Cancel the in-flight request on retake** so an old response cannot land on a
  new photo.

## Error handling (friendly, accessible)

- Friendly messages for **503** (recognition not ready), **422** (validation),
  **413** (too large), **429** (rate limited), and **offline**.
- Accessible **404** on routing (destination unreachable in accessible mode) —
  explain, do not suggest stairs.
- **heading-422**: retry once without the heading, then surface the error.

## Image quality check

- Before upload, run a **blur/blank check** via a **Laplacian variance** measure
  on a **512 px canvas**. If blurry or blank, ask the user to step back and point
  down the hall or at a room number. `image.js` already resizes to ~512 px and
  strips EXIF.

## Correction feedback

- After `POST /correct`, show **"Thanks, it learned that"** with the new
  **`index_size`** from the response.

## Route rendering

- **Turn icons keyed to the exact `api/routing.py` instruction prefixes** — match
  on these strings, do not paraphrase:
  - `Walk`
  - `Continue`
  - `Turn left and walk`
  - `Turn right and walk`
  - `Turn around and walk`
  - `Take the stairs to …` (floor change)
  - `Take the elevator to …` (floor change)
- Show a **floor-change card** for the elevator/stairs steps.
- **Vibrate** on step/arrival cues where supported.
- Display **`ocr_room`** when present.
- Support **`?to=` prefill** of the destination from the URL.

## Design and accessibility

- Show only the next step(s); **never a building map**, graph, or floor plan.
- Respect **`prefers-reduced-motion`**.
- **44 px minimum tap targets**; readable at arm's length.
- Near-black background, monochrome, one BU-red accent for "you are here" and the
  route. Accessible mode is easy to find, not buried.
- No GPS or location permission prompts, ever. Do not store photos in the
  browser after upload.

## Open question to respect

- Keep `spots.js` (node id → readable name, never invents nodes) and the
  **"Retake photo"** affordance until the spots-endpoint open question is
  resolved.
