"""Synthetic graph and generated images: no private building data in tests."""
from io import BytesIO
import sqlite3

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from api.main import create_app, MAX_UPLOAD
from api.recognition import StubBackend
from api.routing import Router


@pytest.fixture
def router():
    nodes = [
        {'id': 'test_entry', 'floor': 1, 'x': 0, 'y': 0, 'label': 'Entry'},
        {'id': 'test_hall', 'floor': 1, 'x': 10, 'y': 0, 'label': 'Hall', 'landmark': 'bench'},
        {'id': 'test_lift', 'floor': 1, 'x': 10, 'y': 10, 'label': 'Lift'},
        {'id': 'test_upper', 'floor': 2, 'x': 10, 'y': 10, 'label': 'Upper lift'},
        {'id': 'test_room', 'floor': 2, 'x': 20, 'y': 10, 'label': 'Test room'},
        {'id': 'test_isolated', 'floor': -1, 'x': 0, 'y': 0, 'label': 'Isolated'},
    ]
    edges = [
        {'from': 'test_entry', 'to': 'test_hall', 'meters': 10},
        {'from': 'test_hall', 'to': 'test_lift', 'meters': 10},
        {'from': 'test_lift', 'to': 'test_upper', 'meters': 0, 'vertical': True, 'cost': 30,
         'instruction': 'Take elevator up'},
        {'from': 'test_upper', 'to': 'test_room', 'meters': 10},
        {'from': 'test_hall', 'to': 'test_room', 'meters': 5, 'stairs': True, 'vertical': True},
        {'from': 'test_entry', 'to': 'test_isolated', 'meters': 1, 'verify': True},
    ]
    return Router({'nodes': nodes, 'edges': edges}, [
        {'room': 'TEST', 'name': 'Test destination', 'node': 'test_room', 'floor': 2}])


class FakeML(StubBackend):
    model_name = 'test-model'

    def locate(self, image, previous=None):
        self.seen_size = image.size
        self.seen_exif = dict(image.getexif())
        self.seen_previous = previous
        result = super().locate(image)
        result['confidence'] = 0.8
        result['top3'][0]['votes'] = 8
        result['private_diagnostic'] = 'must not leave API'
        return result


@pytest.fixture
def backend(tmp_path, router):
    model = FakeML(router.nodes['test_hall'])
    now = [0.0]
    app = create_app(tmp_path, model, router, clock=lambda: now[0],
                     allowed_origins=['https://example.vercel.app'])
    with TestClient(app) as client:
        yield client, model, app, now, tmp_path


def photo(color='red', format='JPEG', size=(1200, 600)):
    output = BytesIO()
    with Image.new('RGB', size, color) as image:
        exif = Image.Exif()
        exif[270] = 'private metadata'
        image.save(output, format=format, exif=exif)
    return output.getvalue()


def locate(client, color='red'):
    return client.post('/locate', files={'image': ('query.jpg', photo(color), 'image/jpeg')})


@pytest.mark.parametrize('color', ['red', 'green', 'blue'])
def test_locate_contract_and_privacy(backend, color):
    client, model, app, now, directory = backend
    response = locate(client, color)
    assert response.status_code == 200
    result = response.json()
    assert set(result) == {'photo_id', 'spot', 'floor', 'heading', 'confidence', 'top3',
                           'ocr_room', 'ocr_floor', 'p_correct', 'tier', 'ms'}
    assert result['spot'] == 'test_hall'
    assert result['photo_id'].startswith('p_')
    assert result['ms'] >= 0
    assert model.seen_size == (512, 256)
    assert model.seen_exif == {}
    assert {path.name for path in directory.iterdir()} == {'corrections.sqlite'}


def test_health_ready_and_missing_data(backend, tmp_path):
    client, model, *_ = backend
    assert client.get('/health').json() == {'ok': True, 'index_size': 0, 'model': 'test-model'}
    with TestClient(create_app(tmp_path / 'empty')) as empty:
        assert empty.get('/health').status_code == 503
        assert locate(empty).status_code == 503
        assert empty.get('/route', params={'from': 'unknown', 'to': 'unknown'}).status_code == 503
        assert empty.post('/correct', json={'photo_id': 'p_x', 'true_spot': 'unknown'}).status_code == 503


def test_second_photo_passes_the_first_photos_vector(backend):
    client, model, *_ = backend
    first = locate(client).json()
    assert model.seen_previous is None
    files = {'image': ('query.jpg', photo('green'), 'image/jpeg')}
    second = client.post('/locate', files=files, data={'previous': first['photo_id']})
    assert second.status_code == 200
    assert model.seen_previous is not None and model.seen_previous.shape == (384,)
    # An expired or unknown id falls back to a single-photo answer.
    unknown = client.post('/locate', files=files, data={'previous': 'p_' + '0' * 32})
    assert unknown.status_code == 200 and model.seen_previous is None
    assert client.post('/locate', files=files, data={'previous': 'not-an-id'}).status_code == 422


def test_accessible_route_and_alias(backend):
    client, *_ = backend
    params = {'from': 'test_entry', 'to': 'test destination', 'accessible': True,
              'heading': 'test_hall'}
    result = client.get('/route', params=params).json()
    assert [s['node'] for s in result['steps']] == ['test_hall', 'test_lift', 'test_upper', 'test_room']
    assert 'right' in result['steps'][1]['instruction']
    assert result['total_meters'] == 30
    assert result['est_seconds'] == 34
    params['accessible'] = False
    assert client.get('/route', params=params).json()['total_meters'] == 15


def test_route_legs_one_per_floor(router):
    legs = router.route('test_entry', 'test_room', accessible=True)['legs']
    assert [(leg['floor'], leg['start'], leg['end']) for leg in legs] == [
        (1, 'test_entry', 'test_lift'), (2, 'test_upper', 'test_room')]
    assert legs[0]['exit'] == {'mode': 'elevator', 'to_floor': 2}
    assert legs[-1]['exit'] is None
    # Normalized per leg: inside the padded box, aspect kept, no raw coordinates.
    assert legs[0]['points'] == [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]]
    assert legs[1]['points'] == [[0.1, 0.5], [0.9, 0.5]]
    stairs = router.route('test_entry', 'test_room')['legs']
    assert stairs[0]['exit'] == {'mode': 'stairs', 'to_floor': 2}
    assert router.route('test_entry', 'test_entry')['legs'] == [
        {'floor': 1, 'points': [[0.5, 0.5]], 'nodes': ['test_entry'],
         'branches': [[{'dx': 1.0, 'dy': 0.0, 'kind': 'hall'}]],
         'start': 'test_entry', 'end': 'test_entry', 'exit': None}]


def test_route_legs_ride_through_floors():
    graph = {'nodes': [
        {'id': 'synthetic_b1', 'floor': -1, 'x': 0, 'y': 0},
        {'id': 'synthetic_f1', 'floor': 1, 'x': 0, 'y': 0},
        {'id': 'synthetic_f2', 'floor': 2, 'x': 0, 'y': 0},
        {'id': 'synthetic_room', 'floor': 2, 'x': 0, 'y': 10},
    ], 'edges': [
        {'from': 'synthetic_b1', 'to': 'synthetic_f1', 'meters': 0, 'vertical': True},
        {'from': 'synthetic_f1', 'to': 'synthetic_f2', 'meters': 0, 'vertical': True},
        {'from': 'synthetic_f2', 'to': 'synthetic_room', 'meters': 10},
    ]}
    legs = Router(graph, []).route('synthetic_b1', 'synthetic_room')['legs']
    assert [leg['floor'] for leg in legs] == [-1, 2]
    assert legs[0]['exit'] == {'mode': 'elevator', 'to_floor': 2}


def test_cost_preferred_and_reverse_elevator(router):
    assert router.route('test_lift', 'test_upper')['total_meters'] == 25
    result = router.route('test_upper', 'test_lift', accessible=True)
    assert 'to 1' in result['steps'][0]['instruction']
    assert 'up' not in result['steps'][0]['instruction']


def test_route_errors_and_same_spot(backend):
    client, *_ = backend
    for start, to, status in [('missing', 'TEST', 422), ('test_entry', 'missing', 422),
                              ('test_entry', 'test_isolated', 404)]:
        assert client.get('/route', params={'from': start, 'to': to}).status_code == status
    assert client.get('/route', params={'from': 'test_entry', 'to': 'TEST',
                                       'heading': 'test_room'}).status_code == 422
    same = client.get('/route', params={'from': 'test_entry', 'to': 'test_entry'}).json()
    assert same == {'steps': [], 'total_meters': 0.0, 'est_seconds': 0, 'legs': [
        {'floor': 1, 'points': [[0.5, 0.5]], 'nodes': ['test_entry'],
         'branches': [[{'dx': 1.0, 'dy': 0.0, 'kind': 'hall'}]],
         'start': 'test_entry', 'end': 'test_entry', 'exit': None}]}


def test_correction_logging_replay_and_rollback(backend):
    client, model, app, now, directory = backend
    photo_id = locate(client).json()['photo_id']
    payload = {'photo_id': photo_id, 'true_spot': 'test_entry'}
    assert client.post('/correct', json=payload).json() == {'ok': True, 'index_size': 1}
    assert model.labels == ['test_entry']
    assert client.post('/correct', json=payload).json() == {'ok': True, 'index_size': 1}
    with sqlite3.connect(directory / 'corrections.sqlite') as db:
        assert db.execute('SELECT photo_id,true_spot,predicted FROM corrections').fetchone() == (
            photo_id, 'test_entry', 'test_hall')
    assert app.state.index_version() == 1
    assert app.state.rollback_last_correction() == 2
    assert model.labels == []
    with sqlite3.connect(directory / 'corrections.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM corrections').fetchone()[0] == 0
    with pytest.raises(ValueError):
        app.state.rollback_last_correction()


def test_expiry_and_unknown_node(backend):
    client, model, app, now, _ = backend
    photo_id = locate(client).json()['photo_id']
    assert client.post('/correct', json={'photo_id': photo_id, 'true_spot': 'invented'}).status_code == 422
    now[0] = 600
    assert client.post('/correct', json={'photo_id': photo_id, 'true_spot': 'test_entry'}).status_code == 410
    assert model.size == 0


def test_bounded_cache(tmp_path, router):
    with TestClient(create_app(tmp_path, FakeML(router.nodes['test_hall']), router, cache_limit=1)) as client:
        first = locate(client).json()['photo_id']
        second = locate(client).json()['photo_id']
        assert client.post('/correct', json={'photo_id': first, 'true_spot': 'test_entry'}).status_code == 410
        assert client.post('/correct', json={'photo_id': second, 'true_spot': 'test_entry'}).status_code == 200


def test_invalid_uploads(backend):
    client, *_ = backend
    assert client.post('/locate', json={}).status_code == 415
    assert client.post('/locate', files={'wrong': ('x.jpg', photo())}).status_code == 422
    for raw in (b'', b'not an image', photo(format='BMP', size=(12, 6))):
        assert client.post('/locate', files={'image': ('x.jpg', raw)}).status_code == 422
    assert client.post('/locate', files={'image': ('x.jpg', b'x' * (MAX_UPLOAD + 1))}).status_code == 413
    assert client.post('/locate', content=b'x' * (MAX_UPLOAD + 100_000)).status_code == 413


def test_cors_and_rate_limit(backend):
    client, *_ = backend
    for origin, allowed in [('https://example.vercel.app', True), ('https://evil.example', False)]:
        response = client.options('/correct', headers={'Origin': origin,
                                  'Access-Control-Request-Method': 'POST'})
        assert ('access-control-allow-origin' in response.headers) == allowed
    for _ in range(30):
        assert client.post('/correct', json={'photo_id': 'missing', 'true_spot': 'test_entry'}).status_code == 410
    assert client.post('/correct', json={'photo_id': 'missing', 'true_spot': 'test_entry'}).status_code == 429


def test_failure_does_not_partially_correct(backend, monkeypatch):
    client, model, app, now, directory = backend
    photo_id = locate(client).json()['photo_id']

    def fail(prepared):
        model.labels = ['partial']
        raise RuntimeError('private error detail')

    monkeypatch.setattr(model, 'apply_correction', fail)
    with TestClient(app, raise_server_exceptions=False) as errors:
        response = errors.post('/correct', json={'photo_id': photo_id, 'true_spot': 'test_entry'})
    assert response.status_code == 500
    assert response.json() == {'detail': 'Internal server error'}
    assert model.labels == []
    assert app.state.index_version() == 0
    with sqlite3.connect(directory / 'corrections.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM corrections').fetchone()[0] == 0


def test_large_upload_never_spools_to_disk(backend, monkeypatch):
    import tempfile
    client, *_ = backend

    def forbid_disk(*args, **kwargs):
        raise AssertionError('User image spooled to disk')

    monkeypatch.setattr(tempfile, 'TemporaryFile', forbid_disk)
    pixels = np.random.default_rng(42).integers(0, 256, (1100, 1100, 3), dtype=np.uint8)
    output = BytesIO()
    with Image.fromarray(pixels) as image:
        image.save(output, format='JPEG', quality=95)
    raw = output.getvalue()
    assert 1024 * 1024 < len(raw) <= MAX_UPLOAD
    assert client.post('/locate', files={'image': ('noise.jpg', raw)}).status_code == 200


def test_chunked_body_limit(backend):
    client, *_ = backend
    response = client.post('/locate', content=iter([b'x' * 800_000] * 3),
                           headers={'Content-Type': 'multipart/form-data; boundary=test'})
    assert response.status_code == 413


def test_malformed_multipart(backend):
    client, *_ = backend
    assert client.post('/locate', content=b'invalid', headers={
        'Content-Type': 'multipart/form-data'}).status_code == 422


def test_group_straight_segments_and_heading():
    graph = {'nodes': [
        {'id': 'synthetic_a', 'floor': 1, 'x': 0, 'y': 0, 'label': 'A'},
        {'id': 'synthetic_b', 'floor': 1, 'x': 10, 'y': 0, 'label': 'B'},
        {'id': 'synthetic_c', 'floor': 1, 'x': 20, 'y': 0, 'label': 'C'},
        {'id': 'synthetic_n', 'floor': 1, 'x': 0, 'y': -10, 'label': 'North'},
    ], 'edges': [
        {'from': 'synthetic_a', 'to': 'synthetic_b', 'meters': 10},
        {'from': 'synthetic_b', 'to': 'synthetic_c', 'meters': 10},
        {'from': 'synthetic_a', 'to': 'synthetic_n', 'meters': 10},
    ]}
    routes = Router(graph, [])
    result = routes.route('synthetic_a', 'synthetic_c', heading='synthetic_n')
    assert result['steps'] == [{'instruction': 'Turn right and walk toward C',
                               'meters': 20, 'node': 'synthetic_c', 'passes': []}]
    reverse = routes.route('synthetic_b', 'synthetic_a', heading='synthetic_c')
    assert reverse['steps'][0]['instruction'].startswith('Turn around')


def test_turn_wording_shallow_bends_and_doors():
    graph = {'nodes': [
        {'id': 'synthetic_a', 'floor': 1, 'x': 0, 'y': 0, 'label': 'A'},
        {'id': 'synthetic_b', 'floor': 1, 'x': 10, 'y': 0, 'label': 'B'},
        # 35 degrees off the corridor line: a bend, not a turn.
        {'id': 'synthetic_c', 'floor': 1, 'x': 20, 'y': 7, 'label': 'C'},
        {'id': 'synthetic_d', 'floor': 1, 'x': 20, 'y': 17, 'label': 'D'},
        # A door just beside the corridor.
        {'id': 'synthetic_door', 'floor': 1, 'x': 14, 'y': 3, 'label': 'Door', 'type': 'room'},
        {'id': 'synthetic_far', 'floor': 1, 'x': 22, 'y': -2, 'label': 'Far'},
    ], 'edges': [
        {'from': 'synthetic_a', 'to': 'synthetic_b', 'meters': 10},
        {'from': 'synthetic_b', 'to': 'synthetic_c', 'meters': 12},
        {'from': 'synthetic_c', 'to': 'synthetic_d', 'meters': 10},
        {'from': 'synthetic_b', 'to': 'synthetic_door', 'meters': 5},
        {'from': 'synthetic_door', 'to': 'synthetic_far', 'meters': 9},
    ]}
    routes = Router(graph, [])
    bend = routes.route('synthetic_a', 'synthetic_c')
    assert [s['instruction'] for s in bend['steps']] == ['Walk toward C']
    turn = routes.route('synthetic_a', 'synthetic_d')
    assert turn['steps'][-1]['instruction'] == 'Turn right and walk toward D'
    door = routes.route('synthetic_a', 'synthetic_door')
    assert door['steps'] == [{'instruction': 'Walk toward Door, on your right',
                              'meters': 15, 'node': 'synthetic_door', 'passes': []}]
    # Passing through a door node never reads as a turn.
    through = routes.route('synthetic_a', 'synthetic_far')
    assert [s['instruction'] for s in through['steps']] == ['Walk toward Far']


def test_one_way_edge():
    graph = {'nodes': [{'id': 'synthetic_a', 'floor': 1, 'x': 0, 'y': 0},
                       {'id': 'synthetic_b', 'floor': 1, 'x': 1, 'y': 0}],
             'edges': [{'from': 'synthetic_a', 'to': 'synthetic_b', 'meters': 1, 'one_way': True}]}
    routes = Router(graph, [])
    assert routes.route('synthetic_a', 'synthetic_b')['total_meters'] == 1
    with pytest.raises(LookupError):
        routes.route('synthetic_b', 'synthetic_a')


def test_factory_loaded_once(tmp_path, router, monkeypatch):
    import json
    import sys
    from types import SimpleNamespace
    graph = {'nodes': list(router.nodes.values()), 'edges': []}
    (tmp_path / 'graph.json').write_text(json.dumps(graph))
    (tmp_path / 'rooms.json').write_text('[]')
    calls = []

    def factory(directory):
        calls.append(directory)
        return FakeML(router.nodes['test_hall'])

    monkeypatch.setitem(sys.modules, 'synthetic_ml', SimpleNamespace(create_backend=factory))
    monkeypatch.setenv('HOUND_ML_FACTORY', 'synthetic_ml:create_backend')
    monkeypatch.delenv('HOUND_STUB_SPOT', raising=False)
    with TestClient(create_app(tmp_path)) as client:
        assert locate(client).status_code == 200
        assert locate(client).status_code == 200
    assert calls == [tmp_path]


def test_inference_does_not_block_request_middleware(backend, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    client, model, *_ = backend
    entered, release = Event(), Event()
    original = model.locate

    def slow_locate(image):
        entered.set()
        assert release.wait(5)
        return original(image)

    monkeypatch.setattr(model, 'locate', slow_locate)
    with ThreadPoolExecutor(max_workers=2) as pool:
        matching = pool.submit(locate, client)
        try:
            assert entered.wait(2)
            unrelated = pool.submit(client.post, '/not-an-endpoint')
            assert unrelated.result(timeout=2).status_code == 404
        finally:
            release.set()
        assert matching.result(timeout=2).status_code == 200


def test_directions_name_landmarks_passed_and_where_to_step_out():
    graph = {'nodes': [
        {'id': 'synthetic_a', 'floor': 1, 'x': 0, 'y': 0, 'type': 'hallway', 'short': 'the west hallway'},
        {'id': 'synthetic_b', 'floor': 1, 'x': 10, 'y': 0, 'type': 'hallway'},
        {'id': 'synthetic_c', 'floor': 1, 'x': 20, 'y': 0, 'type': 'hallway'},
        # Beside the hallway at B: restrooms below the line (right, y grows down), stairs above (left).
        {'id': 'synthetic_wc', 'floor': 1, 'x': 10, 'y': 4, 'type': 'room', 'short': 'the restrooms'},
        {'id': 'synthetic_st', 'floor': 1, 'x': 10, 'y': -4, 'type': 'stairs', 'short': 'the main stairs'},
        {'id': 'synthetic_lift', 'floor': 1, 'x': 20, 'y': 5, 'type': 'elevator', 'short': 'the elevators'},
        {'id': 'synthetic_up', 'floor': 2, 'x': 20, 'y': 5, 'type': 'elevator', 'short': 'the elevators'},
        {'id': 'synthetic_hall2', 'floor': 2, 'x': 20, 'y': 12, 'type': 'hallway', 'short': 'the upper hallway'},
    ], 'edges': [
        {'from': 'synthetic_a', 'to': 'synthetic_b', 'meters': 10},
        {'from': 'synthetic_b', 'to': 'synthetic_c', 'meters': 10},
        {'from': 'synthetic_b', 'to': 'synthetic_wc', 'meters': 3},
        {'from': 'synthetic_b', 'to': 'synthetic_st', 'meters': 3},
        {'from': 'synthetic_c', 'to': 'synthetic_lift', 'meters': 4},
        {'from': 'synthetic_lift', 'to': 'synthetic_up', 'meters': 0, 'vertical': True},
        {'from': 'synthetic_up', 'to': 'synthetic_hall2', 'meters': 6},
    ]}
    result = Router(graph, []).route('synthetic_a', 'synthetic_hall2')
    walk = result['steps'][0]
    assert walk['node'] == 'synthetic_c'
    assert walk['passes'] == [{'name': 'the main stairs', 'side': 'left'},
                              {'name': 'the restrooms', 'side': 'right'}]
    ride = next(s for s in result['steps'] if s['instruction'].startswith('Take the elevator'))
    # Name where you step out to, not the elevator you're already in.
    assert ride['instruction'] == 'Take the elevator to 2, then head toward the upper hallway'
    assert ride['passes'] == []


def test_legs_carry_branch_directions_only():
    graph = {'nodes': [
        {'id': 'synthetic_a', 'floor': 1, 'x': 0, 'y': 0},
        {'id': 'synthetic_b', 'floor': 1, 'x': 10, 'y': 0},
        {'id': 'synthetic_c', 'floor': 1, 'x': 20, 'y': 0},
        {'id': 'synthetic_side', 'floor': 1, 'x': 10, 'y': 30, 'type': 'hallway'},
        {'id': 'synthetic_door', 'floor': 1, 'x': 10, 'y': -2, 'type': 'room'},
    ], 'edges': [
        {'from': 'synthetic_a', 'to': 'synthetic_b', 'meters': 10},
        {'from': 'synthetic_b', 'to': 'synthetic_c', 'meters': 10},
        {'from': 'synthetic_b', 'to': 'synthetic_side', 'meters': 30},
        {'from': 'synthetic_b', 'to': 'synthetic_door', 'meters': 2},
    ]}
    leg = Router(graph, []).route('synthetic_a', 'synthetic_c')['legs'][0]
    assert leg['nodes'] == ['synthetic_a', 'synthetic_b', 'synthetic_c']
    # A unit direction and a kind per opening: never the far node's position or name.
    assert leg['branches'] == [[], [{'dx': 0.0, 'dy': -1.0, 'kind': 'door'},
                                     {'dx': 0.0, 'dy': 1.0, 'kind': 'hall'}], []]
