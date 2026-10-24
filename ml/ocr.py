"""Room-sign OCR backup (EasyOCR), gated and injectable.

Reads 3-digit room numbers and floor numerals from a sign in the photo. The
floor numeral maps per design.md §4 / steering ml.md:

- ``2xx`` -> floor 2
- ``Bxx`` -> floor -1 (B1)
- otherwise (``1xx``) -> floor 1

Anything out of scope is ignored. ``easyocr`` is imported **lazily** inside
:class:`EasyOcrReader`, so this module imports without it. A reader is any
callable ``reader(image) -> (ocr_room: str | None, ocr_floor: int | None)``.
Tests inject a fake reader (or ``None`` for a no-op).
"""
from __future__ import annotations

import re

# Room numbers: B + 2-3 digits for the basement (B62, B64A), else 3 digits.
# A bare 2-digit number (seat counts, "48") is never a room (review N04).
_ROOM_RE = re.compile(r'\b(?:([Bb])(\d{2,3})|(\d{3}))([A-Da-d])?\b')
# Floor signage: "Floor 2", "Level 1", "Lower Level", "LL".
_FLOOR_RE = re.compile(r'\b(?:(?:floor|level)\s*([12])|(lower\s*level|LL))\b', re.IGNORECASE)


def parse_sign(text: str):
    """Parse OCR text into ``(room, floor)`` or ``(None, None)`` if out of scope.

    ``B62 -> ('B62', -1)``, ``B262 -> ('B262', -1)``, ``248 -> ('248', 2)``,
    ``164 -> ('164', 1)``, ``Floor 2 -> (None, 2)``, ``Lower Level -> (None, -1)``.
    """
    text = text or ''
    for match in _ROOM_RE.finditer(text):
        basement, b_digits, digits, suffix = match.groups()
        suffix = (suffix or '').upper()
        if basement:
            return f'B{b_digits}{suffix}', -1
        if digits[0] == '2':
            return digits + suffix, 2
        if digits[0] == '1':
            return digits + suffix, 1
        # first digit 0/3-9 with no B prefix: out of scope, keep scanning.
    match = _FLOOR_RE.search(text)
    if match:
        return None, int(match.group(1)) if match.group(1) else -1
    return None, None


class NullOcrReader:
    """No-op reader used when easyocr is unavailable or OCR is disabled."""

    def __call__(self, image):
        return None, None


class EasyOcrReader:
    """EasyOCR-backed reader. Imports ``easyocr`` lazily at construction."""

    def __init__(self, languages=('en',), gpu: bool = False):
        import easyocr  # noqa: WPS433 (lazy heavy import)

        self._reader = easyocr.Reader(list(languages), gpu=gpu)

    def __call__(self, image):
        import numpy as np

        # EasyOCR expects a numpy array / path; never retain the array.
        texts = self._reader.readtext(np.asarray(image), detail=0)
        floor_only = None
        for text in texts:
            room, floor = parse_sign(str(text))
            if room is not None:
                return room, floor
            if floor is not None and floor_only is None:
                floor_only = floor
        return None, floor_only
