# Hound Around: where things stand

Last updated Sat Oct 24, 2026, 11:30 PM, by David. Read this first, then `CLAUDE.md`, `docs/contract.md` and your file in
`docs/roles/`. Coding agents: treat this as the current state of the project. Update it when something here changes.

## Live links

| What | Where | State |
| --- | --- | --- |
| Front end | https://www.hound-around.tech (also hound-around-theta.vercel.app) | Up on the **real backend**, with the retake / choose-start screens |
| Backend API | https://dribeiro0-hound-around.hf.space | **Live and healthy**: `/health` → `ok: true`, **3,263 vectors, 57 spots** (index v3, deployed Sun 12:09 AM: Friday + Saturday phone walks, confirmed room clips, 360 views). Dataset revision `ead1404`; previous `c9b5f76` |
| Backend Space | huggingface.co/spaces/dribeiro0/hound-around | Public Docker Space (David's account), deployed from `main` at `0f7bf8d` (Space commit `84e4168`). Rejection code is live but **off** (no `recognition.json` yet) |
| Private data | HF dataset `dribeiro0/hound-around-data` | `index.npz`, `graph.json`, `rooms.json`. Private; the Space reads it with a read-only `HF_TOKEN` secret |

Live checks at 1:30 PM: two held-out hallway photos came back as the right spot in 0.7–0.9 s; an accessible route from
the west entrance to Room 164 came back as 3 steps, 65 m; CORS allows the production Vercel origin.

## What works

- **Integration verification (Oct 24):** 67 backend/ML/evaluation/property tests and 37 frontend tests pass.
  The new full-cycle integration test loads the real ML factory/index with a deterministic synthetic embedder,
  then exercises locate → accessible route → correction → re-snap → rollback. This is software verification,
  not recognition accuracy. A mobile-sized browser also reached the live backend's health and routing through
  the local proxy and directly from a configured static production build (including CORS). Locate/correct were
  intercepted fixtures to avoid altering the production index; a new real-photo recognition check remains pending.
- **Frontend integration fixes:** route retry is restored, route results are cleared when inputs change, and
  confidence displays as match strength rather than claiming exact frame agreement. The local proxy setup is
  documented in `frontend/README.md`. Production still needs the Vercel environment/redeploy handoff below.
- **Core loop end to end through the real API:** photo → spot + floor → route (accessible mode uses elevators) →
  correction goes live in the index.
- **Data:** about 7,100 face-blurred, labeled frames: Saturday-morning sessions plus a 4–6 PM round (31 phone videos:
  B1/F1/F2 walks and one-spot room clips) and a 10:40 PM Insta360 pass of the F1 east end (7 videos, cut into
  phone-like views without stitching). Never in this repo.
- **Graph:** 61 spots on B1/F1/F2, all connected. Room aliases: 164 (opening/closing ceremony), B62, B64A, 220
  (CS Builds), 262–265 (hacking rooms), Spark (incubator lab, F2 west).
- **Tests:** `python -m pytest -q` → 66 passed (API, ML, eval, property tests, plus regressions for every finding in
  the Kiro code review).

## Accuracy so far (real footage, not outsider photos yet)

**Update, Sat night (34 phone videos, 1,570 test frames, shipped backend):** exact 28%, within 10 m 52%, right floor
74%, user success 55%, a correction learns 82%, wrong-spot correction hijacks 3.5% (was 5.1%). F1 is now properly
measured (328 test frames instead of 48): user success 48%.

- **More phone footage barely moved accuracy.** On the same 1,077 test frames, adding the afternoon round went from
  27.9% to 28.4% top-1 (F1 top-3 31% → 48% was the one real gain). The errors are look-alike spots, not missing data.
- **360 footage:** sharing the per-spot cap with phone frames hurt (top-3 at those spots 33% → 19%); added on top
  (max 40 views per spot) it was neutral overall and slightly better at its spots, and it gave F1_south_stair its
  first footage. The index builder now caps 360 views separately.

Morning numbers, kept for comparison:

Leave-one-video-out: train on every other video, test on 1,077 frames taken right at a spot. This is the honest
in-building number; the outsider test set will be the headline number.

| Floor | Exact spot | Within 10 m | Right floor | User success* |
| --- | --- | --- | --- | --- |
| B1 | 32% | 49% | 74% | 55% |
| F1 | 23% | 50% | 73% | 50% (only 48 test frames: F1 needs a second filming session) |
| F2 | 23% | 52% | 78% | 59% |
| All | 28% | 50% | 75% | 56% |

\* User success = a confident answer within 10 m, or the top-3 picker contains the true spot.

- A correction makes the next photo of that spot right **80%** of the time (the "it learned from you" demo moment).
- The top-3 picker shows for 62% of photos.

**What the experiments showed (for the pitch, `ml/research/`):**
- DINOv2 beats a color-histogram baseline and CLIP; nearest-frame voting is the best simple method.
- PIGEON-style distance-smoothed labels help within a session (top-3 0.61 → 0.75) but not across sessions.
- **More frames from the same videos stop helping** past about 40 per spot. New sessions and new angles help: B1 went
  from 28% to 53% top-3 going from 1 to 2 training videos.
- The main errors are look-alike neighbors (the F2 east corridor E1–E4) and **B1 ↔ F2 confusion** from lighting and
  session effects. Room-sign OCR and the top-3 picker are the safety net.

## Changed behavior the team should know

- **Confidence** is now the winner's votes plus votes for spots within 8 m on the same floor, / 10 (it was winner's
  votes / 10). Look-alike neighbors split the vote but the route starts in the same place. `top3` vote counts are
  unchanged. This cut picker prompts from 82% to 62% with no accuracy loss. `docs/contract.md` should say so; agree it
  as a team.
- **A correction wins** when it's the nearest match to the new photo (it used to get pushed out by duplicate frames).
- **No index → the API reports 503** ("not ready") instead of answering with a made-up location.
- **The OCR floor override** now re-ranks within that floor, so the app's answer is always the first picker option.

## Navigation features (merged in PR #18; backend deployed Sat 5 PM)

`feat/navigation-fallbacks` adds manual starting-room entry, public destination
suggestions, a pixel mascot school/building picker, restart-safe correction vectors
and rollback, calibrated unrelated-photo rejection, and automated software checks.
It preserves the four existing endpoints and success payloads. A rejected photo
returns a documented 422 error; the app asks for a new photo or a manual start.

Local verification: **90 Python tests, 57 frontend tests, and the production build
passed**. Python ran on 3.14 locally; CI is configured for the required 3.11 runtime.
Browser checks used synthetic responses for retake/manual routing and isolated
school switching. Read-only live health/CORS/accessible-route checks passed; these
are not new accuracy measurements. Docker image execution remains unverified here.

Activation still requires:

- Calibrate rejection on separate known/unrelated validation photos and evaluate
  on held-out photos. Without a configured cutoff, the guard is inactive.
- Redeploy the backend and frontend after review. The current live service does
  not acquire these changes merely because they are committed to GitHub.
- Mount persistent storage via `HOUND_STATE_DIR` for corrections to survive Space
  replacement. Keep one worker and a unique, stable `HOUND_DATASET_ID` per building.
- Supply reviewed data and a separate backend for each additional school/building.
  Only BU/CDS is configured; no other school coverage is claimed.
- Configure optional deployment-smoke repository variables and required CI checks.

Setup commands and limitations: [navigation features](navigation-features-proposal.md).

## Open work, by owner

| Priority | Task | Owner |
| --- | --- | --- |
| 1 | **Outsider test photos:** 30–50 photos from people not on the team, named `TEST_<spot>_NN.jpg`, to David's Drive. Needed for the go/no-go and the headline accuracy number | Anyone |
| 3 | **Film F1 again**, a second session: 360° clips at every F1 spot, plus `class24`, `class48`, `south_stair`, `cafe_entry`, `restrooms_w`, `stair_east`. F1 is the demo floor | Data (David) |
| 4 | F2 360° clips for one-video spots (`hall_w`, `hall_ne`, `hall_north`, `core_elev`, `core_e`, `csbuilds`, `open_study`, `class20`, `class48c`) and the missing `class48a`; close-ups of room-number signs | Data |
| 5 | Confirm which doors are 262, 263, 264, 265, B62 and B64B. Clips of these rooms exist but stay unlabeled until confirmed (embeddings can't tell the black doors apart). Also confirm the on-site notes "F1 stair east does not exist" and F1 class48 | Anyone on site |
| 6 | Integration PR #15 is merged. Review/deploy the new navigation feature branch using the activation checklist above | Backend + Front end |
| 7 | Phone test on event Wi-Fi and cellular | Front end |
| 8 | Interviews (~10), stranger timing test, slides, demo script, backup video. **Devpost project tonight; submit by Sun 10 AM** | Pitch |
| 9 | Ethics Genius Bar visit (basement yellow space); ethics slide | David + Pitch |

## How to update the backend

- **New footage:** David processes it (extract → label → blur), rebuilds `index.npz`, re-uploads it to the private
  dataset, then restarts the Space. Nothing data-related goes to GitHub.
- **New backend code on `main`:** the Space is a copy, not linked to GitHub, so David redeploys it. Export with
  `git -c core.autocrlf=false archive` (Windows line endings break `scripts/start.sh` on Linux).
- **Current deployed corrections reset** when the Space restarts. The navigation
  feature branch adds replay from SQLite; preserving state across filesystem
  replacement also requires persistent storage as described above.

## Commands

```bash
python -m pytest -q                                   # all tests
python -m ml.build_index                              # rebuild data/index.npz from data/*/labels.csv
python pipeline/api_graph.py                          # data/graph.json + rooms.json from the walk sheets + private patch
python -m ml.eval --split test --limit 10             # go/no-go on outsider photos in data/test/
python -m ml.research.backend_eval --dataset data/dataset data/dataset_new data/dataset_f2   # per-floor real-data numbers
curl https://dribeiro0-hound-around.hf.space/health
```

## Rules (unchanged)

- The repo is public: never commit frames, video, floor plans, `graph.json`, `rooms.json`, `index.npz`, tokens or
  anything under `data/`.
- Faces are blurred before frames leave the laptop. User photos are deleted right after matching. No GPS, no tracking.
- Unsure about an event rule? Ask hackbu@bu.edu or Discord. Don't guess.
