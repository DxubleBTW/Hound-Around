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

# 3-digit room numbers, optional leading floor letter (B for basement).
_ROOM_RE = re.compile(r'\b([Bb]?)(\d{3})\b')


def parse_sign(text: str):
    """Parse OCR text into ``(room, floor)`` or ``(None, None)`` if out of scope.

    ``B262 -> ('B262', -1)``, ``248 -> ('248', 2)``, ``164 -> ('164', 1)``.
    """
    for match in _ROOM_RE.finditer(text or ''):
        letter, digits = match.group(1).upper(), match.group(2)
        first = digits[0]
        if letter == 'B':
            return f'B{digits}', -1
        if first == '2':
            return digits, 2
        if first == '1':
            return digits, 1
        # first digit 0/3-9 with no B prefix: out of scope, keep scanning.
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
        for text in texts:
            room, floor = parse_sign(str(text))
            if room is not None:
                return room, floor
        return None, None
