// Drawable route legs from GET /route (docs/contract.md). One leg per floor;
// points are normalized to that leg alone, so nothing here is a building map.

import { floorName } from './spots.js'

const unit = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1

// The legs if every one is well formed, else null so the screen falls back to
// the sign-by-sign directions (older backends send no legs at all).
export function usableLegs(data) {
  const legs = data?.legs
  if (!Array.isArray(legs) || !legs.length) return null
  const ok = legs.every((leg, index) => leg
    && [-1, 1, 2].includes(leg.floor)
    && Array.isArray(leg.points) && leg.points.length > 0
    && leg.points.every((p) => Array.isArray(p) && p.length === 2 && unit(p[0]) && unit(p[1]))
    && (index === legs.length - 1
      ? leg.exit == null
      : leg.exit && ['elevator', 'stairs'].includes(leg.exit.mode) && [-1, 1, 2].includes(leg.exit.to_floor)))
  return ok ? legs : null
}

// "Take the elevator to Floor 2".
export function exitLabel(exit) {
  if (!exit) return ''
  return `Take the ${exit.mode === 'stairs' ? 'stairs' : 'elevator'} to ${floorName(exit.to_floor)}`
}

// Split the (compacted) steps into one group per leg: each group ends with the
// floor change(s) that leave that leg. Returns null when the counts disagree,
// so the caller can show every step instead of a wrong subset.
export function stepsByLeg(steps, kindOf, legCount) {
  const vertical = (s) => ['elevator', 'stairs'].includes(kindOf(s.instruction))
  const groups = [[]]
  steps.forEach((step, index) => {
    groups[groups.length - 1].push(step)
    const next = steps[index + 1]
    if (vertical(step) && next && !vertical(next)) groups.push([])
  })
  return groups.length === legCount ? groups : null
}

// Points are 0-1 across the leg; shorter first hops don't set the map's "up".
const MIN_STRETCH = 0.15

// Turn the leg so its first stretch points up the screen ("track up"): the map
// then matches what's in front of you instead of the building's own axes. The
// rotated shape is refit into the 0.1-0.9 box. Branch stubs turn with it.
export function trackUp(leg) {
  const pts = leg.points
  const branches = leg.branches || pts.map(() => [])
  if (pts.length < 2) return { points: pts, branches }
  // Align to the first real stretch (the segment that first reaches MIN_STRETCH
  // from the start), not a 1 m hop out of a stairwell or door.
  let j = pts.findIndex(([x, y], i) => i > 0 && Math.hypot(x - pts[0][0], y - pts[0][1]) >= MIN_STRETCH)
  if (j < 1) j = pts.length - 1
  const [x0, y0] = pts[j - 1]
  const [x1, y1] = pts[j]
  // Rotate the first segment's angle onto "up" (-90 degrees; screen y grows down).
  const theta = -Math.PI / 2 - Math.atan2(y1 - y0, x1 - x0)
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const turn = ([x, y]) => [x * cos - y * sin, x * sin + y * cos]
  const turned = pts.map(([x, y]) => turn([x - 0.5, y - 0.5]))
  const xs = turned.map((p) => p[0])
  const ys = turned.map((p) => p[1])
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  const span = Math.max(spanX, spanY) || 1
  const ox = (1 - 0.8 * spanX / span) / 2
  const oy = (1 - 0.8 * spanY / span) / 2
  const fit = ([x, y]) => [ox + 0.8 * (x - Math.min(...xs)) / span, oy + 0.8 * (y - Math.min(...ys)) / span]
  return {
    points: turned.map(fit),
    branches: branches.map((list) => (list || []).map((b) => {
      const [dx, dy] = turn([b.dx, b.dy])
      return { ...b, dx, dy }
    })),
  }
}

// Numbered marks on the map, matching the numbered directions list: each
// turning step is drawn where it starts (the previous step's end, or the start
// of the leg). Steps whose node isn't on this leg (the elevator ride) are skipped.
export function turnMarks(leg, legSteps, kindOf) {
  const nodes = leg.nodes || []
  const marks = []
  let from = leg.start
  legSteps.forEach((step, index) => {
    const kind = kindOf(step.instruction)
    const at = nodes.indexOf(from)
    if (at >= 0 && ['left', 'right', 'around'].includes(kind)) marks.push({ index: at, n: index + 1, kind })
    from = step.node
  })
  return marks
}

// "Pass the restrooms on your left and the main stairs on your right."
export function passesText(passes = []) {
  if (!passes.length) return ''
  const parts = passes.map((p) => `${p.name} on your ${p.side}`)
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Pass ${list}.`
}

// Remembered "Show directions" choice; storage can be blocked, so default off.
const DIRECTIONS_KEY = 'hound-show-directions'

export function directionsShown() {
  try { return globalThis.localStorage?.getItem(DIRECTIONS_KEY) === '1' } catch { return false }
}

export function setDirectionsShown(shown) {
  try { globalThis.localStorage?.setItem(DIRECTIONS_KEY, shown ? '1' : '0') } catch { /* storage blocked */ }
}
