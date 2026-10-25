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

// Remembered "Show directions" choice; storage can be blocked, so default off.
const DIRECTIONS_KEY = 'hound-show-directions'

export function directionsShown() {
  try { return globalThis.localStorage?.getItem(DIRECTIONS_KEY) === '1' } catch { return false }
}

export function setDirectionsShown(shown) {
  try { globalThis.localStorage?.setItem(DIRECTIONS_KEY, shown ? '1' : '0') } catch { /* storage blocked */ }
}
