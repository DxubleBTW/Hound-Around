// Tiny perspective renderer for the building drawings: boxes in, outlined
// polygons out, far faces first so near ones cover them. No floor plans: boxes
// are massing only.
//
// A box is { x, z, w, d, y, h } (plan centre, plan size, bottom, height).
// A camera is { yaw, eye, dist, pitch, f }: it orbits the model at `dist`, sits at
// height `eye` and tilts up (pitch > 0) or down (pitch < 0).

export function project([x, y, z], cam) {
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw)
  const X = x * c - z * s
  const Z = x * s + z * c
  const ry = y - cam.eye, rz = Z - cam.dist
  const depth = ry * Math.sin(cam.pitch) - rz * Math.cos(cam.pitch)
  const up = ry * Math.cos(cam.pitch) + rz * Math.sin(cam.pitch)
  return [cam.f * X / depth, -cam.f * up / depth, depth]
}

const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

function faces({ x, z, w, d, y, h }) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y + h
  return [
    { n: [0, 0, 1], kind: 'side', q: [[x0, y, z1], [x1, y, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, 0, -1], kind: 'side', q: [[x1, y, z0], [x0, y, z0], [x0, y1, z0], [x1, y1, z0]] },
    { n: [1, 0, 0], kind: 'side', q: [[x1, y, z1], [x1, y, z0], [x1, y1, z0], [x1, y1, z1]] },
    { n: [-1, 0, 0], kind: 'side', q: [[x0, y, z0], [x0, y, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, -1, 0], kind: 'under', q: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]] },
    { n: [0, 1, 0], kind: 'top', q: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
  ]
}

// Visible faces of every box, sorted far to near. `fins(box, i)` returns the
// spacing of vertical fin lines on that box's sides, or 0 for none.
export function render(boxes, cam, fins = () => 0) {
  const eye = [cam.dist * Math.sin(cam.yaw), cam.eye, cam.dist * Math.cos(cam.yaw)]
  const out = []
  boxes.forEach((box, i) => faces(box).forEach((f, k) => {
    const mid = f.q.reduce((m, p) => m.map((v, j) => v + p[j] / 4), [0, 0, 0])
    const toEye = eye.map((v, j) => v - mid[j])
    if (f.n[0] * toEye[0] + f.n[1] * toEye[1] + f.n[2] * toEye[2] <= 0) return
    const pts = f.q.map((p) => project(p, cam))
    const lines = []
    const gap = f.kind === 'side' ? fins(box, i) : 0
    if (gap) {
      const n = Math.floor(Math.hypot(f.q[1][0] - f.q[0][0], f.q[1][2] - f.q[0][2]) / gap)
      for (let t = 1; t < n; t++) lines.push([project(lerp(f.q[0], f.q[1], t / n), cam), project(lerp(f.q[3], f.q[2], t / n), cam), t % 3 === 0])
    }
    out.push({ key: `${i}-${k}`, box: i, kind: f.kind, depth: project(mid, cam)[2], pts, lines })
  }))
  return out.sort((a, b) => b.depth - a.depth)
}

export function bounds(shapes, pad = 8) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of shapes) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2]
}

export const points = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
export const ease = (t) => 1 - Math.pow(1 - t, 3)
