// Client for the Hound Around API. Shapes follow docs/contract.md exactly.
// With VITE_API_URL unset, everything runs on mock data so the UI can be demoed without the backend.

import { checkHealth, delay, requestJson } from './lib/request.js'

const BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '')
export const MOCK = !BASE

// locate accepts an optional AbortSignal so Locating can cancel the in-flight
// request (on retake/unmount) and enforce its own ~8s timeout.
export async function locate(blob, { signal } = {}) {
  if (MOCK) return mockLocate(signal)
  const fd = new FormData()
  fd.append('image', blob, 'photo.jpg')
  return requestJson(BASE + '/locate', { method: 'POST', body: fd, signal, operation: 'locate' })
}

export async function route({ from, to, accessible, heading }, { signal } = {}) {
  if (MOCK) return mockRoute({ from, to, accessible }, signal)
  const q = new URLSearchParams({ from, to, accessible: String(!!accessible) })
  if (heading) q.set('heading', heading)
  return requestJson(BASE + `/route?${q}`, { signal, operation: 'route' })
}

export async function correct(photo_id, true_spot, { signal } = {}) {
  if (MOCK) return delay(300, { ok: true, index_size: 2214 }, signal)
  return requestJson(BASE + '/correct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_id, true_spot }),
    signal, operation: 'correct',
  })
}

// Health has a longer timeout than other calls so a sleeping Hugging Face Space
// has time to wake. MOCK reports a ready "mock" model so no status pill shows.
export async function health() {
  if (MOCK) return { ok: true, reachable: true, index_size: 2213, model: 'mock' }
  return checkHealth(BASE + '/health')
}

// ---------- mock data (ids taken from docs/contract.md examples) ----------
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
  return delay(1400, res, signal)
}

function mockRoute({ from, to, accessible }, signal) {
  // Vertical wording mirrors the two real forms api/routing.py emits (design §5),
  // so mock demos exercise the same Route icons/floor-change card the backend drives.
  // This is mock-only text, not a contract change.
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
  return delay(400, { steps, total_meters: total, est_seconds: Math.round(total / 1.2) }, signal)
}
