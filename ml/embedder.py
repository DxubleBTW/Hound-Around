"""DINOv2-small image embedder.

Produces a 384-d, L2-normalized descriptor from the DINOv2-small **CLS token**
(design.md §2): it is DINOv2's purpose-built global image descriptor, directly
comparable with cosine similarity (the top-10 voting scheme), and cheaper than
pooling all patch tokens which helps the < 1 s CPU budget.

The heavy dependencies (``torch``, ``transformers``) are imported **lazily**
inside :class:`Dinov2Embedder`, so ``import ml.embedder`` succeeds without them
and synthetic tests can inject a deterministic fake embedder instead.

An embedder is any callable ``embed(images) -> np.ndarray[float32]`` where
``images`` is a single PIL image or a list of them, returning shape ``(384,)``
or ``(N, 384)`` of L2-normalized rows. :func:`normalize` and
:func:`as_embed_fn` help wrap simpler callables.
"""
from __future__ import annotations

import numpy as np

DIM = 384
MODEL_NAME = 'facebook/dinov2-small'


def normalize(vectors: np.ndarray) -> np.ndarray:
    """L2-normalize rows of a float32 array; leaves zero rows untouched."""
    vectors = np.asarray(vectors, dtype=np.float32)
    single = vectors.ndim == 1
    matrix = vectors.reshape(1, -1) if single else vectors
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    safe = np.where(norms == 0, 1.0, norms)
    out = (matrix / safe).astype(np.float32)
    return out[0] if single else out


def as_embed_fn(fn):
    """Wrap a per-image ``fn(image) -> vector`` into a batch embed callable.

    The returned callable accepts a single PIL image or a list and always
    returns an L2-normalized float32 array of shape ``(384,)`` or ``(N, 384)``.
    """
    def embed(images):
        if _is_single(images):
            vector = np.asarray(fn(images), dtype=np.float32).reshape(-1)
            if vector.shape != (DIM,):
                raise ValueError(f'Embedder must return {DIM}-d vectors, got {vector.shape}')
            return normalize(vector)
        rows = [np.asarray(fn(image), dtype=np.float32).reshape(-1) for image in images]
        matrix = np.stack(rows) if rows else np.zeros((0, DIM), dtype=np.float32)
        if matrix.shape[1:] != (DIM,):
            raise ValueError(f'Embedder must return {DIM}-d vectors, got {matrix.shape}')
        return normalize(matrix)
    return embed


def _is_single(images) -> bool:
    """A single PIL image (not a list/tuple of images)."""
    return not isinstance(images, (list, tuple))


class Dinov2Embedder:
    """DINOv2-small CLS-token embedder. Loads the model once at construction.

    ``torch`` and ``transformers`` are imported here (lazily), so the module
    import never requires them. Pass this to ``create_backend(embedder=...)``
    for the real path, or omit it in tests and inject a fake.
    """

    model_name = MODEL_NAME

    def __init__(self, device: str | None = None):
        import torch  # noqa: WPS433 (lazy heavy import)
        from transformers import AutoImageProcessor, AutoModel  # noqa: WPS433

        self._torch = torch
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self._processor = AutoImageProcessor.from_pretrained(MODEL_NAME)
        self._model = AutoModel.from_pretrained(MODEL_NAME).to(self.device).eval()

    def __call__(self, images):
        single = _is_single(images)
        batch = [images] if single else list(images)
        if not batch:
            return np.zeros((0, DIM), dtype=np.float32)
        torch = self._torch
        inputs = self._processor(images=batch, return_tensors='pt').to(self.device)
        with torch.inference_mode():
            outputs = self._model(**inputs)
            # CLS token is position 0 of the last hidden state (design §2).
            cls = outputs.last_hidden_state[:, 0, :]
        vectors = cls.detach().to('cpu', dtype=torch.float32).numpy()
        vectors = normalize(vectors)
        return vectors[0] if single else vectors
