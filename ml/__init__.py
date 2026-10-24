"""Hound Around recognition package.

Wired to the backend through ``HOUND_ML_FACTORY=ml.backend:create_backend``.
The heavy model dependencies (torch, transformers, easyocr) are imported
lazily inside the real embedder/OCR classes, so ``import ml`` and the
synthetic tests work without them installed.
"""
