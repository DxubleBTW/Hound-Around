# Hound Around — Design

Status: draft for team review. Follows `requirements.md`. Grounded in `docs/contract.md`
(law), `api/main.py`, `api/routing.py`, `api/recognition.py`, `api/README.md`, the role
docs, and `docs/dataset.md`. No contract fields are renamed; proposed additions stay in
Open Questions until approved.

## 1. Overview and module layout

New `ml/` package (the only new runtime code area), imported by the backend through the
existing handoff in `api/recognition.py`:

```
ml/
  embedder.py      # DINOv2-small wrapper: image -> 384-d L2-normalized vector
  ocr.py           # EasyOCR wrapper: room number + floor numeral, gated
  index.py         # in-memory vector index: load/save index.npz, add, snapshot/restore
  build_index.py   # labels.csv (keep) -> data/index.npz   (CLI: python -m ml.build_index)
  backend.py       # create_backend(data_dir) factory: the locate()/correction interface
  eval.py          # splits, metrics, experiments  (CLI: python -m ml.eval)
```

The API sets `HOUND_ML_FACTORY=ml.backend:create_backend`. The factory is called once at
startup with `data_dir` and returns the object the API serializes
(`model_name`, `size`, `locate`, `prepare_correction`, `apply_correction`, `snapshot`,
`restore`). `StubBackend` in `api/recognition.py` is the reference shape; `ml.backend`
must match it field-for-field, including the internal `vector` key.

## 2. Embedding: DINOv2-small, CLS token vs mean pooling

**Decision: use the DINOv2-small CLS token** as the 384-d global descriptor,
L2-normalized.

Rationale:

- The CLS token is DINOv2's purpose-built global image descriptor and is the standard
  representation for image-level retrieval. It is directly comparable with cosine
  similarity, which is exactly the top-10 voting scheme in `docs/roles/ml.md`.
- Mean pooling over patch tokens can be more robust to partial occlusion (e.g. a person in
  frame), but our pipeline already blurs/masks people and `docs/dataset.md` notes distant
  figures are not identifiable. The bigger risk for us is **look-alike floors** (F1/F2
  share finishes near the elevators), where a single stable global descriptor plus the OCR
  floor backup serves better than diluting the descriptor by averaging patches.
- CLS is cheaper (no pooling pass over all patch tokens) which helps the **< 1 s CPU**
  budget (requirement A.5).

Both representations are 384-d, so `eval.py` can run a mean-pooling variant as an ablation
if CLS underperforms on the val split, without changing any downstream shape. Default and
shipped path is CLS.

## 3. Voting, confidence, and the one-correction-flip strategy

`locate(image)` (requirement A.3–A.4):

1. Embed → 384-d L2-normalized vector `q`.
2. Cosine similarity against every row in the index (vectors are already normalized, so
   this is a dot product), take the **top-10** neighbors.
3. Vote by label; winner is the top-voted spot; `confidence = winning_votes / 10`;
   `top3` is the three highest-voted `{spot, votes}`.
4. `heading` is chosen so it is a graph neighbor of `spot` (the API rejects a heading that
   is not a neighbor — `api/main.py`), floor comes from the winning node.
5. OCR is gated (section 4) and can override the floor.

**One correction must flip the very next near-identical query (requirement F.3).**
`POST /correct` stores the *query vector* under `true_spot` with `source="correction"`
(`docs/contract.md` index schema; `api/main.py` passes the cached normalized vector to
`prepare_correction`). To guarantee the flip:

- Design: on a correction, append the corrected vector AND **weight correction votes
  higher in the top-k vote** (a correction vote counts as, e.g., 3 video votes), so a
  single corrected exemplar can outvote the stale video cluster for a near-identical query.
- Why this is enough: the next query is near-identical to the corrected photo, so the
  corrected vector is (near) rank-1 by cosine similarity. With weighted votes, even one
  corrected neighbor in the top-10 carries enough weight that `true_spot` becomes the
  winner. Ties break toward the correction.
- This must be **proven by a synthetic test** (no real data): build a tiny synthetic index,
  issue a query that currently votes to the wrong label, apply one correction with that
  query's vector, then re-issue a near-identical query and assert the winner is now
  `true_spot` and `confidence` reflects the corrected votes. With `hypothesis` (Open
  Question 2) this is a property over random synthetic vectors.
- Correction weighting lives entirely inside `ml/`; the API already applies corrections to
  the in-memory index instantly and offers one-level rollback, so no contract or API
  change is needed.

## 4. OCR gating and floor-override logic

EasyOCR reads 3-digit room numbers and floor numerals. It is the backup that covers the
F1/F2 look-alike problem (`docs/dataset.md`, `docs/roles/ml.md`). To protect the **< 1 s
CPU** budget:

- **Gate (requirement A.5, Open Question 5):** run OCR only when the vote is uncertain —
  `confidence < 0.8` OR the top 3 span more than one floor. On the common confident path,
  OCR is skipped so `locate` stays fast.
- **Floor override:** when OCR reads a floor and it disagrees with the winning vote, prefer
  the OCR floor (`docs/roles/ml.md` step 5). Then pick the **best-voted spot on that floor**
  from the neighbors. The returned `confidence` is reseated to that override winner's own
  honest vote fraction (`best_votes / 10`), so `confidence` stays a true `votes / 10`
  value on every path (`docs/contract.md`'s "confidence = winning votes / 10" rule holds,
  and `Confirm.jsx`'s `round(confidence * 10)` "N/10 frames agree" meter stays truthful).
  A floor conflict already means the override winner's vote count is low, so the resulting
  confidence is low enough to trip the top-3 picker — the "signals disagree, show the
  picker" intent is preserved without inventing a non-`votes/k` number. Interpretation:
  `2xx → F2`, `Bxx → B1`, otherwise `F1`.
- `ocr_room`/`ocr_floor` are `null` when nothing is read (`docs/contract.md`). The override
  must still return a `spot` whose node floor equals the returned `floor`, because
  `api/main.py` rejects any result where `nodes[spot].floor != floor`.

## 5. Routing instruction wording (reconciliation)

`api/routing.py` is authoritative for instruction text. For vertical (floor-change) edges
it emits exactly:

- `Take the stairs to {level}, toward {toward}`
- `Take the elevator to {level}, toward {toward}`

where `{level}` is `LL` for floor -1 else the floor number, `{mode}` is `stairs` when the
edge has `stairs: true` else `elevator`, and `{toward}` is the target node's label plus its
landmark in parentheses when present. Horizontal edges emit one of `Walk`, `Continue`,
`Turn left and walk`, `Turn right and walk`, `Turn around and walk`, each as
`"{direction} toward {toward}"`.

**Frontend reconciliation:** the mock data in `frontend/src/api.js` uses different vertical
wording ("Take a podium elevator down to 1", "Take the stairs down one floor"). That is
mock-only text. The **real** Route screen must render whatever the backend returns verbatim
(`frontend/src/screens/Route.jsx` already prints `step.instruction` as-is), so no frontend
change is required for wording; the mock strings should be updated to match the two
real forms above so demos without the backend look correct. Do not re-derive or rewrite
instruction prose on the client.

Router behavior to rely on (do not re-implement on the client): weight is `cost` if present
else `meters`; `accessible=true` drops `stairs` edges; `verify: true` edges are excluded;
edges are bidirectional unless `one_way: true`; `est_seconds = ceil(total_meters / speed)`
with speed 1.2 m/s (0.9 accessible); straight `Continue` segments are grouped into one
human turn.

## 6. Deployment architecture (HF Space + private data)

```
Public GitHub repo (code, Dockerfile, /.kiro)         Private HF dataset repo
        │ build                                         graph.json, rooms.json, index.npz
        ▼                                                        │ HF_TOKEN (Space secret)
Public HF Space (FastAPI, api.main:app, port 7860) ──────────────┘ download at startup
        ▲ CORS                                          build time: download DINOv2-small
        │                                                + EasyOCR model weights into image
Vercel frontend (VITE_API_URL -> Space URL)
```

Decisions (Open Question 3):

- **Space code is public; private data is not.** At startup the Space downloads
  `graph.json`/`rooms.json`/`index.npz` from a **private HF dataset repo** using an
  `HF_TOKEN` **Space secret** (`huggingface_hub`), writing them into `HOUND_DATA_DIR`
  (`/app/data`). `api/main.py` already loads `graph.json`/`rooms.json` from `HOUND_DATA_DIR`
  at startup; the `index.npz` load lives in `ml/backend`. No private file enters the public
  repo or the public Space git (`docs/roles/README.md`, `api/README.md`).
- **Model download at build time, not per request.** The `facebook/dinov2-small` weights
  and EasyOCR detection/recognition models are downloaded during the Docker build so cold
  start does not pull them, and the model loads once at startup (`docs/roles/backend.md`,
  `docs/roles/ml.md`).
- **`.dockerignore` extension.** Today `.dockerignore` allows only `requirements.txt` and
  `api/`. Add the `ml/` package so it enters the build context:
  ```
  !ml/
  !ml/*.py
  ```
  Still **no data, images, or weights** in the build context (they are downloaded at build
  or startup). Never add `data/` or `.npz`.
- **Env vars for the Space:**
  - `HOUND_ML_FACTORY=ml.backend:create_backend`
  - `HOUND_DATA_DIR=/app/data` (already set in the Dockerfile)
  - `HOUND_CORS_ORIGINS=https://www.hound-around.tech,https://hound-around.tech,https://hound-around-theta.vercel.app,http://localhost:5173`
  - `HF_TOKEN` (secret) and the private dataset repo id
  - Proxy/rate-limit setting from section 7.
- Keep **one Uvicorn worker** (`api/README.md`): corrections live in one in-memory index;
  multiple workers would have independent caches and indexes.

## 7. Rate limit behind the HF proxy (fix)

Problem (Open Question 4): `api/main.py` rate-limits **30 POST/min per `request.client.host`**.
Behind the HF proxy, `request.client.host` is the proxy IP, so **all judges share one
bucket** and 429 each other.

Decision — do both:

1. **Trust the proxy deliberately.** Run Uvicorn with `--proxy-headers` and a trusted-hosts
   allowlist so the framework resolves the real client IP from the forwarded header for the
   known HF proxy only. `api/README.md` is explicit: configure trusted-proxy handling in
   Uvicorn deliberately; do **not** trust arbitrary forwarded IP headers. This restores
   per-client buckets without opening header spoofing.
2. **Raise the demo limit** for the presentation window as a safety net if the proxy
   allowlist cannot be pinned in time, via the allowed-origins/limit configuration path,
   reverting after the demo.

The limiter logic in `api/main.py` does not change; only how the peer IP is derived and the
configured limit change. Upload/size/type limits stay as-is.

## 8. New-dependency table

| Package | Rough size | Where used | Category |
| --- | --- | --- | --- |
| `torch` (CPU wheels) | ~200 MB | DINOv2 inference in `ml/embedder.py` | video (runtime) |
| `transformers` + `facebook/dinov2-small` | ~85 MB weights | the embedder in `ml/embedder.py` | video (runtime) |
| `easyocr` + models | ~90 MB lib + ~100 MB models | room/floor OCR in `ml/ocr.py` | video (runtime) |
| `CLIP ViT-B/32` | ~350 MB | baseline comparison in `ml/eval.py` only | experiments only |
| `huggingface_hub` | small | download private data at Space startup | video (runtime) |
| `hypothesis` | small | one-correction-flip property test | dev only |

All require team approval before install (`CLAUDE.md`). Runtime packages go in
`requirements.txt`; `hypothesis` goes in `requirements-dev.txt`; CLIP is installed only in
the experiments environment and never shipped to the Space.

## 9. Testing strategy

- Backend suite `tests/test_backend.py` stays green with its synthetic graph and generated
  solid-color images (`python -m pytest -q`).
- `ml/` unit tests are synthetic-only (tiny random index, generated images) and must run
  without private data or a GPU. They cover: `index.npz` round-trip shape/dtype, voting +
  confidence math, snapshot/restore no-aliasing, OCR gating branch selection (mocked OCR),
  and the one-correction-flip property.
- `eval.py` is structured so its metric functions are unit-testable on synthetic inputs;
  real numbers are produced only with private data (human-blocked).
