#!/usr/bin/env bash
# Container entrypoint: pull private runtime data (if configured), then exec
# uvicorn. fetch_data.py no-ops gracefully when HOUND_DATA_REPO/HF_TOKEN are
# unset, so a local `docker run` without secrets still boots (to 503 until data
# is present). We do NOT `set -e` on the fetch: a failed download must not stop
# the app from starting and reporting its own readiness state.
set -u

python scripts/fetch_data.py || true

# --proxy-headers + --forwarded-allow-ips='*' resolve the real client IP behind
# the HF Space proxy so the per-peer rate limiter (api/main.py) buckets judges
# individually instead of sharing one proxy-IP bucket (design.md §7). HF's proxy
# IP is not stable, so '*' is the documented demo choice; it is safe here
# because the limiter is per-peer and the forwarded IP is only used for rate
# limiting, not auth. One worker: corrections live in a single in-memory index.
exec python -m uvicorn api.main:app \
  --host 0.0.0.0 \
  --port 7860 \
  --workers 1 \
  --no-access-log \
  --proxy-headers \
  --forwarded-allow-ips='*'
