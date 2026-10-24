# Hound Around frontend

Phone web app: snap a hallway photo → see where you are → "Right spot?" → turn-by-turn route.
React 18 + Vite 5 + Tailwind 4. Talks to the FastAPI backend using the shapes in `../docs/contract.md`.

## Run it

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 , also on your LAN IP so you can open it on a phone
```

With no `VITE_API_URL` set, the app runs on **mock data** (a "Demo data" pill shows at the top).
Mock locate alternates between a confident match and an unsure one, so both demo paths are visible.

## Connect the real backend

Copy `.env.example` to `.env.local`, then pick one:

**Backend on your laptop** (also works from a phone on the same Wi-Fi, no CORS setup):
```bash
# terminal 1, repo root (needs private data/graph.json + rooms.json, and HOUND_ML_FACTORY or HOUND_STUB_SPOT)
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --workers 1
# frontend/.env.local
VITE_API_URL=/api
API_PROXY_TARGET=http://127.0.0.1:8000
# terminal 2
cd frontend && npm run dev
```
Vite forwards `/api/*` to uvicorn, so the browser only ever talks to Vite.

**Deployed Space:** `VITE_API_URL=https://<user>-<space>.hf.space` (the direct `.hf.space` host, not the
huggingface.co/spaces page). The Space must allow this site's origin in `HOUND_CORS_ORIGINS`; the Dockerfile
default allows `https://www.hound-around.tech`, `https://hound-around.tech`, `https://hound-around-theta.vercel.app` and `http://localhost:5173`.
Vercel preview URLs are not covered (the backend rejects wildcards); add one explicitly if you need it.

**Server status pill.** On load the app polls `GET /health` every 5 s (up to 2 min) and shows
"Connecting… / Server waking up… / Can’t reach the server" until the backend is ready, since a sleeping
Space wakes on that first request. If `/health` reports a `stub-*` model, a red "Test backend · not real
recognition" pill stays up so nobody mistakes the stub for real recognition.

## Error handling and checks

Requests time out after eight seconds and are cancelled when leaving a screen.
Errors show recovery guidance for connection failures, invalid photos, unavailable routes,
expired correction IDs, rate limits, and unavailable services. Invalid responses cannot
advance to a successful screen. Locate and route failures offer retry.

If saving a correction fails, the selected spot stays available: retry saving or continue
routing from it. A timeout can happen after the server saved the correction, so the UI
says it could not confirm the save rather than claiming nothing was learned. An expired
or already-used photo ID requires another photo to try learning again.

Photo preparation failures return to capture with an error instead of uploading an empty
blob. Dark/blurry-image detection is still separate follow-up work.

```bash
cd frontend
npm test             # Node's built-in runner; use Node 20+
npm run build
```

Before deployment, test on a real phone: corrupt/unsupported image, offline request,
a stalled request, retry followed by retake, route failure, and correction failure with
both retry and continue. Confirm late responses never replace the current screen and
only a confirmed successful correction shows the learning message. Unit tests use mocks;
they do not establish real recognition accuracy or phone/network performance.

> Phone camera note: `capture="environment"` opens the camera directly on phones. On a laptop it opens a file picker.
> Testing on a phone over LAN works with `npm run dev`; the camera input does not need HTTPS.

## Vercel

Live: **https://www.hound-around.tech**. Pushes to `main` deploy production; every branch/PR gets a preview link.

No dashboard changes needed. The build is configured in the repo:
- Root Directory = repo root (current setting): `/vercel.json` installs and builds `frontend/` and serves `frontend/dist`.
- If Root Directory is ever set to `frontend`, `frontend/vercel.json` takes over and selects the Vite preset.

Add `VITE_API_URL` under Environment Variables, then redeploy (Vite bakes it in at build time).

## Screens (`src/screens/`)

| Screen | What it does |
|---|---|
| `Snap` | Destination ("Where to?"), Elevators-only toggle, big camera button. Shrinks the photo to 512 px and strips EXIF before upload. |
| `Locating` | Shows the photo while `POST /locate` runs. Eight-second timeout, retry, and cancellation on retake. |
| `Confirm` | Spot + floor + "9/10 frames agree". "Right spot?" → yes routes, no opens the top-3 picker. Picker opens automatically when confidence < 0.6 or the top 3 span floors (contract rule). Picking a different spot calls `POST /correct`; only a confirmed save shows "just learned from you". Failures offer retry or navigation without a confirmed save. |
| `Route` | `GET /route`, one step at a time (ethics rule: no full map, only the next turn). Route failures offer retry or restart. |

## Rules this code follows
- No GPS / geolocation API anywhere. The photo is the only input, and EXIF (incl. GPS tags) is stripped by re-encoding.
- The photo preview URL is revoked on restart; nothing is stored client-side.
- Node ids come only from the backend. `src/lib/spots.js` formats them for display, it never invents them.
- No images in the repo (`.gitignore` blocks png/jpg); icons are inline SVG.
