"""Fingerprint private runtime artifacts and the code that consumes them."""
import hashlib
import json
import os
from pathlib import Path

import numpy as np

from ml.embedder import MODEL_NAME, MEGALOC_MODEL_NAME, embedder_name
from ml.rejection import file_digest

DECISION_VERSION = 'ocr-consistent-v1'
REQUIRED = ('index.npz', 'graph.json', 'rooms.json')
OPTIONAL = ('recognition.json', 'confidence.json')


def index_identity(path):
    """Read descriptor metadata without materializing the full vector matrix."""
    default = MEGALOC_MODEL_NAME if embedder_name() == 'megaloc' else MODEL_NAME
    if not path.exists():
        return default
    with np.load(path, allow_pickle=False) as data:
        name = str(data['model_name']) if 'model_name' in data.files else ''
        name = name or default
        if 'pca_components' in data.files:
            name += f'+pca{data["pca_components"].shape[0]}'
        return name


def recognition_context(data_dir, index_path=None, model=None):
    paths = {name: Path(data_dir) / name for name in REQUIRED}
    if index_path is not None:
        paths['index.npz'] = Path(index_path)
    return {'model': model or index_identity(paths['index.npz']), 'decision_version': DECISION_VERSION,
            'files': {name: file_digest(path) if path.exists() else None for name, path in paths.items()}}


def context_digest(context):
    return hashlib.sha256(json.dumps(context, sort_keys=True).encode()).hexdigest()


def code_digest(root=None):
    root = Path(root or Path(__file__).resolve().parents[1])
    paths = [*root.glob('api/*.py'), *root.glob('ml/*.py'), root / 'api/logging.json',
             *(root / name for name in ('scripts/start.sh', 'scripts/fetch_data.py',
                                       'requirements.txt', 'requirements-core.txt', 'Dockerfile'))]
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.relative_to(root).as_posix().encode() + b'\0' + path.read_bytes())
    return digest.hexdigest()


def build_manifest(data_dir):
    directory = Path(data_dir)
    for name in REQUIRED:
        if not (directory / name).is_file():
            raise ValueError(f'Missing runtime artifact: {name}')
    return {'schema_version': 1, 'code_sha256': code_digest(),
            'context': recognition_context(directory),
            'files': {name: file_digest(directory / name) if (directory / name).exists() else None
                      for name in REQUIRED + OPTIONAL}}


def validate_manifest(data_dir, required=False):
    path = Path(data_dir) / 'runtime-manifest.json'
    if not path.exists():
        if required or os.getenv('HOUND_REQUIRE_MANIFEST') == '1':
            raise ValueError('A validated runtime-manifest.json is required')
        return None
    actual = json.loads(path.read_text())
    expected = build_manifest(data_dir)
    if actual != expected:
        raise ValueError('Runtime package does not match code/model/data fingerprints; restore a compatible package')
    return actual


def runtime_directory(root):
    root = Path(root)
    pointer = root / 'current'
    return pointer if pointer.exists() or pointer.is_symlink() else root
