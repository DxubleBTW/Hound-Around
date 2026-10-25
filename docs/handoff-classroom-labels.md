# Classroom door-number labels

The earlier display fix replaced misleading room numbers with seating capacities.
This follow-up removes capacities from destination choices, location names, and
displayed directions. Capacity-based node IDs remain unchanged for matching/routing.

## Source of room names

The six room choices already public in the app were checked against the final node
returned by the existing deployed `/route` endpoint on October 24, 2026:

| Public room | Route destination node |
| --- | --- |
| 164 | `F1_room164` |
| B62 | `B1_class70` |
| 262 | `F2_class48a` |
| 263 | `F2_class48b` |
| 264 | `F2_class48c` |
| 265 | `F2_class20` |

These are the current routing aliases, **not independent verification of physical
door signs**. The repository previously recorded some of these as inferred. An
on-site teammate must confirm them and correct the private room table if needed.
No new room association is inferred from a capacity value.

The frontend's small, explicitly public label set lives in
`frontend/src/lib/publicRoomLabels.js`, passed only through the BU/CDS building
configuration. Another school does not inherit its room names. Confirmation,
top-three choices, route headers, and legacy capacity-based direction text use
that building's labels. Only these already public room choices are included;
the private directory, graph, and images are not exported.

Backend route wording now reads numeric door aliases from private `rooms.json`.
A single number wins over a capacity-based graph label. Duplicate event names
for that same number do not create ambiguity. Missing or multiple numbers on a
capacity node produce **Classroom (room number unconfirmed)** rather than a guess.
Unmapped F1 capacity nodes therefore do not silently become Room 164.

## After an on-site correction

1. Check the physical door sign and the corresponding node spot with the data lead.
2. Update the private room mapping (and its source patch), not the embedding label
   IDs solely to rename a room. If the frames themselves were mislabeled, review
   them separately, rebuild the index, and recalibrate rejection for that index.
3. Update this small public label set if an already public room's node changed.
   Review any additional room names before publishing them. Keep the complete
   directory private and keep each building's metadata separate.
4. Redeploy both frontend and backend as needed. The existing frontend rewrite
   removes legacy capacity wording while an older backend is still running, but
   it cannot repair an incorrect private routing association.
5. On a phone, test Room B62 and 262–265 as destinations and as recognized starting
   locations. Verify the confirmation heading, top-three options, route overview,
   current step, and next-step preview show room numbers with no capacities.

Software checks: run `npm test` and `npm run build` in `frontend/`, plus
`python -m pytest -q` from the repository root. These exercise synthetic fixtures
and do not prove that a room alias matches a physical sign.

The fix adds no endpoints or response fields, changes no private mapping data,
and does not improve the underlying recognition accuracy by itself.
