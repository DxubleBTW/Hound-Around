// Display-only rewriting for the directions screen.
//
// IMPORTANT: this is the single, central "display rewrite" seam. The backend's
// instruction prose is LAW and must never change; the step classifier
// (Route.jsx `stepKind`) keys on the EXACT raw backend prefixes. Nothing here
// changes what we send to the API or how a step is classified. These helpers
// only reword the string a human SEES, so we can keep extending them later
// (e.g. other awkward words) without touching the contract.

// Case-aware, word-boundary rewrites applied to any user-facing text. Keep this
// list small and obvious. Each entry replaces a whole word while preserving the
// original capitalization of the first letter ("Corridor" -> "Hallway",
// "corridor" -> "hallway").
const WORD_REWRITES = [
  { from: 'corridor', to: 'hallway' },
]

// Rewrite a single whole word while preserving the leading-letter case of the
// matched source word. Lower-case source -> lower-case target; a capitalized
// source (first letter upper) -> capitalized target.
function matchCase(sourceWord, target) {
  const firstUpper = sourceWord[0] === sourceWord[0]?.toUpperCase() &&
    sourceWord[0] !== sourceWord[0]?.toLowerCase()
  return firstUpper ? target[0].toUpperCase() + target.slice(1) : target
}

// Prettify a user-facing instruction or landmark string for DISPLAY only.
// Applies the word rewrites above with word boundaries so neighbouring words are
// never mangled. Non-string / empty input passes through as an empty string.
export function prettifyLandmark(text = '', roomLabel = '') {
  let out = String(text || '')
  // Older backend graph labels can still include seating capacities. Strip the
  // capacity for display without inventing a door number or changing turn words.
  const physicalRoom = typeof roomLabel === 'string' && /^Room B?\d{2,3}[A-Z]?$/i.test(roomLabel) ? roomLabel : ''
  out = out.replace(/\b\d+\s*[-–]?\s*(?:seat(?:er)?|person)\s+(classrooms?|rooms?)(?:\s+(?:[A-C]|west|middle|east)(?=\s*(?:[·,(]|$)))?/gi,
    (_, noun) => physicalRoom || noun)
  for (const { from, to } of WORD_REWRITES) {
    const re = new RegExp(`\\b${from}\\b`, 'gi')
    out = out.replace(re, (word) => matchCase(word, to))
  }
  return out
}

// Plain-language "next move" label derived purely from the step kind (which
// Route.jsx computes from the raw backend prefix). This is the "points you the
// right way" cue — a RELATIVE turn, not a magnetic/device bearing (the app has a
// hard no-sensors rule). Vertical moves optionally take the destination level so
// the label can read "Go up to Floor 2".
export function moveLabel(kind, levelName = '') {
  switch (kind) {
    case 'left': return 'Turn left'
    case 'right': return 'Turn right'
    case 'around': return 'Turn around'
    case 'continue':
    case 'walk': return 'Keep straight'
    case 'elevator':
    case 'stairs': {
      const verb = kind === 'elevator' ? 'Take the elevator' : 'Take the stairs'
      return levelName ? `${verb} to ${levelName}` : verb
    }
    default: return 'Keep straight'
  }
}

// Short accessible label for the big relative arrow. Mirrors moveLabel but kept
// separate so screen-reader text can stay terse and unambiguous. Never implies a
// compass bearing or absolute building orientation.
export function arrowAria(kind) {
  switch (kind) {
    case 'left': return 'Next move: turn left'
    case 'right': return 'Next move: turn right'
    case 'around': return 'Next move: turn around'
    case 'elevator': return 'Next move: change floors by elevator'
    case 'stairs': return 'Next move: change floors by stairs'
    case 'continue':
    case 'walk':
    default: return 'Next move: keep straight ahead'
  }
}
