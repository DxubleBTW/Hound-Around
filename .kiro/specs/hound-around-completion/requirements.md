# Hound Around — Completion Requirements

Status: draft for team review · Governs all remaining work for DS+X 2026 (CDS, 665 Comm Ave).

## Product goal

A phone web app for one building: BU's Center for Computing & Data Sciences. A person
takes **one photo** of the hallway they are standing in. From that photo alone (no GPS,
no Wi-Fi positioning, no tracking), Hound Around recognizes the **spot** and **floor**,
then gives turn-by-turn directions to a room such as "164", "B62" or "262". An
**accessible mode** avoids stairs. If the guess is wrong, the person picks the right spot
from the top 3 and the system **learns immediately**: the next photo of that spot is
recognized.

The core loop that nobody may break: **photo → spot → route → correction.**

Scope and hard constraints (from `CLAUDE.md`, `docs/roles/README.md`, `docs/contract.md`):

- Floors in scope are **B1 (-1), F1 (1), F2 (2)** only. No floor 3+.
- `docs/contract.md` is law. No field renames or new endpoints/fields without team
  approval; proposals live in the Open Questions section below.
- The GitHub repo is public. Never commit frames, videos, test photos, floor plans,
  `graph.json`, `rooms.json`, `labels.csv`, `anchors.json`, `nodes.txt`, anything under
  `data/`, `*.npz`, `*.sqlite`, model weights, or secrets. Never loosen `.gitignore`, and
  never add `.kiro/` to it (Hackachusetts requires `/.kiro` in the repo).
- No new dependencies without approval. Every task ends with a command that proves it.

## Workstreams and requirements

Requirements use EARS phrasing (WHEN/IF … THE SYSTEM SHALL …). The contract response
shapes referenced below are fixed by `docs/contract.md`.

### A. Recognition ML package (`ml/`)

**User story:** As a lost visitor, I want the app to recognize my hallway spot and floor
from one photo, so that I can be routed without typing where I am.

Acceptance criteria:

1. WHEN `ml.build_index` is run against a `labels.csv` whose rows have `status == keep`,
   THE SYSTEM SHALL write `data/index.npz` containing `vecs` float16 `[N, 384]`
   (L2-normalized), `labels` str `[N]`, and `source` str `[N]` set to `"video"`, matching
   the `index.npz` schema in `docs/contract.md`.
2. WHEN indexing frames for a spot, THE SYSTEM SHALL cap that spot at ~60 frames so the
   basement walk does not over-represent B1 (`docs/dataset.md`, `docs/roles/ml.md`).
3. WHEN `locate(image)` is called, THE SYSTEM SHALL embed the image with DINOv2-small to a
   384-d descriptor, compute cosine similarity against `index.npz`, take the top-10
   neighbors, vote by label, and return the contract `/locate` dictionary fields plus an
   internal `vector` (384 finite, nonzero floats), exactly as the `api/README.md` ML
   handoff and `StubBackend` in `api/recognition.py` specify.
4. WHERE the winning label took `v` of the top-10 votes, THE SYSTEM SHALL set
   `confidence = v / 10` and return up to 3 entries in `top3` as `{spot, votes}`
   (`docs/contract.md`).
5. WHEN `locate` runs on CPU, THE SYSTEM SHALL return in **< 1 s** (`docs/roles/ml.md`
   "Done means"; the HF Space may have no GPU).
6. THE SYSTEM SHALL expose the handoff interface the API serializes: `model_name`,
   `size`, `locate(image)`, `prepare_correction(vector, label)`, `apply_correction(prepared)`,
   `snapshot()`, `restore(snapshot)`, and SHALL NOT retain the image after `locate`
   returns (`api/README.md`).
7. IF `prepare_correction` is called, THE SYSTEM SHALL allocate a replacement index that
   tags the new vector `source == "correction"` **without mutating the live index**, and
   `apply_correction` SHALL swap to it; `snapshot`/`restore` SHALL give reliable one-level
   rollback with no aliasing of arrays that later mutate (`api/README.md`).

### B. Graph, rooms, and connectivity (private data + checks)

**User story:** As a visitor, I want directions that follow real, walkable building edges,
so that routing never sends me through a wall or a wrong floor.

Acceptance criteria:

1. WHEN the graph loads, THE SYSTEM SHALL accept only nodes on floors -1/1/2 and SHALL
   reject duplicates and out-of-scope floors (enforced by `Router.__init__` in
   `api/routing.py`).
2. THE graph SHALL use node IDs of the form `<FLOOR>_<name>` exactly as on the walk
   sheets, SHALL include the video-only nodes named in `docs/contract.md`
   (`F1_stair_east`, `F1_room164`, `F1_cafe_entry`, `F1_restrooms_w`), and SHALL NOT
   invent node IDs. **(human-blocked: needs the private walk sheets)**
3. WHEN a connectivity check runs on the graph, THE SYSTEM SHALL confirm every room target
   in `rooms.json` is reachable from at least one hallway node in both normal and
   accessible modes, flagging any unreachable target. **(human-blocked: needs private
   `graph.json`/`rooms.json`)**
4. THE `rooms.json` SHALL map at least room 164 (opening/closing ceremony), B62–B64 and
   262–265 to nodes, per `docs/roles/backend.md`. **(human-blocked)**

### C. Evaluation and experiments (`ml/eval.py`) — 25% of the rubric

**User story:** As a judge, I want honest accuracy numbers on photos the team never saw,
so that "Data Science Application" is backed by evidence, not a demo.

Acceptance criteria:

1. THE SYSTEM SHALL use the fixed split: train = Saturday-morning runs; val = one
   held-out run per floor; test = outsider `TEST_<node>_NN.jpg` photos; and SHALL NOT mix
   train frames into val or test (`CLAUDE.md`, `docs/roles/ml.md`, `docs/dataset.md`).
2. WHEN `ml.eval` runs, THE SYSTEM SHALL report top-1 spot, top-3 spot, floor accuracy,
   median graph-distance error in meters (using `graph.json`), p50/p95 latency, and how
   often it correctly says it is unsure (`confidence < 0.6`).
3. WHEN the 3:00 PM go/no-go runs on the 10 outsider photos, THE SYSTEM SHALL locate
   **at least 7 of 10** correctly (`docs/roles/README.md`). **(human-blocked: needs the
   outsider test photos)**
4. THE SYSTEM SHALL produce the experiments table comparing a color-histogram baseline vs
   CLIP ViT-B/32 vs DINOv2-small, across k = 1/5/10/20, with OCR on vs off, plus a
   corrections learning curve and a confusion list of mixed-up spots (`docs/roles/ml.md`).
   **(human-blocked for real numbers: needs private frames + test photos)**

### D. Backend deployment (HF Space)

**User story:** As a visitor on cellular, I want a reliable hosted API, so that the app
works on my phone during the demo.

Acceptance criteria:

1. WHEN the Space starts, THE SYSTEM SHALL load the model once at startup (not per
   request) and SHALL load `graph.json`/`rooms.json`/`index.npz` from private storage, never
   from the public repo (`docs/roles/backend.md`, `api/README.md`).
2. THE image SHALL NOT be persisted: `/locate` SHALL strip EXIF, cache only the normalized
   vector under `photo_id` with a TTL, and close/delete the image immediately
   (already enforced in `api/main.py`).
3. WHEN `/correct` is called with a valid cached `photo_id`, THE SYSTEM SHALL append the
   stored vector under `true_spot` (source `correction`) to the **in-memory** index, log
   it to `corrections.sqlite`, and make the change live instantly, with one-level rollback
   available to a local operator (`api/main.py`, `api/README.md`).
4. THE Space SHALL set CORS to the explicit production origins and SHALL keep upload
   limits (2 MiB, JPEG/PNG/WebP, 20 MP) and the POST rate limit (`api/main.py`). See Open
   Question 4 for the behind-proxy fix. **(human-blocked for the live deploy: needs the HF
   account/secret and real data)**

### E. Frontend on real API (`frontend/`)

**User story:** As a stranger, I want to go from photo to directions on my own phone in
under 30 s, so that the app is usable without help (`docs/roles/frontend.md`).

Acceptance criteria:

1. WHEN `VITE_API_URL` is set, THE frontend SHALL call the real `/locate`, `/route`,
   `/correct` endpoints; WHEN it is unset, it SHALL run on mock data (already in
   `frontend/src/api.js`).
2. WHEN a photo is taken, THE Snap screen SHALL resize to ~512 px and strip EXIF via
   canvas re-encode before upload (already in `frontend/src/lib/image.js`).
3. IF `confidence < 0.6` OR the top 3 span floors, THE Locate screen SHALL show the
   **top-3 picker** instead of a single answer (`docs/contract.md`, `docs/roles/frontend.md`).
4. WHEN the user answers "No" on Confirm, THE SYSTEM SHALL open the top-3 picker plus a
   "none of these" spot list, call `POST /correct`, and show "Thanks, it learned that" with
   the new `index_size` (`docs/roles/frontend.md`). The "none of these" spot list depends
   on Open Question 1.
5. THE Locate screen SHALL show "Sending… Matching…" with an ~8 s timeout and retry and
   SHALL never show a stale result (`docs/roles/frontend.md`).
6. THE app SHALL never request GPS/location permission, SHALL never show a floor plan or
   full building map, and SHALL not store photos in the browser after upload.

### F. Tests and quality gates (`tests/`)

**User story:** As a teammate, I want every change to end with a runnable proof, so that
we never ship a broken core loop under time pressure.

Acceptance criteria:

1. THE existing backend suite (`tests/test_backend.py`) SHALL stay green
   (`python -m pytest -q`) using only the synthetic graph and generated solid-color images,
   never building photographs.
2. THE ml package SHALL have synthetic-only unit tests that run under `python -m pytest -q`
   without any private data and without a GPU.
3. WHERE property-based testing is approved, THE SYSTEM SHALL include a synthetic test
   proving that **one correction flips the very next near-identical query** (see
   design.md). Uses `hypothesis` (Open Question 2).

### G. Submission artifacts (README, KIRO.md, Devpost)

**User story:** As a judge, I want the repo and Devpost to explain the system and show the
Kiro spec, so that Hackachusetts and DS+X criteria are met.

Acceptance criteria:

1. THE repo SHALL contain `/.kiro` (this spec, steering, hooks) committed, per
   Hackachusetts.
2. THE `README.md` SHALL include the live Vercel link, run/setup instructions, and the
   ethics summary; THE `KIRO.md` SHALL describe how the spec drove the build.
3. THE submission SHALL present the test-set accuracy number, the experiments table, and
   the live correction moment — the three things `docs/roles/README.md` says are never cut.

## Open Questions (need team/user approval)

These require a human decision before the dependent tasks can proceed. Nothing here
changes `docs/contract.md` without explicit team sign-off.

1. **Readable spot names and the "none of these" list — GET `/spots` or a label field?**
   The Confirm screen's top-3 picker and its "none of these" spot list (`docs/roles/frontend.md`)
   need human-readable names and a full list of valid spots, but `docs/contract.md`
   returns **node IDs only** and has **no spot-list endpoint**. Today `frontend/src/lib/spots.js`
   formats IDs locally, which cannot enumerate all spots. Proposal (needs team approval, it
   touches the contract): add `GET /spots → [{id, floor, label}]`, OR add a `label` field
   to `/locate` top3 entries. Preference: a read-only `GET /spots` because it does not
   change existing response shapes. **Decision needed from the whole team.**

2. **New-dependency approvals (rough sizes + where used).** None of these are installed in
   the sandbox; all need approval (`CLAUDE.md`: "No new dependencies without asking").
   - `torch` (CPU wheels, ~200 MB) — DINOv2 inference in `ml/` (video, runtime).
   - `transformers` + `facebook/dinov2-small` weights (~85 MB) — the embedder in `ml/`
     (video, runtime; weights downloaded at build time).
   - `easyocr` (~90 MB library + ~100 MB detection/recognition models) — room-number and
     floor-numeral OCR backup in `ml/` (video, runtime).
   - `CLIP ViT-B/32` (~350 MB) — **experiments only**, the baseline comparison in
     `ml/eval.py`; not shipped to the Space.
   - `hypothesis` (small) — **dev only**, property-based test for the one-correction-flip
     proof.
   - `huggingface_hub` (small) — downloading private `graph.json`/`rooms.json`/`index.npz`
     at Space startup via `HF_TOKEN`.

3. **HF Space privacy approach.** The repo is public but the graph/rooms/index must stay
   private (`docs/roles/README.md`, `api/README.md`). Proposal: keep the Space **code**
   public, store `graph.json`/`rooms.json`/`index.npz` in a **private HF dataset repo**, and
   have the Space download them at startup using an `HF_TOKEN` Space **secret** (with
   `huggingface_hub`). No private file ever enters the public repo or the public Space git.
   **Confirm the private dataset repo name and that the token is a Space secret, not in
   code.**

4. **Rate limit behind the HF proxy.** `api/main.py` rate-limits 30 POST/min **per direct
   peer** using `request.client.host`. Behind the HF proxy, every judge shares the proxy's
   IP, so they collapse into **one shared bucket** and will 429 each other during the demo.
   `api/README.md` warns to configure trusted-proxy handling deliberately and not trust
   arbitrary forwarded headers. Proposal (pick one): (a) configure Uvicorn
   `--proxy-headers` with a trusted-hosts allowlist so the real client IP is used, or
   (b) raise the demo limit / disable the limiter for the presentation window. **Team
   decision: which, and what demo limit?**

5. **OCR latency budget.** `locate()` must stay **< 1 s on CPU** (`docs/roles/ml.md`), but
   EasyOCR adds latency. Proposal: **gate OCR** — only run it when the vote is uncertain,
   e.g. `confidence < 0.8` OR the top 3 span floors — so the common confident path stays
   fast, and the OCR floor overrides the vote only when they disagree (design.md). **Confirm
   the gating threshold and the per-call latency ceiling (target < 1 s including OCR when
   gated on).**

### Human-only asks (no code can satisfy these)

- **Private data:** processed/blurred F2 frames, the full `labels.csv`, the private
  `graph.json`/`rooms.json`, and the **outsider test photos** (`TEST_<node>_NN.jpg`). Absent
  in the sandbox; blocks B, C real numbers, and the live demo.
- **The F2 building walk** and resolving the review-folder labels (`docs/roles/data.md`).
- **Accounts/secrets:** a Hugging Face account + Space + private dataset repo + `HF_TOKEN`
  secret; a Vercel project + `VITE_API_URL`.
- **Network tests on real phones** (event Wi-Fi, cellular, hotspot, Slow 3G).
