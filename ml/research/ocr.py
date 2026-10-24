"""Room-sign OCR backup: read room numbers like 164, 262, B62 and infer the floor."""
import os
import re
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")  # EasyOCR's progress bar crashes cp1252 consoles

ROOM_RE = re.compile(r"^(B\d{2}[A-Z]?|[12]\d{2}[A-Z]?)$")
_reader = None


def read_room(image):
    """Returns (room, floor) for the most confident room-number-looking text, or (None, None)."""
    global _reader
    if _reader is None:
        import easyocr
        import torch
        gpu = torch.cuda.is_available()
        # On CPU EasyOCR takes ~2-3 s per 720p frame (the ASUS GPU can be asleep): say so instead of crawling silently
        print(f"EasyOCR on {'GPU' if gpu else 'CPU (slow)'}", file=sys.stderr, flush=True)
        _reader = easyocr.Reader(["en"], gpu=gpu, verbose=False)
    import numpy as np
    best = None
    for _, text, conf in _reader.readtext(np.asarray(image.convert("RGB")), allowlist="B0123456789AB"):
        t = text.strip().upper().replace(" ", "")
        if ROOM_RE.match(t) and conf > 0.4 and (best is None or conf > best[1]):
            best = (t, conf)
    if not best:
        return None, None
    room = best[0]
    return room, -1 if room.startswith("B") else int(room[0])
