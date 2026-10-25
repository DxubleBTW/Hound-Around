"""Versioned confidence and the three-tier flow (auto / picker / second photo).

Production uses a private, fingerprint-checked confidence.json. Constants below
are a legacy research baseline, not a fallback calibration for changed decisions.

Fit by ``ml/research/calibrate.py``: a logistic model, out-of-fold leave-one-video-out on 2,914 at-spot frames
(Sun Oct 25), predicting whether the returned spot is right (within 10 m on the right floor). Raw vote share was
not calibrated; this is. Tiers measured on the same frames, with the second photo simulated by another frame of
the same spot >= 3 s away in the held-out video:

    LOW 0.5, HIGH 0.7: auto 42% of photos (85% right), picker 30%, second photo 28%;
    user success 73.0% vs 68.1% for the old rule (picker below 0.6 or when floors split).

These historical measurements do not apply to the revised OCR decision path.
Refit/evaluate with ml.research.calibrate_confidence; never fit on outsider test photos.
"""
import math
from ml.embedder import MEGALOC_MODEL_NAME
import json
import logging
from dataclasses import dataclass

from ml.artifacts import recognition_context

TARGET = 'within_10m_same_floor'

FEATURES = ('confidence', 'share', 'top_sim', 'margin', 'span')
COEF = (2.137558913667877, 0.6220559724173725, 2.3117075631629933, 1.9106218983049001, -0.6386799672003874)
INTERCEPT = -3.1504313013822904
LOW, HIGH = 0.5, 0.7
MEGALOC_COEF = (5.049213420408608, -2.922677769661306, 2.1227797738819074,
                4.277558925946516, -0.6522046131197158)
MEGALOC_INTERCEPT = -1.7547274933582615
# Full-width single-view MegaLoc, n=1758 held-out-video queries, production
# graph/room OCR handling. LOW/HIGH unchanged: auto 63.4% (91.4% near),
# picker 22.8%, second 13.8%; simulated user success 84.1%. This is not an
# independent-user study. PCA variants require their own calibration.


def coefficients(model_name=None):
    if model_name == MEGALOC_MODEL_NAME:
        return MEGALOC_COEF, MEGALOC_INTERCEPT
    if model_name and model_name.startswith('gmberton/MegaLoc'):
        raise ValueError('This MegaLoc descriptor needs its own confidence calibration')
    return COEF, INTERCEPT


def p_correct(features: dict, model_name=None) -> float:
    """Legacy research baseline; production loads a fingerprinted Model."""
    coef, intercept = coefficients(model_name)
    z = intercept + sum(c * float(features[name]) for c, name in zip(coef, FEATURES))
    return 1 / (1 + math.exp(-z))


def tier(p: float, span: bool) -> str:
    """Auto when sure and the top 3 agree on the floor; picker in the middle; else ask for a second photo."""
    if p >= HIGH and not span:
        return 'auto'
    return 'picker' if p >= LOW else 'second'


@dataclass(frozen=True)
class Model:
    coefficients: tuple
    intercept: float
    low: float = LOW
    high: float = HIGH

    def predict(self, features):
        values = [float(features[name]) for name in FEATURES]
        if not all(math.isfinite(value) for value in values):
            raise ValueError('Nonfinite confidence features')
        z = self.intercept + sum(c * value for c, value in zip(self.coefficients, values))
        # Stable sigmoid for either sign, including extreme but finite logits.
        return 1 / (1 + math.exp(-z)) if z >= 0 else math.exp(z) / (1 + math.exp(z))

    def tier(self, probability, span):
        if probability >= self.high and not span:
            return 'auto'
        return 'picker' if probability >= self.low else 'second'


def model_from_config(config, context):
    if (not isinstance(config, dict) or config.get('schema_version') != 1
            or config.get('context') != context or config.get('target') != TARGET
            or config.get('features') != list(FEATURES) or config.get('split') != 'validation'):
        raise ValueError('Confidence calibration does not match this decision/model/index/graph/rooms; refit it')
    try:
        coefficients = config['coefficients']
        values = [*coefficients, config['intercept'], config['low'], config['high']]
        if (len(coefficients) != len(FEATURES)
                or any(isinstance(value, bool) or not isinstance(value, (int, float))
                       or not math.isfinite(value) for value in values)
                or not 0 < config['low'] < config['high'] < 1):
            raise ValueError('Invalid confidence coefficients or tier thresholds')
        return Model(tuple(coefficients), config['intercept'], config['low'], config['high'])
    except (KeyError, TypeError):
        raise ValueError('Invalid confidence configuration') from None


def load_model(data_dir, index_path, model_name):
    path = data_dir / 'confidence.json'
    if not path.exists():
        logging.getLogger(__name__).warning('Confidence calibration is absent; automatic starts are disabled')
        return None
    return model_from_config(json.loads(path.read_text()), recognition_context(data_dir, index_path, model_name))
