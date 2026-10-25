import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextStep } from '../src/lib/tiers.js'

const loc = (extra) => ({ spot: 'F2_hall_e2', confidence: 0.5, top3: [{ spot: 'F2_hall_e2', votes: 5 }], ...extra })

test('the backend tier decides when present', () => {
  assert.equal(nextStep(loc({ tier: 'auto', confidence: 0.3 })), 'auto')
  assert.equal(nextStep(loc({ tier: 'picker' })), 'picker')
  assert.equal(nextStep(loc({ tier: 'second' })), 'second')
})

test('a second photo never asks for a third', () => {
  assert.equal(nextStep(loc({ tier: 'second' }), { fused: true }), 'picker')
  assert.equal(nextStep(loc({ confidence: 0.1 }), { fused: true }), 'picker')
})

test('without a tier the old confidence rule applies', () => {
  assert.equal(nextStep(loc({ confidence: 0.1 })), 'retake')
  assert.equal(nextStep(loc({ confidence: 0.5 })), 'picker')
  // Uncalibrated backends still get the "Right spot?" check, never a silent pick.
  assert.equal(nextStep(loc({ confidence: 0.9 })), 'confirm')
  // Top 3 on different floors: let the user pick.
  assert.equal(nextStep(loc({ confidence: 0.9, top3: [{ spot: 'F2_a', votes: 7 }, { spot: 'F1_b', votes: 3 }] })), 'picker')
  assert.equal(nextStep(null), 'retake')
})
