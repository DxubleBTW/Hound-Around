"""Bounded, anonymous process aggregates; no request, image, user or node labels."""
from contextlib import contextmanager
import json
import logging
import math
from threading import Lock
import time

STAGES = ('decode', 'model_wait', 'embedding', 'search', 'ocr', 'locate', 'route', 'correct')
OUTCOMES = ('locate.ok', 'locate.rejected', 'locate.invalid', 'locate.busy', 'locate.unavailable', 'locate.failed',
            'route.ok', 'route.failed', 'correct.ok', 'correct.failed')
BUCKETS_MS = (1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000)


class Metrics:
    def __init__(self):
        self._lock = Lock()
        self._times = {stage: [0] * (len(BUCKETS_MS) + 1) for stage in STAGES}
        self._counts = {name: 0 for name in OUTCOMES}
        self._requests = 0

    def observe(self, stage, seconds):
        if stage not in self._times or not math.isfinite(seconds) or seconds < 0:
            raise ValueError('Invalid aggregate timing')
        bucket = next((i for i, limit in enumerate(BUCKETS_MS) if seconds * 1000 <= limit), len(BUCKETS_MS))
        with self._lock:
            self._times[stage][bucket] += 1

    @contextmanager
    def time(self, stage):
        start = time.perf_counter()
        try:
            yield
        finally:
            self.observe(stage, time.perf_counter() - start)

    def increment(self, outcome):
        if outcome not in self._counts:
            raise ValueError('Unknown aggregate outcome')
        with self._lock:
            self._counts[outcome] += 1
            self._requests += 1
            emit = self._requests % 100 == 0
        if emit:
            logging.getLogger(__name__).info('service_aggregates %s', json.dumps(self.snapshot(), sort_keys=True))

    def snapshot(self):
        with self._lock:
            return {'buckets_ms': list(BUCKETS_MS),
                    'timings': {key: list(value) for key, value in self._times.items()},
                    'outcomes': dict(self._counts)}
