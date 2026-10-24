"""Image embedders behind one interface: embed(list of images) -> L2-normalized float32 [N, D].

Models: hist (HSV color histogram baseline), clip (ViT-B/32), dinov2 (small, CLS token), dinov2_mean (mean of patch tokens).
"""
import hashlib
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODELS = ["hist", "clip", "dinov2", "dinov2_mean"]


CROPS = {"full": None, "left": (0.0, 0.6), "right": (0.4, 1.0)}  # side crops overlap in the middle


def _rgb(img, crop=None):
    if isinstance(img, (str, Path)):
        img = Image.open(img)
    img = img.convert("RGB")
    if crop:
        w, h = img.size
        img = img.crop((int(w * crop[0]), 0, int(w * crop[1]), h))
    return img


def _norm(x):
    x = np.asarray(x, dtype=np.float32)
    return x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-8)


class Embedder:
    def __init__(self, name):
        if name not in MODELS:
            raise ValueError(f"unknown model {name}, pick from {MODELS}")
        self.name = name
        if name == "clip":
            from transformers import CLIPModel, CLIPProcessor
            self.proc = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
            self.model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(DEVICE).eval()
        elif name.startswith("dinov2"):
            from transformers import AutoImageProcessor, AutoModel
            self.proc = AutoImageProcessor.from_pretrained("facebook/dinov2-small")
            self.model = AutoModel.from_pretrained("facebook/dinov2-small").to(DEVICE).eval()

    @torch.no_grad()
    def embed(self, images, batch=32, crop="full"):
        out = []
        for i in range(0, len(images), batch):
            chunk = [_rgb(im, CROPS[crop]) for im in images[i:i + batch]]
            if self.name == "hist":
                out.append(np.stack([_hist(im) for im in chunk]))
                continue
            inputs = self.proc(images=chunk, return_tensors="pt").to(DEVICE)
            if self.name == "clip":
                feats = self.model.get_image_features(**inputs)
                feats = getattr(feats, "pooler_output", feats)  # transformers 5 may return an output object
            else:
                hidden = self.model(**inputs).last_hidden_state
                feats = hidden[:, 0] if self.name == "dinov2" else hidden[:, 1:].mean(1)
            out.append(feats.float().cpu().numpy())
        return _norm(np.concatenate(out))


def _hist(im):
    hsv = cv2.cvtColor(np.asarray(im.resize((256, 192))), cv2.COLOR_RGB2HSV)
    h = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256]).ravel()
    return np.sqrt(h / h.sum())  # Hellinger: cosine on sqrt histograms


_loaded = {}


def embed_cached(name, paths, cache_dir="data/cache", crop="full"):
    """Embed file paths once per model and crop, and reuse across experiments."""
    key = hashlib.md5("\n".join(f"{p}:{Path(p).stat().st_mtime_ns}" for p in paths).encode()).hexdigest()[:12]
    cache = Path(cache_dir) / f"{name}_{crop}_{key}.npy"
    if cache.exists():
        return np.load(cache)
    if name not in _loaded:
        _loaded[name] = Embedder(name)
    vecs = _loaded[name].embed(paths, crop=crop)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.save(cache, vecs)
    return vecs
