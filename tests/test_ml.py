"""Synthetic-only tests for the ml/ recognition package.

No torch / transformers / easyocr, no building photos. A deterministic fake
embedder maps a solid-color image to a fixed 384-d vector; graphs are made up.
"""
from io import BytesIO
import json

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from ml.backend import Backend, create_backend
from ml.embedder import DIM, normalize
from ml.index import CORRECTION_WEIGHT, VectorIndex


# --- synthetic fixtures ---------------------------------------------------

def basis(seed, dim=DIM):
    """A fixed pseudo-random unit vector for a given seed."""
    rng = np.random.default_rng(seed)
    return normalize(rng.standard_normal(dim).astype(np.float32))


# Three near-orthogonal direction vectors, one per solid color.
COLOR_VEC = {
    (255, 0, 0): basis(1),     # red
    (0, 128, 0): basis(2),     # green
    (0, 0, 255): basis(3),     # blue
    (0, 0, 0): basis(4),       # black (used for a distinct query)
}


class FakeEmbedder:
    """Maps a solid-color PIL image to a fixed 384-d vector. Batch-capable."""

    model_name = 'fake-embedder'
    batched = True

    def _one(self, image):
        color = image.getpixel((0, 0))
        if color in COLOR_VEC:
            return COLOR_VEC[color].copy()
        # Deterministic fallback from the color tuple.
        return basis(sum(color) + 100)

    def __call__(self, images):
        if isinstance(images, (list, tuple)):
            return normalize(np.stack([self._one(im) for im in images]))
        return self._one(images)


def solid(color):
    return Image.new('RGB', (32, 32), color)


def synthetic_graph():
    """Nodes across floors with a simple adjacency for heading tests."""
    return {
        'nodes': [
            {'id': 'F1_a', 'floor': 1, 'x': 0, 'y': 0, 'label': 'A'},
            {'id': 'F1_b', 'floor': 1, 'x': 1, 'y': 0, 'label': 'B'},
            {'id': 'F2_c', 'floor': 2, 'x': 2, 'y': 0, 'label': 'C'},
            {'id': 'B1_d', 'floor': -1, 'x': 3, 'y': 0, 'label': 'D'},
        ],
        'edges': [
            {'from': 'F1_a', 'to': 'F1_b', 'meters': 1},
            {'from': 'F1_b', 'to': 'F2_c', 'meters': 1, 'vertical': True},
        ],
    }


def make_index(rows):
    """rows: list of (color, label, source) -> VectorIndex."""
    vecs = np.stack([COLOR_VEC[c] for c, _, _ in rows])
    labels = [l for _, l, _ in rows]
    source = [s for _, _, s in rows]
    return VectorIndex(vecs=vecs, labels=labels, source=source)


def build(index, graph=None, headings=None, ocr_reader=None, top_k=10, rooms=None):
    graph = graph or synthetic_graph()
    return Backend(index, graph, headings or {}, FakeEmbedder(),
                   ocr_reader=ocr_reader, top_k=top_k, rooms=rooms)


# --- contract shape -------------------------------------------------------

def test_locate_contract_shape():
    red, green, blue = (255, 0, 0), (0, 128, 0), (0, 0, 255)
    index = make_index([
        (red, 'F1_a', 'video'), (red, 'F1_a', 'video'), (red, 'F1_a', 'video'),
        (green, 'F1_b', 'video'), (blue, 'F2_c', 'video'),
    ])
    backend = build(index)
    result = backend.locate(solid(red))
    assert set(result) == {'spot', 'floor', 'heading', 'confidence', 'top3',
                           'ocr_room', 'ocr_floor', 'vector'}
    assert result['spot'] == 'F1_a'
    assert result['floor'] == 1
    vector = np.asarray(result['vector'], dtype=np.float32)
    assert vector.shape == (DIM,)
    assert np.isfinite(vector).all() and np.linalg.norm(vector) > 0


def far_graph():
    """synthetic_graph() with F1_a and F1_b 30 m apart (no neighborhood pooling)."""
    graph = synthetic_graph()
    graph['edges'][0] = {'from': 'F1_a', 'to': 'F1_b', 'meters': 30}
    return graph


def test_confidence_math():
    red = (255, 0, 0)
    # 7 red->F1_a out of top_k=10 -> confidence 0.7 when F1_b is far away.
    rows = [(red, 'F1_a', 'video')] * 7 + [((0, 128, 0), 'F1_b', 'video')] * 5
    backend = build(make_index(rows), graph=far_graph(), top_k=10)
    result = backend.locate(solid(red))
    assert result['spot'] == 'F1_a'
    assert result['top3'][0]['votes'] == 7
    assert result['confidence'] == pytest.approx(0.7)


def test_confidence_pools_votes_from_nearby_spots():
    red = (255, 0, 0)
    # F1_b is 1 m from F1_a on the same floor: its 3 votes say "same place".
    rows = [(red, 'F1_a', 'video')] * 7 + [((0, 128, 0), 'F1_b', 'video')] * 5
    result = build(make_index(rows), top_k=10).locate(solid(red))
    assert result['spot'] == 'F1_a'
    assert result['top3'][0]['votes'] == 7  # votes stay honest per spot
    assert result['confidence'] == pytest.approx(1.0)
    # F2_c is 1 m from F1_b in the graph but on another floor: never pooled.
    rows = [(red, 'F1_b', 'video')] * 6 + [((0, 0, 255), 'F2_c', 'video')] * 4
    result = build(make_index(rows), top_k=10).locate(solid(red))
    assert result['confidence'] == pytest.approx(0.6)


def test_top3_ordering_and_similarity_tiebreak():
    red, green, blue = (255, 0, 0), (0, 128, 0), (0, 0, 255)
    # Equal votes for two labels; red query is more similar to F1_a exemplars.
    rows = [(red, 'F1_a', 'video'), (red, 'F1_a', 'video'),
            (green, 'F1_b', 'video'), (green, 'F1_b', 'video'),
            (blue, 'F2_c', 'video')]
    backend = build(make_index(rows), top_k=10)
    result = backend.locate(solid(red))
    top3 = result['top3']
    # votes descending
    assert [v['votes'] for v in top3] == sorted((v['votes'] for v in top3), reverse=True)
    # tie between F1_a and F1_b (2 votes each); red query closer to F1_a wins.
    assert top3[0]['spot'] == 'F1_a'


def test_floor_from_winning_node():
    blue = (0, 0, 255)
    backend = build(make_index([(blue, 'F2_c', 'video')] * 3))
    result = backend.locate(solid(blue))
    assert result['spot'] == 'F2_c'
    assert result['floor'] == 2  # F2 node floor


def test_heading_only_when_graph_neighbor():
    red = (255, 0, 0)
    # heading F1_b is a graph neighbor of F1_a -> used.
    backend = build(make_index([(red, 'F1_a', 'video')] * 3),
                    headings={'F1_a': 'F1_b'})
    assert backend.locate(solid(red))['heading'] == 'F1_b'

    # heading B1_d is NOT a neighbor of F1_a -> null.
    backend2 = build(make_index([(red, 'F1_a', 'video')] * 3),
                     headings={'F1_a': 'B1_d'})
    assert backend2.locate(solid(red))['heading'] is None


# --- one correction flips the next query ---------------------------------

def test_one_correction_flips_next_query():
    red = (255, 0, 0)
    # Index votes red -> F1_a (3 stale video exemplars).
    index = make_index([(red, 'F1_a', 'video')] * 3 + [((0, 0, 255), 'F2_c', 'video')])
    backend = build(index)
    first = backend.locate(solid(red))
    assert first['spot'] == 'F1_a'

    # Correct a near-identical red photo to F1_b and apply it.
    query_vector = COLOR_VEC[red]
    prepared = backend.prepare_correction(query_vector, 'F1_b')
    # prepare must NOT mutate the live index.
    assert backend.index.labels == ['F1_a', 'F1_a', 'F1_a', 'F2_c']
    backend.apply_correction(prepared)
    assert backend.index.source[-1] == 'correction'

    # The very next near-identical red query now resolves to F1_b.
    second = backend.locate(solid(red))
    assert second['spot'] == 'F1_b'
    # Correction vote weighting carried the flip.
    assert CORRECTION_WEIGHT >= 3


# --- snapshot / restore independence --------------------------------------

def test_snapshot_restore_independence():
    red = (255, 0, 0)
    backend = build(make_index([(red, 'F1_a', 'video')] * 2))
    snap = backend.snapshot()

    # Mutate the live index after taking the snapshot.
    backend.apply_correction(backend.prepare_correction(COLOR_VEC[red], 'F1_b'))
    assert len(backend.index) == 3
    # Snapshot is unchanged (no aliasing).
    assert len(snap) == 2
    assert snap.labels == ['F1_a', 'F1_a']

    # Restore brings back the pre-correction state, independent of later edits.
    backend.restore(snap)
    assert backend.index.labels == ['F1_a', 'F1_a']
    # Mutating the restored index must not touch the snapshot array.
    backend.index.vecs[0, 0] = 999.0
    assert snap.vecs[0, 0] != 999.0


# --- image not retained ---------------------------------------------------

def test_image_not_retained():
    import gc
    import weakref
    red = (255, 0, 0)
    backend = build(make_index([(red, 'F1_a', 'video')] * 3))
    image = solid(red)
    ref = weakref.ref(image)
    backend.locate(image)
    del image
    gc.collect()
    assert ref() is None  # backend kept no reference to the image.


# --- OCR gating and floor override ----------------------------------------

def test_ocr_skipped_on_confident_single_floor():
    red = (255, 0, 0)
    calls = []

    def reader(image):
        calls.append(image)
        return '164', 1

    # 9/10 votes -> confident, single floor -> OCR gate skips.
    backend = build(make_index([(red, 'F1_a', 'video')] * 9), ocr_reader=reader)
    result = backend.locate(solid(red))
    assert calls == []
    assert result['ocr_room'] is None and result['ocr_floor'] is None


def test_ocr_floor_override_picks_best_on_that_floor():
    red, blue = (255, 0, 0), (0, 0, 255)
    # Low confidence vote winner is F1_a (floor 1); OCR says floor 2.
    rows = [(red, 'F1_a', 'video'), (red, 'F1_a', 'video'), (blue, 'F2_c', 'video')]
    backend = build(make_index(rows), ocr_reader=lambda im: ('248', 2))
    result = backend.locate(solid(red))
    # OCR floor wins -> best-voted spot on floor 2 among neighbors.
    assert result['floor'] == 2
    assert result['spot'] == 'F2_c'
    assert result['ocr_room'] == '248' and result['ocr_floor'] == 2
    # Confidence is reseated to the override winner's honest vote fraction
    # (F2_c has 1 vote, top_k=10 -> 0.1), still a true votes/k with no x0.5,
    # so Confirm.jsx's round(confidence*10) meter equals the winner's votes.
    override_votes = next(t['votes'] for t in result['top3'] if t['spot'] == 'F2_c')
    assert result['confidence'] == pytest.approx(override_votes / backend.top_k)
    assert result['confidence'] == pytest.approx(0.1)
    assert round(result['confidence'] * backend.top_k) == override_votes


# --- Goal 2: floor/hallway robustness -------------------------------------

def test_wrong_floor_lookalike_is_corrected_by_ocr_floor():
    # Voting picks a wrong-floor look-alike (F1_a wins 2-1), but OCR reads the
    # correct floor 2: the override returns a spot on the OCR floor, and the
    # contract dict shape stays intact with a valid 0..1 confidence.
    red, blue = (255, 0, 0), (0, 0, 255)
    rows = [(red, 'F1_a', 'video'), (red, 'F1_a', 'video'), (blue, 'F2_c', 'video')]
    backend = build(make_index(rows), ocr_reader=lambda im: ('248', 2))
    result = backend.locate(solid(red))
    assert result['floor'] == 2
    assert result['spot'] == 'F2_c'           # top3[0] on the OCR floor
    assert result['top3'][0]['spot'] == 'F2_c'
    assert backend._floor[result['spot']] == result['floor']  # API invariant
    assert 0.0 <= result['confidence'] <= 1.0
    assert set(result) == {'spot', 'floor', 'heading', 'confidence', 'top3',
                           'ocr_room', 'ocr_floor', 'vector'}


def test_ocr_room_resolved_via_rooms_json_sets_floor_without_numeral():
    # The sign shows only a room number (no "Floor N"); the OCR reader returns
    # floor=None. rooms.json maps that room to a known F2 node, so the backend
    # still corrects the floor to 2 and returns a spot there.
    red, blue = (255, 0, 0), (0, 0, 255)
    rows = [(red, 'F1_a', 'video'), (red, 'F1_a', 'video'), (blue, 'F2_c', 'video')]
    rooms = [{'room': '248', 'floor': 2, 'node': 'F2_c', 'name': 'Room 248'}]
    backend = build(make_index(rows), ocr_reader=lambda im: ('248', None), rooms=rooms)
    result = backend.locate(solid(red))
    assert result['floor'] == 2
    assert result['spot'] == 'F2_c'
    assert result['ocr_room'] == '248' and result['ocr_floor'] is None
    assert backend._floor[result['spot']] == result['floor']


def test_rooms_json_entries_outside_scope_or_graph_are_ignored():
    # Guarded loading: a bad floor, an unknown node, or a missing room must not
    # enter the room->floor map (no hard dependency on rooms.json shape).
    rooms = [
        {'room': '305', 'floor': 3, 'node': 'F2_c'},    # floor out of scope
        {'room': '777', 'floor': 2, 'node': 'ghost'},   # node not in graph
        {'floor': 2, 'node': 'F2_c'},                   # no room key
        {'room': '248', 'floor': 2, 'node': 'F2_c'},    # valid
    ]
    backend = build(make_index([((255, 0, 0), 'F1_a', 'video')]), rooms=rooms)
    assert backend._room_floor == {'248': 2}


def test_no_ocr_read_leaves_vote_unchanged():
    # OCR reads nothing: the floor/spot stay exactly what voting produced.
    red, blue = (255, 0, 0), (0, 0, 255)
    rows = [(red, 'F1_a', 'video'), (red, 'F1_a', 'video'), (blue, 'F2_c', 'video')]
    backend = build(make_index(rows), ocr_reader=lambda im: (None, None))
    result = backend.locate(solid(red))
    assert result['spot'] == 'F1_a' and result['floor'] == 1
    assert result['ocr_room'] is None and result['ocr_floor'] is None


def test_raised_gate_runs_ocr_on_middling_single_floor_vote():
    # 8/10 votes (0.8 confidence) with a lone neighbor on another floor: below
    # the 0.85 gate, so OCR runs even though top3 might not span floors here.
    from ml.backend import OCR_CONFIDENCE_GATE
    assert OCR_CONFIDENCE_GATE == 0.85
    red = (255, 0, 0)
    calls = []

    def reader(image):
        calls.append(image)
        return None, None

    # 8 red->F1_a, 2 green->F1_b, far apart so no neighborhood pooling: 0.8.
    rows = [(red, 'F1_a', 'video')] * 8 + [((0, 128, 0), 'F1_b', 'video')] * 2
    backend = build(make_index(rows), graph=far_graph(), ocr_reader=reader)
    result = backend.locate(solid(red))
    assert result['confidence'] == pytest.approx(0.8)
    assert calls, 'OCR should run when confidence (0.8) is below the 0.85 gate'


def test_clearly_confident_single_floor_still_skips_ocr():
    # 9/10 single-floor vote (0.9 >= 0.85 gate) must still skip OCR: it stays
    # gated so the latency cost is not paid on confident queries.
    red = (255, 0, 0)
    calls = []

    def reader(image):
        calls.append(image)
        return None, None

    backend = build(make_index([(red, 'F1_a', 'video')] * 9),
                    graph=far_graph(), ocr_reader=reader)
    result = backend.locate(solid(red))
    assert result['confidence'] == pytest.approx(0.9)
    assert calls == []


# --- build_index unit test (tmp_path, not data/) --------------------------

def test_build_index_contract_format(tmp_path):
    graph = synthetic_graph()
    (tmp_path / 'graph.json').write_text(json.dumps(graph))

    train = tmp_path / 'dataset' / 'train'
    colors = {'F1_a': (255, 0, 0), 'F1_b': (0, 128, 0), 'F2_c': (0, 0, 255)}
    rows = ['file,video,t_sec,label,label_source,in_graph,sharpness,dup_of_prev,status,heading']
    # 70 keep frames for F1_a (exceeds the ~60 cap), a few for others, and one
    # rejected row that must be excluded.
    _ensure(train / 'F1_a')
    for i in range(70):
        name = f'F1_a_{i}.jpg'
        solid(colors['F1_a']).save(train / 'F1_a' / name)
        rows.append(f'{name},v1,{i}.0,F1_a,card,true,1800,false,keep,F1_b')
    for spot in ('F1_b', 'F2_c'):
        _ensure(train / spot)
        for i in range(5):
            name = f'{spot}_{i}.jpg'
            solid(colors[spot]).save(train / spot / name)
            rows.append(f'{name},v2,{i}.0,{spot},card,true,1800,false,keep,')
    rows.append('bad.jpg,v3,0.0,F1_a,card,true,10,false,reject_blurry,')
    (tmp_path / 'labels.csv').write_text('\n'.join(rows) + '\n')

    from ml.build_index import build_index
    from ml.embedder import INDEX_VIEWS
    out_path, counts = build_index(tmp_path, embed_fn=FakeEmbedder(), cap=60)

    assert out_path == tmp_path / 'index.npz'
    data = np.load(out_path, allow_pickle=False)
    assert data['vecs'].dtype == np.float16
    assert data['vecs'].shape[1] == DIM
    assert set(data['source'].tolist()) == {'video'}
    assert counts['F1_a'] == 60  # capped
    assert counts['F1_b'] == 5 and counts['F2_c'] == 5
    # every frame is stored as whole + left + right crop, all under its own label
    assert len(data['labels']) == (60 + 5 + 5) * len(INDEX_VIEWS)
    assert data['labels'].tolist().count('F1_b') == 5 * len(INDEX_VIEWS)
    assert data['vecs'].shape[0] == len(data['labels'])
    # L2-normalized rows.
    norms = np.linalg.norm(data['vecs'].astype(np.float32), axis=1)
    assert np.allclose(norms, 1.0, atol=1e-2)
    # Nothing was written under a real data/ directory.
    assert (tmp_path / 'index.npz').exists()


def _ensure(path):
    path.mkdir(parents=True, exist_ok=True)


# --- integration: backend loaded through create_app -----------------------

def _jpeg(color):
    output = BytesIO()
    with Image.new('RGB', (64, 64), color) as image:
        image.save(output, format='JPEG')
    return output.getvalue()


def test_create_app_with_backend(tmp_path, monkeypatch):
    import sys
    from types import SimpleNamespace
    from api.main import create_app

    graph = synthetic_graph()
    (tmp_path / 'graph.json').write_text(json.dumps(graph))
    (tmp_path / 'rooms.json').write_text('[]')

    red = (255, 0, 0)
    index = make_index([(red, 'F1_a', 'video')] * 8 + [((0, 0, 255), 'F2_c', 'video')] * 2)
    index.save(tmp_path / 'index.npz')  # create_backend refuses to start without one

    def factory(directory):
        # Inject the fake embedder and a no-op OCR reader: no torch/easyocr.
        backend = create_backend(directory, embedder=FakeEmbedder(),
                                 ocr_reader=lambda im: (None, None))
        backend.index = index  # swap in the synthetic index
        return backend

    monkeypatch.setitem(sys.modules, 'synthetic_ml', SimpleNamespace(create_backend=factory))
    monkeypatch.setenv('HOUND_ML_FACTORY', 'synthetic_ml:create_backend')
    monkeypatch.delenv('HOUND_STUB_SPOT', raising=False)

    with TestClient(create_app(tmp_path)) as client:
        health = client.get('/health').json()
        assert health['ok'] is True and health['model'] == 'fake-embedder'
        response = client.post('/locate', files={'image': ('q.jpg', _jpeg(red), 'image/jpeg')})
        assert response.status_code == 200
        body = response.json()
        # API strips the internal vector and diagnostics.
        assert set(body) == {'photo_id', 'spot', 'floor', 'heading', 'confidence',
                             'top3', 'ocr_room', 'ocr_floor', 'ms'}
        assert body['spot'] == 'F1_a'
        assert body['floor'] == 1


# --- review regressions (docs: Hound-Around-Kiro-Recheck, N02-N07) ---------

def test_correction_flips_query_despite_ten_identical_video_frames():
    # N02: ten identical video exemplars used to push an equally similar
    # correction out of the top k, so the correction never voted.
    red = (255, 0, 0)
    backend = build(make_index([(red, 'F1_a', 'video')] * 10))
    backend.apply_correction(backend.prepare_correction(COLOR_VEC[red], 'F1_b'))
    assert backend.locate(solid(red))['spot'] == 'F1_b'


def test_correction_does_not_hijack_unrelated_query():
    red, blue = (255, 0, 0), (0, 0, 255)
    backend = build(make_index([(red, 'F1_a', 'video')] * 5 + [(blue, 'F2_c', 'video')] * 5))
    backend.apply_correction(backend.prepare_correction(COLOR_VEC[red], 'F1_b'))
    assert backend.locate(solid(blue))['spot'] == 'F2_c'


def test_ocr_override_from_rank_four_is_selectable():
    # N03: OCR picked a 4th-ranked spot that was missing from top3.
    graph = {'nodes': [{'id': s, 'floor': f} for s, f in
                       (('F1_a', 1), ('F1_b', 1), ('F1_c', 1), ('F2_d', 2))], 'edges': []}
    red = (255, 0, 0)
    vec = COLOR_VEC[red]
    near = [normalize(vec + 0.05 * basis(10 + i)) for i in range(10)]
    labels = ['F1_a'] * 4 + ['F1_b'] * 3 + ['F1_c'] * 2 + ['F2_d']
    index = VectorIndex(np.stack(near), labels, ['video'] * 10)
    backend = Backend(index, graph, {}, FakeEmbedder(), ocr_reader=lambda im: ('248', 2))
    result = backend.locate(solid(red))
    assert result['spot'] == 'F2_d' and result['floor'] == 2
    assert result['top3'][0]['spot'] == 'F2_d'


def test_ocr_parses_basement_rooms_and_floor_signs():
    # N04: B62 and "Floor 2" used to parse as nothing.
    from ml.ocr import parse_sign
    assert parse_sign('B62') == ('B62', -1)
    assert parse_sign('b64a') == ('B64A', -1)
    assert parse_sign('164') == ('164', 1)
    assert parse_sign('248') == ('248', 2)
    assert parse_sign('Floor 2') == (None, 2)
    assert parse_sign('Lower Level') == (None, -1)
    assert parse_sign('48') == (None, None)        # seat counts are not rooms
    assert parse_sign('665 Comm Ave') == (None, None)
    assert parse_sign('Floor 3') == (None, None)   # out of scope


def test_heading_never_crosses_unverified_edge():
    # N06: the API's router drops verify=true edges, so such a heading 500s.
    graph = synthetic_graph()
    graph['edges'][0]['verify'] = True
    red = (255, 0, 0)
    backend = build(make_index([(red, 'F1_a', 'video')] * 3), graph=graph,
                    headings={'F1_a': 'F1_b'})
    assert backend.locate(solid(red))['heading'] is None


def test_create_backend_fails_closed_without_index(tmp_path):
    # N07: a missing or empty index used to answer with an invented location.
    (tmp_path / 'graph.json').write_text(json.dumps(synthetic_graph()))
    with pytest.raises(FileNotFoundError):
        create_backend(tmp_path, embedder=FakeEmbedder(), ocr_reader=lambda im: (None, None))
    VectorIndex().save(tmp_path / 'index.npz')
    with pytest.raises(ValueError):
        create_backend(tmp_path, embedder=FakeEmbedder(), ocr_reader=lambda im: (None, None))


def test_build_index_reads_pipeline_dataset_folders(tmp_path):
    # N05: label_frames.py writes data/<dataset>/labels.csv; the builder only
    # read data/labels.csv. Also: excluded videos never reach an eval index (N01).
    (tmp_path / 'graph.json').write_text(json.dumps(synthetic_graph()))
    header = 'file,video,t_sec,label,label_source,in_graph,sharpness,dup_of_prev,status'
    for ds, video, spot, color in (('dataset', 'v1', 'F1_a', (255, 0, 0)),
                                   ('dataset_f2', 'v2', 'F2_c', (0, 0, 255))):
        _ensure(tmp_path / ds / 'train' / spot)
        lines = [header]
        for i in range(3):
            name = f'{spot}_{i}.jpg'
            solid(color).save(tmp_path / ds / 'train' / spot / name)
            lines.append(f'{name},{video},{i}.0,{spot},voice,true,1800,false,keep')
        (tmp_path / ds / 'labels.csv').write_text('\n'.join(lines) + '\n')
    from ml.build_index import build_index
    _, counts = build_index(tmp_path, embed_fn=FakeEmbedder())
    assert counts == {'F1_a': 3, 'F2_c': 3}
    _, counts = build_index(tmp_path, embed_fn=FakeEmbedder(), exclude_videos={'v2'},
                            out_path=tmp_path / 'eval.npz')
    assert counts == {'F1_a': 3}


def test_build_index_caps_360_views_separately_from_phone_frames(tmp_path):
    # 360 crops must not crowd phone frames out of a spot's cap; they get their own budget.
    (tmp_path / 'graph.json').write_text(json.dumps(synthetic_graph()))
    header = 'file,video,t_sec,label,label_source,in_graph,sharpness,dup_of_prev,status'
    for ds, video, n in (('dataset', 'v1', 4), ('dataset_360', 'X360_001', 6)):
        _ensure(tmp_path / ds / 'train' / 'F1_a')
        lines = [header]
        for i in range(n):
            name = f'{ds}_{i}.jpg'
            solid((255, 0, 0)).save(tmp_path / ds / 'train' / 'F1_a' / name)
            lines.append(f'{name},{video},{i}.0,F1_a,voice,true,1800,false,keep')
        (tmp_path / ds / 'labels.csv').write_text('\n'.join(lines) + '\n')
    import ml.build_index as B
    B.CAP_360_PER_SPOT, old = 2, B.CAP_360_PER_SPOT
    try:
        _, counts = B.build_index(tmp_path, embed_fn=FakeEmbedder(), cap=3)
    finally:
        B.CAP_360_PER_SPOT = old
    assert counts == {'F1_a': 3 + 2}


def test_app_reports_unready_when_index_missing(tmp_path, monkeypatch):
    # N07 end to end: no index -> /health 503 and /locate 503, never a guess.
    import sys
    from types import SimpleNamespace
    from api.main import create_app

    (tmp_path / 'graph.json').write_text(json.dumps(synthetic_graph()))
    (tmp_path / 'rooms.json').write_text('[]')

    def factory(directory):
        return create_backend(directory, embedder=FakeEmbedder(), ocr_reader=lambda im: (None, None))

    monkeypatch.setitem(sys.modules, 'synthetic_ml_missing', SimpleNamespace(create_backend=factory))
    monkeypatch.setenv('HOUND_ML_FACTORY', 'synthetic_ml_missing:create_backend')
    monkeypatch.delenv('HOUND_STUB_SPOT', raising=False)
    with TestClient(create_app(tmp_path)) as client:
        assert client.get('/health').status_code == 503
        response = client.post('/locate', files={'image': ('q.jpg', _jpeg((255, 0, 0)), 'image/jpeg')})
        assert response.status_code == 503


def test_letterbox_keeps_the_whole_image_and_pads_to_a_square():
    # No center crop: a landscape frame keeps its full width, padding fills the rest.
    from ml.embedder import PAD_RGB, SIDE, letterbox
    image = Image.new('RGB', (1920, 1080), (255, 0, 0))
    boxed = letterbox(image)
    assert boxed.size == (SIDE, SIDE)
    assert boxed.getpixel((0, SIDE // 2)) == (255, 0, 0)  # left edge is image, not cut away
    assert boxed.getpixel((SIDE // 2, 0)) == PAD_RGB  # top is padding


def test_index_views_are_whole_frame_plus_overlapping_side_crops():
    from ml.embedder import index_views
    views = index_views(Image.new('RGB', (1000, 500)))
    assert [v.size for v in views] == [(1000, 500), (600, 500), (600, 500)]
