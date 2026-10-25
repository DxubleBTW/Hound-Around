"""Integration boundary for the ML lead's implementation.

Set HOUND_ML_FACTORY=package.module:create_backend. The factory is called once
with data_dir (Path). It returns an object with size, model_name, locate(image)
(and locate(image, previous=vector) for the two-photo flow),
prepare_correction(vector, label), apply_correction(prepared), snapshot(), and
restore(snapshot). locate returns the contract dictionary plus an internal
`vector` numpy array. Mutations and inference are serialized by the API.
"""
import importlib

import numpy as np


def load_backend(factory_path, data_dir):
    module, name = factory_path.split(':', 1)
    return getattr(importlib.import_module(module), name)(data_dir)


class StubBackend:
    """Explicit integration stub, never an accuracy claim or production default."""
    model_name = 'stub-not-recognition'

    def __init__(self, node):
        self.node = node
        self.labels = []

    @property
    def size(self):
        return len(self.labels)

    def locate(self, image, previous=None):
        vector = np.zeros(384, dtype=np.float32)
        vector[0] = 1
        return {'spot': self.node['id'], 'floor': self.node['floor'], 'heading': None,
                'confidence': 0.0, 'top3': [{'spot': self.node['id'], 'votes': 0}],
                'ocr_room': None, 'ocr_floor': None, 'vector': vector}

    def prepare_correction(self, vector, label):
        return self.labels + [label]

    def apply_correction(self, prepared):
        self.labels = prepared

    def snapshot(self):
        return self.labels.copy()

    def restore(self, snapshot):
        self.labels = snapshot
