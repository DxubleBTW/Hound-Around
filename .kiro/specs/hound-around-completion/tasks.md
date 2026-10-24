# Hound Around — Tasks

Status: draft for team review. Follows `design.md`. Ordered by priority and dependency so
independent tasks run in parallel waves. Keep each task small; finish **P0 first**. Every
task ends with a proof command. Tasks marked **[HUMAN-BLOCKED]** need private data,
accounts, or a building walk and cannot be completed in the sandbox.

Legend: `[ ]` not started · each task names real file paths · "parallel" = can run in the
same wave as its siblings.

Priority gates (today is Sat Oct 24, 2026): **P0 before 3 PM** (go/no-go) · **P1 by 6 PM** ·
**P2 by 8 PM** (Hackachusetts) · **P3 Sunday morning** (DS+X). If time or credits run out,
everything already finished must still work.

---

## P0 — before 3 PM (core recognition + go/no-go)

Wave P0-a (ml package, sequential within the package; blocks C and D):

- [ ] **P0.1 — ml embedder.** Add `ml/embedder.py`: DINOv2-small CLS-token embedding →
  384-d L2-normalized vector (design §2). Loads model once.
  Proof: `python -m pytest -q tests/test_ml_embedder.py`
  (synthetic: feeds a generated image, asserts shape `(384,)`, finite, unit norm).
  Needs `torch`+`transformers` approval (Open Question 2).
- [ ] **P0.2 — ml index.** Add `ml/index.py`: in-memory vector index with
  `load/save(index.npz)`, `add(vector,label,source)`, cosine top-k, `snapshot`/`restore`
  (no array aliasing), matching the `index.npz` schema in `docs/contract.md`.
  Proof: `python -m pytest -q tests/test_ml_index.py` (synthetic round-trip + snapshot).
- [ ] **P0.3 — ml backend factory.** Add `ml/backend.py` with
  `create_backend(data_dir)` exposing `model_name`, `size`, `locate(image)`,
  `prepare_correction`, `apply_correction`, `snapshot`, `restore` exactly like
  `api/recognition.py:StubBackend`, including the internal `vector` key; top-10 voting and
  `confidence = votes/10` (design §3).
  Proof: `python -m pytest -q tests/test_ml_backend.py` (synthetic index, asserts contract
  dict keys + weighted-correction behavior).
- [ ] **P0.4 — one-correction-flip test.** Add `tests/test_ml_correction.py`: synthetic
  index, a query that votes wrong, apply one correction, re-query near-identical vector,
  assert the winner flips to `true_spot` (design §3). Needs `hypothesis` approval
  (Open Question 2) for the property version; a plain pytest version works without it.
  Proof: `python -m pytest -q tests/test_ml_correction.py`
- [ ] **P0.5 — build_index CLI.** Add `ml/build_index.py`: `labels.csv` (`status==keep`)
  → `data/index.npz`, capping ~60 frames/spot (design, `docs/dataset.md`). Code + a
  synthetic-CSV test; real run is human-blocked.
  Proof: `python -m pytest -q tests/test_ml_build_index.py` (synthetic CSV + generated
  images → checks fp16 `[N,384]`, labels, `source=="video"`).
- [ ] **P0.6 — wire ml into the API.** Set `HOUND_ML_FACTORY=ml.backend:create_backend`
  and confirm the existing backend suite stays green with the real factory available.
  Proof: `python -m pytest -q`

Wave P0-b (can run in parallel with P0-a; independent files):

- [ ] **P0.7 — graph connectivity check (B.1 code).** Add `ml/check_graph.py` (or a test
  helper) that loads a graph+rooms and asserts floors ∈ {-1,1,2}, no duplicate/unknown
  nodes, and every room target reachable in normal and accessible modes. Prove on the
  **synthetic** graph from `tests/`.
  Proof: `python -m pytest -q tests/test_graph_connectivity.py`
  **[HUMAN-BLOCKED]** running it on the real private graph needs `data/graph.json`.
- [ ] **P0.8 — minimal eval (C.3 harness).** Add `ml/eval.py` skeleton with the metric
  functions (top-1, top-3, floor accuracy, graph-distance error, p50/p95 latency,
  unsure-rate) unit-testable on synthetic inputs, plus a `--test-dir` entry point for the
  go/no-go.
  Proof: `python -m pytest -q tests/test_ml_eval.py`
  **[HUMAN-BLOCKED]** the real go/no-go (`python -m ml.eval --test-dir data/test`, ≥7/10)
  needs the outsider `TEST_*.jpg` photos.

Go/no-go gate (3 PM) — **[HUMAN-BLOCKED]**, needs private frames + test photos:
`python -m ml.eval --test-dir data/test` prints ≥ 7/10 correct.

---

## P1 — by 6 PM (full eval, deploy, frontend on real API)

Wave P1-a (experiments; depends on P0 ml package):

- [ ] **P1.1 — full experiments (C.4).** Extend `ml/eval.py`: color-histogram baseline vs
  CLIP ViT-B/32 vs DINOv2-small, k = 1/5/10/20, OCR on/off, corrections learning curve,
  confusion list. CLIP is experiments-only (Open Question 2).
  Proof: `python -m ml.eval --experiments --out results/experiments.md`
  **[HUMAN-BLOCKED]** real numbers need private frames + test photos; the code path is
  synthetic-testable: `python -m pytest -q tests/test_ml_eval.py`.

Wave P1-b (deploy; depends on P0 ml package; parallel with P1-a):

- [ ] **P1.2 — extend `.dockerignore`.** Add `!ml/` and `!ml/*.py` so the `ml/` package
  enters the build context; keep data/images/weights out (design §6).
  Proof: `docker build -t hound-api . && docker run --rm hound-api python -c "import ml.backend"`
- [ ] **P1.3 — build-time model download + requirements.** Add approved runtime deps to
  `requirements.txt` (`torch` CPU, `transformers`, `easyocr`, `huggingface_hub`) and a
  Dockerfile step to pre-download `facebook/dinov2-small` + EasyOCR models (design §6/§8).
  Proof: `docker build -t hound-api .` (build succeeds, models cached in image).
  **[HUMAN-BLOCKED]** needs dependency approval and network for downloads.
- [ ] **P1.4 — Space startup data load.** In `ml/backend` (or a startup hook), download
  `graph.json`/`rooms.json`/`index.npz` from the private HF dataset repo via `HF_TOKEN`
  into `HOUND_DATA_DIR` (design §6, Open Question 3).
  Proof: `curl -s $SPACE_URL/health` returns `{"ok":true,...,"model":"dinov2-small"}`.
  **[HUMAN-BLOCKED]** needs the HF account, Space, private dataset repo, and token.
- [ ] **P1.5 — proxy rate-limit fix.** Apply design §7: Uvicorn `--proxy-headers` with a
  trusted-hosts allowlist for the HF proxy and/or a raised demo limit (Open Question 4).
  Proof: from two devices behind the proxy, `curl -F image=@q.jpg $SPACE_URL/locate`
  succeed independently (no shared 429).
  **[HUMAN-BLOCKED]** needs the deployed Space.
- [ ] **P1.6 — set Space env + CORS.** Set `HOUND_ML_FACTORY`, `HOUND_DATA_DIR`,
  `HOUND_CORS_ORIGINS` (the production + localhost origins in design §6), `HF_TOKEN`.
  Proof: `curl -i -H 'Origin: https://www.hound-around.tech' $SPACE_URL/health` shows the
  CORS header. **[HUMAN-BLOCKED]** needs the Space.

Wave P1-c (frontend on real API; depends on a reachable Space URL for live proof, but code
builds without it):

- [ ] **P1.7 — point frontend at the Space (E.1).** Set `VITE_API_URL` (via
  `frontend/.env`/Vercel) so `frontend/src/api.js` calls the real endpoints.
  Proof: `cd frontend && npm run build`
- [ ] **P1.8 — Locate top-3 picker wiring (E.3).** Confirm `frontend/src/screens/Locating.jsx`
  shows the top-3 picker when `confidence < 0.6` or top3 spans floors.
  Proof: `cd frontend && npm run build`
- [ ] **P1.9 — Confirm → correct (E.4).** Wire Confirm "No" → top-3 picker → `POST /correct`
  → "Thanks, it learned that" with new `index_size` (`frontend/src/screens/Confirm.jsx`).
  The "none of these" full spot list depends on Open Question 1.
  Proof: `cd frontend && npm run build`

---

## P2 — by 8 PM (polish, property tests, Hackachusetts submission)

- [ ] **P2.1 — frontend polish (E.5–E.9).** Loading/error/empty states, ~8 s timeout +
  retry on Locate, reduced-motion, big tap targets (`docs/roles/frontend.md`).
  Proof: `cd frontend && npm run build`
- [ ] **P2.2 — update mock vertical wording.** In `frontend/src/api.js`, change mock
  vertical steps to the real forms `Take the stairs to {level}, toward …` /
  `Take the elevator to {level}, toward …` (design §5).
  Proof: `cd frontend && npm run build`
- [ ] **P2.3 — property tests (F).** If `hypothesis` is approved, add property-based
  versions of the one-correction-flip and voting invariants.
  Proof: `python -m pytest -q`
- [ ] **P2.4 — README + KIRO.md (G.2).** Live Vercel link, run/setup, ethics summary;
  `KIRO.md` describing how this spec drove the build.
  Proof: docs-only; `python -m pytest -q` stays green and `cd frontend && npm run build`.
- [ ] **P2.5 — Devpost + ethics slide (G.3).** The test-set accuracy number, experiments
  table, and live-correction moment (never cut). **[HUMAN-BLOCKED]** (accounts, real
  numbers, slide).

---

## P3 — Sunday morning (DS+X final)

- [ ] **P3.1 — accuracy chart.** Turn `results/experiments.md` into one chart
  (`docs/img/accuracy.png`) for the pitch.
  Proof: `python -m ml.eval --chart --out docs/img/accuracy.png`
  **[HUMAN-BLOCKED]** needs real eval numbers.
- [ ] **P3.2 — GET `/spots` (if approved).** Only if Open Question 1 is approved by the
  team: add a read-only `GET /spots → [{id,floor,label}]` and use it for the Confirm "none
  of these" list. Contract change — do not start without sign-off.
  Proof: `python -m pytest -q` (new endpoint test) + `cd frontend && npm run build`.
- [ ] **P3.3 — full demo rehearsal.** photo → route → wrong → correct → re-snap right, on
  the deployed backend and on cellular (`docs/roles/backend.md` "Done means").
  Proof: scripted `curl` run against `$SPACE_URL` prints valid `/locate`, `/route`,
  `/correct` JSON. **[HUMAN-BLOCKED]** needs the live Space + a real phone.

---

## Parallelism summary

- **P0:** wave P0-a (ml package P0.1→P0.6, sequential) runs in parallel with wave P0-b
  (P0.7 graph check, P0.8 eval harness).
- **P1:** P1-a (experiments), P1-b (deploy), and P1-c (frontend) are three parallel waves
  once the P0 ml package exists; within P1-b, P1.2/P1.3 gate the deploy tasks P1.4–P1.6.
- **P2:** P2.1, P2.2, P2.3, P2.4 are independent and parallel; P2.5 is human-blocked.
- **Human-blocked tasks** (B real run, C real numbers, D deploy, go/no-go, demo
  rehearsal, chart) are flagged inline and wait on private data, accounts, or the building
  walk.
