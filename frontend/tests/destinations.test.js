import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALL_DESTS, DEST_GROUPS, destinationLabel, resolveDestination } from '../src/lib/destinations.js'

test('every quick-pick is a verified-real value with a label', () => {
  // Each value returned 200 from the live /route on 2026-10-25 (made-up places return 422).
  assert.deepEqual(ALL_DESTS.map((d) => d.value), [
    '164', '220', '262', '263', '264', '265', 'B62', 'B64A',
    'F2_open_study', 'Spark',
    'F1_cafe_entry',
    'F1_restrooms', 'F2_restrooms', 'B1_restrooms',
  ])
  for (const d of ALL_DESTS) {
    assert.equal(typeof d.value, 'string')
    assert.ok(d.value.length > 0)
    assert.ok(d.label.length > 0)
  }
  // No duplicate destination values across groups.
  const values = ALL_DESTS.map((d) => d.value)
  assert.equal(new Set(values).size, values.length)
  assert.ok(DEST_GROUPS.every((g) => g.items.length > 0))
})

test('resolveDestination passes through plain room numbers and node ids', () => {
  assert.equal(resolveDestination('164'), '164')
  assert.equal(resolveDestination(' 164 '), '164')
  assert.equal(resolveDestination('B62'), 'B62')
  assert.equal(resolveDestination('F1_restrooms'), 'F1_restrooms')
})

test('resolveDestination maps "floor N bathroom" phrasing to a real restroom node', () => {
  assert.equal(resolveDestination('floor 1 bathroom'), 'F1_restrooms')
  assert.equal(resolveDestination('Floor 2 restroom'), 'F2_restrooms')
  assert.equal(resolveDestination('second floor toilet'), 'F2_restrooms')
  assert.equal(resolveDestination('lower level washroom'), 'B1_restrooms')
  assert.equal(resolveDestination('first floor bathrooms'), 'F1_restrooms')
})

test('resolveDestination leaves unknown free text untouched for the backend to reject', () => {
  assert.equal(resolveDestination('the dog park'), 'the dog park')
  assert.equal(resolveDestination(''), '')
})

test('resolveDestination matches a curated label case-insensitively', () => {
  assert.equal(resolveDestination('restrooms · floor 1'), 'F1_restrooms')
})

test('destinationLabel reads correctly for rooms and nodes', () => {
  assert.equal(destinationLabel('164'), 'Room 164')
  assert.equal(destinationLabel('B62'), 'Room B62')
  assert.match(destinationLabel('F1_restrooms'), /Restrooms/)
  assert.match(destinationLabel('F1_restrooms'), /Floor 1/)
  assert.match(destinationLabel('B1_class70'), /Lower level/)
})
