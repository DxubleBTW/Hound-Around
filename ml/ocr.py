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

Signs are small in a 512px hallway shot, so :class:`EasyOcrReader` upscales and
grey/contrast-stretches the image before ``readtext`` (PIL/numpy only), asks
EasyOCR for per-detection confidences (``detail=1``), parses **every** line,
and picks the best candidate (a full room beats a floor-only read; among rooms
the highest-confidence valid room wins). The user image is never retained.
"""
from __future__ import annotations

import re

# Room numbers: B + 2-3 digits for the basement (B62, B64A), else 3 digits.
# A bare 2-digit number (seat counts, "48") is never a room (review N04).
_ROOM_RE = re.compile(r'\b(?:([Bb])(\d{2,3})|(\d{3}))([A-Da-d])?\b')
# Floor signage: "Floor 2", "Level 1", "Lower Level", "LL".
_FLOOR_RE = re.compile(r'\b(?:(?:floor|level)\s*([12])|(lower\s*level|LL))\b', re.IGNORECASE)

# Common OCR digit confusions, applied ONLY inside a token that already looks
# like a room (e.g. "B6A" alongside digits, "2O8" -> "208"). Never global.
_DIGIT_FIX = {'O': '0', 'o': '0', 'D': '0', 'l': '1', 'I': '1', '|': '1',
              'S': '5', 'B': '8'}
# A candidate room token before confusion-repair: optional B, then 2-4 glyphs
# that are digits or digit-look-alikes, then an optional A-D suffix. We only
# apply confusion fixes when the raw glob is "almost" a room already so random
# words are not mangled into numbers.
_ROOM_CANDIDATE_RE = re.compile(
    r'\b([Bb])?([0-9OoDlI|SB]{2,4})([A-Da-d])?\b')


def _repair_token(token: str) -> str:
    """Map digit-look-alike glyphs to digits within a candidate room token."""
    return ''.join(_DIGIT_FIX.get(ch, ch) for ch in token)


def _normalize_room_text(text: str) -> str:
    """Repair digit-confusions inside room-looking tokens, leave the rest.

    Also joins a stray single space inside an otherwise-3-digit run ("2 48" ->
    "248") because EasyOCR sometimes splits a wide sign, but only when the two
    fragments are purely digits and together form exactly three digits -- a
    conservative join that will not merge unrelated numbers.
    """
    text = text or ''
    # Conservative "2 48" -> "248" join: a 1-or-2 digit run, a single space,
    # then a run that completes it to exactly three digits.
    text = re.sub(r'\b(\d{1,2})\s(\d{1,2})\b',
                  lambda m: m.group(1) + m.group(2)
                  if len(m.group(1)) + len(m.group(2)) == 3 else m.group(0),
                  text)

    def _fix(match):
        prefix, body, suffix = match.groups()
        repaired = _repair_token(body)
        if not repaired.isdigit():
            return match.group(0)  # not actually a number; leave untouched.
        return (prefix or '') + repaired + (suffix or '')

    return _ROOM_CANDIDATE_RE.sub(_fix, text)


def parse_sign(text: str):
    """Parse OCR text into ``(room, floor)`` or ``(None, None)`` if out of scope.

    ``B62 -> ('B62', -1)``, ``B262 -> ('B262', -1)``, ``248 -> ('248', 2)``,
    ``164 -> ('164', 1)``, ``Floor 2 -> (None, 2)``, ``Lower Level -> (None, -1)``.

    Pure function: no easyocr, so it is trivially unit-tested. Digit-confusion
    repair (O->0, l/I->1, ...) is applied only inside tokens that already look
    like a room, never across the whole string, so posters/clocks are not
    turned into rooms. A bare 2-digit number stays a non-room (seat counts).
    """
    text = _normalize_room_text(text)
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


def select_reading(detections):
    """Pick the best ``(room, floor)`` from OCR detections.

    ``detections`` is an iterable of ``(text, confidence)`` pairs (confidence
    may be ``None`` when unavailable). Selection rule:

    - A full room match always beats a floor-only read.
    - Among rooms, prefer the one seen most often; break ties by the highest
      summed OCR confidence. (Consensus first, confidence second: a number the
      camera saw twice is more trustworthy than a single high-confidence read.)
    - If no room is found, return the first floor-only read.

    Returns ``(room, floor)``; ``(None, None)`` when nothing parses.
    """
    room_votes: dict = {}
    floor_only = None
    for text, conf in detections:
        room, floor = parse_sign(str(text))
        weight = float(conf) if conf is not None else 1.0
        if room is not None:
            bucket = room_votes.setdefault(room, {'floor': floor, 'count': 0, 'conf': 0.0})
            bucket['count'] += 1
            bucket['conf'] += max(weight, 0.0)
        elif floor is not None and floor_only is None:
            floor_only = floor
    if room_votes:
        room = max(room_votes,
                   key=lambda r: (room_votes[r]['count'], room_votes[r]['conf']))
        return room, room_votes[room]['floor']
    return None, floor_only


def preprocess_for_ocr(image, scale: int = 2):
    """Upscale + greyscale + contrast-stretch a PIL image for small-digit OCR.

    Returns a numpy uint8 array (greyscale). PIL/numpy only -- no opencv /
    scikit-image. Small door-sign digits in a 512px hallway shot gain recall
    from the larger, higher-contrast input. Defensive: any failure falls back
    to a plain array of the original image so OCR still runs.
    """
    import numpy as np
    from PIL import Image

    try:
        grey = image.convert('L')
        if scale and scale > 1:
            grey = grey.resize((grey.width * scale, grey.height * scale), Image.BICUBIC)
        arr = np.asarray(grey, dtype=np.float32)
        lo, hi = float(arr.min()), float(arr.max())
        if hi > lo:
            arr = (arr - lo) * (255.0 / (hi - lo))  # stretch to full 0..255.
        return arr.astype(np.uint8)
    except Exception:
        return np.asarray(image)


# Characters worth keeping for room/floor signs; cuts background noise. EasyOCR
# accepts an ``allowlist`` to readtext; we pass it defensively and fall back if
# the installed version rejects the kwarg.
_ALLOWLIST = '0123456789BbAaCcDdLlFfEeVvOoRr '


class NullOcrReader:
    """No-op reader used when easyocr is unavailable or OCR is disabled."""

    def __call__(self, image):
        return None, None


class EasyOcrReader:
    """EasyOCR-backed reader. Imports ``easyocr`` lazily at construction.

    ``__call__`` preprocesses the image (upscale + grey + contrast), runs
    ``readtext`` with per-detection confidences, parses every line, and returns
    the best ``(room, floor)`` via :func:`select_reading`. The actual readtext
    call is factored into :meth:`_read` so synthetic tests can override it
    without easyocr installed (pass ``read_fn`` or subclass).
    """

    def __init__(self, languages=('en',), gpu: bool = False, scale: int = 2,
                 read_fn=None):
        self._scale = scale
        self._read_fn = read_fn
        self._reader = None
        if read_fn is None:
            import easyocr  # noqa: WPS433 (lazy heavy import)

            self._reader = easyocr.Reader(list(languages), gpu=gpu)

    def _read(self, array):
        """Return a list of ``(text, confidence)`` for a preprocessed array.

        Uses ``detail=1`` so we get confidences, and tries an ``allowlist`` to
        cut background noise, falling back if the installed easyocr rejects the
        kwarg. Overridable/injectable for tests via ``read_fn``.
        """
        if self._read_fn is not None:
            results = self._read_fn(array)
        else:
            try:
                results = self._reader.readtext(array, detail=1, allowlist=_ALLOWLIST)
            except TypeError:
                # Older easyocr without allowlist support: plain detailed pass.
                results = self._reader.readtext(array, detail=1)
        return _as_text_conf(results)

    def __call__(self, image):
        # Preprocess (no image reference retained past this call).
        array = preprocess_for_ocr(image, scale=self._scale)
        detections = self._read(array)
        return select_reading(detections)


def _as_text_conf(results):
    """Coerce readtext output into ``[(text, confidence|None), ...]``.

    EasyOCR ``detail=1`` yields ``(bbox, text, confidence)``; ``detail=0``
    yields plain strings. Accept both so the reader is robust to easyocr
    version/param differences and to injected fakes.
    """
    pairs = []
    for item in results or ():
        if isinstance(item, str):
            pairs.append((item, None))
        elif isinstance(item, (list, tuple)):
            if len(item) >= 3:
                pairs.append((item[1], item[2]))
            elif len(item) == 2:
                pairs.append((item[0], item[1]))
            elif len(item) == 1:
                pairs.append((item[0], None))
    return pairs
