# Handoff: point the Vercel front end at the live backend

For Avery (or Avery's coding agent). From David, Sat Oct 24, 2026, about 1:30 PM.

## Goal

The Vercel front end still runs on mock data. Switch it to the live backend by setting one environment variable and
redeploying. No code changes are needed.

## Current state (verified 1:30 PM)

- Backend: public Hugging Face Docker Space `dribeiro0/hound-around`, serving **`https://dribeiro0-hound-around.hf.space`**.
  Deployed from GitHub `main` at `c55ebfa`.
- `GET /health` returns `{"ok": true, "index_size": 2375, "model": "facebook/dinov2-small"}`.
- `POST /locate` with a real hallway photo returns the right spot in about 0.7-0.9 s. `GET /route?from=F1_entry_west&to=164&accessible=true`
  returns a 3-step, 65 m route to Room 164.
- CORS allows exactly these origins (`HOUND_CORS_ORIGINS` on the Space and in the Dockerfile):
  `https://www.hound-around.tech`, `https://hound-around.tech`, `https://hound-around-theta.vercel.app`,
  `http://localhost:5173`.
- The front end reads the backend URL from `VITE_API_URL` (`frontend/src/api.js`). When unset, it uses mock data.
  Vite bakes the value in **at build time**, so it only takes effect after a redeploy.

## Steps

1. Vercel → the Hound Around project → **Settings → Environment Variables**.
2. Add:
   - **Key:** `VITE_API_URL`
   - **Value:** `https://dribeiro0-hound-around.hf.space` (no trailing slash, no `/api`)
   - **Environments:** Production (add Preview too if you want preview builds live; see the CORS note below).
3. **Deployments** → latest production deployment → **⋯ → Redeploy**. A redeploy is required: changing the variable
   alone does nothing to the already-built site.
4. Do not commit the value into `frontend/.env` or any file in the repo. The repo is public, and the Vercel setting is
   the single source of truth.

## Verify

1. Open the production site on a phone (`https://hound-around-theta.vercel.app` or `hound-around.tech`).
2. The status pill should not show mock or offline. Take a photo of a hallway on B1, F1 or F2:
   - You should get a real spot name (not one of the mock ids in `docs/contract.md`), then a route.
3. Browser devtools → Network: requests go to `dribeiro0-hound-around.hf.space` and return 200.
   - CORS errors mean the page origin isn't in the allowed list above. Use the production URL, or ask David to add the
     origin.
4. Optional terminal check:
   ```bash
   curl https://dribeiro0-hound-around.hf.space/health
   ```

## Things to know

- **Preview deployments** (`hound-around-git-<branch>-….vercel.app`) are **not** in the CORS list, so they fail
  against the live backend. Test on the production URL, or send David the preview origin to add.
- **Cold start:** if the Space has been idle it can take about a minute to wake. The app's health pill and retry
  handle this; just wait and retry once.
- **Corrections reset on Space restart.** That's expected for the demo (documented in `api/README.md`).
- **Don't change the backend from here.** The Space is a copy of `main`, not linked to GitHub, and it pulls its private
  data (index, graph, rooms) from the private dataset repo `dribeiro0/hound-around-data` using a Space secret. David
  redeploys the Space when backend code or the index changes. Never put building photos, the graph or tokens in the
  public repo or the front end.
- The first photo after a cold start is the slowest (model warm-up). Do a throwaway photo before the demo.

## Done means

The production site, opened on a phone on cellular, goes photo → real spot → route using the live backend, with no
mock data and no CORS errors.
