# Hound Around

**Never lost around here.** Snap a photo of where you're standing in BU's Center for Computing & Data Sciences. Hound Around recognizes the hallway and floor, then routes you to your room. Wrong? Tap the right spot and it learns.

DS+X / Hackachusetts project, built at BU Spark! DS+X 2026 (College Hack track).

## Status

- Data pipeline: working (`pipeline/`). Video → labeled, face-blurred frames.
- Dataset: 1,696 labeled frames across 33 spots on B1 and floor 1. Floor 2 is being filmed. See `docs/dataset.md`.
- Matching, routing, API and app: in progress.

## Repo layout

| Path | What |
| --- | --- |
| `docs/contract.md` | Data formats and API everyone builds against |
| `docs/dataset.md` | Dataset card: collection, counts, biases, splits |
| `pipeline/` | Video → frames → labels → face blur ([how to run](pipeline/README.md)) |
| `CLAUDE.md` | Project rules for coding agents |

## Data and privacy

- No building photos, videos or floor plans are published in this repo.
- Faces are blurred before any frame is used. User photos are deleted right after matching.
- No GPS, no network location, no tracking.
- Floor-plan source for the routing graph: Data Sciences Center Draft Project Impact Report (KPMB Architects, 2019). Used only to build the graph, never displayed.
