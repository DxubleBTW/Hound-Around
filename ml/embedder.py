"""Image embedders: DINOv2-small (shipped today) and MegaLoc (the descriptor swap).

**DINOv2-small** (:class:`Dinov2Embedder`) produces a 384-d, L2-normalized
descriptor from the CLS token (design.md §2). Images are **letterboxed** onto a
224 x 224 square instead of the processor's resize-256 + center-crop-224, which
cut the sides off landscape training frames and the top/bottom off portrait phone
photos. Leave-one-video-out with the multi-view index: top-1 31 -> 37%,
top-3 53 -> 59%, floor 76 -> 81% (ml/research/matching_sweep.py).

**MegaLoc** (:class:`MegalocEmbedder`, gmberton/MegaLoc via torch.hub, MIT) is a
place-recognition descriptor that aggregates DINOv2-B patch tokens into 8,448-d.
It is fed a **square resize** (the model's own training transform: scale to
322 x 322 ignoring the aspect ratio, :func:`squash`). On the same 1,758
leave-one-video-out queries: top-1 36.8 -> 48.2%, top-3 59.5 -> 74.9%,
floor 81.2 -> 89.4% (team measurement, Sun Oct 25; see docs/STATUS.md).

Which one runs is chosen by ``HOUND_EMBEDDER`` (``dinov2`` default, ``megaloc``)
through :func:`make_embedder`. The index's row width follows the embedder, so
nothing downstream may hard-code 384: use ``index.dim`` / ``backend.dim``.

An 8,448-d float16 index of 21k rows is ~350 MB, so the index builder can fit a
**PCA** (:class:`Projector`) and store it *inside* ``index.npz``; the backend
then projects every query with the same matrix. The projection travels with the
index, and the backend's ``model_name`` gains ``+pca<k>``, so rejection
thresholds and correction contexts stay bound to the exact descriptor.

The heavy dependencies (``torch``, ``transformers``) are imported **lazily**
inside the embedder classes, so ``import ml.embedder`` succeeds without them
and synthetic tests inject a deterministic fake embedder instead.

An embedder is any callable ``embed(images) -> np.ndarray[float32]`` where
``images`` is a single PIL image or a list of them, returning shape ``(D,)``
or ``(N, D)`` of L2-normalized rows, with ``model_name`` and ``dim``
attributes. :func:`normalize` and :func:`as_embed_fn` help wrap simpler callables.
"""
from __future__ import annotations

import os

import numpy as np

# --- DINOv2-small (shipped) ---------------------------------------------------
DIM = 384  # DINOv2-small CLS width; the default when nothing says otherwise
HF_MODEL = 'facebook/dinov2-small'
# Identity of the descriptor (weights + preprocessing). Rejection thresholds and
# correction contexts are bound to it, so a preprocessing change must change it.
MODEL_NAME = f'{HF_MODEL}+pad224'
SIDE = 224
PAD_RGB = (124, 116, 104)  # ImageNet mean: padding normalizes to ~0

# --- MegaLoc ------------------------------------------------------------------
MEGALOC_HUB = 'gmberton/MegaLoc'
MEGALOC_DIM = 8448
MEGALOC_SIDE = 322  # trained on 322 x 322 squares
MEGALOC_MODEL_NAME = f'{MEGALOC_HUB}+squash{MEGALOC_SIDE}'
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)

EMBEDDERS = ('dinov2', 'megaloc')
ENV_EMBEDDER = 'HOUND_EMBEDDER'

# Index rows per training frame: (left, right) fractions of the width, None = whole frame.
INDEX_VIEWS = (None, (0.0, 0.6), (0.4, 1.0))


def normalize(vectors: np.ndarray) -> np.ndarray:
    """L2-normalize rows of a float32 array; leaves zero rows untouched."""
    vectors = np.asarray(vectors, dtype=np.float32)
    single = vectors.ndim == 1
    matrix = vectors.reshape(1, -1) if single else vectors
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    safe = np.where(norms == 0, 1.0, norms)
    out = (matrix / safe).astype(np.float32)
    return out[0] if single else out


def as_embed_fn(fn, dim: int = DIM):
    """Wrap a per-image ``fn(image) -> vector`` into a batch embed callable.

    The returned callable accepts a single PIL image or a list and always
    returns an L2-normalized float32 array of shape ``(dim,)`` or ``(N, dim)``.
    """
    def embed(images):
        if _is_single(images):
            vector = np.asarray(fn(images), dtype=np.float32).reshape(-1)
            if vector.shape != (dim,):
                raise ValueError(f'Embedder must return {dim}-d vectors, got {vector.shape}')
            return normalize(vector)
        rows = [np.asarray(fn(image), dtype=np.float32).reshape(-1) for image in images]
        matrix = np.stack(rows) if rows else np.zeros((0, dim), dtype=np.float32)
        if matrix.shape[1:] != (dim,):
            raise ValueError(f'Embedder must return {dim}-d vectors, got {matrix.shape}')
        return normalize(matrix)
    embed.dim = dim
    embed.model_name = getattr(fn, 'model_name', MODEL_NAME)
    return embed


def letterbox(image, side=SIDE):
    """Scale an RGB PIL image to fit a ``side`` x ``side`` square and pad the rest (no pixels cropped)."""
    from PIL import Image

    scale = side / max(image.size)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                           Image.BICUBIC)
    canvas = Image.new('RGB', (side, side), PAD_RGB)
    canvas.paste(resized, ((side - resized.width) // 2, (side - resized.height) // 2))
    return canvas


def squash(image, side=MEGALOC_SIDE):
    """Resize an RGB PIL image to a ``side`` x ``side`` square, ignoring the aspect ratio.

    This is MegaLoc's own training transform (``ml/research/embed.py`` ``prep='squash'``):
    no pixels are cropped or padded, the picture is stretched. Portrait phone photos
    and landscape training frames land in the same square, which is what made it
    beat letterboxing for this model.
    """
    from PIL import Image

    return image.resize((side, side), Image.BICUBIC)


def index_views(image):
    """The :data:`INDEX_VIEWS` crops of one training frame, in order."""
    width, height = image.size
    return [image if view is None else image.crop((int(width * view[0]), 0, int(width * view[1]), height))
            for view in INDEX_VIEWS]


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
    dim = DIM

    def __init__(self, device: str | None = None):
        import torch  # noqa: WPS433 (lazy heavy import)
        from transformers import AutoImageProcessor, AutoModel  # noqa: WPS433

        self._torch = torch
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self._processor = AutoImageProcessor.from_pretrained(HF_MODEL)
        self._model = AutoModel.from_pretrained(HF_MODEL).to(self.device).eval()

    def __call__(self, images):
        single = _is_single(images)
        batch = [images] if single else list(images)
        if not batch:
            return np.zeros((0, DIM), dtype=np.float32)
        torch = self._torch
        batch = [letterbox(image.convert('RGB')) for image in batch]
        inputs = self._processor(images=batch, do_resize=False, do_center_crop=False,
                                 return_tensors='pt').to(self.device)
        with torch.inference_mode():
            outputs = self._model(**inputs)
            # CLS token is position 0 of the last hidden state (design §2).
            cls = outputs.last_hidden_state[:, 0, :]
        vectors = cls.detach().to('cpu', dtype=torch.float32).numpy()
        vectors = normalize(vectors)
        return vectors[0] if single else vectors


class MegalocEmbedder:
    """MegaLoc place-recognition embedder (8,448-d) on square-resized 322 x 322 input.

    Weights come from ``torch.hub.load('gmberton/MegaLoc', 'get_trained_model')``;
    set ``TORCH_HOME`` to a writable cache (the Dockerfile pre-downloads them at
    build time). ``batch`` bounds memory on the CPU Space: a ViT-B backbone with
    8,448-d outputs is heavier than DINOv2-small, and /locate embeds one photo.
    """

    model_name = MEGALOC_MODEL_NAME
    dim = MEGALOC_DIM

    def __init__(self, device: str | None = None, batch: int = 16, threads: int | None = None):
        import torch  # noqa: WPS433 (lazy heavy import)

        self._torch = torch
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        if threads:
            torch.set_num_threads(threads)
        self._model = torch.hub.load(MEGALOC_HUB, 'get_trained_model', trust_repo=True).to(self.device).eval()
        self._mean = torch.tensor(IMAGENET_MEAN, device=self.device).view(3, 1, 1)
        self._std = torch.tensor(IMAGENET_STD, device=self.device).view(3, 1, 1)
        self.batch = batch

    def _tensor(self, image):
        array = np.asarray(squash(image.convert('RGB')), dtype=np.float32) / 255.0
        return self._torch.from_numpy(array).permute(2, 0, 1)

    def __call__(self, images):
        single = _is_single(images)
        batch = [images] if single else list(images)
        if not batch:
            return np.zeros((0, MEGALOC_DIM), dtype=np.float32)
        torch = self._torch
        parts = []
        with torch.inference_mode():
            for start in range(0, len(batch), self.batch):
                x = torch.stack([self._tensor(im) for im in batch[start:start + self.batch]]).to(self.device)
                out = self._model((x - self._mean) / self._std)
                out = out[0] if isinstance(out, tuple) else out
                parts.append(out.detach().to('cpu', dtype=torch.float32).numpy())
        vectors = normalize(np.concatenate(parts))
        if vectors.shape[1] != MEGALOC_DIM:
            raise ValueError(f'MegaLoc returned {vectors.shape[1]}-d vectors, expected {MEGALOC_DIM}')
        return vectors[0] if single else vectors


def embedder_name(name: str | None = None) -> str:
    """The configured embedder: the argument, else ``HOUND_EMBEDDER``, else ``dinov2``."""
    name = (name or os.getenv(ENV_EMBEDDER) or 'dinov2').strip().lower()
    if name not in EMBEDDERS:
        raise ValueError(f'{ENV_EMBEDDER}={name!r}: pick one of {EMBEDDERS}')
    return name


def make_embedder(name: str | None = None, **kwargs):
    """Construct the configured real embedder (heavy imports happen here)."""
    name = embedder_name(name)
    if name == 'megaloc':
        return MegalocEmbedder(**kwargs)
    return Dinov2Embedder(**kwargs)


class Projector:
    """A fitted PCA that shrinks descriptors: ``(D,) -> (k,)``, re-normalized.

    Stored inside ``index.npz`` as ``pca_mean`` ``[D]`` and ``pca_components``
    ``[k, D]`` (float32), so an index and its projection can never be separated.
    """

    def __init__(self, mean, components):
        self.mean = np.asarray(mean, dtype=np.float32).reshape(-1)
        self.components = np.asarray(components, dtype=np.float32)
        if self.components.ndim != 2 or self.components.shape[1] != self.mean.shape[0]:
            raise ValueError('PCA components must be [k, D] matching the mean')

    @property
    def in_dim(self) -> int:
        return int(self.mean.shape[0])

    @property
    def out_dim(self) -> int:
        return int(self.components.shape[0])

    @classmethod
    def fit(cls, vectors, k: int) -> 'Projector':
        """Fit on ``[N, D]`` rows (centered SVD); ``k`` is clipped to ``min(N, D)``."""
        matrix = np.asarray(vectors, dtype=np.float32)
        if matrix.ndim != 2 or matrix.shape[0] == 0:
            raise ValueError('PCA needs a non-empty [N, D] matrix')
        k = int(min(k, *matrix.shape))
        if k < 1:
            raise ValueError('PCA needs k >= 1')
        mean = matrix.mean(axis=0)
        _, _, vt = np.linalg.svd((matrix - mean).astype(np.float64), full_matrices=False)
        return cls(mean, vt[:k].astype(np.float32))

    def __call__(self, vectors):
        vectors = np.asarray(vectors, dtype=np.float32)
        single = vectors.ndim == 1
        matrix = vectors.reshape(1, -1) if single else vectors
        if matrix.shape[1] != self.in_dim:
            raise ValueError(f'Projector expects {self.in_dim}-d input, got {matrix.shape[1]}')
        out = normalize((matrix - self.mean) @ self.components.T)
        return out[0] if single else out

    def npz_fields(self) -> dict:
        return {'pca_mean': self.mean, 'pca_components': self.components}

    @classmethod
    def from_npz(cls, data) -> 'Projector | None':
        """The projector stored in a loaded ``index.npz`` mapping, or ``None``."""
        keys = getattr(data, 'files', None)
        keys = keys if keys is not None else list(data.keys())
        if 'pca_components' in keys:
            return cls(data['pca_mean'], data['pca_components'])
        return None


def projected_model_name(model_name: str, projector: Projector | None) -> str:
    return model_name if projector is None else f'{model_name}+pca{projector.out_dim}'


def with_projection(embed_fn, projector: Projector | None):
    """Compose an embedder with a projector; returns the embedder unchanged when ``projector`` is None."""
    if projector is None:
        return embed_fn
    base_name = getattr(embed_fn, 'model_name', MODEL_NAME)

    def embed(images):
        return projector(np.asarray(embed_fn(images), dtype=np.float32))
    embed.dim = projector.out_dim
    embed.model_name = projected_model_name(base_name, projector)
    embed.batched = True
    return embed
