// Display-only grouping of route steps. The backend's steps are law; this only
// decides how many signs the user taps through.
//
// A "keep straight" step shorter than TINY_METERS isn't worth its own sign (the
// live route to Room 164 opened with "Keep straight, about 2 m"). Its distance
// folds into the next step instead. Turns, floor changes and the final step are
// never folded, so no direction is ever dropped.
export const TINY_METERS = 3

const STRAIGHT = new Set(['walk', 'continue'])

export function compactSteps(steps = [], kindOf = () => 'walk') {
  const out = []
  let carry = 0
  steps.forEach((step, index) => {
    const meters = step.meters || 0
    const last = index === steps.length - 1
    if (!last && STRAIGHT.has(kindOf(step.instruction)) && meters < TINY_METERS) {
      carry += meters
      return
    }
    out.push(carry ? { ...step, meters: meters + carry } : step)
    carry = 0
  })
  return out
}
