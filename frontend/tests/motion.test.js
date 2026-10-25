import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { motionPaused, prefersReducedMotion, setMotionPaused, subscribeMotion } from '../src/lib/motion.js'

const oldWindow = globalThis.window
const oldDocument = globalThis.document
afterEach(() => {
  globalThis.window = oldWindow
  globalThis.document = oldDocument
})

function browser({ paused = false, legacy = false } = {}) {
  const events = new EventTarget()
  const changes = new EventTarget()
  const media = { matches: false }
  const add = (listener) => changes.addEventListener('change', listener)
  const remove = (listener) => changes.removeEventListener('change', listener)
  if (legacy) { media.addListener = add; media.removeListener = remove }
  else {
    media.addEventListener = (_, listener) => add(listener)
    media.removeEventListener = (_, listener) => remove(listener)
  }
  const storage = new Map([['hound-motion-paused', paused ? '1' : '0']])
  globalThis.window = {
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => media,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  }
  globalThis.document = { documentElement: { dataset: {} } }
  return { media, change: () => changes.dispatchEvent(new Event('change')) }
}

test('saved pause applies before the first render', () => {
  browser({ paused: true })
  assert.equal(motionPaused(), true)
  assert.equal(prefersReducedMotion(), true)
})

test('pause then play notifies mounted animations with the new setting', () => {
  browser()
  const states = []
  const unsubscribe = subscribeMotion(() => states.push(prefersReducedMotion()))
  setMotionPaused(true)
  setMotionPaused(false)
  assert.deepEqual(states, [true, false])
  assert.equal(motionPaused(), false)
  unsubscribe()
  setMotionPaused(true)
  assert.deepEqual(states, [true, false])
})

for (const legacy of [false, true]) {
  test(`device motion changes notify mounted animations (${legacy ? 'legacy Safari' : 'modern browser'})`, () => {
    const { media, change } = browser({ legacy })
    const states = []
    const unsubscribe = subscribeMotion(() => states.push(prefersReducedMotion()))
    media.matches = true
    change()
    setMotionPaused(false)
    assert.deepEqual(states, [true, true]) // Play respects the device preference.
    media.matches = false
    change()
    assert.equal(states.at(-1), false)
    unsubscribe()
    change()
    assert.equal(states.length, 3)
  })
}
