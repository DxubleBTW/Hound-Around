import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkHealth } from '../src/lib/request.js'

test('ready backend reports ok with index size and model', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, index_size: 2213, model: 'dinov2-small' }))
  assert.deepEqual(await checkHealth('/health'), { ok: true, reachable: true, index_size: 2213, model: 'dinov2-small' })
})

test('503 while the model loads is reachable but not ok, and does not throw', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, index_size: 0, model: 'unconfigured' }, { status: 503 }))
  assert.deepEqual(await checkHealth('/health'), { ok: false, reachable: true, index_size: 0, model: 'unconfigured' })
})

test('connection failure is unreachable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  assert.equal((await checkHealth('/health')).reachable, false)
})

test('stalled health check times out as unreachable', async (t) => {
  t.mock.method(globalThis, 'fetch', (_u, { signal }) => new Promise((_r, reject) =>
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
  assert.deepEqual(await checkHealth('/health', { timeoutMs: 5 }), { ok: false, reachable: false, index_size: 0, model: '' })
})

test('non-JSON body (proxy error page) is handled', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }))
  assert.deepEqual(await checkHealth('/health'), { ok: false, reachable: true, index_size: 0, model: '' })
})
