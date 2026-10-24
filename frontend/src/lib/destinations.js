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
export const DEST_GROUPS = [
  {
    title: 'Popular',
    items: [
      { value: '164', label: 'Room 164 · Closing Ceremony' },
      { value: 'B62', label: 'Room B62' },
      { value: '262', label: 'Room 262' },
      { value: '263', label: 'Room 263' },
      { value: '264', label: 'Room 264' },
      { value: '265', label: 'Room 265' },
    ],
  },
  {
    title: 'Restrooms',
    items: [
      { value: 'F1_restrooms', label: 'Restrooms · Floor 1' },
      { value: 'F2_restrooms', label: 'Restrooms · Floor 2' },
      { value: 'B1_restrooms', label: 'Restrooms · Lower level' },
    ],
  },
  {
    title: 'Classrooms',
    items: [
      { value: 'B1_class70', label: '70-seat classroom · Lower level' },
      { value: 'F1_class24', label: 'Classroom 24 · Floor 1' },
      { value: 'F1_class48', label: 'Classroom 48 · Floor 1' },
      { value: 'F2_class20', label: 'Classroom 20 · Floor 2' },
      { value: 'F2_class48a', label: 'Classroom 48a · Floor 2' },
    ],
  },
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

  // "70 seat classroom" / "classroom 24" etc. map to a verified classroom when the
  // number is one we actually know; otherwise fall through to the backend.
  if (CLASS_WORDS.test(lower)) {
    const num = lower.match(/\d+[a-z]?/)
    if (num) {
      const hit = ALL_DESTS.find((d) => /_class/.test(d.value) && d.value.toLowerCase().endsWith(num[0]))
      if (hit) return hit.value
    }
  }

  return raw
}

// Human-readable header for a destination value, for the Route screen title.
// "164" -> "Room 164"; "F1_restrooms" -> "Restrooms (Floor 1)". Uses spots.js
// formatting and never invents names.
export function destinationLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  // A verified quick-pick: prefer its curated label (strip the " · floor" tail so
  // the header stays short) but keep the floor in parentheses where it helps.
  const known = BY_VALUE.get(raw.toLowerCase())
  // Bare room number like "164" or "B62".
  if (/^[a-z]?\d+[a-z]?$/i.test(raw)) return `Room ${raw.toUpperCase()}`
  // A node id we can format with spots.js (e.g. "F1_restrooms").
  if (/^[bf]\d?_/i.test(raw)) {
    const name = spotName(raw)
    const floor = floorOf(raw).name
    return floor && !name.includes(floor) ? `${name} (${floor})` : name
  }
  return known ? known.label : raw
}
