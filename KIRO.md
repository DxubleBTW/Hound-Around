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

### Planned (later tasks)

- The `ml/` package: `embedder.py`, `ocr.py`, `index.py`, `build_index.py`,
  `backend.py`, `eval.py`, with synthetic-only tests.
- Eval structure (metrics, experiments table, learning curve).
- Frontend finishing (real API wiring, loading/error/empty states, Laplacian
  blur check, turn icons, floor-change card, accessibility).
- Property-based tests (e.g. the one-correction-flip).
- Deployment notes (HF Space + private data) and submission docs.

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

## Running log — fill in as work proceeds

- **Which hooks automated what:** _TBD — note real runs, e.g. a pytest failure
  caught on save or a contract mismatch flagged._
- **Which steering mattered most:** _TBD._
- **What the property tests caught:** _TBD (e.g. the one-correction-flip)._
- **MCP / Kiro powers used:** _TBD._
- **What a person changed by hand** (vs what Kiro generated): _TBD — record
  human edits here to keep the account honest._
