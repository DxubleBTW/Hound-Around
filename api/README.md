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
  top3, ocr_room and ocr_floor plus an **internal** `vector` (384 finite,
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

Corrections update the **in-memory** index immediately and log to SQLite.
They do not overwrite index.npz. Restarting reloads ML's base index, so the
SQLite log alone cannot replay learned vectors. Use one Uvicorn worker:
multiple workers would have independent caches and indexes.

A local operator embedding the app in a trusted Python process may call
`app.state.rollback_last_correction()` to restore the preceding index,
remove that correction's log row, invalidate outstanding cached vectors,
and increment the in-memory version. `app.state.index_version()` reads the
version. Only the latest correction can be rolled back. This adds no public
endpoint and provides no remote admin UI. Versions and rollback snapshots
last for this process only. Rollback removes its log entry; this is a demo
log, not an immutable audit trail.

## Smoke checks

```sh
curl -i http://127.0.0.1:8000/health
curl -F image=@/private/path/query.jpg http://127.0.0.1:8000/locate
curl --get --data-urlencode 'from=F1_entry_west' --data-urlencode 'to=164' --data-urlencode 'accessible=true' http://127.0.0.1:8000/route
curl -H 'Content-Type: application/json' -d '{"photo_id":"COPY_FROM_LOCATE","true_spot":"VERIFIED_NODE_ID"}' http://127.0.0.1:8000/correct
```

These route identifiers must exist in the real private graph. Before judging,
check west entrance → 164 and B1 → 262 in accessible mode against the real
walk sheets. Rehearse photo → route → correction → new photo on the deployed
backend and on cellular. Warm `/health` five minutes before presenting.

## Container and Space handoff

The root Dockerfile builds the backend scaffold on Python 3.11, port 7860,
as a non-root user. No data, model, or images enter its build context.
Configure a **private** Space or mount private graph/room/index files through
your approved private storage mechanism. Do not upload them to a public Space
repository. Mount data writable for SQLite and set HOUND_DATA_DIR accordingly.
A public app API does not require making its private source data public.

The ML module, its dependencies, and its build-time model download must be
added to the image once ML supplies its handoff. This scaffold intentionally
starts with 503 readiness until it has those inputs. Cold start, actual model
latency, Space hosting and Wi-Fi/cellular/hotspot/Slow 3G remain unverified.
No deployment or publication has been performed.
