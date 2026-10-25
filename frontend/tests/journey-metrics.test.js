import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JourneyMetrics } from '../src/lib/journeyMetrics.js'

test('photo-to-route timing includes retakes and manual recovery without recording places', () => {
  let now = 100
  const metrics = new JourneyMetrics(() => now)
  metrics.begin(0)
  metrics.rejected()
  metrics.retake()
  now = 1000
  metrics.begin() // another photo must not reset the journey clock
  metrics.manual()
  now = 3000
  metrics.ready()
  metrics.ready() // rerender or route retry cannot count twice
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.routesReady, 1)
  assert.equal(snapshot.withoutRetake, 0)
  assert.equal(snapshot.afterRejection, 1)
  assert.equal(snapshot.viaManualFallback, 1)
  assert.equal(snapshot.photoToRoute[3], 1)
  snapshot.photoToRoute.fill(100)
  assert.equal(metrics.snapshot().photoToRoute[0], 0)
})

test('abandoned and purely manual flows do not become photo success measurements', () => {
  const metrics = new JourneyMetrics(() => 500)
  metrics.manual()
  metrics.ready()
  metrics.begin(0)
  metrics.cancel()
  metrics.ready()
  assert.equal(metrics.snapshot().routesReady, 0)
  metrics.begin(0)
  metrics.ready()
  assert.equal(metrics.snapshot().withoutRetake, 1)
})
