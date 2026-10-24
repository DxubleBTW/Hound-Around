# Backend lead (David)

You own the API, routing, corrections, hosting, network testing, and the ethics and security slide.

## Your deliverables

1. **`graph.json` (B1, F1, F2 only)** from the walk sheets. Drop the floor 13 and 17 nodes. Add the nodes found on
   video (`F1_stair_east`, `F1_room164`, `F1_cafe_entry`, `F1_restrooms_w`). Every edge gets `meters`,
   `instruction`, `stairs`, and `vertical` where it applies. Private: it lives in `data/` and never in the repo.
2. **`rooms.json`**: room 164 (opening and closing ceremony), B62–B64, 262–265, plus whatever Data confirms.
3. **FastAPI app** per `docs/contract.md`:
   - `POST /locate`: read the image, strip EXIF, call ML's `locate()`, keep the vector in memory under `photo_id` for
     ~10 min, **delete the image**. Return the exact contract fields.
   - `GET /route`: networkx shortest path. Weight = `cost` if present, else `meters`. `accessible=true` drops
     `stairs` edges. `to` accepts a node id or a room number. Group the steps into human turns.
   - `POST /correct`: append the stored vector to the index under `true_spot` (source `correction`) and log it in
     SQLite. One correction goes live instantly in the demo. Keep a version and a rollback.
   - `GET /health`.
   - CORS for the Vercel domain. Limit upload size and file type. Rate-limit `/correct`.
4. **Deploy to a Hugging Face Space.** The model loads once at startup. Test the cold start.
5. **Network test** (Sat afternoon): event Wi-Fi, cellular, a hotspot, and Chrome DevTools "Slow 3G". Front end shows
   "Sending… Matching…" and times out at ~8 s with a retry.
6. **Ethics and security slide**, plus a check at the Ethics Genius Bar (basement yellow space).

## Timeline

- Before noon: trim the graph to B1/F1/F2 and write `rooms.json`. Scaffold FastAPI with a stub `locate()` so Front end
  can build against real endpoints right away.
- 12:15–3: `/route` with tests (west entrance → room 164; B1 → 262 in accessible mode). Swap in ML's real `locate()`.
- 3–6: deploy the Space, add `/correct` and SQLite, run the network tests.
- 6–8: harden (limits, CORS, timeouts). Draft the ethics slide.
- Night: help with the README sections for the API and the setup.

## Ethics slide content

- Faces blurred automatically; people masked; user photos deleted right after matching; EXIF stripped.
- No GPS, no tracking, no stored location history.
- No public building map: the dataset, floor plans and graph stay out of the public repo.
- When unsure, it asks (top-3 picker) instead of guessing.
- Poisoning defenses at scale: BU login, 3-person consensus on corrections, rate limits, a versioned index with
  rollback, restricted areas locked.
- Contrast: Stanford's PIGEON (CVPR 2024) geolocates photos, and its authors withheld the full model over privacy
  concerns. Hound Around is one building, opt-in, one photo only when you ask.

## Done means

- `curl` against the deployed Space returns valid `/locate` and `/route` JSON from a phone on cellular.
- A full demo run (photo → route → wrong → correct → re-snap right) works end to end.

## Don'ts

- Don't rename contract fields.
- Don't log or store images.
- Don't commit `data/`, the graph or the rooms file.
