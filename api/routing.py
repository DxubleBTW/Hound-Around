"""Routes use verified graph edges; pixel coordinates supply direction only."""
import math
import re

import networkx as nx

# Door nodes sit a little off the corridor line, so small bends are not turns.
STRAIGHT_DEGREES = 45
AROUND_DEGREES = 150
# A destination door this far off the walking line is "on your left/right".
SIDE_DEGREES = 15


def is_door(node):
    return node.get('type') == 'room'


class Router:
    def __init__(self, graph, rooms):
        self.nodes = {node['id']: node for node in graph['nodes']}
        if len(self.nodes) != len(graph['nodes']):
            raise ValueError('Duplicate graph node')
        if any(n['floor'] not in (-1, 1, 2) for n in self.nodes.values()):
            raise ValueError('Graph includes out-of-scope floor')
        self.graph = nx.DiGraph()
        self.graph.add_nodes_from(self.nodes)
        for edge in graph['edges']:
            a, b = edge['from'], edge['to']
            if a not in self.nodes or b not in self.nodes:
                raise ValueError('Edge references unknown node')
            meters = float(edge['meters'])
            cost = float(edge.get('cost', meters))
            if not math.isfinite(meters) or meters < 0 or not math.isfinite(cost) or cost < 0:
                raise ValueError('Invalid edge distance')
            # Dashed walk-sheet edges must be checked before navigation.
            if edge.get('verify', False):
                continue
            self.graph.add_edge(a, b, **{**edge, 'meters': meters, 'cost': cost})
            if not edge.get('one_way', False):
                # Authored instructions may say "up" or "down"; generate the
                # reverse instruction from nodes rather than reversing prose.
                reverse = {**edge, 'meters': meters, 'cost': cost}
                reverse.pop('instruction', None)
                self.graph.add_edge(b, a, **reverse)
        self.aliases = {}
        self.room_numbers = {}
        for room in rooms:
            if room['node'] not in self.nodes:
                raise ValueError('Room references unknown node')
            number = str(room['room']).strip().upper()
            if re.fullmatch(r'B?\d{2,3}[A-Z]?', number):
                self.room_numbers.setdefault(room['node'], set()).add(number)
            for alias in (room['room'], room['name']):
                key = alias.strip().casefold()
                if key in self.aliases and self.aliases[key] != room['node']:
                    raise ValueError('Ambiguous room alias')
                self.aliases[key] = room['node']

    def node_label(self, node):
        """Door aliases come from rooms.json; capacity IDs never imply room numbers."""
        numbers = self.room_numbers.get(node['id'], set())
        if len(numbers) == 1:
            return f'Room {next(iter(numbers))}'
        if re.search(r'_class\d+[a-z]?$', node['id']):
            return 'Classroom (room number unconfirmed)'
        label = node.get('label', node['id'])
        return re.sub(r'\b\d+\s*[-–]?\s*(?:seat(?:er)?|person)\s+(classrooms?|rooms?)\b',
                      r'\1', label, flags=re.IGNORECASE)

    def resolve(self, value):
        if value in self.nodes:
            return value
        try:
            return self.aliases[value.strip().casefold()]
        except KeyError:
            raise ValueError('Unknown room or node') from None

    def route(self, start, destination, accessible=False, heading=None):
        start, destination = self.resolve(start), self.resolve(destination)
        if heading is not None and (
            heading not in self.nodes or not self.graph.has_edge(start, heading)
        ):
            raise ValueError('Heading must be a neighboring node')
        graph = nx.subgraph_view(
            self.graph,
            filter_edge=lambda a, b: not accessible or not self.graph[a][b].get('stairs', False),
        )
        try:
            path = nx.shortest_path(graph, start, destination, weight='cost')
        except nx.NetworkXNoPath:
            raise LookupError('No accessible route' if accessible else 'No route') from None
        steps, total = [], 0.0
        previous = None
        for a, b in zip(path, path[1:]):
            edge = graph[a][b]
            target = self.nodes[b]
            landmark = target.get('landmark')
            label = self.node_label(target)
            toward = f'{label} ({landmark})' if landmark else label
            if edge.get('vertical', False):
                level = 'LL' if target['floor'] == -1 else str(target['floor'])
                mode = 'stairs' if edge.get('stairs', False) else 'elevator'
                instruction = f'Take the {mode} to {level}, toward {toward}'
                previous = None
            else:
                direction = 'Walk'
                origin = self.nodes[a]
                # A door passed mid-route bends the line but is not a turn; the
                # next turn is measured from the node before the door.
                passing_door = a != start and is_door(origin)
                incoming, angle = None, None
                if passing_door:
                    direction = 'Continue'
                elif previous is not None:
                    incoming = (origin['x'] - previous['x'], origin['y'] - previous['y'])
                elif a == start and heading:
                    facing = self.nodes[heading]
                    if facing['floor'] == origin['floor']:
                        incoming = (facing['x'] - origin['x'], facing['y'] - origin['y'])
                outgoing = (target['x'] - origin['x'], target['y'] - origin['y'])
                if incoming and math.hypot(*incoming) and math.hypot(*outgoing):
                    angle = math.degrees(math.atan2(
                        incoming[0] * outgoing[1] - incoming[1] * outgoing[0],
                        incoming[0] * outgoing[0] + incoming[1] * outgoing[1],
                    ))
                    # Walk-sheet y increases downward.
                    direction = ('Turn around and walk' if abs(angle) >= AROUND_DEGREES else
                                 'Turn right and walk' if angle >= STRAIGHT_DEGREES else
                                 'Turn left and walk' if angle <= -STRAIGHT_DEGREES else 'Continue')
                    if b == destination and is_door(target) and SIDE_DEGREES <= abs(angle) < AROUND_DEGREES:
                        # The door is beside the corridor: say which side, don't turn.
                        direction = 'Continue'
                        toward = f"{toward}, on your {'right' if angle > 0 else 'left'}"
                instruction = f'{direction} toward {toward}'
                if not passing_door:
                    previous = origin
            if steps and not edge.get('vertical', False) and direction == 'Continue':
                # Group straight segments into one human turn, unless the
                # previous step was a floor transition.
                if not steps[-1]['instruction'].startswith('Take the '):
                    steps[-1]['instruction'] = steps[-1]['instruction'].rsplit(' toward ', 1)[0] + f' toward {toward}'
                    steps[-1]['meters'] += edge['meters']
                    steps[-1]['node'] = b
                else:
                    steps.append({'instruction': instruction, 'meters': edge['meters'], 'node': b})
            else:
                steps.append({'instruction': instruction, 'meters': edge['meters'], 'node': b})
            total += edge['meters']
        return {'steps': steps, 'total_meters': total,
                'est_seconds': math.ceil(total / (0.9 if accessible else 1.2)),
                'legs': self.legs(path, graph)}

    def legs(self, path, graph):
        """One drawable leg per floor. Points are normalized to each leg's own
        bounding box, so building coordinates and other geometry never leave
        the server: the client sees only the shape of its own path."""
        legs, run = [], [path[0]]
        for a, b in zip(path, path[1:]):
            edge = graph[a][b]
            if not edge.get('vertical', False):
                run.append(b)
                continue
            exit = {'mode': 'stairs' if edge.get('stairs', False) else 'elevator',
                    'to_floor': self.nodes[b]['floor']}
            if len(run) == 1 and legs:
                # The previous edge was vertical too: riding through a floor
                # (LL -> 1 -> 2) is one move, not a one-point leg.
                legs[-1]['exit'] = exit
            else:
                legs.append(self._leg(run, exit))
            run = [b]
        legs.append(self._leg(run, None))
        return legs

    def _leg(self, run, exit):
        xs = [self.nodes[n]['x'] for n in run]
        ys = [self.nodes[n]['y'] for n in run]
        span = max(max(xs) - min(xs), max(ys) - min(ys)) or 1.0
        # Keep aspect: scale the longer side to 0.8, centre the shorter one.
        ox = (1 - 0.8 * (max(xs) - min(xs)) / span) / 2
        oy = (1 - 0.8 * (max(ys) - min(ys)) / span) / 2
        points = [[round(ox + 0.8 * (x - min(xs)) / span, 3),
                   round(oy + 0.8 * (y - min(ys)) / span, 3)] for x, y in zip(xs, ys)]
        return {'floor': self.nodes[run[0]]['floor'], 'points': points,
                'start': run[0], 'end': run[-1], 'exit': exit}
