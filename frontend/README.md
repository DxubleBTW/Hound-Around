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

## Navigation fallbacks and campus selection

Choose a starting room without a photo, or use the manual option when none of the
predictions fits. Manual routing never saves a correction. When the configured
backend rejects an unrelated photo, **Retake photo** returns to capture rather than
resending that photo; manual navigation remains available.

The destination input provides native autocomplete from the building's explicitly
public catalog. **Change school** opens the pixel mascot row and illustrative
campus scene: tap a school or drag its mascot onto the scene, then choose a building.
Switching clears the previous navigation state and uses an immutable building API
client. Only BU/CDS is configured; other buildings need separate reviewed backends,
public metadata, and their own `VITE_*` API settings. No floor plans are published.

See [feature setup](../docs/navigation-features-proposal.md) for configuration,
calibration, limitations, and checks. The private graph/room directory must never
be copied into the public campus catalog.

To use the real backend, copy `.env.example` to `.env.local` and set `VITE_API_URL` to the Space URL.

### Connect a local checkout to the existing live service

The current backend URL and its verified state are in [docs/STATUS.md](../docs/STATUS.md).
For local development, put the following in **ignored** `frontend/.env.local`, replacing
the placeholder with that backend URL. Preserve any existing local settings:

```dotenv
VITE_API_URL=/api
API_PROXY_TARGET=<backend URL from docs/STATUS.md>
```

Run `npm run dev` from `frontend/`. Vite forwards `/api/*` to the live service, so the
browser can run the full UI without downloading private data or ML models locally.
Health and directions use the real service; confirming a correction changes its live
index. Use verified CDS photos and location labels when testing corrections.

The `/api` proxy is for development only. A production build needs `VITE_API_URL` set
to the direct backend URL; Vercel must have that value in its own environment and be
redeployed. See [the deployment handoff](../docs/handoff-vercel-backend.md).

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
blob. A client-side Laplacian check also rejects blurry/blank photos; its threshold
still needs checking on real phones and hallway photos.

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
| `Confirm` | Spot + floor + match strength. The score includes nearby-spot support and is not a calibrated accuracy percentage. "Right spot?" → yes routes, no opens the top-3 picker. Picker opens automatically when confidence < 0.6 or the top 3 span floors. Picking a different spot calls `POST /correct`; only a confirmed save shows the learning message. Failures offer retry or navigation without a confirmed save. |
| `Route` | `GET /route`, one step at a time (ethics rule: no full map, only the next turn). Route failures offer retry or restart. |

## Rules this code follows
- No GPS / geolocation API anywhere. The photo is the only input, and EXIF (incl. GPS tags) is stripped by re-encoding.
- The photo preview URL is revoked on restart; nothing is stored client-side.
- Node ids come only from the backend. `src/lib/spots.js` formats them for display, it never invents them.
- No images in the repo (`.gitignore` blocks png/jpg); icons are inline SVG.


## Local reliability measurements

`VITE_LOCAL_METRICS=1` exposes `window.houndMetrics()` for a local diagnostic build.
Only aggregate photo-to-route timings and recovery counts remain in page memory;
nothing is uploaded or persisted, and a route response is not proof of arrival.
The server tier controls picker/second-photo/automatic starts; absent production
confidence calibration uses the picker. Correction retries are idempotent, and
conflicting correction labels receive retake guidance. See the
[reliability guide](../docs/recognition-reliability.md) for the repeatable synthetic
mobile-browser smoke check and real-photo release requirements.
