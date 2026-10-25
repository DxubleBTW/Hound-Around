# Backend

Implements the four endpoints in `docs/contract.md`. Read
`docs/roles/backend.md` for ownership and the remaining live-demo checks.

## Run

Use Python 3.11. From the repository root:

```sh
python -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
.venv/bin/python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

On Windows use `.venv\Scripts\python.exe` for the interpreter commands.
Only the backend's planned packages are in requirements.txt. ML owns its
model dependencies; install those separately when integrating its module.

Supply private `data/graph.json` and `data/rooms.json` in the agreed formats.
`HOUND_DATA_DIR` can point to a different directory. Do not commit these files.
No real graph or room mappings are supplied: the walk sheets and verified
signs must come from the team. Tests use an explicitly synthetic graph and
three generated image colors, never building photographs.

The graph is limited to floors -1, 1 and 2. Unverified (`verify: true`) edges
are excluded. Edges are bidirectional by default; `one_way: true` keeps only
the declared direction. Path selection uses `cost` where supplied, otherwise
meters. Responses always report actual meters; time is walking distance at
1.2 m/s (0.9 accessible), so elevator waiting is not included. Coordinates
must use the same orientation on all sheets, with y increasing downward.
Straight segments are grouped into turns. Inaccessible destinations return
404 rather than suggesting stairs in accessible mode.

## ML handoff

Set `HOUND_ML_FACTORY=your_module:create_backend`. The named factory receives
`data_dir` as a pathlib.Path and is invoked once at startup. Agree on the
actual module path with ML; no module is assumed to exist yet.

Its returned object provides:

- `model_name: str` and `size: int` properties.
- `locate(image) -> dict`: the contract's spot, floor, heading, confidence,
  top3, ocr_room and ocr_floor plus an **internal** `vector` (`model.dim` finite,
  nonzero floats). The API strips vector and diagnostics from the response.
  ML owns embedding, voting, OCR conflict resolution, confidence, and heading.
- `prepare_correction(vector, label)`: allocate a replacement index, tagging
  the new vector's source as `correction`, without mutating the live index.
- `apply_correction(prepared)`: swap to the prepared index.
- `snapshot()` and `restore(snapshot)`: preserve/restore independent index
  state for failed writes and one-level rollback. Restore must be reliable
  and snapshots must not alias arrays that later mutate.

The API serializes these operations. It passes an EXIF-free RGB image with
both dimensions at most 512 px and closes it immediately afterward. ML must
not retain the image. The API caches only a normalized vector and prediction
metadata, for at most 512 outstanding photos. Vectors expire after 600 seconds
and are removed on the next cache operation. Corrections are single use.

For frontend integration before ML arrives, explicitly set
`HOUND_STUB_SPOT` to a node ID in your private graph. This returns that fixed
node at confidence zero, with model `stub-not-recognition` in `/health`.
It does **not** recognize images. Never use it for accuracy or judging.
Do not set both the stub and ML factory. With no ML configured, recognition
and health return 503; routing can still work from the supplied graph.

## Configuration and corrections

Set `HOUND_CORS_ORIGINS=https://your-app.vercel.app` for hosting. A comma-separated
explicit list is supported; the local default is http://localhost:5173.
Wildcards are rejected. POSTs are capped at 30 per minute per direct peer;
`/correct` is included. Behind a proxy, configure trusted proxy handling in
Uvicorn deliberately; do not trust arbitrary forwarded IP headers. Shared
proxy addresses can otherwise share a rate-limit bucket.

JPEG, PNG, and WebP are decoded and checked, with a 2 MiB file limit and
20-million-pixel limit. Multipart bodies are bounded before parsing, and the
parser's spool threshold is above the entire body cap. Photos remain in RAM.
Only normalized vectors are cached. SQLite stores the contract correction
log at `HOUND_DATA_DIR/corrections.sqlite`.

Corrections update the live index immediately and persist normalized vectors,
metadata, and versions in SQLite. On restart, compatible corrections replay onto
the original base index; index.npz is not overwritten. Set `HOUND_STATE_DIR` to a
private persistent volume and a unique `HOUND_DATASET_ID` per building. Ephemeral
hosting storage still disappears when replaced. Use one Uvicorn worker because
multiple workers would have independent caches and live indexes.

A local operator embedding the app in a trusted Python process may call
`app.state.rollback_last_correction()` to restore the preceding index,
remove that correction's log row, invalidate outstanding cached vectors,
and increment the persisted version. `app.state.index_version()` reads the
version. The latest compatible correction can be rolled back, including after
restart; its snapshot is reconstructed during replay. This adds no public
endpoint and provides no remote admin UI. Rollback removes the corresponding
vector and log entry; this is not an immutable audit trail. Old audit rows that
have no vector cannot be replayed. A different model/base index/graph gets its
own correction context rather than inheriting another dataset's labels.

See [navigation feature setup](../docs/navigation-features-proposal.md) for
similarity-based rejection, calibration, public campus metadata, persistent
state migration, and deployment checks. The optional rejection cutoff must be
validated and configured before unrelated-photo rejection is active. It returns
the documented 422 error code and never issues a photo ID for rejected inputs.

## Smoke checks

```sh
curl -i http://127.0.0.1:8000/health
curl -F image=@/private/path/query.jpg http://127.0.0.1:8000/locate
curl --get --data-urlencode 'from=F1_entry_west' --data-urlencode 'to=164' --data-urlencode 'accessible=true' http://127.0.0.1:8000/route
curl -H 'Content-Type: application/json' -d '{"photo_id":"COPY_FROM_LOCATE","true_spot":"VERIFIED_NODE_ID"}' http://127.0.0.1:8000/correct
```

These route identifiers must exist in the real private graph. Before judging,
check west entrance → 164 and B1 → 262 in accessible mode against the real
walk sheets. Rehearse corrections against an isolated/staging index. Use read-only
health/routing and appropriately prepared locate photos on production; never call
`/correct` on live merely to test the UI.

## Container and Space handoff

The Dockerfile builds the real backend on Python 3.11, port 7860, as a non-root
user. It downloads the configured descriptor and OCR weights at build time.
Select MegaLoc with `--build-arg EMBEDDER=megaloc`; the index descriptor identity,
projection and width must match. Private runtime data is fetched from a private
HF dataset, never embedded in the public code repository or image build context.

See [recognition reliability and rollout](../docs/recognition-reliability.md) for
fingerprinted confidence, atomic pinned-package activation, strict manifest mode,
correction receipts, persistent state and anonymous timing aggregates. Missing
confidence calibration uses the picker; incompatible calibration/package data
makes recognition unavailable. One active recognition request is admitted before
upload buffering; excess requests receive 503 with `Retry-After: 1`.

Coordinate backend deployment with the data lead. Record and roll back code and
the private dataset together. This PR has not deployed a backend or calibrated
private photos; real CPU, load, phone and held-out accuracy checks remain required.
