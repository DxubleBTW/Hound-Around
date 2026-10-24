import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spotName } from '../src/lib/spots.js'
import { ALL_DESTS, destinationLabel, resolveDestination } from '../src/lib/destinations.js'

test('capacity node IDs never display as physical room numbers', () => {
  assert.equal(spotName('F1_class24'), '24-seat classroom')
  assert.equal(spotName('F1_class48'), '48-seat classroom')
  assert.equal(spotName('F2_class48a'), '48-seat classroom A')
  assert.equal(spotName('B1_class70'), '70-seat classroom')
  assert.equal(spotName('F1_room164'), 'Room 164')
  assert.equal(destinationLabel('F1_class48'), '48-seat classroom (Floor 1)')
  assert.ok(ALL_DESTS.filter((d) => /_class/.test(d.value)).every((d) => d.label.includes('-seat classroom')))
})

test('typed classroom numbers resolve as door numbers rather than capacity nodes', () => {
  assert.equal(resolveDestination('Classroom 24'), '24')
  assert.equal(resolveDestination('Classroom 164'), '164')
  assert.equal(resolveDestination('Class room B62'), 'B62')
  assert.equal(resolveDestination('Classroom 48a'), '48A')
})

test('capacity descriptions resolve only when explicitly identified and unambiguous', () => {
  assert.equal(resolveDestination('70 seat classroom'), '70 seat classroom')
  assert.equal(resolveDestination('48-seat classroom · Floor 1'), 'F1_class48')
  assert.equal(resolveDestination('48-seat classroom'), '48-seat classroom')
  assert.equal(resolveDestination('48-seat classroom floor 2'), '48-seat classroom floor 2')
  assert.equal(resolveDestination('Classroom 999'), '999')
})
