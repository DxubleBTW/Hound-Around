import assert from 'node:assert/strict'
import { test } from 'node:test'
import { directionsShown, exitLabel, stepsByLeg, usableLegs } from '../src/lib/legs.js'

const legs = [
  { floor: 1, points: [[0.1, 0.1], [0.9, 0.1]], start: 'F1_a', end: 'F1_core_elev', exit: { mode: 'elevator', to_floor: 2 } },
  { floor: 2, points: [[0.1, 0.5], [0.9, 0.5]], start: 'F2_core_elev', end: 'F2_room', exit: null },
]

const kind = (instruction) => (instruction.startsWith('Take the elevator') ? 'elevator' : 'walk')

test('usableLegs accepts well-formed legs and rejects anything else', () => {
  assert.equal(usableLegs({ legs }), legs)
  assert.equal(usableLegs({}), null)
  assert.equal(usableLegs({ legs: [] }), null)
  assert.equal(usableLegs({ legs: [{ ...legs[0], points: [[1.2, 0]] }, legs[1]] }), null)
  // Only the last leg may end without a floor change.
  assert.equal(usableLegs({ legs: [{ ...legs[0], exit: null }, legs[1]] }), null)
  assert.equal(usableLegs({ legs: [legs[0]] }), null)
})

test('exitLabel names the mode and floor', () => {
  assert.equal(exitLabel(legs[0].exit), 'Take the elevator to Floor 2')
  assert.equal(exitLabel({ mode: 'stairs', to_floor: -1 }), 'Take the stairs to Lower level')
  assert.equal(exitLabel(null), '')
})

test('stepsByLeg groups each floor with the ride that leaves it', () => {
  const steps = [
    { instruction: 'Walk toward the tower elevators', meters: 12, node: 'F1_core_elev' },
    { instruction: 'Take the elevator to LL, toward Lobby', meters: 0, node: 'B1_core_elev' },
    { instruction: 'Take the elevator to 2, toward Lobby', meters: 0, node: 'F2_core_elev' },
    { instruction: 'Walk toward Room 263', meters: 9, node: 'F2_room' },
  ]
  assert.deepEqual(stepsByLeg(steps, kind, 2), [steps.slice(0, 3), steps.slice(3)])
  assert.equal(stepsByLeg(steps, kind, 3), null)
})

test('directions are hidden by default', () => {
  assert.equal(directionsShown(), false)
})
