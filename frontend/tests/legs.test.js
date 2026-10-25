import assert from 'node:assert/strict'
import { test } from 'node:test'
import { directionsShown, exitLabel, passesText, stepsByLeg, trackUp, turnMarks, usableLegs } from '../src/lib/legs.js'

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

test('trackUp turns the first stretch to point up the screen and keeps it in the box', () => {
  // Walk east, then turn right (south on the plan, y grows down).
  const leg = { points: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.5]],
    branches: [[], [{ dx: 0, dy: -1, kind: 'hall' }], []] }
  const { points, branches } = trackUp(leg)
  const [a, b, c] = points
  close(a[0], b[0]) // first stretch is vertical...
  assert.ok(b[1] < a[1]) // ...and goes up
  assert.ok(c[0] > b[0]) // a right turn still goes right on screen
  for (const [x, y] of points) assert.ok(x >= 0.099 && x <= 0.901 && y >= 0.099 && y <= 0.901)
  // The north opening at the corner now points left (it was on the walker's left).
  close(branches[1][0].dx, -1)
  close(branches[1][0].dy, 0)
  assert.deepEqual(trackUp({ points: [[0.5, 0.5]] }).points, [[0.5, 0.5]])
})

test('trackUp ignores a short first hop (out of a stairwell) and aligns the real hallway', () => {
  // A 0.05 hop south, then the long hallway west.
  const { points } = trackUp({ points: [[0.9, 0.45], [0.9, 0.5], [0.1, 0.5]] })
  const [a, b, c] = points
  close(b[0], c[0]) // the hallway itself is now vertical (the hop sits off to the side)...
  assert.ok(c[1] < b[1] && c[1] < a[1]) // ...and goes up
})

test('turnMarks numbers turns where they start, matching the directions list', () => {
  const leg = { start: 'a', nodes: ['a', 'b', 'c', 'lift'] }
  const steps = [
    { instruction: 'Walk toward b', node: 'b' },
    { instruction: 'Turn left and walk toward c', node: 'c' },
    { instruction: 'Turn right and walk toward the elevators', node: 'lift' },
    { instruction: 'Take the elevator to 2, then head toward x', node: 'up' },
  ]
  const kind = (i) => (i.startsWith('Turn left') ? 'left' : i.startsWith('Turn right') ? 'right' : 'walk')
  assert.deepEqual(turnMarks(leg, steps, kind), [{ index: 1, n: 2, kind: 'left' }, { index: 2, n: 3, kind: 'right' }])
})

test('passesText reads like speech', () => {
  assert.equal(passesText([]), '')
  assert.equal(passesText([{ name: 'the restrooms', side: 'left' }]), 'Pass the restrooms on your left.')
  assert.equal(passesText([{ name: 'the restrooms', side: 'left' }, { name: 'Room 262', side: 'right' },
    { name: 'the main stairs', side: 'left' }]),
  'Pass the restrooms on your left, Room 262 on your right and the main stairs on your left.')
})

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
