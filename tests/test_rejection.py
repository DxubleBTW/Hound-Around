"""A unanimous neighbor vote must not turn an unrelated image into a location."""
import json
from io import BytesIO

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from api.main import create_app
from ml.backend import Backend
from ml.calibrate_rejection import calibrate
from ml.errors import UnrecognizedLocation
from ml.index import VectorIndex
from ml.rejection import file_digest, load_threshold
from test_backend import router


def test_no_correlation_rejected_even_when_all_neighbors_agree(router):
    known = np.zeros(384, dtype=np.float32)
    known[0] = 1
    unrelated = np.zeros(384, dtype=np.float32)
    unrelated[1] = 1
    index = VectorIndex(np.repeat(known[None, :], 10, axis=0), ['test_hall'] * 10, ['video'] * 10)
    graph = {'nodes': list(router.nodes.values()), 'edges': []}
    backend = Backend(index, graph, {}, lambda image: unrelated, min_similarity=0.7)
    with pytest.raises(UnrecognizedLocation):
        backend.locate(None)
    backend._embed = lambda image: known
    assert backend.locate(None)['spot'] == 'test_hall'


def test_api_rejects_without_issuing_photo_id_or_learning(tmp_path, router):
    class Rejecting:
        model_name = 'synthetic-rejection'
        size = 10
        def snapshot(self): return None
        def locate(self, image): raise UnrecognizedLocation()
    output = BytesIO()
    with Image.new('RGB', (32, 32), 'red') as image:
        image.save(output, format='PNG')
    with TestClient(create_app(tmp_path, Rejecting(), router)) as client:
        response = client.post('/locate', files={'image': ('generated.png', output.getvalue())})
        assert response.status_code == 422
        assert response.json()['detail']['code'] == 'unrecognized_location'
        assert 'photo_id' not in response.json()
        assert client.get('/health').json()['index_size'] == 10
    assert not list(tmp_path.rglob('*.png'))


def test_threshold_requires_both_validation_classes():
    with pytest.raises(ValueError, match='both known'):
        calibrate([{'split': 'validation', 'similarity': 0.9, 'is_known': 'true'}])
    with pytest.raises(ValueError, match='Only validation'):
        calibrate([{'split': 'test', 'similarity': 0.9, 'is_known': 'true'}])


def test_calibration_separates_known_and_unrelated_scores():
    rows = [{'split': 'validation', 'similarity': x, 'is_known': str(known)}
            for known, values in [(True, [.85, .9, .95]), (False, [.3, .4, .5])] for x in values]
    result = calibrate(rows, max_false_accept=0, min_known_recall=1)
    assert .5 < result['min_similarity'] < .85
    assert result['known_recall'] == 1
    assert result['unrelated_false_accept'] == 0


def test_inseparable_scores_do_not_produce_a_misleading_cutoff():
    rows = [{'split': 'validation', 'similarity': .8, 'is_known': str(x)} for x in (True, False)]
    with pytest.raises(ValueError, match='cannot meet both'):
        calibrate(rows, max_false_accept=0, min_known_recall=.9)


def test_config_is_bound_to_exact_index_and_model(tmp_path, monkeypatch):
    monkeypatch.delenv('HOUND_MIN_SIMILARITY', raising=False)
    index = tmp_path / 'index.npz'
    index.write_bytes(b'synthetic index')
    assert load_threshold(tmp_path, index, 'test-model') is None
    config = {'model': 'test-model', 'index_sha256': file_digest(index), 'min_similarity': .7}
    (tmp_path / 'recognition.json').write_text(json.dumps(config))
    assert load_threshold(tmp_path, index, 'test-model') == .7
    index.write_bytes(b'different index')
    with pytest.raises(ValueError, match='recalibrate'):
        load_threshold(tmp_path, index, 'test-model')


@pytest.mark.parametrize('value', ['nan', 'inf', '-2', '1.1'])
def test_invalid_configured_threshold_is_rejected(tmp_path, monkeypatch, value):
    monkeypatch.setenv('HOUND_MIN_SIMILARITY', value)
    with pytest.raises(ValueError):
        load_threshold(tmp_path, tmp_path / 'index.npz')


def test_score_collection_uses_private_validation_images_and_query_resize(tmp_path):
    from ml.rejection_scores import collect_scores
    vector = np.zeros(384, dtype=np.float32)
    vector[0] = 1
    index = VectorIndex(vector[None, :], ['F1_synthetic'], ['video'])
    for name, color in [('known', 'red'), ('unrelated', 'blue')]:
        folder = tmp_path / name
        folder.mkdir()
        with Image.new('RGB', (1200, 600), color) as image:
            image.save(folder / 'generated.png')
    seen = []
    def embed(image):
        seen.append(image.size)
        result = np.zeros(384, dtype=np.float32)
        result[0 if image.getpixel((0, 0))[0] else 1] = 1
        return result
    rows = collect_scores(index, embed, tmp_path, 'synthetic-index-digest')
    assert seen == [(512, 256), (512, 256)]
    assert [row['similarity'] for row in rows] == [1, 0]
    assert all(row['split'] == 'validation' for row in rows)
    assert all(row['index_sha256'] == 'synthetic-index-digest' for row in rows)


def test_final_outsider_photos_cannot_be_used_to_tune_rejection(tmp_path):
    from ml.rejection_scores import collect_scores
    folder = tmp_path / 'known'
    folder.mkdir()
    with Image.new('RGB', (32, 32), 'red') as image:
        image.save(folder / 'TEST_F1_synthetic_01.jpg')
    with pytest.raises(ValueError, match='final TEST_'):
        collect_scores(None, None, tmp_path, 'digest')


def test_invalid_configuration_is_a_clear_configuration_error(tmp_path, monkeypatch):
    monkeypatch.delenv('HOUND_MIN_SIMILARITY', raising=False)
    index = tmp_path / 'index.npz'
    index.write_bytes(b'synthetic index')
    path = tmp_path / 'recognition.json'
    for config in ([], {}, {'model':'facebook/dinov2-small','index_sha256':file_digest(index),'min_similarity':None},
                   {'model':'facebook/dinov2-small','index_sha256':file_digest(index),'min_similarity':True}):
        path.write_text(json.dumps(config))
        with pytest.raises(ValueError):
            load_threshold(tmp_path, index)
