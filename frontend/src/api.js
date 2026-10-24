// Client for the Hound Around API. Shapes follow docs/contract.md exactly.
// With VITE_API_URL unset, everything runs on mock data so the UI can be demoed without the backend.

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const MOCK = !BASE

async function req(path, opts) {
  let res
  try {
    res = await fetch(BASE + path, opts)
  } catch (e) {
    // Network failure / abort / offline: preserve the cause so screens can branch.
    if (e?.name === 'AbortError') throw e
    const err = new Error('network')
    err.network = true
    throw err
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`${res.status} ${text}`.trim())
    err.status = res.status // numeric status so screens can map 503/422/413/429
    err.body = text
    throw err
  }
  return res.json()
}

// locate accepts an optional AbortSignal so Locating can cancel the in-flight
// request (on retake) and enforce its own ~8s timeout.
export async function locate(blob, { signal } = {}) {
  if (MOCK) return mockLocate(signal)
  const fd = new FormData()
  fd.append('image', blob, 'photo.jpg')
  return req('/locate', { method: 'POST', body: fd, signal })
}

export async function route({ from, to, accessible, heading }) {
  if (MOCK) return mockRoute({ from, to, accessible })
  const q = new URLSearchParams({ from, to, accessible: String(!!accessible) })
  if (heading) q.set('heading', heading)
  return req(`/route?${q}`)
}

export async function correct(photo_id, true_spot) {
  if (MOCK) return delay(300, { ok: true, index_size: 2214 })
  return req('/correct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id, true_spot }),
  })
}

// Map a thrown error to a short, friendly message. `kind` picks /locate vs /route copy.
export function friendlyError(err, kind = 'locate') {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return "You're offline. Reconnect and try again."
  }
  if (err?.network) return "Can't reach the server. Check your connection and try again."
  switch (err?.status) {
    case 503: return "Hound Around is warming up. Give it a few seconds and retry."
    case 422: return kind === 'route'
      ? "Couldn't plan that route. Try again."
      : "Couldn't read that photo. Step back and point down the hallway or at a room number."
    case 413: return 'That photo is too large. Try again.'
    case 429: return 'Whoa, slow down a second, then try again.'
    default: return err?.message || 'Something went wrong. Try again.'
  }
}

// ---------- mock data (ids taken from docs/contract.md examples) ----------
const delay = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))
let mockCalls = 0

function mockLocate(signal) {
  mockCalls += 1
  // Alternate confident / unsure so both demo paths (straight to route, top-3 picker) are visible.
  const unsure = mockCalls % 2 === 0
  const res = unsure
    ? { photo_id: `p_mock${mockCalls}`, spot: 'F2_hall_e2', floor: 2, heading: 'F2_hall_e3', confidence: 0.5,
        top3: [{ spot: 'F2_hall_e2', votes: 5 }, { spot: 'F1_lobby', votes: 3 }, { spot: 'F2_hall_e1', votes: 2 }],
        ocr_room: null, ocr_floor: null, ms: 640 }
    : { photo_id: `p_mock${mockCalls}`, spot: 'F1_lobby', floor: 1, heading: 'F1_core_elev', confidence: 0.9,
        top3: [{ spot: 'F1_lobby', votes: 9 }, { spot: 'F1_core_elev', votes: 1 }],
        ocr_room: null, ocr_floor: 1, ms: 580 }
  // Honor abort so the mock path behaves like the real one on retake.
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(() => resolve(res), 1400)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()) }, { once: true })
  })
}

function abortError() {
  const e = new Error('aborted')
  e.name = 'AbortError'
  return e
}

function mockRoute({ from, to, accessible }) {
  // Vertical wording mirrors the two real forms api/routing.py emits (design §5),
  // so mock demos look correct. This is mock-only text, not a contract change.
  const steps = from.startsWith('F2')
    ? [
        { instruction: 'Turn around and walk toward the podium elevators', meters: 22, node: 'F2_podium_elev' },
        accessible
          ? { instruction: 'Take the elevator to 1, toward Lobby (podium elevators)', meters: 0, node: 'F1_podium_elev' }
          : { instruction: 'Take the stairs to 1, toward east stair', meters: 8, node: 'F1_stair_east' },
        { instruction: `Continue toward ${to}`, meters: 18, node: 'F1_room164' },
      ]
    : [
        { instruction: 'Walk toward the tower elevators', meters: 12, node: 'F1_core_elev' },
        { instruction: `Turn left and walk toward ${to}`, meters: 15, node: 'F1_room164' },
      ]
  const total = steps.reduce((a, s) => a + s.meters, 0)
  return delay(400, { steps, total_meters: total, est_seconds: Math.round(total / 1.2) })
}
