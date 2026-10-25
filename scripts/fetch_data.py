"""Stage a pinned private runtime snapshot and atomically activate it at startup.

The Space CODE is public; the private ``graph.json`` / ``rooms.json`` /
``index.npz`` live in a PRIVATE Hugging Face dataset repo (design.md §6). At
startup, when ``HOUND_DATA_REPO`` is set and ``HF_TOKEN`` is present, this
downloads a complete package below ``HOUND_DATA_DIR/packages`` before uvicorn
boots. The API follows the atomic ``current`` pointer. Optional calibration and
runtime manifests are fetched from the same immutable dataset revision.

No token or private file is ever baked into the image. If ``HOUND_DATA_REPO``
is unset (e.g. a local ``docker run`` without secrets) this no-ops gracefully so
the container still boots to the 503 "data not ready" state rather than
crashing. The same graceful no-op applies when ``HF_TOKEN`` is missing or the
download fails: retain the previous package; the API validates readiness.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# The three private runtime files the app loads from HOUND_DATA_DIR.
DATA_FILES = ('graph.json', 'rooms.json', 'index.npz')
OPTIONAL_DATA_FILES = ('recognition.json', 'confidence.json', 'runtime-manifest.json')


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
        from huggingface_hub import HfApi, snapshot_download
        from tempfile import TemporaryDirectory
        import uuid
        from ml.artifacts import build_manifest, code_digest, validate_manifest

        # Resolve once, then fetch every artifact from the same immutable revision.
        revision = HfApi(token=token).repo_info(
            repo_id, repo_type='dataset', revision=os.getenv('HOUND_DATA_REVISION') or 'main').sha
        if not revision or any(c not in '0123456789abcdef' for c in revision):
            raise ValueError('Dataset did not resolve to an immutable commit')
        data_dir.mkdir(parents=True, exist_ok=True)
        packages = data_dir / 'packages'
        packages.mkdir(exist_ok=True)
        with TemporaryDirectory(prefix='.candidate-', dir=packages) as temporary:
            candidate = Path(temporary) / 'runtime'
            snapshot_download(repo_id=repo_id, repo_type='dataset', token=token,
                              revision=revision, local_dir=str(candidate),
                              allow_patterns=list(DATA_FILES + OPTIONAL_DATA_FILES))
            expected = build_manifest(candidate)  # Required artifacts must all exist.
            manifest = validate_manifest(candidate)
            if manifest is None:
                log('runtime manifest absent; legacy package compatibility is unverified')
            destination = packages / f'{revision}-{code_digest()[:12]}'
            if destination.exists():
                validate_manifest(destination)
                if build_manifest(destination) != expected:
                    raise ValueError('Previously installed immutable package was modified')
            else:
                candidate.rename(destination)
            pointer = data_dir / f'.current-{uuid.uuid4().hex}'
            try:
                pointer.symlink_to(destination.relative_to(data_dir), target_is_directory=True)
                pointer.replace(data_dir / 'current')
            finally:
                pointer.unlink(missing_ok=True)
            log(f'activated complete private runtime revision {revision}')
    except Exception as error:
        # Leave the previous package pointer untouched. Startup validates its code
        # compatibility too; an incompatible previous package reports not ready.
        log(f'private package activation failed ({type(error).__name__}); previous package retained')

    return 0


if __name__ == '__main__':
    sys.exit(main())
