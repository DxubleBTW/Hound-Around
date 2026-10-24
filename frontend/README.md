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

To use the real backend, copy `.env.example` to `.env.local` and set `VITE_API_URL` to the Space URL.

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
