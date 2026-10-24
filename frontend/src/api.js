// Client for the Hound Around API. Shapes follow docs/contract.md exactly.
// With VITE_API_URL unset, everything runs on mock data so the UI can be demoed without the backend.

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const MOCK = !BASE

async function req(path, opts) {
  const res = await fetch(BASE + path, opts)
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.json()
}

export async function locate(blob) {
  if (MOCK) return mockLocate()
  const fd = new FormData()
  fd.append('image', blob, 'photo.jpg')
  return req('/locate', { method: 'POST', body: fd })
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

// ---------- mock data (ids taken from docs/contract.md examples) ----------
const delay = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms))
let mockCalls = 0

function mockLocate() {
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
  return delay(1400, res)
}

function mockRoute({ from, to, accessible }) {
  const steps = from.startsWith('F2')
    ? [
        { instruction: 'Turn around and walk toward the podium elevators', meters: 22, node: 'F2_podium_elev' },
        accessible
          ? { instruction: 'Take a podium elevator down to 1', meters: 0, node: 'F1_podium_elev' }
          : { instruction: 'Take the stairs down one floor', meters: 8, node: 'F1_stair_east' },
        { instruction: `Head straight past the lobby to ${to}`, meters: 18, node: 'F1_room164' },
      ]
    : [
        { instruction: 'Walk past the tower elevators', meters: 12, node: 'F1_core_elev' },
        { instruction: `Turn left; ${to} is on your right`, meters: 15, node: 'F1_room164' },
      ]
  const total = steps.reduce((a, s) => a + s.meters, 0)
  return delay(400, { steps, total_meters: total, est_seconds: Math.round(total / 1.2) })
}
