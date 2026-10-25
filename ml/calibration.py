"""Calibrated confidence and the three-tier flow (auto pick / picker / second photo).

Fit by ``ml/research/calibrate.py``: a logistic model, out-of-fold leave-one-video-out on 2,914 at-spot frames
(Sun Oct 25), predicting whether the returned spot is right (within 10 m on the right floor). Raw vote share was
not calibrated; this is. Tiers measured on the same frames, with the second photo simulated by another frame of
the same spot >= 3 s away in the held-out video:

    LOW 0.5, HIGH 0.7: auto 42% of photos (85% right), picker 30%, second photo 28%;
    user success 73.0% vs 68.1% for the old rule (picker below 0.6 or when floors split).

Refit and update these numbers together when the index or model changes. Never fit on outsider test photos.
"""
import math
from ml.embedder import MEGALOC_MODEL_NAME

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
    coef, intercept = coefficients(model_name)
    z = intercept + sum(c * float(features[name]) for c, name in zip(coef, FEATURES))
    return 1 / (1 + math.exp(-z))


def tier(p: float, span: bool) -> str:
    """Auto when sure and the top 3 agree on the floor; picker in the middle; else ask for a second photo."""
    if p >= HIGH and not span:
        return 'auto'
    return 'picker' if p >= LOW else 'second'
