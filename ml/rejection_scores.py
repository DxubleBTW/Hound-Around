"""Collect private rejection scores from validation/known and validation/unrelated.

Uses the API's 512px query preparation and the real embedder/index. Never use
training frames or the final outsider test set to choose a rejection cutoff.
No photos are copied or uploaded; output CSV is private calibration metadata.
"""
import argparse
import csv
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from ml.embedder import Dinov2Embedder, MODEL_NAME
from ml.index import VectorIndex
from ml.rejection import file_digest


EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}


def collect_scores(index, embedder, root, fingerprint):
    rows = []
    for label, directory in ((True, root / 'known'), (False, root / 'unrelated')):
        paths = sorted(path for path in directory.rglob('*') if path.suffix.lower() in EXTENSIONS)
        if not paths:
            raise ValueError(f'No validation images in {directory}')
        for path in paths:
            if path.name.upper().startswith('TEST_'):
                raise ValueError('Do not tune rejection using final TEST_ outsider photos')
            with Image.open(path) as original:
                image = ImageOps.exif_transpose(original).convert('RGB')
            try:
                image.info.clear()
                image.thumbnail((512, 512))
                vector = np.asarray(embedder(image), dtype=np.float32)
                _, neighbors = index.vote(vector, k=1)
                if not neighbors or not np.isfinite(neighbors[0][2]):
                    raise ValueError('Cannot score against an empty or invalid index')
                rows.append({'file': str(path.relative_to(root)), 'similarity': float(np.clip(neighbors[0][2], -1, 1)),
                             'is_known': label, 'split': 'validation', 'index_sha256': fingerprint, 'model': MODEL_NAME})
            finally:
                image.close()
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--validation-root', type=Path, required=True)
    parser.add_argument('--index', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.suffix.lower() != '.csv' or args.output.resolve() == args.index.resolve():
            raise ValueError('Write scores to a separate CSV file; never overwrite the base index')
        index = VectorIndex.load(args.index)
        fingerprint = file_digest(args.index)
        rows = collect_scores(index, Dinov2Embedder(), args.validation_root, fingerprint)
        if file_digest(args.index) != fingerprint:
            raise ValueError('Index changed during scoring; rerun against a stable base index')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('w', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=['file', 'similarity', 'is_known', 'split', 'index_sha256', 'model'])
            writer.writeheader()
            writer.writerows(rows)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(f'Wrote {len(rows)} private validation scores to {args.output}; no test accuracy was measured.')


if __name__ == '__main__':
    main()
