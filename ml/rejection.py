"""Load a validated similarity cutoff; never invent one for a building."""
import hashlib
import json
import math
import logging
import os

from ml.embedder import MODEL_NAME


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def threshold_value(value):
    if isinstance(value, bool):
        raise ValueError('Recognition threshold must be a number, not a boolean')
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError('Recognition threshold must be a finite number') from None
    if not math.isfinite(value) or not -1 <= value <= 1:
        raise ValueError('Recognition threshold must be finite and between -1 and 1')
    return value


def load_threshold(data_dir, index_path, model=MODEL_NAME):
    override = os.getenv('HOUND_MIN_SIMILARITY')
    if override is not None:
        return threshold_value(override)
    config_path = data_dir / 'recognition.json'
    if not config_path.exists():
        logging.getLogger(__name__).warning(
            'Unrecognized-photo rejection is not configured. Calibrate recognition.json before enabling this guard.')
        return None
    config = json.loads(config_path.read_text())
    if not isinstance(config, dict) or 'min_similarity' not in config:
        raise ValueError('Recognition configuration is missing a similarity threshold')
    if config.get('model') != model or config.get('index_sha256') != file_digest(index_path):
        raise ValueError('Recognition threshold does not match this model/index; recalibrate it')
    return threshold_value(config['min_similarity'])
