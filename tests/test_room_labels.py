"""Synthetic room-table fixtures; these are not physical building mappings."""
from api.routing import Router


def make_router(rooms):
    return Router({'nodes': [
        {'id': 'F1_entry_test', 'floor': 1, 'x': 0, 'y': 0, 'label': 'Entry'},
        {'id': 'F1_class48', 'floor': 1, 'x': 10, 'y': 0, 'label': '48-seat classroom'},
    ], 'edges': [{'from': 'F1_entry_test', 'to': 'F1_class48', 'meters': 10}]}, rooms)


def room(number, name=None):
    return {'room': number, 'name': name or number, 'floor': 1, 'node': 'F1_class48'}


def test_route_uses_door_number_from_room_table_instead_of_capacity():
    router = make_router([room('199', 'Classroom 199'), room('199', 'Test event')])
    result = router.route('F1_entry_test', '199')
    assert result['steps'][0]['instruction'] == 'Walk toward Room 199'
    assert result['steps'][0]['node'] == 'F1_class48'
    assert router.resolve('Test event') == 'F1_class48'


def test_unmapped_or_ambiguous_classroom_does_not_invent_a_door_number():
    for rooms in ([], [room('199'), room('198')], [room('test event')]):
        router = make_router(rooms)
        instruction = router.route('F1_entry_test', 'F1_class48')['steps'][0]['instruction']
        assert instruction == 'Walk toward Classroom (room number unconfirmed)'
        assert '48' not in instruction


def test_capacity_in_hallway_labels_is_not_used_as_a_room_number():
    router = make_router([])
    assert router.node_label({'id': 'F1_test_hall', 'label': 'East hallway by 48-seat rooms'}) == 'East hallway by rooms'
    assert router.node_label({'id': 'F1_test_hall', 'label': 'East hallway by 48-person rooms'}) == 'East hallway by rooms'
