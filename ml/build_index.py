"""Build ``data/index.npz`` from ``labels.csv`` (status==keep) + frames.

Reads every ``<data_dir>/<dataset>/labels.csv`` the pipeline wrote (frames in
``<data_dir>/<dataset>/train/<spot>/``; a top-level ``<data_dir>/labels.csv``
pairs with ``<data_dir>/dataset/train``), keeps ``status == keep``, embeds, and writes
``<data_dir>/index.npz`` in the contract format:

- ``vecs`` float16 ``[N, D]`` (L2-normalized; D follows the embedder, or ``--pca K``)
- ``labels`` str ``[N]``
- ``source`` str ``[N]`` = ``"video"``
- ``heading`` str ``[N]``: graph node the frame faces, ``''`` when unknown (optional; older indexes lack it).
  ``python -m ml.build_index --add-headings`` adds it to an existing index without re-embedding.

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

from ml.embedder import INDEX_VIEWS, Projector, index_views, normalize

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


def build_index(data_dir, embed_fn=None, cap=CAP_PER_SPOT, exclude_videos=(), out_path=None, pca=None):
    """Build and return ``(VectorIndex-like arrays)`` and write ``index.npz``.

    Returns ``(path, counts)`` where ``counts`` maps spot -> frames indexed
    (each frame is ``len(INDEX_VIEWS)`` rows).
    ``embed_fn`` is injectable (fake in tests); defaults to the embedder named by
    ``HOUND_EMBEDDER`` (:func:`ml.embedder.make_embedder`). ``pca=K`` fits a PCA
    on the full-width rows, stores the K-d rows and saves the projection inside
    the same ``index.npz`` (the backend applies it to every query).
    """
    data_dir = Path(data_dir)
    graph = json.loads((data_dir / 'graph.json').read_text())
    valid_nodes = {n['id'] for n in graph.get('nodes', []) if n.get('floor') in VALID_FLOORS}

    if embed_fn is None:
        from ml.embedder import make_embedder  # lazy heavy import
        embed_fn = make_embedder()

    headings = frame_headings(data_dir)
    vecs_parts, labels, row_headings, counts = [], [], [], {}
    dim = getattr(embed_fn, 'dim', None)
    for spot, frames in index_frames(data_dir, valid_nodes, cap, exclude_videos):
        images = [Image.open(f).convert('RGB') for f in frames]
        try:
            views = [view for image in images for view in index_views(image)]
            vectors = np.asarray(embed_fn(views), dtype=np.float32).reshape(len(views), -1)
            if dim is None:
                dim = vectors.shape[1]
            elif vectors.shape[1] != dim:
                raise ValueError(f'Embedder returned {vectors.shape[1]}-d rows, expected {dim}-d')
        finally:
            for image in images:
                image.close()
        vecs_parts.append(normalize(vectors))
        labels.extend([spot] * vectors.shape[0])
        row_headings.extend(headings.get(str(f), '') for f in frames for _ in INDEX_VIEWS)
        counts[spot] = len(frames)

    projector = None
    if vecs_parts and pca:
        full = np.vstack(vecs_parts)
        projector = Projector.fit(full, int(pca))
        vecs_parts = [projector(full)]
        print(f'PCA {projector.in_dim} -> {projector.out_dim} stored in the index')
    vecs = np.vstack(vecs_parts).astype(np.float16) if vecs_parts \
        else np.zeros((0, dim or 0), dtype=np.float16)
    source = np.asarray(['video'] * len(labels), dtype='U') if labels \
        else np.zeros((0,), dtype='U1')
    labels_arr = np.asarray(labels, dtype='U') if labels else np.zeros((0,), dtype='U1')
    heading_arr = np.asarray(row_headings, dtype='U') if labels else np.zeros((0,), dtype='U1')

    out_path = Path(out_path) if out_path else data_dir / 'index.npz'
    extra = projector.npz_fields() if projector is not None else {}
    np.savez(out_path, vecs=vecs, labels=labels_arr, source=source, heading=heading_arr, **extra)

    _report(counts)
    return out_path, counts


def index_frames(data_dir, valid_nodes, cap=CAP_PER_SPOT, exclude_videos=()):
    """(spot, frame paths) in index row order: spots sorted, phone frames then 360 frames."""
    by_spot = keep_frames(data_dir, exclude_videos)
    for spot in sorted(by_spot):
        if spot not in valid_nodes:
            continue
        is_360 = [f for f in by_spot[spot] if '360' in Path(f).parent.parent.parent.name]
        phone = [f for f in by_spot[spot] if f not in set(is_360)]
        frames = even_sample(phone, cap) + even_sample(is_360, CAP_360_PER_SPOT)
        if frames:
            yield spot, frames


def frame_headings(data_dir):
    """frame path -> the graph node the frame faces (labels.csv ``heading``), where recorded."""
    from ml.backend import manifest_paths

    data_dir = Path(data_dir)
    out = {}
    for manifest in manifest_paths(data_dir):
        train_dir = data_dir / 'dataset' / 'train' if manifest.parent == data_dir else manifest.parent / 'train'
        with open(manifest, newline='') as handle:
            for row in csv.DictReader(handle):
                heading = (row.get('heading') or '').strip()
                if row.get('status') == 'keep' and heading and row.get('label') and row.get('file'):
                    out[str(train_dir / row['label'] / row['file'])] = heading
    return out


def add_headings(data_dir, index_path=None, cap=CAP_PER_SPOT):
    """Write per-row headings into an existing index without re-embedding.

    Recomputes the row order from the manifests and refuses to write unless it
    reproduces the index's labels exactly (same frames, same sampling)."""
    data_dir = Path(data_dir)
    index_path = Path(index_path) if index_path else data_dir / 'index.npz'
    graph = json.loads((data_dir / 'graph.json').read_text())
    valid_nodes = {n['id'] for n in graph.get('nodes', []) if n.get('floor') in VALID_FLOORS}
    headings = frame_headings(data_dir)
    labels, row_headings = [], []
    for spot, frames in index_frames(data_dir, valid_nodes, cap):
        labels.extend([spot] * len(frames) * len(INDEX_VIEWS))
        row_headings.extend(headings.get(str(f), '') for f in frames for _ in INDEX_VIEWS)
    data = dict(np.load(index_path, allow_pickle=False))
    if [str(x) for x in data['labels']] != labels:
        raise ValueError('Index rows do not match the manifests; rebuild the index instead')
    data['heading'] = np.asarray(row_headings, dtype='U')
    np.savez(index_path, **data)
    known = sum(1 for h in row_headings if h)
    print(f'{known} of {len(row_headings)} rows have a heading')
    return index_path


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
    import sys

    data = Path(os.getenv('HOUND_DATA_DIR', 'data'))
    if '--add-headings' in sys.argv:
        add_headings(data)
    else:
        # python -m ml.build_index [--pca K]   (embedder from HOUND_EMBEDDER)
        pca = int(sys.argv[sys.argv.index('--pca') + 1]) if '--pca' in sys.argv else None
        build_index(data, pca=pca)
