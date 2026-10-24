"""Property-based tests (workstream F) for routing and voting invariants.

Hypothesis generates ONLY synthetic graphs and synthetic indexes: no real
building photos, no torch/transformers/easyocr, no private data. The strategies
build made-up node ids on the in-scope floors {-1, 1, 2}, random edges (some
marked stairs/verify/one_way/vertical with x,y coords), a few room aliases, and
random normalized 384-d vectors. The invariants mirror design.md §3-§5 and §9.

Reuses the FakeEmbedder / basis() / synthetic_graph conventions from
tests/test_ml.py: vectors come from basis(seed), the Backend is built with an
injected embed_fn so no heavy deps load.

Policy (orchestrator / steering): if a property surfaces a real bug in api/ or
ml/, do NOT patch production code to make it pass; surface the minimal
counterexample. Only the test's own assumptions get fixed here.
"""
from __future__ import annotations

import math

import numpy as np
import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from api.routing import Router
from ml.backend import Backend, OCR_CONFIDENCE_GATE
from ml.embedder import DIM, normalize
from ml.index import CORRECTION_WEIGHT, VectorIndex


FLOORS = (-1, 1, 2)
SPEED = {False: 1.2, True: 0.9}


def basis(seed, dim=DIM):
    """A fixed pseudo-random unit vector for a given seed (matches test_ml)."""
    rng = np.random.default_rng(int(seed))
    return normalize(rng.standard_normal(dim).astype(np.float32))


# --------------------------------------------------------------------------
# Routing strategies: random small synthetic graphs + rooms.
# --------------------------------------------------------------------------

@st.composite
def graph_and_rooms(draw):
    """Build a small random graph (nodes on {-1,1,2}) + a rooms alias list.

    Nodes get integer x,y coords. Edges are drawn between distinct node pairs
    and randomly marked stairs/verify/one_way/vertical with positive meters.
    Rooms map a few unique alias strings to existing nodes.
    """
    n = draw(st.integers(min_value=2, max_value=6))
    floors = draw(st.lists(st.sampled_from(FLOORS), min_size=n, max_size=n))
    nodes = []
    for i in range(n):
        nodes.append({
            'id': f'N{i}',
            'floor': floors[i],
            'x': draw(st.integers(min_value=-20, max_value=20)),
            'y': draw(st.integers(min_value=-20, max_value=20)),
            'label': f'L{i}',
        })
    ids = [node['id'] for node in nodes]

    # Draw a set of directed edges over distinct ordered pairs.
    pairs = [(a, b) for a in ids for b in ids if a != b]
    chosen = draw(st.lists(st.sampled_from(pairs), min_size=1, max_size=len(pairs), unique=True))
    edges = []
    for a, b in chosen:
        stairs = draw(st.booleans())
        edges.append({
            'from': a,
            'to': b,
            'meters': draw(st.floats(min_value=0.5, max_value=25.0,
                                     allow_nan=False, allow_infinity=False)),
            'stairs': stairs,
            # A vertical move only makes sense when it is stairs or elevator.
            'vertical': stairs or draw(st.booleans()),
            'one_way': draw(st.booleans()),
            'verify': draw(st.booleans()),
        })

    # A few room aliases -> existing nodes (unique alias keys, unique names).
    room_count = draw(st.integers(min_value=0, max_value=min(3, n)))
    rooms = []
    used_keys = set()
    for j in range(room_count):
        node = draw(st.sampled_from(ids))
        room_key = f'room{j}'
        name_key = f'Name {j}'
        if room_key.casefold() in used_keys or name_key.casefold() in used_keys:
            continue
        used_keys.update({room_key.casefold(), name_key.casefold()})
        rooms.append({'room': room_key, 'name': name_key, 'node': node})

    return {'nodes': nodes, 'edges': edges}, rooms


def _stair_edges(router):
    """Set of (a, b) directed edges still marked stairs in the live graph."""
    return {(a, b) for a, b, data in router.graph.edges(data=True) if data.get('stairs')}


@settings(max_examples=200, deadline=None)
@given(data=graph_and_rooms(), accessible=st.booleans())
def test_route_invariants(data, accessible):
    import networkx as nx

    graph, rooms = data
    router = Router(graph, rooms)
    ids = [node['id'] for node in graph['nodes']]
    floor_of = {node['id']: node['floor'] for node in graph['nodes']}

    # Mirror the Router's own filtered subgraph so we can recover the true
    # node-by-node path. The Router groups consecutive straight "Continue"
    # segments into one step, so a single step['node'] is the END of a grouped
    # chain, not necessarily a direct neighbor of the previous step. The
    # per-edge invariants (adjacency, no stairs, no verify-only hop) therefore
    # belong on this reconstructed path, which the grouped steps summarize.
    filtered = nx.subgraph_view(
        router.graph,
        filter_edge=lambda a, b: not accessible or not router.graph[a][b].get('stairs', False),
    )
    live_edges = set(router.graph.edges())

    for start in ids:
        for destination in ids:
            try:
                result = router.route(start, destination, accessible=accessible)
            except LookupError:
                # No path under the (accessible) filter: a valid outcome.
                continue

            steps = result['steps']

            # from == to -> empty route, zero totals.
            if start == destination:
                assert steps == []
                assert result['total_meters'] == 0.0
                assert result['est_seconds'] == 0
                continue

            # The true node path the Router walked (same weight, same filter).
            path = nx.shortest_path(filtered, start, destination, weight='cost')

            if steps:
                # The path's first hop leaves `from` on a live edge.
                assert (start, path[1]) in live_edges
                # Last step's node is the resolved destination.
                assert steps[-1]['node'] == destination
                # Step nodes are a subsequence of the path (grouping only ever
                # drops intermediate straight nodes, never reorders).
                it = iter(path)
                for step in steps:
                    assert step['node'] in it, 'step node not on the path in order'

            # total_meters == sum of step meters (float tolerance).
            step_sum = sum(step['meters'] for step in steps)
            assert result['total_meters'] == pytest.approx(step_sum, abs=1e-6)

            # est_seconds == ceil(total / speed).
            expected = math.ceil(result['total_meters'] / SPEED[accessible])
            assert result['est_seconds'] == expected

            # Per-edge invariants along the reconstructed path. Read the flags
            # off the LIVE graph edge, not the input: when the input has
            # parallel edges between a pair, the DiGraph keeps the last-added
            # one, so the effective stairs/verify state is whatever the live
            # edge carries.
            for a, b in zip(path, path[1:]):
                # No out-of-scope floors anywhere on the path.
                assert floor_of[b] in FLOORS
                # verify:true edges were dropped at construction, so no path
                # hop can be a verify-only connection.
                assert (a, b) in live_edges
                # Accessible routes never traverse an edge marked stairs:true.
                if accessible:
                    assert not router.graph[a][b].get('stairs', False)

            # No step node sits on an out-of-scope floor either.
            for step in steps:
                assert floor_of[step['node']] in FLOORS


@settings(max_examples=100, deadline=None)
@given(data=graph_and_rooms())
def test_route_unknown_room_raises(data):
    graph, rooms = data
    router = Router(graph, rooms)
    existing = {node['id'] for node in graph['nodes']}
    existing |= {room['room'] for room in rooms} | {room['name'] for room in rooms}
    # A name that cannot resolve.
    bogus = 'DEFINITELY_NOT_A_NODE_OR_ROOM'
    assume(bogus not in existing)
    start = graph['nodes'][0]['id']
    with pytest.raises(ValueError):
        router.route(start, bogus)
    with pytest.raises(ValueError):
        router.route(bogus, start)


@settings(max_examples=100, deadline=None)
@given(data=graph_and_rooms())
def test_resolve_room_aliases(data):
    graph, rooms = data
    assume(rooms)
    router = Router(graph, rooms)
    for room in rooms:
        assert router.resolve(room['room']) == room['node']
        assert router.resolve(room['name']) == room['node']
        # Case-insensitive, whitespace-tolerant.
        assert router.resolve('  ' + room['room'].upper() + ' ') == room['node']


# --------------------------------------------------------------------------
# Voting strategies: random normalized vectors + synthetic graph/index.
# --------------------------------------------------------------------------

# A small fixed pool of spots on known floors (made-up ids).
VOTE_SPOTS = {
    'S_bm1': -1,
    'S_f1a': 1,
    'S_f1b': 1,
    'S_f2a': 2,
}


def vote_graph():
    """Synthetic graph: the vote spots as nodes with a simple adjacency."""
    ids = list(VOTE_SPOTS)
    nodes = [{'id': spot, 'floor': floor, 'x': i, 'y': 0, 'label': spot}
             for i, (spot, floor) in enumerate(VOTE_SPOTS.items())]
    # A ring of edges so each spot has a neighbor on the graph.
    edges = []
    for i in range(len(ids)):
        edges.append({'from': ids[i], 'to': ids[(i + 1) % len(ids)], 'meters': 1.0})
    return {'nodes': nodes, 'edges': edges}


class VectorEmbedder:
    """Returns the query vector it was constructed to emit. Batch-capable.

    locate(image) ignores the image; this maps the test's synthetic 'image'
    (an index into a vector table) to a fixed vector.
    """

    model_name = 'prop-embedder'
    batched = True

    def __init__(self, vector):
        self._vector = np.asarray(vector, dtype=np.float32).reshape(-1)

    def __call__(self, images):
        if isinstance(images, (list, tuple)):
            return normalize(np.stack([self._vector for _ in images]))
        return self._vector.copy()


def build_backend(index, vector, top_k=10):
    # ocr_reader=None guarantees the OCR override path never runs, so the
    # non-override confidence invariant always holds.
    return Backend(index, vote_graph(), {}, VectorEmbedder(vector),
                   ocr_reader=None, top_k=top_k)


@st.composite
def index_rows(draw):
    """A random synthetic index: normalized rows with labels in VOTE_SPOTS."""
    spots = list(VOTE_SPOTS)
    n = draw(st.integers(min_value=1, max_value=12))
    rows = []
    for _ in range(n):
        seed = draw(st.integers(min_value=0, max_value=10_000))
        label = draw(st.sampled_from(spots))
        source = draw(st.sampled_from(['video', 'correction']))
        rows.append((basis(seed), label, source))
    return rows


def make_index(rows):
    vecs = np.stack([v for v, _, _ in rows])
    labels = [lbl for _, lbl, _ in rows]
    source = [src for _, _, src in rows]
    return VectorIndex(vecs=vecs, labels=labels, source=source)


@settings(max_examples=200, deadline=None)
@given(rows=index_rows(), q_seed=st.integers(min_value=0, max_value=10_000),
       top_k=st.integers(min_value=1, max_value=12))
def test_vote_result_invariants(rows, q_seed, top_k):
    query = basis(q_seed)
    index = make_index(rows)
    backend = build_backend(index, query, top_k=top_k)

    result = backend.locate(object())  # image ignored by VectorEmbedder.
    # The backend's confidence denominator is the configured top_k (not the
    # number of neighbors actually examined); design.md §3 / ml/backend.locate
    # compute confidence = min(1, winning_votes / self.top_k). The vote tally
    # only ever examines min(top_k, len(index)) neighbors.
    examined = min(top_k, len(index))

    # confidence in [0, 1].
    assert 0.0 <= result['confidence'] <= 1.0

    top3 = result['top3']
    assert 1 <= len(top3) <= 3
    # votes descending, except that a correction which is the query's nearest
    # neighbor may lead with fewer votes (ml/index.py, review N02).
    votes = [t['votes'] for t in top3]
    assert votes[1:] == sorted(votes[1:], reverse=True)
    # unique spots in top3.
    assert len({t['spot'] for t in top3}) == len(top3)
    # spot == top3[0].spot.
    assert result['spot'] == top3[0]['spot']

    # Non-override path: confidence is the winner's votes plus same-floor spots
    # within NEIGHBORHOOD_M of it, / top_k (capped at 1), never less than the
    # winner's own share.
    winning_votes = top3[0]['votes']
    assert result['confidence'] >= min(1.0, winning_votes / top_k) - 1e-9

    # Returned floor matches the winning spot's node floor.
    assert result['floor'] == VOTE_SPOTS[result['spot']]

    # heading is null or a graph neighbor of spot. (No headings configured here,
    # so it is always null, but assert the invariant generally.)
    neighbors = set(backend._neighbors.get(result['spot'], set()))
    assert result['heading'] is None or result['heading'] in neighbors

    # top3 vote sum bound: with correction weighting a single row can count
    # CORRECTION_WEIGHT; the sum over the examined neighbors (min(top_k, N)) is
    # <= examined * CORRECTION_WEIGHT.
    assert sum(votes) <= examined * CORRECTION_WEIGHT


@settings(max_examples=100, deadline=None)
@given(rows=index_rows(), q_seed=st.integers(min_value=0, max_value=10_000))
def test_snapshot_restore_round_trip(rows, q_seed):
    index = make_index(rows)
    backend = build_backend(index, basis(q_seed))
    snap = backend.snapshot()

    # Round-trip equality in vecs / labels / source.
    assert np.array_equal(snap.vecs, index.vecs)
    assert snap.labels == index.labels
    assert snap.source == index.source

    # Mutating the live index afterwards must not change the snapshot.
    backend.apply_correction(backend.prepare_correction(basis(q_seed), 'S_f1a'))
    assert len(backend.index) == len(index) + 1
    assert len(snap) == len(index)
    # Mutating live array values does not alias into the snapshot.
    before = snap.vecs.copy()
    backend.index.vecs[0, 0] = 123.0
    assert np.array_equal(snap.vecs, before)


@settings(max_examples=200, deadline=None)
@given(q_seed=st.integers(min_value=0, max_value=10_000),
       stale=st.integers(min_value=1, max_value=CORRECTION_WEIGHT - 1))
def test_one_correction_flip_property(q_seed, stale):
    """A single correction (weight CORRECTION_WEIGHT) outvotes up to
    CORRECTION_WEIGHT-1 stale video exemplars for the next near-identical query.
    """
    query = basis(q_seed)
    # `stale` video exemplars all voting spot A for this query.
    rows = [(query, 'S_f1a', 'video') for _ in range(stale)]
    index = make_index(rows)
    backend = build_backend(index, query, top_k=10)

    first = backend.locate(object())
    assert first['spot'] == 'S_f1a'

    # Append a correction with the same query vector under a different label B.
    backend.apply_correction(backend.prepare_correction(query, 'S_f1b'))

    second = backend.locate(object())
    # One correction (weight 3) beats up to 2 stale video votes.
    assert second['spot'] == 'S_f1b'
