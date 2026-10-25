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

FEATURES = ('confidence', 'share', 'top_sim', 'margin', 'span')
COEF = (2.137558913667877, 0.6220559724173725, 2.3117075631629933, 1.9106218983049001, -0.6386799672003874)
INTERCEPT = -3.1504313013822904
LOW, HIGH = 0.5, 0.7


def p_correct(features: dict) -> float:
    z = INTERCEPT + sum(c * float(features[name]) for c, name in zip(COEF, FEATURES))
    return 1 / (1 + math.exp(-z))


def tier(p: float, span: bool) -> str:
    """Auto when sure and the top 3 agree on the floor; picker in the middle; else ask for a second photo."""
    if p >= HIGH and not span:
        return 'auto'
    return 'picker' if p >= LOW else 'second'
