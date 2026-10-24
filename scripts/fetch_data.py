"""Pull the private runtime data into HOUND_DATA_DIR at Space startup.

The Space CODE is public; the private ``graph.json`` / ``rooms.json`` /
``index.npz`` live in a PRIVATE Hugging Face dataset repo (design.md §6). At
startup, when ``HOUND_DATA_REPO`` is set and ``HF_TOKEN`` is present, this
downloads those three files into ``HOUND_DATA_DIR`` before uvicorn boots the
app (api/main.py reads graph/rooms, ml/backend reads index.npz).

No token or private file is ever baked into the image. If ``HOUND_DATA_REPO``
is unset (e.g. a local ``docker run`` without secrets) this no-ops gracefully so
the container still boots to the 503 "data not ready" state rather than
crashing. The same graceful no-op applies when ``HF_TOKEN`` is missing or the
download fails: log and continue, never raise.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# The three private runtime files the app loads from HOUND_DATA_DIR.
DATA_FILES = ('graph.json', 'rooms.json', 'index.npz')


def log(message: str) -> None:
    print(f'[fetch_data] {message}', flush=True)


def main() -> int:
    repo_id = os.environ.get('HOUND_DATA_REPO')
    data_dir = Path(os.environ.get('HOUND_DATA_DIR', 'data'))

    if not repo_id:
        log('HOUND_DATA_REPO not set, skipping private-data download '
            '(app will report 503 until data is present).')
        return 0

    token = os.environ.get('HF_TOKEN')
    if not token:
        log('HOUND_DATA_REPO is set but HF_TOKEN is missing, skipping download '
            '(app will report 503 until data is present).')
        return 0

    try:
        from huggingface_hub import hf_hub_download  # lazy: runtime dep only.
    except Exception as exc:  # pragma: no cover - only hit without the dep.
        log(f'huggingface_hub unavailable ({exc!r}), skipping download.')
        return 0

    data_dir.mkdir(parents=True, exist_ok=True)
    for filename in DATA_FILES:
        try:
            path = hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                repo_type='dataset',
                token=token,
                local_dir=str(data_dir),
            )
            log(f'downloaded {filename} -> {path}')
        except Exception as exc:
            # Never crash startup over one missing/failed file; the app's own
            # readiness check will surface 503 if required data is absent.
            log(f'could not download {filename} ({exc!r}), continuing.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
