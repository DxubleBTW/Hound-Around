"""The descriptor swap: square resize, data-driven descriptor width, PCA stored with the index.

Synthetic only (no torch, no real frames). A fake 16-d "MegaLoc-shaped" embedder
stands in for the 8,448-d model so the whole path (build index -> PCA -> backend
-> locate -> correction -> persist) is exercised at a width other than 384.
"""
import json
import os

import numpy as np
import pytest
from PIL import Image

from ml.backend import create_backend
from ml.embedder import (DIM, MEGALOC_DIM, MEGALOC_SIDE, Projector, embedder_name, normalize,
                         projected_model_name, squash, with_projection)
from ml.index import VectorIndex
from tests.test_ml import synthetic_graph, solid

WIDE = 16  # stand-in for 8,448


class WideFakeEmbedder:
    """Solid colour -> a fixed WIDE-d unit vector (two basis directions per colour so PCA has variance)."""

    model_name = 'fake-wide+squash322'
    dim = WIDE
    batched = True

    def _one(self, image):
        r, g, b = image.getpixel((0, 0))[:3]
        rng = np.random.default_rng(r * 65536 + g * 256 + b)
        return normalize(rng.standard_normal(WIDE).astype(np.float32))

    def __call__(self, images):
        if isinstance(images, (list, tuple)):
            return normalize(np.stack([self._one(im) for im in images]))
        return self._one(images)


# --- square resize ----------------------------------------------------------

@pytest.mark.parametrize('size', [(1080, 1920), (1920, 1080), (50, 400)])
def test_squash_is_a_square_resize_without_padding(size):
    image = Image.new('RGB', size, (200, 30, 30))
    out = squash(image)
    assert out.size == (MEGALOC_SIDE, MEGALOC_SIDE)
    # stretched, not letterboxed: the corners keep the image colour, no padding band
    for corner in ((0, 0), (MEGALOC_SIDE - 1, 0), (0, MEGALOC_SIDE - 1), (MEGALOC_SIDE - 1, MEGALOC_SIDE - 1)):
        assert out.getpixel(corner) == (200, 30, 30)


def test_embedder_selection_defaults_to_dinov2(monkeypatch):
    monkeypatch.delenv('HOUND_EMBEDDER', raising=False)
    assert embedder_name() == 'dinov2'
    monkeypatch.setenv('HOUND_EMBEDDER', 'MegaLoc')
    assert embedder_name() == 'megaloc'
    monkeypatch.setenv('HOUND_EMBEDDER', 'boq')
    with pytest.raises(ValueError):
        embedder_name()
    assert MEGALOC_DIM == 8448 and DIM == 384


def test_megaloc_calibration_is_bound_to_the_measured_descriptor():
    from ml import calibration
    from ml.embedder import MEGALOC_MODEL_NAME
    features = dict(confidence=.7, share=.6, top_sim=.8, margin=.1, span=0)
    assert calibration.p_correct(features, MEGALOC_MODEL_NAME) != calibration.p_correct(features)
    with pytest.raises(ValueError, match='calibration'):
        calibration.coefficients(MEGALOC_MODEL_NAME + '+pca1024')


# --- index width follows the data --------------------------------------------

def test_index_width_is_read_from_the_vectors(tmp_path):
    vecs = normalize(np.random.default_rng(0).standard_normal((5, WIDE)).astype(np.float32))
    index = VectorIndex(vecs=vecs, labels=['F1_a'] * 5, source=['video'] * 5)
    assert index.dim == WIDE
    with pytest.raises(ValueError):
        index.with_appended(np.ones(DIM, dtype=np.float32), 'F1_a', 'correction')
    appended = index.with_appended(np.ones(WIDE, dtype=np.float32), 'F1_a', 'correction')
    assert len(appended) == 6 and appended.dim == WIDE
    index.save(tmp_path / 'index.npz')
    assert VectorIndex.load(tmp_path / 'index.npz').dim == WIDE


# --- PCA ----------------------------------------------------------------------

def test_projector_round_trips_through_npz_and_normalizes(tmp_path):
    rng = np.random.default_rng(1)
    rows = normalize(rng.standard_normal((40, WIDE)).astype(np.float32))
    pca = Projector.fit(rows, 6)
    assert (pca.in_dim, pca.out_dim) == (WIDE, 6)
    projected = pca(rows)
    assert projected.shape == (40, 6)
    assert np.allclose(np.linalg.norm(projected, axis=1), 1, atol=1e-4)
    index = VectorIndex(vecs=projected, labels=['x'] * 40, source=['video'] * 40, pca=pca)
    index.save(tmp_path / 'index.npz')
    loaded = VectorIndex.load(tmp_path / 'index.npz')
    assert loaded.pca is not None and loaded.pca.out_dim == 6 and loaded.dim == 6
    assert np.allclose(loaded.pca(rows[0]), projected[0], atol=1e-5)
    # projection of a single vector and a batch agree
    assert np.allclose(pca(rows[:1])[0], pca(rows[0]))
    with pytest.raises(ValueError):
        VectorIndex(vecs=rows, labels=['x'] * 40, source=['video'] * 40, pca=pca)  # width disagrees


def test_with_projection_renames_the_model():
    pca = Projector.fit(normalize(np.random.default_rng(2).standard_normal((20, WIDE)).astype(np.float32)), 4)
    embed = with_projection(WideFakeEmbedder(), pca)
    assert embed.dim == 4 and embed.model_name == 'fake-wide+squash322+pca4'
    assert embed(solid((255, 0, 0))).shape == (4,)
    assert embed([solid((255, 0, 0)), solid((0, 128, 0))]).shape == (2, 4)
    assert projected_model_name('m', None) == 'm'
    assert with_projection(WideFakeEmbedder(), None).model_name == 'fake-wide+squash322'


# --- end to end at a non-384 width -------------------------------------------

def _write_dataset(tmp_path, per_spot=8):
    (tmp_path / 'graph.json').write_text(json.dumps(synthetic_graph()))
    (tmp_path / 'rooms.json').write_text('[]')
    train = tmp_path / 'dataset' / 'train'
    colors = {'F1_a': (255, 0, 0), 'F1_b': (0, 128, 0), 'F2_c': (0, 0, 255)}
    rows = ['file,video,t_sec,label,label_source,in_graph,sharpness,dup_of_prev,status,heading']
    for spot, color in colors.items():
        (train / spot).mkdir(parents=True, exist_ok=True)
        for i in range(per_spot):
            # slight colour jitter so the fake embedder gives PCA something to fit
            jitter = tuple(min(255, c + i) for c in color)
            name = f'{spot}_{i}.jpg'
            solid(jitter).save(train / spot / name)
            rows.append(f'{name},v1,{i}.0,{spot},card,true,1800,false,keep,')
    (tmp_path / 'labels.csv').write_text('\n'.join(rows) + '\n')
    return colors


@pytest.mark.parametrize('pca', [None, 5])
def test_build_locate_correct_at_wide_width(tmp_path, pca):
    from ml.build_index import build_index

    colors = _write_dataset(tmp_path)
    out_path, counts = build_index(tmp_path, embed_fn=WideFakeEmbedder(), cap=60, pca=pca)
    data = np.load(out_path, allow_pickle=False)
    width = pca or WIDE
    assert data['vecs'].shape[1] == width
    assert ('pca_components' in data.files) == bool(pca)

    backend = create_backend(tmp_path, embedder=WideFakeEmbedder(), ocr_reader=lambda image: (None, None))
    assert backend.dim == width
    assert backend.model_name == ('fake-wide+squash322+pca5' if pca else 'fake-wide+squash322')
    result = backend.locate(solid(colors['F1_a']))
    assert result['spot'] == 'F1_a' and result['vector'].shape == (width,)

    # a correction at this width is accepted and wins the next identical photo
    query = solid((9, 9, 9))
    vector = backend.locate(query)['vector']
    prepared = backend.prepare_correction(vector, 'F2_c')
    backend.apply_correction(prepared)
    assert backend.locate(query)['spot'] == 'F2_c'


def test_backend_fails_closed_on_width_mismatch(tmp_path):
    from ml.build_index import build_index
    from tests.test_ml import FakeEmbedder

    _write_dataset(tmp_path)
    build_index(tmp_path, embed_fn=WideFakeEmbedder(), cap=60)
    with pytest.raises(ValueError, match='HOUND_EMBEDDER'):
        create_backend(tmp_path, embedder=FakeEmbedder(), ocr_reader=lambda image: (None, None))  # 384-d vs 16-d index


def test_single_view_index_preserves_descriptor_identity(tmp_path):
    from ml.build_index import build_index, add_headings

    _write_dataset(tmp_path)
    embedder = WideFakeEmbedder()
    embedder.index_views = (None,)
    path, counts = build_index(tmp_path, embed_fn=embedder)
    index = VectorIndex.load(path)
    assert len(index) == sum(counts.values())
    assert index.views_per_frame == 1
    assert index.model_name == embedder.model_name
    add_headings(tmp_path)
    index.copy().save(path)
    assert VectorIndex.load(path).views_per_frame == 1
    embedder.model_name = 'another-model-same-width'
    with pytest.raises(ValueError, match='identity'):
        create_backend(tmp_path, embedder=embedder, ocr_reader=lambda image: (None, None))


# --- API keeps the width it is given ------------------------------------------

def test_correction_store_checks_the_live_width(tmp_path):
    import sqlite3

    from api.corrections import CorrectionStore

    db = sqlite3.connect(':memory:')
    db.execute('CREATE TABLE corrections (photo_id TEXT PRIMARY KEY, true_spot TEXT, predicted TEXT, '
               'confidence REAL, created_at TEXT)')
    store = CorrectionStore(db, 'ctx', dim=WIDE)
    db.execute("INSERT INTO corrections VALUES ('p1', 'F1_a', 'F1_b', 0.5, 'now')")
    store.add('p1', normalize(np.ones(WIDE, dtype=np.float32)))
    db.commit()
    assert [r[1] for r in store.records()] == ['F1_a']
    with pytest.raises(ValueError):
        CorrectionStore(db, 'ctx', dim=DIM).records()  # another model's width refuses the blob


def test_api_locate_accepts_the_models_width(tmp_path, monkeypatch):
    """The API checks the returned vector against ``model.dim``, not a literal 384."""
    import sys
    from types import SimpleNamespace

    from fastapi.testclient import TestClient

    from api.main import create_app
    from ml.build_index import build_index

    colors = _write_dataset(tmp_path)
    build_index(tmp_path, embed_fn=WideFakeEmbedder(), cap=60, pca=5)

    def factory(directory):
        return create_backend(directory, embedder=WideFakeEmbedder(), ocr_reader=lambda image: (None, None))

    monkeypatch.setitem(sys.modules, 'swap_ml', SimpleNamespace(create_backend=factory))
    monkeypatch.setenv('HOUND_ML_FACTORY', 'swap_ml:create_backend')
    monkeypatch.delenv('HOUND_STUB_SPOT', raising=False)
    with TestClient(create_app(tmp_path)) as client:
        health = client.get('/health').json()
        assert health.get('ok') is True and 'pca5' in health.get('model', '')
        response = client.post('/locate', files={'image': ('q.jpg', _jpeg(solid(colors['F1_a'])), 'image/jpeg')})
        assert response.status_code == 200, response.text
        assert response.json()['spot'] == 'F1_a'


def _jpeg(image):
    import io

    buf = io.BytesIO()
    image.resize((640, 480)).save(buf, format='JPEG')
    return buf.getvalue()
