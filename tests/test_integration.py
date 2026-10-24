"""Full API/ML/routing/correction integration with explicitly synthetic data.

Uses the real model factory and vector index with a deterministic embedder;
never downloads weights or uses building photos. Accuracy is not measured here.
"""
import csv
from io import BytesIO
import json
from types import SimpleNamespace
import sys

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image

from api.main import create_app
from ml.backend import create_backend
from ml.index import VectorIndex


def test_real_components_complete_photo_route_correct_loop(tmp_path, monkeypatch):
    a, b, room = 'F1_synthetic_a', 'F1_synthetic_b', 'F1_synthetic_room'
    graph = {'nodes': [
        {'id': a, 'floor': 1, 'x': 0, 'y': 0, 'label': 'Synthetic A'},
        {'id': b, 'floor': 1, 'x': 10, 'y': 0, 'label': 'Synthetic B'},
        {'id': room, 'floor': 1, 'x': 20, 'y': 0, 'label': 'Synthetic room'},
    ], 'edges': [
        {'from': a, 'to': b, 'meters': 10, 'stairs': False},
        {'from': b, 'to': room, 'meters': 10, 'stairs': False},
    ]}
    (tmp_path / 'graph.json').write_text(json.dumps(graph))
    (tmp_path / 'rooms.json').write_text(json.dumps([
        {'room': 'TEST', 'floor': 1, 'node': room, 'name': 'Synthetic destination'}]))
    with (tmp_path / 'labels.csv').open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=['label', 'heading', 'status'])
        writer.writeheader()
        writer.writerows([{'label': a, 'heading': b, 'status': 'keep'},
                          {'label': b, 'heading': room, 'status': 'keep'}])
    vector = np.zeros(384, dtype=np.float32)
    vector[0] = 1
    VectorIndex(vecs=np.repeat(vector[None, :], 10, axis=0),
                labels=[a] * 10, source=['video'] * 10).save(tmp_path / 'index.npz')

    class DeterministicEmbedder:
        model_name = 'synthetic-integration-embedder'

        def __call__(self, image):
            return vector.copy()

    loads = []

    def factory(directory):
        loads.append(directory)
        return create_backend(directory, embedder=DeterministicEmbedder(), ocr_reader=lambda image: (None, None))

    monkeypatch.setitem(sys.modules, 'integration_ml', SimpleNamespace(create_backend=factory))
    monkeypatch.setenv('HOUND_ML_FACTORY', 'integration_ml:create_backend')
    monkeypatch.delenv('HOUND_STUB_SPOT', raising=False)
    photo = BytesIO()
    with Image.new('RGB', (32, 32), 'red') as image:
        image.save(photo, format='PNG')
    raw = photo.getvalue()

    with TestClient(create_app(tmp_path)) as client:
        assert client.get('/health').json() == {
            'ok': True, 'index_size': 10, 'model': 'synthetic-integration-embedder'}
        first = client.post('/locate', files={'image': ('generated.png', raw, 'image/png')})
        assert first.status_code == 200
        first = first.json()
        assert first['spot'] == a
        assert first['heading'] == b
        assert 'vector' not in first
        initial_route = client.get('/route', params={
            'from': first['spot'], 'to': 'TEST', 'accessible': True, 'heading': first['heading']})
        assert initial_route.status_code == 200
        assert initial_route.json()['total_meters'] == 20

        corrected = client.post('/correct', json={'photo_id': first['photo_id'], 'true_spot': b})
        assert corrected.json() == {'ok': True, 'index_size': 11}
        second = client.post('/locate', files={'image': ('generated.png', raw, 'image/png')}).json()
        assert second['spot'] == b
        assert second['heading'] == room
        final_route = client.get('/route', params={
            'from': second['spot'], 'to': 'Synthetic destination', 'accessible': True,
            'heading': second['heading']})
        assert final_route.status_code == 200
        assert final_route.json()['total_meters'] == 10
        assert client.post('/correct', json={'photo_id': first['photo_id'], 'true_spot': b}).status_code == 410
        client.app.state.rollback_last_correction()
        assert client.get('/health').json()['index_size'] == 10
        after_rollback = client.post('/locate', files={'image': ('generated.png', raw, 'image/png')}).json()
        assert after_rollback['spot'] == a

    assert loads == [tmp_path]
    assert not list(tmp_path.rglob('*.png'))
    assert not list(tmp_path.rglob('*.jpg'))
