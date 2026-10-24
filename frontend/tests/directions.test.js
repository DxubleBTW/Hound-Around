import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arrowAria, moveLabel, prettifyLandmark } from '../src/lib/directions.js'

test('prettifyLandmark rewrites "corridor" -> "hallway" preserving case', () => {
  assert.equal(prettifyLandmark('Corridor by restrooms'), 'Hallway by restrooms')
  assert.equal(prettifyLandmark('Corridor east of main elevators'), 'Hallway east of main elevators')
  assert.equal(prettifyLandmark('Main corridor'), 'Main hallway')
  assert.equal(
    prettifyLandmark('Main corridor below the elevator passage'),
    'Main hallway below the elevator passage',
  )
})

test('prettifyLandmark rewrites corridor inside a full instruction', () => {
  assert.equal(
    prettifyLandmark('Turn right and walk toward Corridor by restrooms'),
    'Turn right and walk toward Hallway by restrooms',
  )
  assert.equal(
    prettifyLandmark('Walk toward Main corridor below the elevator passage'),
    'Walk toward Main hallway below the elevator passage',
  )
})

test('prettifyLandmark uses word boundaries so it does not mangle other words', () => {
  // No standalone "corridor" word here, so nothing changes.
  assert.equal(prettifyLandmark('corridored'), 'corridored')
  assert.equal(prettifyLandmark('precorridor'), 'precorridor')
})

test('prettifyLandmark handles empty and non-string input safely', () => {
  assert.equal(prettifyLandmark(''), '')
  assert.equal(prettifyLandmark(), '')
  assert.equal(prettifyLandmark(null), '')
})

test('moveLabel gives a plain-language relative move per step kind', () => {
  assert.equal(moveLabel('left'), 'Turn left')
  assert.equal(moveLabel('right'), 'Turn right')
  assert.equal(moveLabel('around'), 'Turn around')
  assert.equal(moveLabel('continue'), 'Keep straight')
  assert.equal(moveLabel('walk'), 'Keep straight')
  assert.equal(moveLabel('elevator'), 'Take the elevator')
  assert.equal(moveLabel('elevator', 'Floor 2'), 'Take the elevator to Floor 2')
  assert.equal(moveLabel('stairs', 'Lower level'), 'Take the stairs to Lower level')
  // Unknown kind falls back to the safe default.
  assert.equal(moveLabel('mystery'), 'Keep straight')
})

test('arrowAria never implies a magnetic/absolute bearing', () => {
  for (const kind of ['left', 'right', 'around', 'continue', 'walk', 'elevator', 'stairs']) {
    const label = arrowAria(kind)
    assert.match(label, /^Next move:/)
    assert.doesNotMatch(label, /north|south|east|west|compass|bearing|degrees/i)
  }
})
