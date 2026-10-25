# Recognition reliability and rollout

This change preserves endpoint names and response fields. It fixes inconsistent
OCR evidence, makes correction retries durable, bounds recognition work, and adds
versioned calibration, compatible runtime packages, and anonymous measurements.
Synthetic software checks do not establish recognition accuracy or latency on the
production CPU. Backend deployment still requires coordination with the data lead.

## Recognition decisions

When OCR identifies a supported floor with indexed candidates, both photos vote
within that floor. Confidence features and heading use the same final retrieval
rows. A second photo always returns a picker; it cannot silently undo the current
room sign by adding unfiltered votes. Unavailable OCR floors are ignored.

Automatic starts require private `confidence.json`. It binds coefficients and tier
thresholds to the model/preprocessing name, decision version, and exact base index,
graph and rooms bytes. Missing calibration returns `p_correct: null, tier: picker`;
incompatible calibration makes recognition unavailable. The historical coefficients
remain an explicitly named research baseline, never a production fallback.

The existing leave-one-video-out research tool `ml.research.calibrate` is preserved.
The new `ml.research.calibrate_confidence` command fits/evaluates deployable bound
artifacts on separate photo manifests. MegaLoc's pinned descriptor and optional
PCA remain supported; calibration context uses the final projected model identity
and the exact index bytes containing its projection.

The target is **within 10 walking meters on the correct floor**, not exact-spot
probability. Changed decision logic invalidates previous measurements. Live
corrections can change the feature distribution; evaluate correction effects on
separate photos before claiming calibrated performance for a corrected index.

## Fit and evaluate confidence privately

Use the existing full ML environment. No new dependency is introduced. Freeze the
reviewed base `index.npz`, `graph.json`, and `rooms.json` under ignored `data/`.
Prepare separate manifests with columns `file,spot,session,split`, relative image
paths, reviewed ground-truth node IDs, and photographer/session groups:

```text
file,spot,session,split
photos/example.jpg,<real node from the private graph>,photographer-a-session-1,validation
```

Validation must contain correct and incorrect predictions and at least two session
groups. Never use training frames or final outsider `TEST_` photos for fitting.
Keep near duplicates in the same split. Session names must identify the actual
photographer/collection groups consistently across manifests. At least two groups
is an input check, not evidence that a small sample is sufficient.

```sh
python -m ml.research.calibrate_confidence --manifest data/confidence-validation.csv --data-dir data --output data/confidence.json
python -m ml.research.calibrate_confidence --manifest data/confidence-holdout.csv --data-dir data --evaluate data/confidence.json --output data/confidence-holdout-report.json
```

The tool runs the production decision path with real embeddings/OCR and extracts
its five final features. During this offline measurement only, runtime rejection
and prior confidence files are bypassed; they cannot censor difficult samples or
prevent refitting an obsolete calibration. Known-building manifests are required;
unrelated-photo rejection remains a separate calibration/evaluation task.

Fit uses deterministic L2-regularized logistic regression. Tier thresholds remain
0.5/0.7; fitting does not optimize them on holdout. Evaluation refuses training
session overlap and exact duplicate photo content. It reports counts, exact-spot,
floor, within-10m accuracy, Brier score and wrong automatic-start rates. It cannot
detect mislabeled session groups or all visually near-duplicate leakage. Inspect
held-out errors and agree on release criteria before enabling automatic starts.
Reusing holdout to revise the model requires a new final holdout set.

## Concurrency and correction retries

One `/locate` request is admitted per process, with no waiting inference queue.
Admission occurs before upload buffering. Excess recognition requests receive
503 and `Retry-After: 1`. Inference and index mutation share a model lock; health
uses a separate short state lock and cached size, and routing remains independent.
Keep one Uvicorn worker. Increasing workers would split corrections across indexes.

An identical successful correction retry returns its original receipt without
inserting another vector, including after restart. Retrying the same photo with a
different label returns 409. Receipts share the SQLite transaction, context and
rollback lifecycle of the correction. Legacy stored corrections without receipts
return the current index size. Unknown/expired photos still return 410. Persistent
storage is still required across Space replacement. Room/decision changes now
isolate old correction contexts for review rather than replaying them silently.

## Package and rollback

Freeze code and data before creating a manifest:

```sh
python -m scripts.package_runtime --data-dir data
```

This produces private `data/runtime-manifest.json`, containing runtime code and
required/optional artifact fingerprints. The Docker image includes its Dockerfile
and logging configuration for the same source fingerprint calculation. Preserve
LF source endings (use the established Git archive export). Keep all manifests,
calibration files, reports and index contents out of public Git/Space code.

Upload the manifest with the exact artifacts to the private dataset. Record the
code commit, dataset revision, manifest and prior package for rollback. Set
`HOUND_DATA_REVISION` to the reviewed private dataset commit and
`HOUND_REQUIRE_MANIFEST=1` after the first compatible package is available. Set a
unique stable `HOUND_DATASET_ID` and a private persistent `HOUND_STATE_DIR`.

Startup resolves the dataset revision once, stages a complete snapshot, validates
it, then switches a local `current` symlink atomically. Failed candidates leave the
prior pointer untouched; stale optional calibration is not copied into a candidate.
Startup validates the selected package again against the running code. A mismatched
manifest reports not ready instead of serving a mixed package. Without a manifest,
legacy loading remains possible unless strict mode is enabled, with an explicit
warning. `/health` alone does not prove that calibration or strict mode is enabled.

Do not deploy a code-only archive over an existing strict package: code fingerprints
will intentionally mismatch. Roll back code and the pinned dataset together. No
backend deployment or private-data upload is performed by this PR.

## Measurement and acceptance

Server timing histograms cover decode, model-lock wait, embedding, retrieval, OCR,
and complete locate/route/correct requests. Fixed outcome counters distinguish
invalid images, unrelated rejection, busy admission and unavailable recognition.
There are no photo/user/IP/node labels. Aggregate snapshots are exposed through
the local operator hook `app.state.metrics_snapshot()`, not a public endpoint.
`service_aggregates` JSON is logged every 100 measured requests using the bundled
logging configuration. Histograms are cumulative per process and use bounded
millisecond buckets; quantiles derived from them are ranges, not exact timings.
Inference work that continues after a disconnect still contributes stage timing.

Browser photo-to-route histograms and recovery counters stay in page memory.
They begin at preparation of the first photo that passes the client check, and include subsequent retakes, second
photos, confirmation and manual fallback until a usable route response. Purely
manual journeys are excluded. For a local diagnostic build set
`VITE_LOCAL_METRICS=1` and inspect `window.houndMetrics()`. No telemetry is uploaded
or persisted. Page refresh loses these aggregates. A route response is not proof
that a person arrived; do not present it as navigation success.

Before release, measure both software and product behavior:

- Run synthetic regressions and CI under Python 3.11 and Node 22.
- Use separate real held-out photos for wrong-floor/automatic-start rates, rejection
  errors and correction regressions; record denominators and collection conditions.
- Measure median/p95 photo-to-route and inference stage timing on the production
  CPU with concurrent requests, plus health/routing responsiveness under load.
- Phone-test rejection → retake, rejection → manual start, both-photo disagreement,
  accessible routes, timeout recovery and confirmed arrival at the correct door.
- Agree on numerical release gates after measuring the baseline. This PR invents
  no accuracy/latency improvement claims and does not replace physical room checks.

The browser recovery check can be repeated without model weights or a live API.
Run a local headless Chrome with remote debugging on port 9224, then:

```sh
cd frontend
VITE_API_URL=http://127.0.0.1:9877 VITE_LOCAL_METRICS=1 npm run dev -- --host 127.0.0.1 --port 5176
# In another terminal, from the repository root (Node 22):
node scripts/smoke_frontend_reliability.mjs
```

The script accepts optional local app/debug URLs. It generates a checkerboard
photo and intercepts locate/route/health requests with synthetic responses. It
checks rejection → retake, rejection → manual recovery, second-photo picker and
aggregate counters without calling the live correction endpoint.
