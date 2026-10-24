# Navigation features and setup

Implemented on the feature branch; production activation still requires reviewed
configuration and deployment. No new public endpoints are added. Existing success
payloads remain unchanged. The optional `GET /directory` idea is deferred; the
current implementation uses explicitly public frontend metadata instead.

## Unrelated-photo rejection and retake

The ML backend can reject a query when its nearest cosine similarity is below a
configured cutoff. Vote confidence is not used for this decision: ten poor matches
can all vote for the same location. The guard runs before OCR/location selection.
A rejected request returns HTTP 422 with a known `unrecognized_location` error code;
no location, cached query, or correction-capable photo ID is issued.

The app offers **Retake photo**, which discards the old photo and returns to capture
rather than resending it. **Choose my starting location** also remains available.
Manual routing does not teach the image model.

**Activation is data-dependent.** There is no invented default cutoff. Without
`recognition.json` or `HOUND_MIN_SIMILARITY`, the current matching behavior remains
and startup logs that the rejection guard is not configured. Do not present it as
active or reliable until a cutoff has been calibrated and the backend redeployed.
Similarity alone cannot guarantee detection of every unrelated image.

Collect separate, face-blurred **validation** photos in:

- `data/rejection_validation/known/`: varied real views inside the mapped building.
- `data/rejection_validation/unrelated/`: varied views that are not mapped locations.

Do not use training frames or the final outsider test set. With the approved model
dependencies installed, run from the repository root:

```sh
python -m ml.rejection_scores --validation-root data/rejection_validation --index data/index.npz --output data/rejection-validation.csv
python -m ml.calibrate_rejection --scores data/rejection-validation.csv --index data/index.npz --output data/recognition.json
```

The default calibration targets are at most 5% unrelated acceptance and at least
90% known-building acceptance **on those validation samples**. They are configurable
CLI targets, not promised test performance. Inseparable scores fail calibration
instead of producing a misleading setting. Evaluate the chosen cutoff on a separate
held-out set before deploying it.

The configuration is bound to the exact index bytes and model name. Rebuild/recalibrate
when the index changes. Ship `recognition.json` through the private dataset alongside
`index.npz`; startup fetch supports it as an optional file. A mismatched configuration
makes the recognition backend unavailable rather than silently applying the wrong cutoff.
An operator can alternatively set a validated scalar with `HOUND_MIN_SIMILARITY`.
No private images, scores, index, or rejection configuration belong in Git.

## Manual start and destination autocomplete

Users can enter the room number beside them at capture, after an unrecognized photo,
or when none of the suggested spots fits. The existing router already resolves room
aliases for the start and destination. Unknown room labels receive the normal routing
error/recovery UI. Inferred room mappings still require verification on site.

The capture field offers native, keyboard-accessible destination suggestions and
quick choices. The public catalog is `frontend/src/lib/campuses.js`; it contains only
the two destinations already shown by the app. Add additional verified public names
and aliases there after review. Never copy the private room/graph files into it.
Approved starting landmarks can be added to a building's `landmarks` list as
`{spot, label, floor}` records whose IDs exist in that building's private graph.

## School and building selection

**Change school** opens a row of original pixel mascots and an illustrative campus
scene. Tap a school or drag its mascot onto the scene, then choose an available
building. Native drag/drop works where the browser supports it; tapping and keyboard
buttons provide the alternative on phones. No real interior map is displayed.

Only BU/CDS is configured. Adding another school requires a reviewed catalog entry
and a separate backend/private mapping package. Set its public `VITE_*` API variable
in the frontend build environment; it must not contain a secret. Unconfigured or
disabled buildings are unavailable. Existing BU/CDS mock mode remains explicitly labeled.

Each building owns an immutable API client. Opening the school picker cancels the
current navigation session; selecting a building starts with fresh photo, prediction,
route, destination, and correction state. Requests never change a shared global URL.
Backend data and correction storage must also be separate for each building.

## Correction persistence and rollback

Set `HOUND_STATE_DIR` to writable persistent storage, for example a mounted private
volume, and set a stable, unique `HOUND_DATASET_ID` for each school's building package.
Without `HOUND_STATE_DIR`, SQLite stays under `HOUND_DATA_DIR` as before. An ephemeral
Space filesystem still loses state when it is replaced; this code does not provision
or purchase persistent hosting storage.

Only normalized correction vectors and metadata are stored, never query photos.
The existing audit table is preserved; `correction_vectors` and `index_versions` are
added. A fresh process replays compatible corrections and restores their version.
The original base index file is not overwritten. Old audit rows without vectors
remain historical records and cannot be replayed.

A change to the model, dataset identity, base index bytes, or graph bytes starts a
new context. Older records remain in the database for review but are not applied to
a different package. Invalid stored vectors fail startup rather than silently learning
bad data. Keep one worker so its cache and live index remain consistent.

The trusted local `app.state.rollback_last_correction()` hook restores the preceding
index and removes the last correction/vector transactionally. It also works after a
restart by reconstructing the last compatible snapshot. It adds no public admin endpoint.

## Automated checks and deployment verification

`.github/workflows/checks.yml` runs Python 3.11 tests, Node 22 tests/build, and a
known-private-artifact check on PRs and main. Actions are pinned to official release
commits. `requirements-dev.txt` installs the lightweight API/test dependencies;
`requirements.txt` still installs the full model runtime for the Docker Space.

The GitHub owner must enable Actions as needed and require these checks in main's
branch protection. Workflow code alone does not configure repository protections.

For optional read-only deployment checks, configure repository variables:

- `HOUND_SMOKE_API_URL`: deployed backend base URL.
- `HOUND_SMOKE_ORIGIN`: exact frontend origin for CORS checking.
- `HOUND_SMOKE_FROM` and `HOUND_SMOKE_TO`: a verified start and room for an accessible route.

Smoke checks run on manual workflow dispatch and successful GitHub deployment-status
events when the URL variable is present. A separately deployed HF Space must trigger
the workflow or run the command explicitly after deployment:

```sh
python scripts/smoke_backend.py --url BACKEND_URL --origin FRONTEND_ORIGIN --from-node VERIFIED_START --to-room VERIFIED_ROOM
```

This only reads health/routes. It never uploads a photo, writes a correction, or
proves recognition accuracy. Actual model improvements, unfamiliar-photo detection
rates, and multi-school coverage still require real data and on-site verification.
