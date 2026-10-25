"""Fit or evaluate confidence on a private, session-separated photo manifest.

CSV columns: file,spot,session,split (validation or holdout). Paths are relative
to the CSV directory. Only validation fits; holdout evaluates a frozen model.
Outputs stay private. No scikit-learn dependency or image uploads are needed.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

import networkx as nx
import numpy as np
from PIL import Image, ImageOps

from api.routing import Router
from ml.artifacts import recognition_context
from ml.backend import create_backend
from ml.calibration import FEATURES, HIGH, LOW, TARGET, Model, model_from_config
from ml.rejection import file_digest


def fit(features, targets, regularization=0.01, iterations=3000):
    """Deterministic L2-regularized logistic fit with a bounded gradient step."""
    x = np.asarray(features, dtype=np.float64)
    y = np.asarray(targets, dtype=np.float64)
    if (x.ndim != 2 or x.shape[1] != len(FEATURES) or y.shape != (len(x),)
            or not np.isfinite(x).all() or not np.isfinite(y).all()
            or set(y.tolist()) != {0, 1}):
        raise ValueError('Need finite feature rows and both correct/incorrect validation examples')
    design = np.column_stack((np.ones(len(x)), x))
    weights = np.zeros(design.shape[1])
    # A global Lipschitz bound makes this fixed step monotonic for this objective.
    step = 1 / (np.linalg.norm(design, ord=2) ** 2 / (4 * len(x)) + regularization)
    for _ in range(iterations):
        z = np.clip(design @ weights, -500, 500)
        probability = 1 / (1 + np.exp(-z))
        penalty = regularization * weights
        penalty[0] = 0
        gradient = design.T @ (probability - y) / len(x) + penalty
        weights -= step * gradient
        if np.linalg.norm(gradient, ord=np.inf) < 1e-8:
            break
    return Model(tuple(weights[1:].tolist()), float(weights[0]))


def collect(manifest, backend, router, split):
    with manifest.open(newline='') as handle:
        entries = list(csv.DictReader(handle))
    if not entries:
        raise ValueError('Photo manifest is empty')
    results, sessions, digests = [], set(), set()
    for entry in entries:
        if entry.get('split') != split or not entry.get('session', '').strip():
            raise ValueError('Every photo must have the requested split and a photographer/session group')
        path = manifest.parent / entry['file']
        if split == 'validation' and path.name.upper().startswith('TEST_'):
            raise ValueError('Final outsider TEST_ photos must not tune calibration')
        truth = entry['spot']
        if truth not in router.nodes:
            raise ValueError('Unknown ground-truth spot')
        digest = file_digest(path)
        if digest in digests:
            raise ValueError('Duplicate photo content in manifest')
        digests.add(digest)
        sessions.add(hashlib.sha256(entry['session'].strip().encode()).hexdigest())
        captured = []
        backend.feature_observer = captured.append
        with Image.open(path) as original:
            image = ImageOps.exif_transpose(original).convert('RGB')
        try:
            image.info.clear()
            image.thumbnail((512, 512))
            prediction = backend.locate(image)
        finally:
            image.close()
            backend.feature_observer = None
        same_floor = prediction['floor'] == router.nodes[truth]['floor']
        distance = math.inf
        if same_floor:
            floor_graph = router.graph.subgraph([node for node, attrs in router.nodes.items()
                                                if attrs['floor'] == prediction['floor']])
            try:
                distance = nx.shortest_path_length(floor_graph, truth, prediction['spot'], weight='meters')
            except nx.NetworkXNoPath:
                pass
        results.append({'features': captured[0], 'correct': same_floor and distance <= 10,
                        'exact': prediction['spot'] == truth, 'same_floor': same_floor})
    return results, sessions, digests


def report(results, model):
    count = len(results)
    if not count:
        raise ValueError('Evaluation needs photos')
    tiers = {'auto': 0, 'picker': 0, 'second': 0}
    wrong_floor = wrong_near = 0
    probabilities, targets = [], []
    for row in results:
        p = model.predict(row['features'])
        action = model.tier(p, bool(row['features']['span']))
        tiers[action] += 1
        wrong_floor += action == 'auto' and not row['same_floor']
        wrong_near += action == 'auto' and not row['correct']
        probabilities.append(p)
        targets.append(float(row['correct']))
    return {'count': count, 'exact_spot_rate': sum(r['exact'] for r in results) / count,
            'right_floor_rate': sum(r['same_floor'] for r in results) / count,
            'within_10m_same_floor_rate': sum(r['correct'] for r in results) / count,
            'brier_score': float(np.mean((np.asarray(probabilities) - targets) ** 2)),
            'tier_counts': tiers, 'auto_wrong_floor_count': wrong_floor,
            'auto_wrong_floor_rate': wrong_floor / tiers['auto'] if tiers['auto'] else None,
            'auto_wrong_location_count': wrong_near,
            'auto_wrong_location_rate': wrong_near / tiers['auto'] if tiers['auto'] else None}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--evaluate', type=Path, help='Frozen confidence.json; requires holdout manifest')
    args = parser.parse_args(argv)
    try:
        protected = [args.manifest, *(args.data_dir / name for name in ('index.npz', 'graph.json', 'rooms.json', 'recognition.json'))]
        if args.evaluate:
            protected.append(args.evaluate)
        if args.output.suffix != '.json' or args.output.resolve() in [p.resolve() for p in protected]:
            raise ValueError('Output must be a separate JSON file, not an input artifact')
        backend = create_backend(args.data_dir, load_configuration=False)
        context = recognition_context(args.data_dir, model=backend.model_name)
        router = Router(json.loads((args.data_dir / 'graph.json').read_text()),
                        json.loads((args.data_dir / 'rooms.json').read_text()))
        frozen = json.loads(args.evaluate.read_text()) if args.evaluate else None
        model = model_from_config(frozen, context) if frozen is not None else None
        results, sessions, digests = collect(args.manifest, backend, router, 'holdout' if args.evaluate else 'validation')
        if frozen is not None:
            if sessions & set(frozen['training_sessions']) or digests & set(frozen['training_images']):
                raise ValueError('Holdout overlaps calibration sessions or exact photo content')
            output = {'split': 'holdout', 'context': context, 'target': TARGET, **report(results, model)}
        else:
            if len(sessions) < 2:
                raise ValueError('Calibration requires at least two photographer/session groups')
            model = fit([[r['features'][name] for name in FEATURES] for r in results], [r['correct'] for r in results])
            output = {'schema_version': 1, 'context': context, 'target': TARGET, 'features': list(FEATURES),
                      'split': 'validation', 'coefficients': list(model.coefficients), 'intercept': model.intercept,
                      'low': LOW, 'high': HIGH, 'training_sessions': sorted(sessions), 'training_images': sorted(digests),
                      'validation_report': report(results, model)}
        if recognition_context(args.data_dir, model=backend.model_name) != context:
            raise ValueError('Data changed during calibration/evaluation')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, indent=2) + '\n')
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    print('Wrote private confidence artifact/report. Validation fit is not held-out accuracy.')


if __name__ == '__main__':
    main()
