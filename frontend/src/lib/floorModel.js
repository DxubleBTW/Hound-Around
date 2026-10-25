// The CDS drawing opened up into the floors you can be routed on, shared by the
// manual locator's floor picker and the route screen's trip view. Massing only:
// the floors are slices of the podium's outline, with the real tower boxes on
// top. No rooms, corridors or plans.
import { CDS_BOXES } from './cdsModel.js'

export const SLAB_H = 20
export const ABOVE = { yaw: 0.78, eye: 250, dist: 380, pitch: -0.5, f: 420 }
export const LIFT = 34
export const mix = (a, b, t) => a + (b - a) * t
export const mixObj = (a, b, t) => Object.fromEntries(Object.keys(b).map((k) => [k, mix(a[k], b[k], t)]))
export const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

// Boxes for morph `t` (0 = home drawing, 1 = floors opened up) and per-floor lifts.
// `parts[i].code` says which floor a box is.
export function floorModel(floors, t, pull, yawNow) {
  const below = floors.filter((f) => f.code.startsWith('B')).length
  const above = floors.length - below
  const podium = CDS_BOXES[0]
  const out = [Math.sin(yawNow), Math.cos(yawNow)]
  let lift = 0
  const parts = floors.map((f, k) => {
    const p = pull[f.code] || 0
    const isBelow = k < below
    // Lower levels start folded flat under the street; the others split the podium.
    const a = isBelow ? { ...podium, y: 0, h: 0.01 } : { ...podium, y: (k - below) * podium.h / above, h: podium.h / above }
    const b = { ...podium, x: podium.x + out[0] * 16 * p, z: podium.z + out[1] * 16 * p, y: (k - below) * SLAB_H + lift + LIFT * 0.5 * p, h: SLAB_H }
    lift += LIFT * p
    return { ...mixObj(a, b, t), code: f.code, below: isBelow }
  })
  // The tower keeps its exact shape; it just rides up on the taller floors.
  const rise = mix(0, above * SLAB_H - podium.h, t) + lift
  const tower = CDS_BOXES.slice(1).map((a) => ({ ...a, y: a.y + rise }))
  return { parts, tower }
}
