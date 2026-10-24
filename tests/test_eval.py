"""Synthetic-only tests for ml/eval.py metric math and the leakage guard.

No torch / CLIP / matplotlib, no real photos. Tiny made-up graphs and a handful
of fake predictions prove the metric math is correct and that the split
boundary guard raises on train/val/test overlap. Reuses the FakeEmbedder /
synthetic_graph patterns from tests/test_ml.py.
"""
from __future__ import annotations

import pytest

from ml.eval import (
    CONFIDENCE_GATE,
    LeakageError,
    assert_no_leakage,
    build_distance_graph,
    calibration,
    compute_metrics,
    confusion_pairs,
    floor_accuracy,
    format_metrics_table,
    go_no_go_line,
    graph_distance,
    latency_percentiles,
    median_graph_distance_error,
    split_train_val,
    top1_accuracy,
    topk_accuracy,
)


# --- synthetic graph with known distances --------------------------------

def eval_graph():
    """A tiny graph with known cost/meters so distances are predictable.

    F1_a --2m-- F1_b --3m-- F1_c   (a chain on floor 1)
    F2_x is isolated on floor 2 (unreachable from floor 1).
    The a->b edge has an explicit cost=2 (routing weights cost else meters).
    """
    return {
        'nodes': [
            {'id': 'F1_a', 'floor': 1},
            {'id': 'F1_b', 'floor': 1},
            {'id': 'F1_c', 'floor': 1},
            {'id': 'F2_x', 'floor': 2},
        ],
        'edges': [
            {'from': 'F1_a', 'to': 'F1_b', 'meters': 5, 'cost': 2},
            {'from': 'F1_b', 'to': 'F1_c', 'meters': 3},
        ],
    }


def pred(true, ranked, confidence=1.0, floor=None):
    """Build a prediction dict: ranked is a list of spots votes-descending."""
    top3 = [{'spot': s, 'votes': len(ranked) - i} for i, s in enumerate(ranked)]
    out = {'true': true, 'top3': top3, 'confidence': confidence}
    if floor is not None:
        out['floor'] = floor
    return out


# --- graph distance (physical meters) -------------------------------------

def test_graph_distance_is_meters_not_routing_cost():
    distance = build_distance_graph(eval_graph())
    # a->b is 5 m even though its routing cost is 2: cost is a penalty, not
    # distance, so it must never be reported as meters of error (review N10).
    assert graph_distance(distance, 'F1_a', 'F1_b') == pytest.approx(5.0)
    assert graph_distance(distance, 'F1_b', 'F1_c') == pytest.approx(3.0)
    assert graph_distance(distance, 'F1_a', 'F1_c') == pytest.approx(8.0)
    assert graph_distance(distance, 'F1_a', 'F1_a') == 0.0


def test_graph_distance_unreachable_is_inf():
    distance = build_distance_graph(eval_graph())
    assert graph_distance(distance, 'F1_a', 'F2_x') == float('inf')
    assert graph_distance(distance, 'F1_a', 'NOPE') == float('inf')


# --- top-1 / top-3 / floor accuracy --------------------------------------

def test_top1_and_top3_accuracy():
    predictions = [
        pred('F1_a', ['F1_a', 'F1_b']),          # top-1 hit
        pred('F1_b', ['F1_a', 'F1_b', 'F1_c']),  # top-1 miss, top-3 hit
        pred('F1_c', ['F1_a', 'F1_b']),          # miss both (c not in top3)
    ]
    assert top1_accuracy(predictions) == pytest.approx(1 / 3)
    assert topk_accuracy(predictions, 3) == pytest.approx(2 / 3)
    assert topk_accuracy(predictions, 1) == pytest.approx(1 / 3)


def test_floor_accuracy_prefers_predicted_floor():
    node_floor = {n['id']: n['floor'] for n in eval_graph()['nodes']}
    predictions = [
        pred('F1_a', ['F1_a'], floor=1),   # predicted floor 1 == true floor 1
        pred('F2_x', ['F1_a'], floor=2),   # OCR-overridden floor 2 == true floor 2
        pred('F1_c', ['F2_x'], floor=2),   # predicted floor 2 != true floor 1
    ]
    assert floor_accuracy(predictions, node_floor) == pytest.approx(2 / 3)


def test_floor_accuracy_falls_back_to_winning_spot():
    node_floor = {n['id']: n['floor'] for n in eval_graph()['nodes']}
    # No explicit 'floor' -> use the rank-1 spot's floor.
    predictions = [pred('F1_a', ['F1_b']), pred('F2_x', ['F2_x'])]
    assert floor_accuracy(predictions, node_floor) == pytest.approx(1.0)


# --- median graph-distance error -----------------------------------------

def test_median_graph_distance_error():
    distance = build_distance_graph(eval_graph())
    predictions = [
        pred('F1_a', ['F1_a']),   # correct -> 0 m
        pred('F1_c', ['F1_b']),   # off by one hop -> 3 m
        pred('F1_c', ['F1_a']),   # two hops -> 5 m
    ]
    # Sorted errors: [0, 3, 5] -> median 3.
    assert median_graph_distance_error(predictions, distance) == pytest.approx(3.0)


def test_median_counts_unreachable_as_inf():
    distance = build_distance_graph(eval_graph())
    predictions = [
        pred('F1_a', ['F1_a']),   # 0
        pred('F2_x', ['F1_a']),   # unreachable -> inf
    ]
    # Median of [0, inf] averages the two middle values -> inf.
    assert median_graph_distance_error(predictions, distance) == float('inf')


# --- latency percentiles --------------------------------------------------

def test_latency_percentiles():
    latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
    pct = latency_percentiles(latencies)
    assert pct['p50'] == pytest.approx(550.0)
    assert pct['p95'] == pytest.approx(955.0)
    assert latency_percentiles([])['p50'] == 0.0
    assert latency_percentiles([42])['p95'] == pytest.approx(42.0)


# --- calibration buckets --------------------------------------------------

def test_calibration_buckets_and_flagging():
    predictions = [
        pred('F1_a', ['F1_a'], confidence=0.9),  # high conf, correct
        pred('F1_b', ['F1_a'], confidence=0.8),  # high conf, WRONG
        pred('F1_c', ['F1_a'], confidence=0.4),  # low conf, wrong (correctly unsure)
        pred('F1_a', ['F1_a'], confidence=0.2),  # low conf, correct (unsure but right)
        pred('F1_b', ['F1_a'], confidence=0.5),  # low conf, wrong (correctly unsure)
    ]
    cal = calibration(predictions)
    assert cal['gate'] == CONFIDENCE_GATE
    assert cal['high_conf_n'] == 2
    assert cal['high_conf_acc'] == pytest.approx(0.5)
    assert cal['low_conf_n'] == 3
    assert cal['low_conf_acc'] == pytest.approx(1 / 3)
    # Of the 3 low-confidence items, 2 were actually wrong -> correctly flagged.
    assert cal['low_conf_correctly_flags_wrong'] == pytest.approx(2 / 3)


def test_calibration_empty_buckets_are_none():
    cal = calibration([pred('F1_a', ['F1_a'], confidence=0.9)])
    assert cal['low_conf_n'] == 0
    assert cal['low_conf_acc'] is None
    assert cal['low_conf_correctly_flags_wrong'] is None


# --- confusion list -------------------------------------------------------

def test_confusion_pairs_most_mixed_first():
    predictions = [
        pred('F1_a', ['F1_b']),  # a confused for b
        pred('F1_a', ['F1_b']),  # a confused for b again
        pred('F1_c', ['F1_b']),  # c confused for b
        pred('F1_a', ['F1_a']),  # correct -> not counted
    ]
    pairs = confusion_pairs(predictions)
    assert pairs[0] == {'true': 'F1_a', 'predicted': 'F1_b', 'count': 2}
    assert {'true': 'F1_c', 'predicted': 'F1_b', 'count': 1} in pairs


# --- bundled metrics + table + go/no-go ----------------------------------

def test_compute_metrics_and_table_render():
    predictions = [
        pred('F1_a', ['F1_a'], confidence=0.9, floor=1),
        pred('F1_c', ['F1_b'], confidence=0.5, floor=1),
    ]
    metrics = compute_metrics(predictions, eval_graph(), latencies_ms=[100, 300])
    assert metrics['n'] == 2
    assert metrics['top1_acc'] == pytest.approx(0.5)
    assert metrics['median_graph_distance_error_m'] == pytest.approx(1.5)
    table = format_metrics_table(metrics, 'val')
    assert 'top-1 spot accuracy' in table
    assert 'median graph-dist' in table
    assert 'n = 2' in table


def test_go_no_go_line():
    good = [pred('F1_a', ['F1_a'])] * 7 + [pred('F1_b', ['F1_a'])] * 3
    bad = [pred('F1_a', ['F1_a'])] * 6 + [pred('F1_b', ['F1_a'])] * 4
    assert 'GO' in go_no_go_line(good) and 'NO-GO' not in go_no_go_line(good)
    assert 'NO-GO' in go_no_go_line(bad)


# --- split boundary + leakage guard --------------------------------------

def labels_rows():
    """Two floors, two videos each; one run per floor is the held-out val."""
    return [
        {'label': 'F1_a', 'video': 'F1_run1', 'file': 'a1.jpg', 'status': 'keep'},
        {'label': 'F1_b', 'video': 'F1_run1', 'file': 'b1.jpg', 'status': 'keep'},
        {'label': 'F1_a', 'video': 'F1_run2', 'file': 'a2.jpg', 'status': 'keep'},
        {'label': 'B1_d', 'video': 'B1_run1', 'file': 'd1.jpg', 'status': 'keep'},
        {'label': 'B1_d', 'video': 'B1_run2', 'file': 'd2.jpg', 'status': 'keep'},
    ]


def test_split_holds_out_one_run_per_floor():
    train, val, val_videos = split_train_val(labels_rows())
    # Last video per floor is held out deterministically.
    assert val_videos == {'F1_run2', 'B1_run2'}
    assert all(r['video'] in val_videos for r in val)
    assert all(r['video'] not in val_videos for r in train)
    # No video appears in both splits.
    assert not ({r['video'] for r in train} & {r['video'] for r in val})


def test_leakage_guard_passes_on_clean_outsider_photos():
    train, val, _ = split_train_val(labels_rows())
    # Outsider stills have no video provenance.
    test_items = [
        {'path': 'TEST_F1_a_01.jpg', 'true': 'F1_a', 'video': None},
        {'path': 'TEST_B1_d_02.jpg', 'true': 'B1_d', 'video': None},
    ]
    # Should not raise.
    assert_no_leakage(train, val, test_items) is None


def test_leakage_guard_raises_when_test_photo_came_from_training_video():
    train, val, _ = split_train_val(labels_rows())
    # A "test" photo that is really a frame from a training video.
    leaking = [{'path': 'TEST_F1_a_09.jpg', 'true': 'F1_a', 'video': 'F1_run1'}]
    with pytest.raises(LeakageError, match='trace back to training'):
        assert_no_leakage(train, val, leaking)


def test_leakage_guard_raises_when_train_and_val_share_a_video():
    train = [{'label': 'F1_a', 'video': 'F1_run1', 'file': 'a.jpg'}]
    val = [{'label': 'F1_a', 'video': 'F1_run1', 'file': 'b.jpg'}]  # same video!
    with pytest.raises(LeakageError, match='share video run'):
        assert_no_leakage(train, val, [])


# --- review regressions (N08, N09) ----------------------------------------

def test_go_no_go_needs_rate_and_sample_size():
    # N09: 7/100 used to print GO.
    hit, miss = pred('F1_a', ['F1_a']), pred('F1_b', ['F1_a'])
    assert 'NO-GO' not in go_no_go_line([hit] * 7 + [miss] * 3)
    assert 'NO-GO' in go_no_go_line([hit] * 6 + [miss] * 4)
    assert 'NO-GO' in go_no_go_line([hit] * 7 + [miss] * 93)
    assert 'NO-GO' in go_no_go_line([hit] * 7)  # fewer than 10 photos
    assert 'NO-GO' not in go_no_go_line([hit] * 14 + [miss] * 6)


def test_metrics_score_the_final_spot_not_top3_head():
    # N08: after an OCR override the app's spot can differ from top3[0].
    fixed = pred('F2_x', ['F1_a', 'F2_x'])
    fixed['spot'] = 'F2_x'
    broken = pred('F1_a', ['F1_a', 'F2_x'])
    broken['spot'] = 'F2_x'
    assert top1_accuracy([fixed]) == 1.0
    assert top1_accuracy([broken]) == 0.0
