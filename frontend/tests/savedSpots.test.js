import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_SAVED, loadSaved, storeSaved, upsertSaved } from '../src/lib/savedSpots.js'

const memory = () => {
  const data = {}
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) }, removeItem: (k) => { delete data[k] } }
}

test('saving the same place again updates it and moves it to the front', () => {
  let list = upsertSaved([], { value: '263', name: 'Hack room', note: '' })
  list = upsertSaved(list, { value: 'Spark', name: 'Lab', note: 'West end' })
  list = upsertSaved(list, { value: '263', name: '  My   table ', note: 'by the window' })
  assert.deepEqual(list, [
    { value: '263', name: 'My table', note: 'by the window' },
    { value: 'Spark', name: 'Lab', note: 'West end' },
  ])
})

test('an empty place is never saved, and the list is capped', () => {
  assert.deepEqual(upsertSaved([], { value: '  ', name: 'x' }), [])
  let list = []
  for (let k = 0; k < MAX_SAVED + 5; k++) list = upsertSaved(list, { value: String(100 + k), name: `R${k}` })
  assert.equal(list.length, MAX_SAVED)
})

test('saved spots round-trip per building, and bad storage reads as empty', () => {
  globalThis.localStorage = memory()
  storeSaved('cds', [{ value: '164', name: 'Ceremony', note: '' }])
  assert.deepEqual(loadSaved('cds'), [{ value: '164', name: 'Ceremony', note: '' }])
  assert.deepEqual(loadSaved('other'), [])
  localStorage.setItem('hound.saved.cds', '{not json')
  assert.deepEqual(loadSaved('cds'), [])
  delete globalThis.localStorage
  assert.deepEqual(loadSaved('cds'), [])
})

test('a saved spot photo stays under its own key, and a full phone just says no', async () => {
  const { loadPhoto, storePhoto } = await import('../src/lib/savedSpots.js')
  globalThis.localStorage = memory()
  const jpeg = 'data:image/jpeg;base64,AAAA'
  assert.equal(storePhoto('cds', 'Spark', jpeg), true)
  assert.equal(loadPhoto('cds', 'spark'), jpeg)
  assert.equal(storePhoto('cds', 'Spark', null), true)
  assert.equal(loadPhoto('cds', 'Spark'), null)
  localStorage.setItem('hound.savedPhoto.cds.x', 'javascript:alert(1)')
  assert.equal(loadPhoto('cds', 'x'), null) // only JPEG data URLs are shown
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => {} }
  assert.equal(storePhoto('cds', 'Spark', jpeg), false)
  delete globalThis.localStorage
})
