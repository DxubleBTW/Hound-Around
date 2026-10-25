"""Build ``data/index.npz`` from ``labels.csv`` (status==keep) + frames.

Reads every ``<data_dir>/<dataset>/labels.csv`` the pipeline wrote (frames in
``<data_dir>/<dataset>/train/<spot>/``; a top-level ``<data_dir>/labels.csv``
pairs with ``<data_dir>/dataset/train``), keeps ``status == keep``, embeds, and writes
``<data_dir>/index.npz`` in the contract format:

- ``vecs`` float16 ``[N, 384]`` (L2-normalized)
- ``labels`` str ``[N]``
- ``source`` str ``[N]`` = ``"video"``

Each spot is capped at 250 frames, sampled evenly across time with a fixed seed
(60 -> 250: +2 top-1, +1 floor under leave-one-video-out; past 250 it is flat).
Every frame adds one row per :data:`ml.embedder.INDEX_VIEWS` view (whole frame,
left and right crop), all with the frame's label, so N = 3 x frames.
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

from ml.embedder import DIM, INDEX_VIEWS, index_views, normalize

CAP_PER_SPOT = 250
# 360-camera views (datasets named *360*) get their own budget on top of the phone frames. Sharing the cap let
# hundreds of 360 crops crowd out the phone frames that phone queries match best (top-3 at those spots 33% -> 19%);
# added on top they were neutral overall and slightly better at their spots (LOVO, Sat night).
CAP_360_PER_SPOT = 40
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


def keep_frames(data_dir, exclude_videos=()):
    """spot -> ordered frame paths across every pipeline manifest (review N05).

    Each ``data/<dataset>/labels.csv`` pairs with ``data/<dataset>/train``; a
    top-level ``data/labels.csv`` pairs with ``data/dataset/train``.
    ``exclude_videos`` keeps held-out videos out of an evaluation index
    (review N01).
    """
    from ml.backend import manifest_paths

    data_dir = Path(data_dir)
    by_spot: dict = {}
    for manifest in manifest_paths(data_dir):
        train_dir = data_dir / 'dataset' / 'train' if manifest.parent == data_dir else manifest.parent / 'train'
        with open(manifest, newline='') as handle:
            skip = {r['file'] for r in csv.DictReader(handle) if r.get('video') in set(exclude_videos)}
        for spot, files in read_keep_rows(manifest).items():
            by_spot.setdefault(spot, []).extend(
                train_dir / spot / f for f in files if f not in skip and (train_dir / spot / f).exists())
    return by_spot


def build_index(data_dir, embed_fn=None, cap=CAP_PER_SPOT, exclude_videos=(), out_path=None):
    """Build and return ``(VectorIndex-like arrays)`` and write ``index.npz``.

    Returns ``(path, counts)`` where ``counts`` maps spot -> frames indexed
    (each frame is ``len(INDEX_VIEWS)`` rows).
    ``embed_fn`` is injectable (fake in tests); defaults to DINOv2.
    """
    data_dir = Path(data_dir)
    graph = json.loads((data_dir / 'graph.json').read_text())
    valid_nodes = {n['id'] for n in graph.get('nodes', []) if n.get('floor') in VALID_FLOORS}

    if embed_fn is None:
        from ml.embedder import Dinov2Embedder  # lazy heavy import
        embed_fn = Dinov2Embedder()

    by_spot = keep_frames(data_dir, exclude_videos)

    vecs_parts, labels, counts = [], [], {}
    for spot in sorted(by_spot):
        if spot not in valid_nodes:
            continue
        is_360 = [f for f in by_spot[spot] if '360' in Path(f).parent.parent.parent.name]
        phone = [f for f in by_spot[spot] if f not in set(is_360)]
        frames = even_sample(phone, cap) + even_sample(is_360, CAP_360_PER_SPOT)
        if not frames:
            continue
        images = [Image.open(f).convert('RGB') for f in frames]
        try:
            views = [view for image in images for view in index_views(image)]
            vectors = np.asarray(embed_fn(views), dtype=np.float32).reshape(-1, DIM)
        finally:
            for image in images:
                image.close()
        vecs_parts.append(normalize(vectors))
        labels.extend([spot] * vectors.shape[0])
        counts[spot] = len(frames)

    vecs = np.vstack(vecs_parts).astype(np.float16) if vecs_parts \
        else np.zeros((0, DIM), dtype=np.float16)
    source = np.asarray(['video'] * len(labels), dtype='U') if labels \
        else np.zeros((0,), dtype='U1')
    labels_arr = np.asarray(labels, dtype='U') if labels else np.zeros((0,), dtype='U1')

    out_path = Path(out_path) if out_path else data_dir / 'index.npz'
    np.savez(out_path, vecs=vecs, labels=labels_arr, source=source)

    _report(counts)
    return out_path, counts


def _report(counts):
    print('Per-spot frame counts:')
    for spot in sorted(counts):
        print(f'  {spot}: {counts[spot]}')
    refilm = sorted(s for s, c in counts.items() if c < REFILM_THRESHOLD)
    total = sum(counts.values())
    print(f'Total frames indexed: {total} ({total * len(INDEX_VIEWS)} rows) across {len(counts)} spots')
    if refilm:
        print(f'Re-film list (< {REFILM_THRESHOLD} frames): {", ".join(refilm)}')
    else:
        print(f'Re-film list (< {REFILM_THRESHOLD} frames): none')


if __name__ == '__main__':  # pragma: no cover - CLI, human-blocked on real data
    import os

    build_index(Path(os.getenv('HOUND_DATA_DIR', 'data')))
