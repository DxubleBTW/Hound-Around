"""Honest evaluation harness: splits, metrics, go/no-go, experiments.

"Data Science Application" is 25% of the rubric, and calling a model is not
enough: the honest numbers are what score (``docs/roles/ml.md``). This module
owns the fixed train/val/test split, the metric math, the 3 PM go/no-go CLI,
and the P1 experiments table.

Splits (``docs/dataset.md`` / ``docs/roles/ml.md`` / ``CLAUDE.md``):

- **train** = Saturday-morning runs (every ``labels.csv`` ``keep`` row).
- **val** = one held-out video run per floor (those rows are pulled OUT of
  train so they are never both indexed and scored).
- **test** = outsider still photos ``data/test/TEST_<node>_NN.jpg``. The
  filename encodes the true node. These are NEVER frames from a training video.

A **leakage guard** (:func:`assert_no_leakage`) raises loudly if a test item's
provenance could overlap a training video, so inflated accuracy can never slip
into the numbers judges will ask about.

Design constraints honored here:

- The metric functions are **pure** (they take predictions/labels, not photos),
  so they are unit-testable on synthetic inputs with no torch/data.
- Graph-distance error reuses **networkx shortest path** over ``graph.json``
  with the same ``cost`` else ``meters`` weighting as ``api/routing.py``.
- Heavy / approval-gated deps (``torch``/``transformers`` via the real
  embedder, ``CLIP``, ``matplotlib``) are imported **lazily** inside the
  experiment/chart paths, so ``import ml.eval`` and ``python -m ml.eval --help``
  work without them.
- Real numbers only. The experiment table, ``results/metrics.json`` and
  ``docs/img/accuracy.png`` are produced ONLY from real ``data/`` inputs
  (human-blocked in the sandbox). Nothing is fabricated here.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import time
from pathlib import Path

import networkx as nx
import numpy as np

from ml.embedder import DIM, normalize

# Confidence threshold the app uses to show the top-3 picker (contract.md /
# requirements C.2): accuracy at/above vs below this, and whether low
# confidence correctly flags a wrong answer.
CONFIDENCE_GATE = 0.6
# The 3 PM go/no-go bar (docs/roles/README.md, requirements C.3).
GO_NO_GO_MIN = 7
GO_NO_GO_N = 10
# Outsider test photo naming: TEST_<node>_NN.jpg (docs/roles/data.md).
TEST_NAME_RE = re.compile(r'^TEST_(?P<node>.+)_(?P<n>\d+)\.(?:jpg|jpeg|png)$', re.IGNORECASE)
VALID_FLOORS = (-1, 1, 2)


# --------------------------------------------------------------------------
# Graph distance (reuse routing's cost-else-meters weighting)
# --------------------------------------------------------------------------

def build_distance_graph(graph: dict) -> nx.Graph:
    """Undirected weighted graph for shortest-path *distance* between spots.

    Edge weight is physical ``meters``. Every edge counts both ways, including
    ``verify`` and ``one_way`` ones the router may skip: graph-distance error
    measures how far apart two spots are in the building, not a navigable
    route for a specific user.
    """
    distance = nx.Graph()
    for node in graph.get('nodes', []):
        distance.add_node(node['id'])
    for edge in graph.get('edges', []):
        a, b = edge.get('from'), edge.get('to')
        if a is None or b is None:
            continue
        # Physical meters only: `cost` is a routing penalty (an elevator is 0 m
        # with cost 30), so it must not show up as localization error (N10).
        weight = float(edge.get('meters', 0.0))
        # Keep the smallest weight if a pair is connected more than once.
        if distance.has_edge(a, b):
            weight = min(weight, distance[a][b]['weight'])
        distance.add_edge(a, b, weight=weight)
    return distance


def graph_distance(distance: nx.Graph, a: str, b: str):
    """Shortest-path distance in meters between two spots, or ``inf``.

    Returns ``0.0`` for the same spot and ``float('inf')`` when either node is
    unknown or no path exists (counted as a miss by the median helper).
    """
    if a == b:
        return 0.0
    if a not in distance or b not in distance:
        return float('inf')
    try:
        return float(nx.shortest_path_length(distance, a, b, weight='weight'))
    except nx.NetworkXNoPath:
        return float('inf')


# --------------------------------------------------------------------------
# Pure metric functions (unit-testable on synthetic inputs)
# --------------------------------------------------------------------------

def top1_accuracy(predictions) -> float:
    """Fraction where the rank-1 spot equals the true spot.

    ``predictions`` is a list of dicts with ``true`` and ``top3`` (a list of
    ``{'spot': ...}`` votes-descending, as the backend returns).
    """
    if not predictions:
        return 0.0
    return sum(1 for p in predictions if _is_correct(p)) / len(predictions)


def topk_accuracy(predictions, k: int = 3) -> float:
    """Fraction where the true spot is among the top-k voted spots."""
    if not predictions:
        return 0.0
    hits = sum(1 for p in predictions if p['true'] in _topk_spots(p, k))
    return hits / len(predictions)


def floor_accuracy(predictions, node_floor: dict) -> float:
    """Fraction where the predicted spot's floor equals the true floor.

    Uses ``predicted['floor']`` when present (what ``locate`` returns, which may
    be overridden by OCR), else the winning spot's floor from ``node_floor``.
    The true floor comes from the true spot via ``node_floor``.
    """
    if not predictions:
        return 0.0
    hits = 0
    for p in predictions:
        true_floor = node_floor.get(p['true'])
        pred_floor = p.get('floor')
        if pred_floor is None:
            pred_floor = node_floor.get(_predicted(p))
        if pred_floor is not None and true_floor is not None and pred_floor == true_floor:
            hits += 1
    return hits / len(predictions)


def median_graph_distance_error(predictions, distance: nx.Graph) -> float:
    """Median shortest-path distance (m) between predicted and true spot.

    A correct top-1 contributes ``0``. Unknown/unreachable pairs contribute
    ``inf`` so they cannot be hidden by the median of the rest.
    """
    if not predictions:
        return 0.0
    errors = []
    for p in predictions:
        predicted = _predicted(p)
        errors.append(graph_distance(distance, predicted, p['true']) if predicted is not None
                      else float('inf'))
    return float(statistics.median(errors))


def latency_percentiles(latencies_ms):
    """Return ``{'p50', 'p95'}`` latency in milliseconds (0 when empty)."""
    values = sorted(float(x) for x in latencies_ms)
    if not values:
        return {'p50': 0.0, 'p95': 0.0}
    return {'p50': _percentile(values, 50), 'p95': _percentile(values, 95)}


def calibration(predictions, gate: float = CONFIDENCE_GATE) -> dict:
    """Confidence calibration around ``gate`` (default 0.6).

    Returns:

    - ``high_conf_n`` / ``high_conf_acc``: count and top-1 accuracy of the
      confident bucket (``confidence >= gate``).
    - ``low_conf_n`` / ``low_conf_acc``: same for the unsure bucket
      (``confidence < gate``).
    - ``low_conf_correctly_flags_wrong``: of the low-confidence items, the
      fraction that were ACTUALLY wrong (how often being unsure correctly flags
      a wrong answer, requirements C.2). ``None`` when the bucket is empty.
    """
    high = [p for p in predictions if float(p.get('confidence', 0.0)) >= gate]
    low = [p for p in predictions if float(p.get('confidence', 0.0)) < gate]

    def _acc(bucket):
        if not bucket:
            return None
        return sum(1 for p in bucket if _is_correct(p)) / len(bucket)

    low_wrong = None
    if low:
        low_wrong = sum(1 for p in low if not _is_correct(p)) / len(low)
    return {
        'gate': gate,
        'high_conf_n': len(high),
        'high_conf_acc': _acc(high),
        'low_conf_n': len(low),
        'low_conf_acc': _acc(low),
        'low_conf_correctly_flags_wrong': low_wrong,
    }


def confusion_pairs(predictions, limit: int = 10):
    """Most-mixed ``(true, predicted)`` spot pairs among the misses.

    Feeds the pitch and the re-film list (``docs/roles/ml.md``). Returns a list
    of ``{'true', 'predicted', 'count'}`` sorted by count descending.
    """
    tally: dict[tuple, int] = {}
    for p in predictions:
        predicted = _predicted(p)
        if predicted is not None and predicted != p['true']:
            key = (p['true'], predicted)
            tally[key] = tally.get(key, 0) + 1
    ordered = sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{'true': t, 'predicted': pr, 'count': c} for (t, pr), c in ordered[:limit]]


def compute_metrics(predictions, graph: dict, latencies_ms=None) -> dict:
    """Bundle every required metric for a list of predictions.

    Each prediction is ``{'true', 'top3', 'confidence', 'floor'(optional)}``.
    ``latencies_ms`` is an optional parallel list of per-locate milliseconds.
    """
    node_floor = {n['id']: n['floor'] for n in graph.get('nodes', [])}
    distance = build_distance_graph(graph)
    return {
        'n': len(predictions),
        'top1_acc': top1_accuracy(predictions),
        'top3_acc': topk_accuracy(predictions, 3),
        'floor_acc': floor_accuracy(predictions, node_floor),
        'median_graph_distance_error_m': median_graph_distance_error(predictions, distance),
        'latency': latency_percentiles(latencies_ms or []),
        'calibration': calibration(predictions),
        'confusion': confusion_pairs(predictions),
    }


# -- metric helpers --------------------------------------------------------

def _topk_spots(prediction, k):
    return [v['spot'] for v in prediction.get('top3', [])[:k]]


def _predicted(prediction):
    """The spot the app actually uses: ``spot`` when recorded (it can differ from
    ``top3[0]`` after an OCR override, review N08), else the top vote."""
    if prediction.get('spot') is not None:
        return prediction['spot']
    top = _topk_spots(prediction, 1)
    return top[0] if top else None


def _is_correct(prediction):
    return _predicted(prediction) == prediction['true']


def _percentile(sorted_values, pct):
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    rank = (pct / 100.0) * (len(sorted_values) - 1)
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    frac = rank - low
    return float(sorted_values[low] + (sorted_values[high] - sorted_values[low]) * frac)


# --------------------------------------------------------------------------
# Splits + leakage guard
# --------------------------------------------------------------------------

def read_labels(labels_csv: Path):
    """Return the ``keep`` rows of ``labels.csv`` as dicts (ordered)."""
    rows = []
    with open(labels_csv, newline='') as handle:
        for row in csv.DictReader(handle):
            if row.get('status') == 'keep':
                rows.append(row)
    return rows


def read_all_labels(data_dir):
    """``keep`` rows from every pipeline manifest, each with its frame ``_path``
    (review N05; same discovery as ml.build_index and ml.backend)."""
    from ml.backend import manifest_paths

    data_dir = Path(data_dir)
    rows = []
    for manifest in manifest_paths(data_dir):
        train_dir = data_dir / 'dataset' / 'train' if manifest.parent == data_dir else manifest.parent / 'train'
        for row in read_labels(manifest):
            row['_path'] = train_dir / row['label'] / row['file']
            rows.append(row)
    return rows


def split_train_val(rows, val_videos=None):
    """Split ``keep`` rows into (train, val) by held-out video per floor.

    ``val`` = one held-out video run per floor. When ``val_videos`` is given it
    is the explicit set/list of video ids to hold out; otherwise the LAST video
    (lexicographically) seen on each floor is held out deterministically. Rows
    in a val video are removed from train so the two never overlap.
    """
    if val_videos is None:
        by_floor_videos: dict[object, set] = {}
        for row in rows:
            floor = _floor_of_row(row)
            by_floor_videos.setdefault(floor, set()).add(row.get('video'))
        val_videos = {sorted(v)[-1] for v in by_floor_videos.values() if v}
    else:
        val_videos = set(val_videos)
    train = [r for r in rows if r.get('video') not in val_videos]
    val = [r for r in rows if r.get('video') in val_videos]
    return train, val, val_videos


def discover_test_items(test_dir: Path):
    """Parse ``data/test/TEST_<node>_NN.jpg`` files into test items.

    Returns a list of ``{'path', 'true', 'video'}`` where ``video`` is ``None``
    (outsider still photos have no training-video provenance). Files that do not
    match the ``TEST_<node>_NN`` convention are ignored (they are not test
    photos). Raises if the directory is missing.
    """
    test_dir = Path(test_dir)
    if not test_dir.exists():
        raise FileNotFoundError(f'Test photo directory not found: {test_dir}')
    items = []
    for path in sorted(test_dir.iterdir()):
        match = TEST_NAME_RE.match(path.name)
        if match:
            items.append({'path': path, 'true': match.group('node'), 'video': None})
    return items


def assert_no_leakage(train_rows, val_rows, test_items):
    """Fail loudly if train/val/test could overlap (``CLAUDE.md`` rule).

    Raises ``LeakageError`` when:

    - any video appears in BOTH the train and val splits (a held-out run must be
      fully held out), or
    - any test item carries a ``video`` provenance that is also a training (or
      val) video -- i.e. a "test" photo that is really a frame from a filmed
      run. Outsider still photos have ``video is None`` and pass.

    Inflated accuracy from train/test overlap is exactly what judges probe, so
    this guard is intentionally strict and raises rather than warning.
    """
    train_videos = {r.get('video') for r in train_rows if r.get('video')}
    val_videos = {r.get('video') for r in val_rows if r.get('video')}

    both = train_videos & val_videos
    if both:
        raise LeakageError(
            f'Train and val share video run(s): {sorted(both)}. A held-out run '
            f'must not also be indexed into train.')

    indexed_videos = train_videos | val_videos
    leaked = sorted({
        item['video'] for item in test_items
        if item.get('video') is not None and item['video'] in indexed_videos
    })
    if leaked:
        raise LeakageError(
            f'Test photo(s) trace back to training/val video run(s): {leaked}. '
            f'Test photos must be outsider stills, never frames from the videos.')


class LeakageError(RuntimeError):
    """Raised when a split boundary is violated (train/val/test overlap)."""


def _floor_of_row(row):
    """Best-effort floor from a label like ``F2_hall_e2`` / ``B1_core``."""
    label = (row.get('label') or '')
    prefix = label.split('_', 1)[0].upper()
    return {'B1': -1, 'F1': 1, 'F2': 2}.get(prefix, prefix)


# --------------------------------------------------------------------------
# Evaluation driver (human-blocked on real data)
# --------------------------------------------------------------------------

def _load_graph(data_dir: Path) -> dict:
    graph_path = Path(data_dir) / 'graph.json'
    if not graph_path.exists():
        raise FileNotFoundError(
            f'graph.json not found under {data_dir}. Real evaluation needs the '
            f'private data/ inputs (human-blocked in the sandbox).')
    return json.loads(graph_path.read_text())


def evaluate_split(data_dir, split: str, backend, graph: dict, limit=None):
    """Run ``backend.locate`` over a split and return (predictions, latencies).

    Reused by the CLI once real data + an approved embedder are present. Pure,
    photo-free math lives in :func:`compute_metrics`; this function is the thin
    I/O layer that is human-blocked without ``data/``.
    """
    from PIL import Image  # local import keeps module import light

    data_dir = Path(data_dir)
    rows = read_all_labels(data_dir)
    train_rows, val_rows, _ = split_train_val(rows)

    if split == 'test':
        items = discover_test_items(data_dir / 'test')
    elif split == 'val':
        items = [_row_item(data_dir, r, 'train') for r in val_rows]
    elif split == 'train':
        items = [_row_item(data_dir, r, 'train') for r in train_rows]
    else:
        raise ValueError(f'Unknown split: {split!r} (use train|val|test)')

    # Guard every run: the split loaders must never be able to mix.
    assert_no_leakage(train_rows, val_rows,
                      items if split == 'test' else [])

    if limit is not None:
        items = items[:limit]

    predictions, latencies = [], []
    for item in items:
        with Image.open(item['path']).convert('RGB') as image:
            start = time.perf_counter()
            result = backend.locate(image)
            latencies.append((time.perf_counter() - start) * 1000.0)
        predictions.append({
            'true': item['true'],
            'spot': result.get('spot'),
            'top3': result.get('top3', []),
            'confidence': result.get('confidence', 0.0),
            'floor': result.get('floor'),
        })
    return predictions, latencies


def _row_item(data_dir, row, subdir):
    path = row.get('_path') or Path(data_dir) / 'dataset' / subdir / row['label'] / row['file']
    return {'path': path, 'true': row['label'], 'video': row.get('video')}


def format_metrics_table(metrics: dict, split: str) -> str:
    """Render the required metrics as a readable plain-text table."""
    lines = [
        f'Metrics ({split} split, n = {metrics["n"]})',
        '-' * 48,
        f'  top-1 spot accuracy : {_pct(metrics["top1_acc"])}',
        f'  top-3 spot accuracy : {_pct(metrics["top3_acc"])}',
        f'  floor accuracy      : {_pct(metrics["floor_acc"])}',
        f'  median graph-dist   : {metrics["median_graph_distance_error_m"]:.2f} m',
        f'  latency p50 / p95   : {metrics["latency"]["p50"]:.0f} / {metrics["latency"]["p95"]:.0f} ms',
    ]
    cal = metrics['calibration']
    lines.append(f'  confidence gate     : {cal["gate"]}')
    lines.append(f'    >= gate           : n={cal["high_conf_n"]} acc={_pct(cal["high_conf_acc"])}')
    lines.append(f'    <  gate           : n={cal["low_conf_n"]} acc={_pct(cal["low_conf_acc"])}')
    lines.append(f'    unsure flags wrong: {_pct(cal["low_conf_correctly_flags_wrong"])}')
    if metrics['confusion']:
        lines.append('  most-mixed spot pairs:')
        for pair in metrics['confusion']:
            lines.append(f'    {pair["true"]} -> {pair["predicted"]} (x{pair["count"]})')
    return '\n'.join(lines)


def _pct(value):
    return 'n/a' if value is None else f'{value * 100:.1f}%'


def go_no_go_line(predictions) -> str:
    """The 3 PM go/no-go verdict: at least 10 photos and >= 70% top-1 correct.

    The rate matters, not the count: 7/100 is a NO-GO (review N09), and fewer
    than 10 photos is not enough evidence to pass.
    """
    correct = sum(1 for p in predictions if _is_correct(p))
    n = len(predictions)
    ok = n >= GO_NO_GO_N and correct * GO_NO_GO_N >= GO_NO_GO_MIN * n
    verdict = 'GO' if ok else 'NO-GO'
    target = f'(target: >= {GO_NO_GO_MIN}/{GO_NO_GO_N} on at least {GO_NO_GO_N} photos)'
    return f'Go/no-go: {correct}/{n} correct {target} -> {verdict}'


# --------------------------------------------------------------------------
# P1 experiments + chart (real-data gated; heavy deps lazy)
# --------------------------------------------------------------------------

def run_experiments(data_dir, out_markdown, metrics_json=None):
    """Produce the P1 experiments table from REAL data (human-blocked).

    Scaffolds the full comparison required by requirements C.4:

    - representations: color-histogram baseline vs CLIP ViT-B/32 vs DINOv2-small
    - k in {1, 5, 10, 20}
    - OCR on vs off
    - corrections learning curve: add held-out photos as corrections one at a
      time, evaluating ONLY on photos not yet in the index
    - a confusion list of the most-mixed spot pairs

    CLIP and the real embedder are imported lazily (approval-gated), so this
    module still imports without them. Numbers come only from ``data/`` inputs;
    nothing is fabricated. Writes ``results/experiments.md`` (with ``n`` beside
    every number) and optionally ``results/metrics.json``.

    Raises ``DataUnavailableError`` when the private data/ inputs are absent
    (the sandbox case): the experiment numbers are human-blocked.
    """
    data_dir = Path(data_dir)
    if not (data_dir / 'graph.json').exists() or not (data_dir / 'test').exists():
        raise DataUnavailableError(
            'Experiments need the private data/ inputs (graph.json, labels.csv, '
            'indexed frames, outsider TEST_*.jpg photos) and approved deps '
            '(torch/transformers for DINOv2, CLIP for the baseline). These are '
            'human-blocked; no numbers are fabricated.')
    # Real-data path (runs only when data + approved deps are present).
    raise NotImplementedError(
        'Experiment execution runs on real private data with approved deps; '
        'wire the approved embedders here when the data lands.')


def render_chart(metrics_json, out_png):
    """Render ONE accuracy chart (never photos) to ``docs/img/accuracy.png``.

    ``matplotlib`` is approval-gated, so it is imported lazily here; the module
    still imports without it. Needs real ``results/metrics.json`` numbers (the
    chart is produced only after a real eval run -- human-blocked).
    """
    metrics_json = Path(metrics_json)
    if not metrics_json.exists():
        raise DataUnavailableError(
            f'{metrics_json} not found. The chart is built from real eval '
            f'numbers (human-blocked); no numbers are fabricated.')
    import matplotlib  # noqa: WPS433 lazy, approval-gated
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt  # noqa: WPS433

    data = json.loads(metrics_json.read_text())
    out_png = Path(out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots()
    labels = list(data.get('accuracy_by_method', {}))
    values = [data['accuracy_by_method'][k] for k in labels]
    ax.bar(labels, values)
    ax.set_ylabel('top-1 accuracy')
    ax.set_title('Recognition accuracy by method')
    fig.savefig(out_png)
    plt.close(fig)
    return out_png


class DataUnavailableError(RuntimeError):
    """Raised when real private data/approved deps are absent (human-blocked)."""


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(
        prog='python -m ml.eval',
        description='Honest evaluation: splits, metrics, go/no-go, experiments. '
                    'Real numbers need the private data/ inputs and approved '
                    'deps (human-blocked in the sandbox).')
    parser.add_argument('--split', choices=('train', 'val', 'test'), default='test',
                        help='Which fixed split to evaluate (default: test).')
    parser.add_argument('--limit', type=int, default=None,
                        help='Evaluate at most N items (go/no-go uses 10).')
    parser.add_argument('--data-dir', default='data',
                        help='Directory with graph.json, labels.csv, dataset/, test/.')
    parser.add_argument('--experiments', metavar='OUT_MD', default=None,
                        help='Run the P1 experiments table, writing this markdown '
                             'file (results/experiments.md). Approval-gated/lazy.')
    parser.add_argument('--metrics-json', metavar='PATH', default=None,
                        help='Where to also write results/metrics.json.')
    parser.add_argument('--chart', metavar='OUT_PNG', default=None,
                        help='Render one accuracy chart (docs/img/accuracy.png) '
                             'from --metrics-json. matplotlib is lazy/approval-gated.')
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    data_dir = Path(args.data_dir)

    # Experiment / chart paths are real-data + approval gated. They import heavy
    # deps lazily and raise a clear human-blocked message when data is absent.
    if args.chart:
        render_chart(args.metrics_json or 'results/metrics.json', args.chart)
        print(f'Wrote chart to {args.chart}')
        return 0
    if args.experiments:
        run_experiments(data_dir, args.experiments, args.metrics_json)
        print(f'Wrote experiments to {args.experiments}')
        return 0

    # Default: evaluate one split and print the metrics table + go/no-go.
    graph = _load_graph(data_dir)
    exclude = ()
    if args.split == 'val':
        # The deployed index holds every video. Scoring held-out runs against it
        # would score frames it already contains (review N01), so val gets its
        # own index built without them.
        _, _, exclude = split_train_val(read_all_labels(data_dir))
    backend = _build_real_backend(data_dir, exclude_videos=exclude)
    predictions, latencies = evaluate_split(data_dir, args.split, backend, graph,
                                             limit=args.limit)
    metrics = compute_metrics(predictions, graph, latencies)
    print(format_metrics_table(metrics, args.split))
    if args.split == 'test':
        print(go_no_go_line(predictions))
    if args.metrics_json:
        out = Path(args.metrics_json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(metrics, indent=2))
        print(f'Wrote {out}')
    return 0


def _build_real_backend(data_dir, exclude_videos=()):
    """Construct the shipped backend (lazily imports torch via DINOv2).

    With ``exclude_videos`` it builds a separate evaluation index without those
    videos (never overwriting the deployed ``index.npz``) and asserts none of
    their frames went in. Kept out of module import so ``--help`` works without
    the heavy deps.
    """
    from ml.backend import create_backend  # local: backend itself is light
    if not exclude_videos:
        return create_backend(data_dir)
    import tempfile

    from ml.build_index import build_index, keep_frames
    from ml.embedder import Dinov2Embedder

    held = {f for frames in keep_frames(data_dir).values() for f in frames} - \
        {f for frames in keep_frames(data_dir, exclude_videos).values() for f in frames}
    embedder = Dinov2Embedder()
    eval_index = Path(tempfile.mkdtemp()) / 'index_eval.npz'
    build_index(data_dir, embed_fn=embedder, exclude_videos=exclude_videos, out_path=eval_index)
    if not held:
        raise LeakageError('Held-out videos contributed no frames; check the split')
    print(f'Evaluation index excludes {len(held)} frames from {sorted(exclude_videos)}')
    return create_backend(data_dir, embedder=embedder, index_path=eval_index)


if __name__ == '__main__':  # pragma: no cover - CLI
    raise SystemExit(main())
