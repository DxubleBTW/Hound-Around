"""Build ``data/index.npz`` from ``labels.csv`` (status==keep) + frames.

Reads ``<data_dir>/labels.csv`` rows with ``status == keep`` and their frames
under ``<data_dir>/dataset/train/<spot>/``, embeds them, and writes
``<data_dir>/index.npz`` in the contract format:

- ``vecs`` float16 ``[N, 384]`` (L2-normalized)
- ``labels`` str ``[N]``
- ``source`` str ``[N]`` = ``"video"``

Each spot is capped at ~60 frames, sampled evenly across time with a fixed seed.
Only spots that are nodes in ``graph.json`` on floors -1, 1 or 2 are included.
Per-spot counts are printed, plus the re-film list (spots under 20 frames).

Run end-to-end (human-blocked in the sandbox: needs approved torch deps and the
private ``data/`` frames)::

    python -m ml.build_index

The real embedder is constructed lazily; tests inject a fake ``embed_fn``.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image

from ml.embedder import DIM, normalize

CAP_PER_SPOT = 60
REFILM_THRESHOLD = 20
SEED = 1234
VALID_FLOORS = (-1, 1, 2)


def even_sample(items, cap, seed=SEED):
    """Evenly sample up to ``cap`` items across the list with a fixed seed.

    Evenly spaced indices keep coverage across videos/time; the seed only
    breaks ties deterministically when picking among equal candidates.
    """
    n = len(items)
    if n <= cap:
        return list(items)
    # Evenly spaced across the full ordered range.
    idx = np.linspace(0, n - 1, num=cap)
    rng = np.random.default_rng(seed)
    # Round with a deterministic tie jitter so repeated runs match.
    chosen = sorted(set(int(round(i)) for i in idx))
    while len(chosen) < cap:
        extra = int(rng.integers(0, n))
        if extra not in chosen:
            chosen.append(extra)
    chosen = sorted(chosen)[:cap]
    return [items[i] for i in chosen]


def read_keep_rows(labels_csv: Path):
    """Return a dict spot -> list of frame filenames (status==keep), ordered."""
    by_spot: dict[str, list] = {}
    with open(labels_csv, newline='') as handle:
        rows = list(csv.DictReader(handle))
    # Stable order across videos and time for even sampling.
    rows.sort(key=lambda r: (r.get('label', ''), r.get('video', ''),
                             _as_float(r.get('t_sec')), r.get('file', '')))
    for row in rows:
        if row.get('status') != 'keep':
            continue
        label = row.get('label')
        file = row.get('file')
        if label and file:
            by_spot.setdefault(label, []).append(file)
    return by_spot


def _as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def build_index(data_dir, embed_fn=None, cap=CAP_PER_SPOT):
    """Build and return ``(VectorIndex-like arrays)`` and write ``index.npz``.

    Returns ``(path, counts)`` where ``counts`` maps spot -> frames indexed.
    ``embed_fn`` is injectable (fake in tests); defaults to DINOv2.
    """
    data_dir = Path(data_dir)
    graph = json.loads((data_dir / 'graph.json').read_text())
    valid_nodes = {n['id'] for n in graph.get('nodes', []) if n.get('floor') in VALID_FLOORS}

    if embed_fn is None:
        from ml.embedder import Dinov2Embedder  # lazy heavy import
        embed_fn = Dinov2Embedder()

    by_spot = read_keep_rows(data_dir / 'labels.csv')
    train_dir = data_dir / 'dataset' / 'train'

    vecs_parts, labels, counts = [], [], {}
    for spot in sorted(by_spot):
        if spot not in valid_nodes:
            continue
        frames = [f for f in by_spot[spot] if (train_dir / spot / f).exists()]
        frames = even_sample(frames, cap)
        if not frames:
            continue
        images = [Image.open(train_dir / spot / f).convert('RGB') for f in frames]
        try:
            vectors = np.asarray(embed_fn(images), dtype=np.float32).reshape(-1, DIM)
        finally:
            for image in images:
                image.close()
        vecs_parts.append(normalize(vectors))
        labels.extend([spot] * vectors.shape[0])
        counts[spot] = vectors.shape[0]

    vecs = np.vstack(vecs_parts).astype(np.float16) if vecs_parts \
        else np.zeros((0, DIM), dtype=np.float16)
    source = np.asarray(['video'] * len(labels), dtype='U') if labels \
        else np.zeros((0,), dtype='U1')
    labels_arr = np.asarray(labels, dtype='U') if labels else np.zeros((0,), dtype='U1')

    out_path = data_dir / 'index.npz'
    np.savez(out_path, vecs=vecs, labels=labels_arr, source=source)

    _report(counts)
    return out_path, counts


def _report(counts):
    print('Per-spot frame counts:')
    for spot in sorted(counts):
        print(f'  {spot}: {counts[spot]}')
    refilm = sorted(s for s, c in counts.items() if c < REFILM_THRESHOLD)
    total = sum(counts.values())
    print(f'Total frames indexed: {total} across {len(counts)} spots')
    if refilm:
        print(f'Re-film list (< {REFILM_THRESHOLD} frames): {", ".join(refilm)}')
    else:
        print(f'Re-film list (< {REFILM_THRESHOLD} frames): none')


if __name__ == '__main__':  # pragma: no cover - CLI, human-blocked on real data
    import os

    build_index(Path(os.getenv('HOUND_DATA_DIR', 'data')))
