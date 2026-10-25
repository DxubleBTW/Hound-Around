// Verified-real destinations for Hound Around.
//
// Every entry here is confirmed to return 200 from the live /route endpoint. The
// backend's `to` accepts EITHER a bare room number (e.g. "164") OR a node id
// (e.g. "F1_restrooms"); both forms are used below exactly as the backend expects.
// NEVER add a destination that has not been verified real, and NEVER invent a node
// id or room number here. This file formats and resolves; it does not invent.
//
// There is no /spots endpoint in the contract, so the app cannot autocomplete the
// full building. The free-text box routes any typed value straight to the backend,
// which 422s anything it does not know; the suggestions/datalist below are built
// ONLY from this verified set so the UI never implies other rooms exist.

import { floorOf, spotName } from './spots.js'

// Grouped quick-picks. `value` is what we send to /route's `to`; `label` is the
// human text on the chip.
// Each group's places were checked against the live /route endpoint on
// 2026-10-25 (200, while made-up places return 422). Names come from the route's
// own final step or docs/STATUS.md. `note` is a short public description.
// `details` are the bullets shown when a place is chosen. Same sourcing rule: only
// what the route or docs/STATUS.md says. Room features (projector, whiteboards,
// outlets) go here only after someone has checked that room on site.
export const DEST_GROUPS = [
  {
    title: 'Top destinations',
    icon: 'flag',
    items: [
      { value: '164', label: 'Room 164', note: 'Opening & closing ceremony', details: ['Opening and closing ceremonies are held here'] },
      { value: '220', label: 'Room 220', note: 'CS Builds', floor: 'Floor 2', details: ['CS Builds room'] },
      { value: '262', label: 'Room 262', note: 'Hacking room', details: ['Hacking room for the event', 'Door number still being confirmed on site'] },
      { value: '263', label: 'Room 263', note: 'Hacking room', details: ['Hacking room for the event', 'Door number still being confirmed on site'] },
      { value: '264', label: 'Room 264', note: 'Hacking room', details: ['Hacking room for the event', 'Door number still being confirmed on site'] },
      { value: '265', label: 'Room 265', note: 'Hacking room', details: ['Hacking room for the event', 'Door number still being confirmed on site'] },
      { value: 'B62', label: 'Room B62', details: ['Door number still being confirmed on site'] },
      { value: 'B64A', label: 'Room B64A', floor: 'Lower level' },
    ],
  },
  {
    title: 'Study spots',
    icon: 'book',
    items: [
      { value: 'F2_open_study', label: 'Open student work area · Floor 2', note: 'Tables and space to work', details: ['Open work area for students', 'Routes to the work-area entrance'] },
      { value: 'Spark', label: 'Spark incubator lab · Floor 2', note: 'West end of the corridor', details: ['Informal collaboration area at the west end of the corridor'] },
    ],
  },
  {
    title: 'Food & coffee',
    icon: 'coffee',
    items: [
      { value: 'F1_cafe_entry', label: 'Café · Floor 1', note: 'Café entrance', details: ['Routes to the café entrance'] },
    ],
  },
  {
    title: 'Restrooms',
    icon: 'restroom',
    items: [
      { value: 'F1_restrooms', label: 'Restrooms · Floor 1' },
      { value: 'F2_restrooms', label: 'Restrooms · Floor 2' },
      { value: 'B1_restrooms', label: 'Restrooms · Lower level' },
    ],
  },
  // Classroom choices use physical door-number aliases in Top destinations above.
  // Capacity-based internal nodes are not user-facing destinations.
]

// Flat list, handy for datalist suggestions and resolution lookups.
export const ALL_DESTS = DEST_GROUPS.flatMap((g) => g.items)

const BY_VALUE = new Map(ALL_DESTS.map((d) => [d.value.toLowerCase(), d]))

// Floor words -> node-id floor code, so a typed phrase like "floor 1 bathroom"
// or "lower level restroom" resolves to a real restroom node without inventing
// anything. Only the restroom nodes we know are real are produced here.
const FLOOR_WORDS = [
  { code: 'F1', test: /\b(floor\s*1|first\s*floor|1st\s*floor|f1|level\s*1|ground)\b/ },
  { code: 'F2', test: /\b(floor\s*2|second\s*floor|2nd\s*floor|f2|level\s*2|upstairs)\b/ },
  { code: 'B1', test: /\b(lower\s*level|basement|lower\s*floor|b1|floor\s*-?1|level\s*-?1|downstairs)\b/ },
]
const RESTROOM_WORDS = /\b(restroom|restrooms|bathroom|bathrooms|toilet|toilets|washroom|washrooms|wc|lavatory)\b/
const CLASS_WORDS = /\b(classroom|class\s*room|lecture)\b/

// Resolve free-text the user typed into a value the backend understands.
// Returns the resolved string, or the trimmed input unchanged if we can't map it
// (in which case the backend will 422 and the Route screen shows guidance).
export function resolveDestination(input) {
  const raw = String(input || '').trim()
  if (!raw) return raw
  const lower = raw.toLowerCase()

  // Exact match against a verified quick-pick (by value or by its label).
  if (BY_VALUE.has(lower)) return BY_VALUE.get(lower).value
  const byLabel = ALL_DESTS.find((d) => d.label.toLowerCase() === lower)
  if (byLabel) return byLabel.value

  // A plain room number / node id: pass through untouched (backend validates it).
  if (/^[a-z]?\d+[a-z]?$/i.test(raw) || /^[bf]\d?_/i.test(raw)) return raw

  // Phrases like "floor 1 bathroom", "second floor restroom", "lower level toilet".
  if (RESTROOM_WORDS.test(lower)) {
    const floor = FLOOR_WORDS.find((f) => f.test.test(lower))
    if (floor) return `${floor.code}_restrooms`
  }

  // A classroom number means the physical door number, not seating capacity.
  // Let the private rooms table validate it; never infer its node from class24.
  if (CLASS_WORDS.test(lower)) {
    const room = lower.match(/^(?:classroom|class\s+room|lecture\s+room)\s+([b]?\d+[a-z]?)$/)
    if (room) return room[1].toUpperCase()
    // Capacity descriptions resolve only through the exact curated labels above.
    // The public suggestion list is incomplete, so a single listed match does not
    // establish that this is the only classroom with that capacity on its floor.
  }

  return raw
}

// Human-readable header for a destination value, for the Route screen title.
// "164" -> "Room 164"; "F1_restrooms" -> "Restrooms (Floor 1)". Uses spots.js
// formatting and never invents names.
export function destinationLabel(value, roomLabels = {}) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  // A verified quick-pick: prefer its curated label (strip the " · floor" tail so
  // the header stays short) but keep the floor in parentheses where it helps.
  const known = BY_VALUE.get(raw.toLowerCase())
  // Bare room number like "164" or "B62".
  if (/^[a-z]?\d+[a-z]?$/i.test(raw)) return `Room ${raw.toUpperCase()}`
  // A node id we can format with spots.js (e.g. "F1_restrooms").
  if (/^[bf]\d?_/i.test(raw)) {
    if (known) { const [name, floor] = known.label.split(' · '); return floor ? `${name} (${floor})` : name }
    const name = spotName(raw, roomLabels)
    const floor = floorOf(raw).name
    return floor && !name.includes(floor) ? `${name} (${floor})` : name
  }
  return known ? known.label : raw
}
