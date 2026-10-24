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

> Phone camera note: `capture="environment"` opens the camera directly on phones. On a laptop it opens a file picker.
> Testing on a phone over LAN works with `npm run dev`; the camera input does not need HTTPS.

## Vercel

Live: **https://hound-around-theta.vercel.app**. Pushes to `main` deploy production; every branch/PR gets a preview link.

No dashboard changes needed. The build is configured in the repo:
- Root Directory = repo root (current setting): `/vercel.json` installs and builds `frontend/` and serves `frontend/dist`.
- If Root Directory is ever set to `frontend`, `frontend/vercel.json` takes over and selects the Vite preset.

Add `VITE_API_URL` under Environment Variables, then redeploy (Vite bakes it in at build time).

## Screens (`src/screens/`)

| Screen | What it does |
|---|---|
| `Snap` | Destination ("Where to?"), Elevators-only toggle, big camera button. Shrinks the photo to 512 px and strips EXIF before upload. |
| `Locating` | Shows the photo with a scan line while `POST /locate` runs. Retry on network errors. |
| `Confirm` | Spot + floor + "9/10 frames agree". "Right spot?" → yes routes, no opens the top-3 picker. Picker opens automatically when confidence < 0.6 or the top 3 span floors (contract rule). Picking a different spot calls `POST /correct` and shows "just learned from you". |
| `Route` | `GET /route`, one step at a time (ethics rule: no full map, only the next turn). |

## Rules this code follows
- No GPS / geolocation API anywhere. The photo is the only input, and EXIF (incl. GPS tags) is stripped by re-encoding.
- The photo preview URL is revoked on restart; nothing is stored client-side.
- Node ids come only from the backend. `src/lib/spots.js` formats them for display, it never invents them.
- No images in the repo (`.gitignore` blocks png/jpg); icons are inline SVG.
