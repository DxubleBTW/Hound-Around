import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shrinkImage } from '../src/lib/image.js'

function globals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    })
  }
}

function setup(t, { context = true, blob = new Blob(['jpeg']), throws = false, width = 1200, height = 600 } = {}) {
  const bitmap = { width, height, close: t.mock.fn() }
  const drawImage = t.mock.fn()
  const canvas = {
    getContext: () => context ? { drawImage } : null,
    toBlob: (callback) => {
      if (throws) throw new Error('Encoding failed')
      callback(blob)
    },
  }
  globals(t, {
    createImageBitmap: async () => bitmap,
    document: { createElement: () => canvas },
  })
  return { bitmap, canvas, drawImage }
}

test('empty photos are rejected before decoding', async () => {
  await assert.rejects(shrinkImage(new Blob()), /empty/)
})

test('unsupported or corrupt photos have retake guidance', async (t) => {
  globals(t, { createImageBitmap: async () => { throw new Error('Decode failed') } })
  await assert.rejects(shrinkImage(new Blob(['bad'])), /could not open this photo/)
})

test('photos are resized and the bitmap is released', async (t) => {
  const { bitmap, canvas } = setup(t)
  assert.ok((await shrinkImage(new Blob(['photo']))).size > 0)
  assert.equal(canvas.width, 512)
  assert.equal(canvas.height, 256)
  assert.equal(bitmap.close.mock.callCount(), 1)
})

test('missing canvas support releases the decoded image', async (t) => {
  const { bitmap } = setup(t, { context: false })
  await assert.rejects(shrinkImage(new Blob(['photo'])), /preparation is unavailable/)
  assert.equal(bitmap.close.mock.callCount(), 1)
})

for (const blob of [null, new Blob()]) {
  test('null or empty canvas output cannot be uploaded', async (t) => {
    const { bitmap } = setup(t, { blob })
    await assert.rejects(shrinkImage(new Blob(['photo'])), /could not prepare this photo/)
    assert.equal(bitmap.close.mock.callCount(), 1)
  })
}

test('canvas exceptions release the bitmap and reject preparation', async (t) => {
  const { bitmap } = setup(t, { throws: true })
  await assert.rejects(shrinkImage(new Blob(['photo'])), /Encoding failed/)
  assert.equal(bitmap.close.mock.callCount(), 1)
})

test('zero-dimension images are rejected', async (t) => {
  const { bitmap } = setup(t, { width: 0 })
  await assert.rejects(shrinkImage(new Blob(['photo'])), /has no image/)
  assert.equal(bitmap.close.mock.callCount(), 1)
})
