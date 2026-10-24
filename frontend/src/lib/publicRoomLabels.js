// Only the six room choices already public in destinations.js belong here.
// Checked against the existing live /route final node on 2026-10-24; these are
// routing aliases, not a claim of independent on-site sign verification.
// Keep in sync with the private rooms table when its mappings change. Never
// copy the full room directory, graph, or images into the frontend.
export const BU_CDS_ROOM_LABELS = Object.freeze({
  F1_room164: 'Room 164',
  B1_class70: 'Room B62',
  F2_class48a: 'Room 262',
  F2_class48b: 'Room 263',
  F2_class48c: 'Room 264',
  F2_class20: 'Room 265',
})
