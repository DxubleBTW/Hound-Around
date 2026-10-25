"""Image embedders behind one interface: embed(list of images) -> L2-normalized float32 [N, D].

Models: hist (HSV color histogram baseline), clip (ViT-B/32), dinov2 (small, CLS token), dinov2_mean (mean of patch tokens),
and place-recognition descriptors that aggregate DINOv2-B patch tokens (MIT-licensed, via torch.hub):
megaloc (gmberton/MegaLoc, SALAD-style, 8448-d) and boq (amaralibey/Bag-of-Queries, 12288-d).

Preprocessing for the DINOv2 models (`prep`):
  center  HF default: shortest edge 256, center-crop 224 (cuts the sides of landscape frames; what ships today)
  pad     letterbox the whole image onto a 224 x 224 square
  native  keep the aspect ratio, short side 224, each side rounded to a multiple of 14 (no pixels lost)
  squash  resize to a square, ignoring the aspect ratio (the VPR models' training transform; their `center`)
VPR models use side 322 instead of 224.
"""
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
VPR = ["megaloc", "boq"]
MODELS = ["hist", "clip", "dinov2", "dinov2_mean"] + VPR
PREPS = ["center", "pad", "native", "squash"]
VPR_SIDE = 322  # both were trained on 322 x 322
PATCH = 14
PAD_RGB = (124, 116, 104)  # ImageNet mean, so padding normalizes to ~0


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


def prepare(img, prep, side=224):
    """Resize (and pad) a PIL image for DINOv2 without the processor's center crop. `center` returns it unchanged."""
    if prep == "center":
        return img
    w, h = img.size
    if prep == "pad":
        s = side / max(w, h)
        img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BICUBIC)
        canvas = Image.new("RGB", (side, side), PAD_RGB)
        canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
        return canvas
    if prep == "squash":
        return img.resize((side, side), Image.BICUBIC)
    if prep == "native":
        s = side / min(w, h)
        size = (max(PATCH, round(w * s / PATCH) * PATCH), max(PATCH, round(h * s / PATCH) * PATCH))
        return img.resize(size, Image.BICUBIC)
    raise ValueError(f"unknown prep {prep}, pick from {PREPS}")


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
        elif name == "megaloc":
            self.model = torch.hub.load("gmberton/MegaLoc", "get_trained_model", trust_repo=True).to(DEVICE).eval()
        elif name == "boq":
            self.model = torch.hub.load("amaralibey/bag-of-queries", "get_trained_boq", backbone_name="dinov2",
                                        output_dim=12288, trust_repo=True).to(DEVICE).eval()

    @torch.no_grad()
    def embed(self, images, batch=32, crop="full", prep="center"):
        out = []
        for i in range(0, len(images), batch):
            chunk = [_rgb(im, CROPS[crop]) for im in images[i:i + batch]]
            if self.name == "hist":
                out.append(np.stack([_hist(im) for im in chunk]))
                continue
            if self.name == "clip":
                inputs = self.proc(images=chunk, return_tensors="pt").to(DEVICE)
                feats = self.model.get_image_features(**inputs)
                feats = getattr(feats, "pooler_output", feats)  # transformers 5 may return an output object
                out.append(feats.float().cpu().numpy())
                continue
            if self.name in VPR:
                out.append(self._vpr([prepare(im, "squash" if prep == "center" else prep, VPR_SIDE) for im in chunk]))
                continue
            out.append(self._dinov2([prepare(im, prep) for im in chunk], prep))
        return _norm(np.concatenate(out))

    def _dinov2(self, chunk, prep):
        if prep == "center":
            groups = [list(range(len(chunk)))]
        else:  # one forward pass per image size (native keeps portrait and landscape apart)
            by_size = {}
            for j, im in enumerate(chunk):
                by_size.setdefault(im.size, []).append(j)
            groups = list(by_size.values())
        feats = np.zeros((len(chunk), self.model.config.hidden_size), dtype=np.float32)
        for idx in groups:
            ims = [chunk[j] for j in idx]
            kw = {} if prep == "center" else {"do_resize": False, "do_center_crop": False}
            inputs = self.proc(images=ims, return_tensors="pt", **kw).to(DEVICE)
            hidden = self.model(**inputs).last_hidden_state
            f = hidden[:, 0] if self.name == "dinov2" else hidden[:, 1:].mean(1)
            feats[idx] = f.float().cpu().numpy()
        return feats


    def _vpr(self, chunk):
        mean = torch.tensor([0.485, 0.456, 0.406], device=DEVICE).view(3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225], device=DEVICE).view(3, 1, 1)
        by_size = {}
        for j, im in enumerate(chunk):
            by_size.setdefault(im.size, []).append(j)
        feats = [None] * len(chunk)
        for idx in by_size.values():
            x = torch.stack([torch.from_numpy(np.asarray(chunk[j], dtype=np.float32) / 255).permute(2, 0, 1)
                             for j in idx]).to(DEVICE)
            f = self.model((x - mean) / std)
            f = f[0] if isinstance(f, tuple) else f  # BoQ returns (descriptor, attentions)
            for j, row in zip(idx, f.float().cpu().numpy()):
                feats[j] = row
        return np.stack(feats)


def _hist(im):
    hsv = cv2.cvtColor(np.asarray(im.resize((256, 192))), cv2.COLOR_RGB2HSV)
    h = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256]).ravel()
    return np.sqrt(h / h.sum())  # Hellinger: cosine on sqrt histograms


_loaded = {}


def get_embedder(name):
    if name not in _loaded:
        _loaded[name] = Embedder(name)
    return _loaded[name]


def _frame_key(path):
    return f"{Path(path).resolve()}:{Path(path).stat().st_mtime_ns}"


def embed_cached(name, paths, cache_dir="data/cache", crop="full", prep="center"):
    """Embed file paths with a per-frame cache keyed by (model, crop, prep, path, mtime); only misses are embedded.

    Adding a dataset embeds just its new frames instead of everything again.
    """
    store = Path(cache_dir) / "frames" / f"{name}_{crop}_{prep}.npz"
    known, vecs = {}, None
    if store.exists():
        with np.load(store, allow_pickle=False) as data:  # closed before the replace below (Windows locks open files)
            vecs = data["vecs"]
            known = {k: i for i, k in enumerate(data["keys"])}
    keys = [_frame_key(p) for p in paths]
    miss = sorted({k for k in keys if k not in known})
    if miss:
        by_key = {k: p for k, p in zip(keys, paths)}
        print(f"  embedding {len(miss)} new frames ({name}, crop={crop}, prep={prep}, {DEVICE})", flush=True)
        new = get_embedder(name).embed([by_key[k] for k in miss], crop=crop, prep=prep)
        vecs = new if vecs is None else np.concatenate([vecs, new])
        all_keys = sorted(known, key=known.get) + miss
        known = {k: i for i, k in enumerate(all_keys)}
        store.parent.mkdir(parents=True, exist_ok=True)
        tmp = store.with_suffix(".tmp.npz")
        np.savez(tmp, keys=np.asarray(all_keys), vecs=vecs.astype(np.float32))
        tmp.replace(store)
    return vecs[[known[k] for k in keys]]
