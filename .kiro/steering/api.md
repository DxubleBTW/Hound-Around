---
inclusion: fileMatch
fileMatchPattern: 'api/**'
---

# API guidance (contract enforcement + ML handoff)

Applies when working in `api/**` and `tests/**`. Grounded in `docs/contract.md`
(law), `api/main.py`, `api/recognition.py`, `api/routing.py`, and
`api/README.md`. `docs/contract.md` is law: never rename a field, change a type
or nullability, or add an endpoint/field without explicit team approval (put
proposals as open questions in the requirements). Keep changes surgical — do not
refactor working `api/` code unless the task needs it.

## Contract surface (do not drift)

```
POST /locate (multipart: image)
 → photo_id, spot, floor (-1|1|2), heading (str|null), confidence (0..1),
   top3 (1..3 of {spot, votes}), ocr_room (str|null), ocr_floor (-1|1|2|null), ms
GET  /route?from=&to=&accessible=&heading=
 → steps:[{instruction, meters, node}], total_meters, est_seconds
POST /correct {photo_id, true_spot} → {ok, index_size}
GET  /health → {ok, index_size, model}
```

- `confidence = winning votes / 10`. Below ~0.6, or when the top 3 span floors,
  the app shows the top-3 picker.
- `ocr_room` / `ocr_floor` are `null` when nothing is read.
- `to` accepts a node id or a room number resolved via `rooms.json`.

## Contract-enforcement invariants in `api/main.py`

The API validates the ML result before returning it (treat these as invariants
the ML handoff must satisfy):

- The internal **`vector`** is popped from the response, **L2-normalized**, and
  validated: shape `(384,)`, all finite, nonzero.
- `spot` and every `top3` node **exist in the graph**.
- The returned **`floor` equals `nodes[spot].floor`**.
- `heading`, when present, is a **graph neighbor** of `spot`.
- Photos stay in RAM only; the image is closed immediately. Only a normalized
  vector + prediction metadata are cached, ≤ 512 outstanding, expiring after
  600 s. Corrections are single use.
- Rate limit: POSTs capped at 30/min per direct peer (`/correct` included).
  Upload limits: JPEG/PNG/WebP, 2 MiB, 20-million-pixel cap.
- One Uvicorn worker only (single in-memory index/cache).

## ML handoff interface (`api/recognition.py`)

`HOUND_ML_FACTORY=module:create_backend` is called once at startup with
`data_dir`. The returned object must provide `model_name`, `size`,
`locate(image)->dict(+internal vector)`, `prepare_correction(vector, label)`,
`apply_correction(prepared)`, `snapshot()`, `restore(snapshot)`. `StubBackend`
is the reference shape; a real backend must match it field-for-field. The API
serializes all of these operations and the ML side must not retain the image.

With no ML configured, `/locate`, `/correct`, and `/health` return **503**;
routing still works from the supplied graph. `HOUND_STUB_SPOT` returns a fixed
node at confidence 0 (`model: stub-not-recognition`) and is never an accuracy
claim. Do not set both the stub and the ML factory.

## Routing (`api/routing.py`) — rely on, do not re-implement

- networkx `DiGraph`; weight is `cost` if present else `meters`.
- `verify: true` edges are excluded; edges are bidirectional unless
  `one_way: true`; `accessible=true` drops `stairs` edges.
- Inaccessible destinations return **404** rather than suggesting stairs.
- `est_seconds = ceil(total_meters / speed)`, speed 1.2 m/s (0.9 accessible).
- Straight `Continue` segments are grouped into one turn.
- Instruction prefixes actually emitted (authoritative — the frontend keys icons
  off these): `Walk`, `Continue`, `Turn left and walk`, `Turn right and walk`,
  `Turn around and walk`, `Take the stairs to {level}, toward {…}`,
  `Take the elevator to {level}, toward {…}` (`{level}` is `LL` for floor -1).

## Tests

- `tests/test_backend.py` uses a **synthetic graph** and **generated solid-color
  images** via `FakeML(StubBackend)`. Keep tests synthetic-only. Proof:
  `python -m pytest -q`.
