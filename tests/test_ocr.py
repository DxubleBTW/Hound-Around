"""Synthetic-only tests for ml/ocr.py.

No easyocr, no torch, no building photos. ``parse_sign`` and ``select_reading``
are pure functions; :class:`EasyOcrReader` is exercised with an injected fake
``read_fn`` so the preprocessing + multi-candidate picker run without easyocr
installed. Images are generated solid colors.
"""
import numpy as np
from PIL import Image
import pytest

from ml.ocr import (
    EasyOcrReader,
    NullOcrReader,
    parse_sign,
    preprocess_for_ocr,
    select_reading,
)


# --- parse_sign: the required cases ---------------------------------------

@pytest.mark.parametrize('text, expected', [
    ('248', ('248', 2)),
    ('B62', ('B62', -1)),
    ('B64A', ('B64A', -1)),
    ('b64a', ('B64A', -1)),
    ('164', ('164', 1)),
    ('Room 262', ('262', 2)),
    ('B262', ('B262', -1)),
    ('Floor 2', (None, 2)),
    ('Floor 1', (None, 1)),
    ('Lower Level', (None, -1)),
    ('LL', (None, -1)),
    ('Level 1', (None, 1)),
    ('48', (None, None)),          # 2-digit seat count is not a room
    ('305', (None, None)),         # floor 3+ out of scope
    ('999', (None, None)),         # out of scope
    ('Floor 3', (None, None)),     # out of scope
    ('665 Comm Ave', (None, None)),  # street number, first digit 6 -> out
    ('', (None, None)),
])
def test_parse_sign_cases(text, expected):
    assert parse_sign(text) == expected


def test_parse_sign_joins_stray_single_space_only_when_three_digits():
    # Conservative join: "2 48" is one wide sign split by OCR -> "248".
    assert parse_sign('2 48') == ('248', 2)
    # But "48 12" is two unrelated 2-digit runs (4 digits total): no join,
    # neither fragment is a room on its own.
    assert parse_sign('48 12') == (None, None)


def test_parse_sign_digit_confusion_only_inside_room_tokens():
    # O->0 and l/I->1 repaired inside a token that already looks like a room.
    assert parse_sign('2O8') == ('208', 2)
    assert parse_sign('l64') == ('164', 1)
    # A real word is not mangled into digits.
    assert parse_sign('HELLO') == (None, None)
    assert parse_sign('Exit') == (None, None)


# --- select_reading: aggregation / consensus / confidence -----------------

def test_select_reading_prefers_room_over_floor_only():
    detections = [('Floor 2', 0.99), ('248', 0.40)]
    assert select_reading(detections) == ('248', 2)


def test_select_reading_consensus_then_confidence():
    # 262 seen twice beats a single higher-confidence 248.
    detections = [('248', 0.95), ('262', 0.50), ('262', 0.55)]
    assert select_reading(detections) == ('262', 2)


def test_select_reading_confidence_breaks_a_tie():
    # Each room seen once -> highest summed confidence wins.
    detections = [('164', 0.30), ('248', 0.80)]
    assert select_reading(detections) == ('248', 2)


def test_select_reading_falls_back_to_floor_only():
    detections = [('Floor 2', 0.99), ('Exit', 0.80)]
    assert select_reading(detections) == (None, 2)


def test_select_reading_handles_missing_confidence():
    # detail=0 style (no confidence) still aggregates by consensus.
    detections = [('248', None), ('248', None), ('262', None)]
    assert select_reading(detections) == ('248', 2)


def test_select_reading_empty():
    assert select_reading([]) == (None, None)


# --- preprocessing --------------------------------------------------------

def test_preprocess_upscales_and_greyscales():
    image = Image.new('RGB', (40, 30), (128, 64, 32))
    arr = preprocess_for_ocr(image, scale=2)
    assert arr.ndim == 2                       # greyscale
    assert arr.shape == (60, 80)               # 2x upscaled (h, w)
    assert arr.dtype == np.uint8


def test_preprocess_contrast_stretches_to_full_range():
    # A gradient image should stretch to span (nearly) 0..255.
    gradient = np.tile(np.linspace(40, 60, 64, dtype=np.uint8), (16, 1))
    image = Image.fromarray(gradient, mode='L').convert('RGB')
    arr = preprocess_for_ocr(image, scale=1)
    assert arr.min() == 0 and arr.max() == 255


def test_preprocess_is_defensive_on_bad_input():
    class NotAnImage:
        pass
    # Falls back to np.asarray without raising.
    out = preprocess_for_ocr(NotAnImage(), scale=2)
    assert out is not None


# --- EasyOcrReader with an injected fake read_fn (no easyocr) --------------

def _detail1(*triples):
    """Build detail=1 style results: (bbox, text, confidence)."""
    bbox = [[0, 0], [1, 0], [1, 1], [0, 1]]
    return [(bbox, text, conf) for text, conf in triples]


def test_reader_picks_highest_confidence_room():
    captured = {}

    def fake_read(array):
        captured['array'] = array
        return _detail1(('Floor 2', 0.99), ('248', 0.95), ('262', 0.40))

    reader = EasyOcrReader(read_fn=fake_read)
    image = Image.new('RGB', (100, 60), (200, 200, 200))
    room, floor = reader(image)
    assert (room, floor) == ('248', 2)
    # The reader preprocessed the image before reading (greyscale 2d array).
    assert captured['array'].ndim == 2


def test_reader_aggregates_consensus_across_lines():
    def fake_read(array):
        return _detail1(('B62', 0.50), ('B62', 0.55), ('248', 0.95))

    reader = EasyOcrReader(read_fn=fake_read)
    assert reader(Image.new('RGB', (80, 40), 'white')) == ('B62', -1)


def test_reader_floor_only_when_no_room():
    def fake_read(array):
        return _detail1(('Lower Level', 0.90), ('Exit', 0.80))

    reader = EasyOcrReader(read_fn=fake_read)
    assert reader(Image.new('RGB', (80, 40), 'white')) == (None, -1)


def test_reader_handles_detail0_strings():
    def fake_read(array):
        return ['Floor 2', '248']  # detail=0 style: plain strings

    reader = EasyOcrReader(read_fn=fake_read)
    assert reader(Image.new('RGB', (80, 40), 'white')) == ('248', 2)


def test_reader_returns_none_when_nothing_parses():
    reader = EasyOcrReader(read_fn=lambda array: [])
    assert reader(Image.new('RGB', (80, 40), 'white')) == (None, None)


def test_null_reader_is_noop():
    assert NullOcrReader()(Image.new('RGB', (8, 8), 'red')) == (None, None)
