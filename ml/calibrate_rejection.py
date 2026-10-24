"""Choose a recognition cutoff from labeled VALIDATION similarity scores.

Input CSV: similarity,is_known,split,index_sha256,model. Every split must be "validation";
known and unrelated examples must both be present. The output is private
configuration bound to the model and the exact base index, not an accuracy claim.
"""
import argparse
import csv
import json
from pathlib import Path

import numpy as np

from ml.embedder import MODEL_NAME
from ml.rejection import file_digest


def calibrate(rows, max_false_accept=0.05, min_known_recall=0.9):
    if not 0 <= max_false_accept <= 1 or not 0 < min_known_recall <= 1:
        raise ValueError('Invalid calibration targets')
    known, unrelated = [], []
    for row in rows:
        if row.get('split') != 'validation':
            raise ValueError('Only validation scores may tune the rejection threshold')
        score = float(row['similarity'])
        if not np.isfinite(score) or not -1 <= score <= 1:
            raise ValueError('Similarity must be finite and between -1 and 1')
        label = str(row['is_known']).strip().lower()
        if label not in ('true', 'false', '1', '0'):
            raise ValueError('is_known must be true/false or 1/0')
        (known if label in ('true', '1') else unrelated).append(score)
    if not known or not unrelated:
        raise ValueError('Need both known-building and unrelated validation photos')
    # The lowest cutoff satisfying the false-accept budget preserves the most
    # known photos. Equality is accepted by inference, hence nextafter below.
    candidates = sorted({-1.0, *(float(np.nextafter(x, np.inf)) for x in unrelated if x < 1)})
    for threshold in candidates:
        false_accept = sum(x >= threshold for x in unrelated) / len(unrelated)
        recall = sum(x >= threshold for x in known) / len(known)
        if false_accept <= max_false_accept:
            if recall < min_known_recall:
                raise ValueError('Validation scores cannot meet both targets; improve the data/model before enabling rejection')
            return {'min_similarity': threshold, 'known_recall': recall,
                    'unrelated_false_accept': false_accept,
                    'known_count': len(known), 'unrelated_count': len(unrelated)}
    raise ValueError('No valid similarity cutoff meets the requested targets')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scores', type=Path, required=True)
    parser.add_argument('--index', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', default=MODEL_NAME)
    parser.add_argument('--max-false-accept', type=float, default=0.05)
    parser.add_argument('--min-known-recall', type=float, default=0.9)
    args = parser.parse_args(argv)
    try:
        if args.output.suffix.lower() != '.json' or args.output.resolve() in (args.scores.resolve(), args.index.resolve()):
            raise ValueError('Write configuration to a separate JSON file; never overwrite scores or the base index')
        with args.scores.open(newline='') as handle:
            rows = list(csv.DictReader(handle))
        fingerprint = file_digest(args.index)
        if any(row.get('index_sha256') != fingerprint or row.get('model') != args.model for row in rows):
            raise ValueError('Validation scores must match the configured model and exact base index')
        result = calibrate(rows, args.max_false_accept, args.min_known_recall)
        result.update({'model': args.model, 'index_sha256': fingerprint,
                       'split': 'validation', 'max_false_accept_target': args.max_false_accept,
                       'min_known_recall_target': args.min_known_recall})
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))
    print(f'Wrote private rejection configuration to {args.output}. '
          'These validation rates are not held-out test results; evaluate before production use.')


if __name__ == '__main__':
    main()
