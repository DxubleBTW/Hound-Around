// What to do with a /locate answer: pick it, ask the user to pick, or ask for
// one more photo. The backend decides from calibrated confidence
// (ml/calibration.py, docs/contract.md); this only falls back to the old rule
// for backends that don't send a tier.

import { floorOf } from './spots.js'

const TIERS = new Set(['auto', 'picker', 'second'])

// Old rule, kept for backends without calibration.
const MIN_RELEVANCE = 0.2
const PICKER_THRESHOLD = 0.6

// 'auto' | 'confirm' | 'picker' | 'second' | 'retake'. `fused` is true for the
// answer to a second photo: the user then confirms on the combined top 3, never
// a third photo. 'confirm' ("Right spot?") is the old rule's confident case.
export function nextStep(loc, { fused = false } = {}) {
  if (!loc) return 'retake'
  if (TIERS.has(loc.tier)) return fused && loc.tier === 'second' ? 'picker' : loc.tier
  if ((loc.confidence || 0) < MIN_RELEVANCE) return fused ? 'picker' : 'retake'
  const floors = new Set((loc.top3 || []).map((t) => floorOf(t.spot).code))
  return loc.confidence < PICKER_THRESHOLD || floors.size > 1 ? 'picker' : 'confirm'
}
