import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compactSteps } from '../src/lib/steps.js'

const kind = (instruction) => (instruction.startsWith('Turn') ? 'right'
  : instruction.startsWith('Take the elevator') ? 'elevator' : 'walk')

test('a tiny keep-straight step folds its distance into the next sign', () => {
  const steps = [
    { instruction: 'Walk toward East hallway', meters: 2, node: 'a' },
    { instruction: 'Turn right and walk toward Room 164', meters: 15, node: 'b' },
  ]
  assert.deepEqual(compactSteps(steps, kind), [{ instruction: 'Turn right and walk toward Room 164', meters: 17, node: 'b' }])
})

test('turns, floor changes and the last step are never folded', () => {
  const steps = [
    { instruction: 'Turn right and walk toward East hallway', meters: 1, node: 'a' },
    { instruction: 'Take the elevator to 1, toward lobby', meters: 0, node: 'b' },
    { instruction: 'Walk toward Room 164', meters: 2, node: 'c' },
  ]
  assert.deepEqual(compactSteps(steps, kind), steps)
})

test('total distance is unchanged', () => {
  const steps = [
    { instruction: 'Walk toward A', meters: 1.5, node: 'a' },
    { instruction: 'Walk toward B', meters: 2, node: 'b' },
    { instruction: 'Walk toward C', meters: 20, node: 'c' },
  ]
  const sum = (list) => list.reduce((a, s) => a + s.meters, 0)
  const out = compactSteps(steps, kind)
  assert.equal(out.length, 1)
  assert.equal(sum(out), sum(steps))
})

test('empty or missing steps stay empty', () => {
  assert.deepEqual(compactSteps([], kind), [])
  assert.deepEqual(compactSteps(undefined, kind), [])
})
