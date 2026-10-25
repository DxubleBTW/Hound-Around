import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { bounds, points, project, render } from '../lib/box3d.js'
import { CDS_BOXES, STREET, STREET_VIEWBOX, STREET_YAW } from '../lib/cdsModel.js'
import Icon from './Icon.jsx'
import { focusRing } from './ui.jsx'

// The building drawing, seen from above at three-quarters, with its floors opened
// up. It starts as the exact drawing from the home screen, in the same place
// (`from`, a screen rect) and at the same angle, then flies to the middle while the
// camera pans up and the podium splits into the floors you can be routed on.
// Choosing a floor lifts the floors above it away. Massing only: no rooms,
// corridors or plans are drawn.
// The floors are slices of the building drawing itself: the podium's outline,
// one slice per floor, with the real tower boxes standing on top.
const SLAB_H = 20
const ABOVE = { yaw: 0.78, eye: 250, dist: 380, pitch: -0.5, f: 420 }
const LIFT = 34
const mix = (a, b, t) => a + (b - a) * t
const mixObj = (a, b, t) => Object.fromEntries(Object.keys(b).map((k) => [k, mix(a[k], b[k], t)]))
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

// Boxes for morph `t` (0 = home drawing, 1 = floors opened up) and per-floor lifts.
// `parts[i].code` says which floor a box is.
function model(floors, t, pull, yawNow) {
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

export default function FloorPicker({ floors, selected, onSelect, from = null }) {
  const box = useRef(null)
  const still = useMemo(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const fromYaw = Number.isFinite(from?.yaw) ? from.yaw : STREET_YAW
  const [t, setT] = useState(still ? 1 : 0)
  const [pull, setPull] = useState({})
  // Drag (or scroll) the drawing to look up the tower. `pan` is in drawing units.
  const [pan, setPan] = useState(0)
  const panRef = useRef(0)
  const drag = useRef(null)
  const dragged = useRef(false)
  const pullRef = useRef({})

  // Start where the home drawing was: same spot, same size, then glide to centre.
  useLayoutEffect(() => {
    const el = box.current
    if (!el || still || !from) return
    const r = el.getBoundingClientRect()
    const [, , vw, vh] = STREET_VIEWBOX
    const s = Math.min(r.width / vw, r.height / vh)
    const w = vw * s, h = vh * s
    const dx = from.x + from.w / 2 - (r.left + r.width / 2)
    const dy = from.y + from.h / 2 - (r.top + (r.height - h) / 2 + h / 2)
    el.style.transition = 'none'
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${from.h / h || 1})`
    el.getBoundingClientRect() // commit the start position
    el.style.transition = 'transform .95s cubic-bezier(.45,0,.2,1)'
    el.style.transform = 'none'
    void w
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The morph: camera pans up and the model turns into floors.
  useEffect(() => {
    if (still) return
    let raf = 0, start = 0
    const tick = (now) => {
      if (!start) start = now
      const p = Math.min(1, (now - start) / 1400)
      setT(inOut(p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [still])

  // Ease each floor's lift toward its target (1 if chosen, else 0).
  useEffect(() => {
    let raf = 0
    const step = () => {
      let moving = false
      const next = {}
      for (const f of floors) {
        const now = pullRef.current[f.code] || 0
        const goal = f.code === selected ? 1 : 0
        const v = Math.abs(goal - now) < 0.01 ? goal : now + (goal - now) * 0.18
        if (v !== goal) moving = true
        next[f.code] = v
      }
      pullRef.current = next
      setPull(next)
      if (moving) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [selected, floors])

  const setPanTo = (v) => { panRef.current = v; setPan(v) }
  // Glide the view back down to the floors (on "Your floors", or choosing one).
  const glide = useRef(0)
  const glideHome = () => {
    cancelAnimationFrame(glide.current)
    const step = () => {
      const v = panRef.current * 0.8
      setPanTo(v < 0.5 ? 0 : v)
      if (v >= 0.5) glide.current = requestAnimationFrame(step)
    }
    glide.current = requestAnimationFrame(step)
  }
  useEffect(() => { if (selected) glideHome() }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  const cam = mixObj({ ...STREET, yaw: fromYaw }, ABOVE, t)
  const { parts: slabs, tower } = model(floors, t, pull, cam.yaw)
  // Glass fins on the floors too, so they read as the same building.
  const shapes = render([...slabs, ...tower], cam, (_, i) => (i >= slabs.length ? 4.5 : t > 0.4 ? 4.5 : 0))
  // One X per upper box, on its biggest visible side, to mark it as not in the demo.
  const area = (q) => Math.abs(q.reduce((a, p, i) => { const n = q[(i + 1) % q.length]; return a + p[0] * n[1] - n[0] * p[1] }, 0)) / 2
  const crossed = new Set()
  const biggest = {}
  for (const sh of shapes) if (sh.box >= slabs.length && sh.kind === 'side' && (!biggest[sh.box] || area(sh.pts) > area(biggest[sh.box].pts))) biggest[sh.box] = sh
  Object.values(biggest).forEach((sh) => crossed.add(sh.key))
  // Final frame: the settled floor stack with room for a lifted floor and the names.
  // Final frame: close on the floors (a lifted one included), with only the foot of
  // the tower above and room on the right for the floor buttons.
  const finalFrame = useMemo(() => {
    const m = model(floors, 1, {}, ABOVE.yaw)
    const lifted = m.parts.map((b) => ({ ...b, y: b.y + LIFT }))
    const f = bounds(render([...m.parts, ...lifted, m.tower[0], m.tower[1]], ABOVE), 6)
    // Centred on the building; the floor buttons fit inside on the right.
    return [f[0] - 46, f[1] - 6, f[2] + 92, f[3] + 10]
  }, [floors])
  // How far up the drawing can pan: until the top of the tower is in view.
  const maxPan = useMemo(() => {
    const m = model(floors, 1, {}, ABOVE.yaw)
    return Math.max(0, finalFrame[1] - bounds(render(m.tower, ABOVE), 14)[1])
  }, [floors, finalFrame])
  const vb = STREET_VIEWBOX.map((v, k) => mix(v, finalFrame[k], t) - (k === 1 ? pan : 0))
  const settled = t > 0.98
  const labelIn = Math.max(0, (t - 0.7) / 0.3)

  const labels = slabs.map((s, k) => {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => project([s.x + a * s.w / 2, s.y + s.h / 2, s.z + b * s.d / 2], cam))
    return { ...floors[k], at: corners.reduce((m, p) => (p[0] > m[0] ? p : m), [-Infinity, 0]) }
  })
  // Lay the buttons out in one column to the right, evenly spaced and kept in the
  // floors' order, each joined to its floor by a leader line.
  const GAP = 25
  const PILL = 80 // widest button, in drawing units
  const col = Math.min(Math.max(...labels.map((l) => l.at[0])) + 18, vb[0] + vb[2] - PILL - 4)
  const order = [...labels].sort((a, b) => a.at[1] - b.at[1])
  order.forEach((l, k) => { l.y = k ? Math.max(l.at[1], order[k - 1].y + GAP) : l.at[1] })
  const shift = order.reduce((m, l) => m + l.at[1] - l.y, 0) / (order.length || 1)
  order.forEach((l) => { l.y += shift })

  return (
    <div ref={box} className="relative h-full w-full origin-center cursor-grab touch-none will-change-transform active:cursor-grabbing"
      onPointerDown={(e) => {
        if (!settled) return
        const r = e.currentTarget.getBoundingClientRect()
        drag.current = { y: e.clientY, pan: panRef.current, unit: vb[3] / r.height }
        dragged.current = false
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dy = e.clientY - d.y
        if (Math.abs(dy) > 6 && !dragged.current) { dragged.current = true; e.currentTarget.setPointerCapture?.(e.pointerId) }
        if (dragged.current) setPanTo(Math.max(0, Math.min(maxPan, d.pan + dy * d.unit)))
      }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onWheel={(e) => { if (settled) setPanTo(Math.max(0, Math.min(maxPan, panRef.current - e.deltaY * 0.4))) }}>
      <svg viewBox={vb.map((v) => v.toFixed(1)).join(' ')} className="h-full w-full" fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round" role="group" aria-label="Floors">
        <g aria-hidden="true">
        {shapes.map((s) => {
          const slab = s.box < slabs.length ? slabs[s.box] : null // a floor part, or null for the tower
          const on = settled && slab && slab.code === selected
          const dim = settled && slab && selected && !on
          const opacity = !slab ? mix(1, 0.42, t) : slab.below ? t * (dim ? 0.5 : 1) : dim ? 0.5 : 1
          return (
            <g key={s.key} opacity={opacity} onClick={slab && settled ? () => { if (!dragged.current) onSelect(slab.code) } : undefined} className={slab && settled ? 'cursor-pointer' : ''}>
              <polygon points={points(s.pts)} strokeWidth={on ? 2.2 : slab ? mix(1.2, 1.5, t) : mix(1.4, 1, t)}
                
                style={{ fill: on ? `color-mix(in srgb, var(--t-ink) ${s.kind === 'top' ? 70 : 80}%, white)`
                  : s.kind === 'under' && !slab ? 'color-mix(in srgb, var(--t-ink) 88%, white)'
                  : s.kind === 'top' && slab ? `color-mix(in srgb, var(--t-ink) ${mix(100, 92, t)}%, white)` : 'var(--t-ink)' }} />
              {s.lines.map(([a, c, strong], k) => (
                <path key={k} d={`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${c[0].toFixed(1)} ${c[1].toFixed(1)}`} strokeWidth=".55" opacity={strong ? mix(0.55, 0.5, t) : mix(0.25, 0.5, t)} />
              ))}
              {/* Floors above the demo's floors are crossed out. */}
              {crossed.has(s.key) && labelIn > 0 && (
                <path d={`M${points([s.pts[0]])}L${points([s.pts[2]])}M${points([s.pts[1]])}L${points([s.pts[3]])}`} strokeWidth="1.6" opacity={labelIn} />
              )}
            </g>
          )
        })}
        </g>
        {/* The floor names are the buttons: tap (or Tab + Enter) to choose a floor. */}
        {labelIn > 0 && labels.map((l) => {
          const on = l.code === selected
          const w = l.name.length * 5.3 + 20
          const choose = () => { if (settled && !dragged.current) onSelect(l.code) }
          return (
            <g key={l.code} opacity={labelIn * (selected && !on ? 0.7 : 1)} role="button" tabIndex={settled ? 0 : -1}
              aria-label={`${l.name}${on ? ', selected' : ''}`} aria-pressed={on} className="floor-pill cursor-pointer outline-none"
              onClick={choose} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose() } }}>
              <path d={`M${(l.at[0] + 3).toFixed(1)} ${l.at[1].toFixed(1)}L${(col - 3).toFixed(1)} ${l.y.toFixed(1)}`} strokeWidth="1" opacity=".55" />
              <rect x={col} y={l.y - 10.5} width={w} height="21" rx="10.5"
                className="floor-pill-bg" strokeWidth={on ? 0 : 1}
                style={{ fill: on ? 'var(--t-fg)' : 'color-mix(in srgb, var(--t-ink) 82%, white)', stroke: 'color-mix(in srgb, var(--t-fg) 35%, transparent)' }} />
              <text x={col + w / 2} y={l.y + 3.6} textAnchor="middle" stroke="none" fontSize="10" fontWeight={on ? 800 : 700}
                style={{ fill: on ? 'var(--t-ink)' : 'var(--t-fg)', fontFamily: 'var(--font-sans)' }}>{l.name}</text>
            </g>
          )
        })}
      </svg>
      {pan > 20 && (
        <button type="button" onClick={glideHome} onPointerDown={(e) => e.stopPropagation()}
          className={`lg-bright pop-in absolute bottom-2 left-1/2 flex min-h-[40px] -translate-x-1/2 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold ${focusRing}`}>
          <Icon name="chevron" size={16} />Your floors
        </button>
      )}
    </div>
  )
}
