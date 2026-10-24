"""Restart and rollback behavior using the real vector index and synthetic data."""
import sqlite3

from fastapi.testclient import TestClient
import numpy as np
import pytest

from api.main import create_app
from ml.backend import Backend
from ml.index import VectorIndex
from test_backend import router, locate  # shared synthetic fixture/image helper


def model_for(router):
    vector = np.zeros(384, dtype=np.float32)
    vector[0] = 1
    index = VectorIndex(np.repeat(vector[None, :], 10, axis=0), ['test_hall'] * 10, ['video'] * 10)
    graph = {'nodes': list(router.nodes.values()), 'edges': [
        {**data, 'from': a, 'to': b} for a, b, data in router.graph.edges(data=True)]}
    return Backend(index, graph, {}, lambda image: vector.copy(), model_name='persistence-test')


def make_app(data, state, router):
    data.mkdir(exist_ok=True)
    return create_app(data, model_for(router), router, state_dir=state)


def save_correction(client):
    photo_id = locate(client).json()['photo_id']
    response = client.post('/correct', json={'photo_id': photo_id, 'true_spot': 'test_entry'})
    assert response.status_code == 200
    return photo_id


def test_learning_and_rollback_survive_restart(tmp_path, router):
    data, state = tmp_path / 'base', tmp_path / 'state'
    with TestClient(make_app(data, state, router)) as first:
        save_correction(first)
        assert first.app.state.index_version() == 1
        assert locate(first).json()['spot'] == 'test_entry'
    with TestClient(make_app(data, state, router)) as second:
        assert second.get('/health').json()['index_size'] == 11
        assert second.app.state.index_version() == 1
        assert locate(second).json()['spot'] == 'test_entry'
        assert second.app.state.rollback_last_correction() == 2
        assert second.get('/health').json()['index_size'] == 10
    with TestClient(make_app(data, state, router)) as third:
        assert third.app.state.index_version() == 2
        assert locate(third).json()['spot'] == 'test_hall'
        with pytest.raises(ValueError):
            third.app.state.rollback_last_correction()
    assert not list(tmp_path.rglob('*.jpg'))
    with sqlite3.connect(state / 'corrections.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM correction_vectors').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM corrections').fetchone()[0] == 0


def test_different_base_index_does_not_replay_old_corrections(tmp_path, router):
    data, state = tmp_path / 'base', tmp_path / 'state'
    with TestClient(make_app(data, state, router)) as first:
        save_correction(first)
    # The byte fingerprint changes even though this synthetic factory still
    # constructs its own index. Production fingerprints the real NPZ bytes.
    (data / 'index.npz').write_bytes(b'a different base version')
    with TestClient(make_app(data, state, router)) as second:
        assert second.get('/health').json()['index_size'] == 10
        assert second.app.state.index_version() == 0
    with sqlite3.connect(state / 'corrections.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM corrections').fetchone()[0] == 1


def test_different_building_directory_does_not_replay_shared_state(tmp_path, router):
    state = tmp_path / 'state'
    with TestClient(make_app(tmp_path / 'school_a', state, router)) as first:
        save_correction(first)
    with TestClient(make_app(tmp_path / 'school_b', state, router)) as second:
        assert second.get('/health').json()['index_size'] == 10


def test_failed_apply_does_not_leave_durable_vector(tmp_path, router, monkeypatch):
    data, state = tmp_path / 'base', tmp_path / 'state'
    app = make_app(data, state, router)
    # Inject a model whose swap fails; the vector/log/version transaction must
    # not be replayable on the next process.
    model = model_for(router)
    app = create_app(data, model, router, state_dir=state)
    with TestClient(app, raise_server_exceptions=False) as client:
        photo_id = locate(client).json()['photo_id']
        monkeypatch.setattr(model, 'apply_correction', lambda prepared: (_ for _ in ()).throw(RuntimeError('swap failed')))
        assert client.post('/correct', json={'photo_id': photo_id, 'true_spot': 'test_entry'}).status_code == 500
    with TestClient(make_app(data, state, router)) as second:
        assert second.get('/health').json()['index_size'] == 10
        assert second.app.state.index_version() == 0
    with sqlite3.connect(state / 'corrections.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM correction_vectors').fetchone()[0] == 0


def test_corrupted_vector_is_not_silently_replayed(tmp_path, router):
    data, state = tmp_path / 'base', tmp_path / 'state'
    with TestClient(make_app(data, state, router)) as first:
        save_correction(first)
    with sqlite3.connect(state / 'corrections.sqlite') as db:
        db.execute('UPDATE correction_vectors SET vector = ?', (b'invalid',))
    with pytest.raises(ValueError, match='invalid dimensions'):
        with TestClient(make_app(data, state, router)):
            pass
