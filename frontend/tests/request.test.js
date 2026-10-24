import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError, delay, requestJson } from '../src/lib/request.js'

function pendingFetch(_url, { signal }) {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })
}

test('successful requests preserve body and clean up their timeout', async (t) => {
  let received
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    received = { url, options }
    return Response.json({ ok: true })
  })
  assert.deepEqual(await requestJson('/test', { method: 'POST', body: 'body', timeoutMs: 10 }), { ok: true })
  assert.equal(received.url, '/test')
  assert.equal(received.options.method, 'POST')
  assert.equal(received.options.body, 'body')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(received.options.signal.aborted, false)
})

test('stalled requests abort with a retryable timeout', async (t) => {
  t.mock.method(globalThis, 'fetch', pendingFetch)
  await assert.rejects(requestJson('/locate', { timeoutMs: 5 }), (error) => {
    assert.ok(error instanceof ApiError)
    assert.match(error.message, /taking too long/)
    return error.retryable
  })
})

test('timeout remains active while the response body is loading', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({
    ok: true,
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }),
  }))
  await assert.rejects(requestJson('/test', { timeoutMs: 5 }), /taking too long/)
})

test('navigation cancellation aborts fetch without a network-error message', async (t) => {
  let sentSignal
  t.mock.method(globalThis, 'fetch', (url, options) => {
    sentSignal = options.signal
    return pendingFetch(url, options)
  })
  const controller = new AbortController()
  const request = requestJson('/test', { signal: controller.signal })
  controller.abort()
  await assert.rejects(request, { name: 'AbortError' })
  assert.equal(sentSignal.aborted, true)
})

test('already cancelled requests do not start fetch', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', pendingFetch)
  await assert.rejects(requestJson('/test', { signal: AbortSignal.abort() }), { name: 'AbortError' })
  assert.equal(fetch.mock.callCount(), 0)
})

test('a late response after cancellation cannot return a result', async (t) => {
  let finish
  t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => { finish = resolve }))
  const controller = new AbortController()
  const request = requestJson('/test', { signal: controller.signal })
  controller.abort()
  finish(Response.json({ ok: true }))
  await assert.rejects(request, { name: 'AbortError' })
})

for (const [status, message, retryable] of [
  [410, /expired or was already corrected/, false],
  [413, /too large/, false],
  [415, /not supported/, false],
  [429, /Wait a minute/, true],
  [500, /service had a problem/, true],
  [503, /not ready/, true],
]) {
  test(`HTTP ${status} has a safe actionable message`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('private server traceback', { status }))
    await assert.rejects(requestJson('/test'), (error) => {
      assert.equal(error.status, status)
      assert.equal(error.retryable, retryable)
      assert.match(error.message, message)
      assert.doesNotMatch(error.message, /private server traceback/)
      return true
    })
  })
}

test('unreachable server returns connection guidance', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(requestJson('/test'), /Check your Wi-Fi or mobile data/)
})

test('route validation errors suggest checking destination rather than replacing the image', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('internal detail', { status: 422 }))
  await assert.rejects(requestJson('/route', { operation: 'route' }), /Check the room number/)
})

test('no accessible path is a route error with no automatic retry', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  await assert.rejects(requestJson('/route', { operation: 'route' }), (error) => {
    assert.equal(error.status, 404)
    assert.equal(error.retryable, false)
    return /No route is available/.test(error.message)
  })
})

test('HTML or invalid JSON is handled as an unreadable response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>proxy failure</html>'))
  await assert.rejects(requestJson('/test'), /unreadable response/)
})

for (const [operation, data] of [
  ['locate', null], ['locate', { spot: 'test' }],
  ['route', { steps: null }], ['route', { steps: [{ instruction: null }], total_meters: 0, est_seconds: 0 }],
  ['correct', { ok: false, index_size: 20 }],
]) {
  test(`incomplete ${operation} responses cannot become a successful screen`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json(data))
    await assert.rejects(requestJson('/test', { operation }), /unreadable response/)
  })
}

test('empty route steps remain valid when already at destination', async (t) => {
  const result = { steps: [], total_meters: 0, est_seconds: 0 }
  t.mock.method(globalThis, 'fetch', async () => Response.json(result))
  assert.deepEqual(await requestJson('/route', { operation: 'route' }), result)
})

test('malformed OCR cannot crash the location screen', async (t) => {
  const result = { photo_id: 'p_test', spot: 'F1_lobby', floor: 1, heading: null, confidence: 0.8,
    top3: [{ spot: 'F1_lobby', votes: 8 }], ocr_room: { detail: 'wrong shape' }, ocr_floor: null, ms: 5 }
  t.mock.method(globalThis, 'fetch', async () => Response.json(result))
  await assert.rejects(requestJson('/locate', { operation: 'locate' }), /unreadable response/)
})

test('mock responses are cancelled when leaving a screen', async () => {
  const controller = new AbortController()
  const request = delay(1000, { ok: true }, controller.signal)
  controller.abort()
  await assert.rejects(request, { name: 'AbortError' })
})

test('unrelated-photo response offers retake rather than pretending the image is malformed', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    detail: { code: 'unrecognized_location', message: 'untrusted server text' },
  }, { status: 422 }))
  await assert.rejects(requestJson('/locate', { operation: 'locate' }), (error) => {
    assert.equal(error.code, 'unrecognized_location')
    assert.equal(error.status, 422)
    assert.match(error.message, /take another photo/)
    assert.doesNotMatch(error.message, /untrusted server text/)
    return true
  })
})
