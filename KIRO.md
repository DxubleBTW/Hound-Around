# How Kiro was used on Hound Around

This is the honest account of how Kiro contributed to Hound Around, kept current
as work proceeds. It separates **what was asked**, **what Kiro added**, and
**what pre-existed and was built with other tools**. Nothing here claims Kiro
built the pre-existing parts.

## What was asked

The team's master prompt asked Kiro to finish Hound Around for the Hackachusetts
/ DS+X 2026 judging, under the non-negotiable rules in `CLAUDE.md` and
`docs/roles/README.md`. The Kiro-specific asks (workstream 0) were:

1. **Steering docs** in `.kiro/steering/`: product, tech, and structure
   describing the repo exactly as it is today; an always-included `hound-rules`
   turning the non-negotiable rules into a per-change checklist; and per-area
   guidance (`ml` for `ml/**` and `pipeline/**`, `frontend` for `frontend/**`,
   `api` for `api/**` and `tests/**`).
2. **Agent hooks** in `.kiro/hooks/`: tests-on-save, contract-guard,
   privacy-guard-on-stop, and frontend-build.
3. **`KIRO.md`** (this file): the running write-up, which becomes the submission
   write-up in workstream G.

The broader asks (an `ml/` package with synthetic-only tests, eval structure,
frontend finishing, deployment, property-based tests, and submission docs) are
tracked in the spec and implemented in later tasks.

## What PRE-EXISTED (built with other tools, not Kiro)

These were in the repo before Kiro and are **not** Kiro's work:

- **`api/`** — the FastAPI backend: the four contract endpoints and contract
  enforcement in `api/main.py`, the ML handoff boundary and `StubBackend` in
  `api/recognition.py`, and the networkx router in `api/routing.py`.
- **`pipeline/`** — the Windows data tools: `extract_frames.py`,
  `label_frames.py`, `blur_faces.py`.
- **`frontend/`** — the first React + Vite + Tailwind phone app (four screens,
  `api.js` with mock fallback, `image.js`, `spots.js`).
- **`docs/`** — `contract.md` (law), `dataset.md`, and the role docs.
- **`tests/test_backend.py`** — the synthetic backend test suite.
- `Dockerfile`, `.dockerignore`, `.gitignore`, `requirements*.txt`, and the
  README files.

## What Kiro added

### Done so far

- **Spec** under `.kiro/specs/hound-around-completion/`
  (`requirements.md`, `design.md`, `tasks.md`) — grounded in the contract and
  existing code, with proposed changes kept as open questions.
- **Steering docs** under `.kiro/steering/`:
  - `product.md` (always) — the product, the core loop, scope, and the
    pre-existing-vs-Kiro split.
  - `tech.md` — stack and proof commands.
  - `structure.md` — directory layout and ownership.
  - `hound-rules.md` (always) — the non-negotiable rules as a per-change
    checklist.
  - `ml.md` (fileMatch `ml/**`, also pipeline) — workstream A/B guidance.
  - `frontend.md` (fileMatch `frontend/**`) — workstream E guidance.
  - `api.md` (fileMatch `api/**`, also tests) — contract-enforcement invariants
    and the ML handoff interface.
- **Agent hooks** under `.kiro/hooks/` (see "Hooks" below).
- **This `KIRO.md`.**

### Done in this wave

- The `ml/` package: `embedder.py` (DINOv2-small CLS embedder), `ocr.py`,
  `index.py`, `build_index.py`, `backend.py` (the `create_backend` factory
  matching the handoff), and `eval.py` (splits, metrics, go/no-go, leakage
  guard), all with synthetic-only tests that run under `python -m pytest -q`.
- Frontend finishing: real API wiring, loading/error/empty states, the
  Laplacian blur check, turn icons, the floor-change card, and accessibility.
- Deployment architecture documented (HF Space + private HF dataset repo via
  `HF_TOKEN`, `.dockerignore` extended to carry `ml/`, env vars, the
  rate-limit-behind-proxy fix, corrections-reset-on-restart) in design §6–§7
  and the README. The Dockerfile dependency install, build-time model download,
  real index, HF/Vercel account steps, and curl proofs are human-blocked (they
  need approval of `torch`/`easyocr`/`huggingface_hub` plus network and
  accounts) and are surfaced as asks, not performed.

### Still pending

- **Property-based tests** (the one-correction-flip) are **pending approval of
  the `hypothesis` dependency**. They have NOT run yet and have not caught
  anything; nothing here claims otherwise.

## Hooks (what each automates)

The four hooks are defined as `*.kiro.hook` JSON files under `.kiro/hooks/`.
They capture a trigger, an action/command, and an agent prompt. If the exact
on-disk format needs reconciling with the installed Kiro version, open the
**Hooks panel** in Kiro to finalize/enable them; the intent below is the source
of truth.

| Hook | Trigger | Action |
| --- | --- | --- |
| `tests-on-save` | save of `api/**/*.py`, `ml/**/*.py`, `tests/**/*.py` | run `python -m pytest -q` and summarize failures |
| `contract-guard` | save of `docs/contract.md`, `api/main.py`, `ml/backend.py`, `frontend/src/api.js` | check code produces/consumes the contract's exact fields (names, types, nullability); list mismatches; never edit the contract |
| `privacy-guard-on-stop` | agent stops | run `git status --porcelain`, warn about any private file (data/, images/videos, graph/rooms/labels/anchors/nodes, `*.npz`, `*.sqlite`, `.env`, tokens), never stage them, and confirm `git check-ignore .kiro/` prints nothing |
| `frontend-build` | save of `frontend/src/**` | run `npm run build` in `frontend/` and report errors |

## Spec structure and spec-driven vs vibe coding

The spec in `.kiro/specs/hound-around-completion/` follows Kiro's
**requirements → design → tasks** flow:

- `requirements.md` — the workstreams (A–G) as acceptance-style requirements,
  grounded in `docs/contract.md` and the existing code.
- `design.md` — the technical decisions (DINOv2 CLS vs mean pooling, top-10
  voting and the one-correction-flip, OCR gating, routing wording
  reconciliation, the HF Space + private-data deployment, the rate-limit proxy
  fix, the new-dependency table, and the testing strategy), with every proposed
  change kept in Open Questions until the team approves it.
- `tasks.md` — the ordered, proof-ending tasks (P1–P3) that implement the
  design.

Spec-driven work differed from vibe coding in a way that mattered for a public
repo with a strict contract: because the contract, the privacy rules, and the
dependency budget were written down first, each change had a clear boundary and
a proof command, and nothing drifted into renaming contract fields, committing
private data, or adding unapproved packages. Vibe coding would have been faster
to start but would not have kept those non-negotiables visible on every change.

## Running log

- **Which hooks automated what:** the four hooks (`tests-on-save`,
  `contract-guard`, `privacy-guard-on-stop`, `frontend-build`) are defined under
  `.kiro/hooks/` with the triggers/actions in the table above. `tests-on-save`
  runs `python -m pytest -q` on Python saves, `frontend-build` runs
  `npm run build` on frontend saves, `contract-guard` flags contract-field
  mismatches, and `privacy-guard-on-stop` checks `git status` for private files
  and confirms `.kiro/` is not ignored. They encode the proof commands this
  project requires after every change.
- **Which steering mattered most:** `hound-rules.md` (always included) carried
  the non-negotiable rules as a per-change checklist and was the one that most
  shaped behavior — it kept `.gitignore` and `docs/contract.md` untouched and
  kept private data out. `api.md` (the contract-enforcement invariants and ML
  handoff interface) and `ml.md` mattered most while building the `ml/` package;
  `frontend.md` guided the frontend finishing; `structure.md`/`tech.md` fixed
  the layout and proof commands.
- **What the property tests caught:** nothing yet. The property-based tests
  (the one-correction-flip) are **pending approval of the `hypothesis`
  dependency** and have not run. No claim is made that they caught anything.
- **MCP / Kiro powers used:** none. No MCP servers and no Kiro powers were used
  for this work; it was done with the file, search, shell, and git tooling only.
- **What a person changed by hand** (vs what Kiro generated): the pre-existing
  `api/`, `pipeline/`, first `frontend/`, `docs/`, `tests/`, `Dockerfile`,
  `.dockerignore` base, `.gitignore`, `requirements*.txt`, and README files were
  built earlier with other tools. The human-blocked steps below are left for a
  person: approving and installing the ML dependencies, extending the Dockerfile
  deps and running `docker build`, creating the HF Space + private dataset repo
  + `HF_TOKEN` secret, setting `VITE_API_URL` in Vercel and redeploying, running
  the curl proofs against the deployed Space, and the end-to-end phone demo.

- **Review-driven fix (2026-10-24, APPROVED review follow-up):** the semantic
  review flagged that the OCR floor-override multiplied `confidence` by `0.5`,
  so after an override the shown number no longer equalled `winning_votes / k`
  and `Confirm.jsx`'s `round(confidence * 10)` "N/10 frames agree" meter could
  round to a misleading `0/10`. Fixed in `ml/backend.py:_apply_floor_override`
  by reseating `confidence` to the override winner's honest vote fraction
  (`best_votes / k`), dropping the `× 0.5`. `confidence` is now a true `votes/k`
  on every path, so the Confirm meter stays truthful with no frontend change —
  a low override vote count still trips the top-3 picker, preserving the
  "signals disagree, show the picker" intent. Also removed a dead `heading`
  local in `locate` (`_result` already recomputes it; behavior identical).
  Updated `design.md §4` to document the reseated confidence and pinned the
  override path's confidence in `test_ocr_floor_override_picks_best_on_that_floor`
  (`confidence == best_votes/k`). `docs/contract.md` left untouched (it remains
  law); the normal-path invariant `confidence == winning_votes/k` is still
  covered by `test_confidence_math`. Proof: `.venv/bin/python -m pytest -q` →
  `49 passed`.
