import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spotName } from '../src/lib/spots.js'
import { ALL_DESTS, destinationLabel, resolveDestination } from '../src/lib/destinations.js'
import { BU_CDS_ROOM_LABELS } from '../src/lib/publicRoomLabels.js'

test('internal capacity IDs never appear in user-facing classroom names', () => {
  for (const node of ['F1_class24', 'F1_class48', 'F2_class48a', 'B1_class70']) {
    assert.equal(spotName(node), 'Classroom (room number unconfirmed)')
    assert.doesNotMatch(spotName(node), /\d|seat/i)
  }
  assert.equal(spotName('F1_room164'), 'Room 164')
  assert.equal(destinationLabel('F1_class48'), 'Classroom (room number unconfirmed) (Floor 1)')
  assert.ok(ALL_DESTS.every((d) => !/_class/.test(d.value)))
  assert.ok(ALL_DESTS.every((d) => !/seat/i.test(d.label)))
})

test('the six public room aliases display as door numbers in the configured building', () => {
  for (const [spot, label] of Object.entries(BU_CDS_ROOM_LABELS)) {
    assert.equal(spotName(spot, BU_CDS_ROOM_LABELS), label)
    assert.ok(ALL_DESTS.some((d) => d.label === label))
    assert.ok(destinationLabel(spot, BU_CDS_ROOM_LABELS).startsWith(label))
  }
  assert.equal(spotName('F2_class48a', BU_CDS_ROOM_LABELS), 'Room 262')
  assert.equal(spotName('B1_class70', BU_CDS_ROOM_LABELS), 'Room B62')
  assert.equal(spotName('F1_class48', BU_CDS_ROOM_LABELS), 'Classroom (room number unconfirmed)')
})

test('typed classroom numbers resolve as door numbers rather than capacity nodes', () => {
  assert.equal(resolveDestination('Classroom 24'), '24')
  assert.equal(resolveDestination('Classroom 164'), '164')
  assert.equal(resolveDestination('Class room B62'), 'B62')
  assert.equal(resolveDestination('Classroom 48a'), '48A')
})

test('capacity descriptions resolve only when explicitly identified and unambiguous', () => {
  assert.equal(resolveDestination('70 seat classroom'), '70 seat classroom')
  assert.equal(resolveDestination('48-seat classroom · Floor 1'), '48-seat classroom · Floor 1')
  assert.equal(resolveDestination('48-seat classroom'), '48-seat classroom')
  assert.equal(resolveDestination('48-seat classroom floor 2'), '48-seat classroom floor 2')
  assert.equal(resolveDestination('Classroom 999'), '999')
})
