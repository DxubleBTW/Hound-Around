import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApi } from '../src/api.js'
import { buildingConfig } from '../src/lib/campuses.js'

const campuses = [
  { id: 'bu', name: 'Boston University', buildings: [{id:'cds',name:'CDS',enabled:true,apiEnv:'VITE_API_URL'}] },
  { id: 'synthetic', name: 'Synthetic school', buildings: [{id:'demo',name:'Synthetic building',enabled:true,apiEnv:'VITE_SYNTHETIC_API'}] },
]

test('only the existing BU/CDS default can use mock mode without a configured backend', () => {
  assert.equal(buildingConfig('bu', 'cds', {}, campuses).available, true)
  assert.equal(buildingConfig('synthetic', 'demo', {}, campuses).available, false)
})

test('a configured second school keeps its own endpoint and public directory', () => {
  const config = buildingConfig('synthetic', 'demo', {VITE_SYNTHETIC_API:'https://school.example/api/'}, campuses)
  assert.equal(config.available, true)
  assert.equal(config.apiBase, 'https://school.example/api')
  assert.deepEqual(config.landmarks, [])
})

for (const url of ['javascript:alert(1)', '//other.example/api', 'https://user:pass@example.com', 'https://example.com?token=secret', '/\\other.example/api', '/api#other', 'http://remote.example/api']) {
  test(`unsafe or ambiguous API base is unavailable: ${url.split(':')[0]}`, () => {
    assert.equal(buildingConfig('bu', 'cds', {VITE_API_URL:url}, campuses).available, false)
  })
}

test('unknown schools/buildings never silently select the default index', () => {
  assert.equal(buildingConfig('unknown', 'cds', {}, campuses), null)
  assert.equal(buildingConfig('bu', 'unknown', {}, campuses), null)
})

test('building clients keep requests and photo corrections scoped without mutating a global base', async (t) => {
  const urls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url)
    return Response.json({ok:true,index_size:10})
  })
  const a = createApi('https://a.example')
  const b = createApi('https://b.example')
  await Promise.all([a.correct('p_a', 'F1_a'), b.correct('p_b', 'F1_b')])
  await a.correct('p_c', 'F1_a')
  assert.deepEqual(urls, ['https://a.example/correct', 'https://b.example/correct', 'https://a.example/correct'])
})

test('cancelling one building request does not cancel another building client', async (t) => {
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (url, {signal}) => {
    if (url.startsWith('https://a.example')) return new Promise((resolve,reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), {once:true})
    })
    return Response.json({ok:true,index_size:20})
  })
  const pending = createApi('https://a.example').correct('p_a','F1_a',{signal:controller.signal})
  const second = createApi('https://b.example').correct('p_b','F1_b')
  controller.abort()
  await assert.rejects(pending, {name:'AbortError'})
  assert.equal((await second).index_size,20)
})
