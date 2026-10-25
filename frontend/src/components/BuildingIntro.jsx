import { useEffect, useMemo, useRef, useState } from 'react'
import { bounds, points, project, render } from '../lib/box3d.js'
import { STREET, STREET_VIEWBOX, STREET_YAW } from '../lib/cdsModel.js'
import { ABOVE, floorModel, inOut, mix, mixObj } from '../lib/floorModel.js'

// Plays once when a route loads: CDS as seen from the street, then the camera
// swings up while the building opens into its floors, your floor slides out and
// lights up (the destination floor carries a flag), and the drawing hands off to
// that floor's hallway (RouteMap). Massing only (lib/floorModel.js): no rooms,
// corridors or plans. It shows on every route; the Skip button ends it early.
// With motion off (pause button or the system setting) it doesn't move: the
// building is shown already opened to your floor, held for a moment.
const OPEN_MS = 1500
const PULL_MS = 650
const HOLD_MS = 650
const OUT_MS = 350
const STILL_MS = 1800
const TOTAL_MS = OPEN_MS + PULL_MS + HOLD_MS + OUT_MS
const HERE = '#CC0000'

export default function BuildingIntro({ floors, here, to, caption = '', still = false, onDone }) {
  const [clock, setClock] = useState(still ? OPEN_MS + PULL_MS : 0)
  const doneCallback = useRef(onDone)
  doneCallback.current = onDone
  useEffect(() => {
    setClock(still ? OPEN_MS + PULL_MS : 0)
    let raf = 0
    let start = 0
    let done = false
    const finish = () => { if (!done) { done = true; doneCallback.current() } }
    // Backstop: if animation frames stall (a hidden tab), still hand off to the route.
    const backstop = setTimeout(finish, still ? STILL_MS : TOTAL_MS + 1500)
    const tick = (now) => {
      if (!start) start = now
      const ms = now - start
      setClock(ms)
      if (ms < TOTAL_MS) raf = requestAnimationFrame(tick)
      else finish()
    }
    if (!still) raf = requestAnimationFrame(tick)
    return () => { done = true; cancelAnimationFrame(raf); clearTimeout(backstop) }
  }, [still])

  const t = inOut(Math.min(1, clock / OPEN_MS))
  const pull = inOut(Math.min(1, Math.max(0, (clock - OPEN_MS) / PULL_MS)))
  const out = Math.min(1, Math.max(0, (clock - OPEN_MS - PULL_MS - HOLD_MS) / OUT_MS))

  const cam = mixObj({ ...STREET, yaw: STREET_YAW }, ABOVE, t)
  const { parts, tower } = floorModel(floors, t, { [here]: pull }, cam.yaw)
  const shapes = render([...parts, ...tower], cam, (_, i) => (i >= parts.length || t > 0.4 ? 4.5 : 0))
  // Final frame: the opened floors (yours pulled out) and the foot of the tower.
  const frame = useMemo(() => {
    const m = floorModel(floors, 1, { [here]: 1 }, ABOVE.yaw)
    const f = bounds(render([...m.parts, m.tower[0]], ABOVE), 10)
    return [f[0] - 8, f[1] - 18, f[2] + 16, f[3] + 26]
  }, [floors, here])
  const vb = STREET_VIEWBOX.map((v, k) => mix(v, frame[k], t))

  const mine = parts.find((s) => s.code === here)
  const dest = parts.find((s) => s.code === to)
  const dot = mine && project([mine.x, mine.y + mine.h, mine.z], cam)
  const flag = dest && dest.code !== here && project([dest.x, dest.y + dest.h, dest.z], cam)

  return (
    <div className="relative w-full" style={{ opacity: 1 - out, transform: `scale(${1 + out * 0.6})` }}>
      <svg viewBox={vb.map((v) => v.toFixed(1)).join(' ')} className="block h-[min(48vh,380px)] w-full" fill="none"
        stroke="currentColor" strokeLinejoin="round" strokeLinecap="round" role="img"
        aria-label={`CDS opening up to your floor. ${caption}`}>
        {shapes.map((s) => {
          const slab = s.box < parts.length ? parts[s.box] : null
          const lit = slab && slab.code === here && pull > 0
          return (
            <g key={s.key} opacity={!slab ? mix(1, 0.32, t) : slab.below ? t : lit ? 1 : mix(1, 0.6, pull)}>
              <polygon points={points(s.pts)} strokeWidth={lit ? 2.2 : 1.3}
                style={{ fill: lit ? `color-mix(in srgb, var(--color-snow) ${Math.round(30 * pull)}%, var(--color-night))` : 'var(--color-night)' }} />
              {s.lines.map(([a, c, strong], k) => (
                <path key={k} d={`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${c[0].toFixed(1)} ${c[1].toFixed(1)}`} strokeWidth=".55" opacity={strong ? 0.5 : 0.22} />
              ))}
            </g>
          )
        })}
        {flag && pull > 0 && (
          <g transform={`translate(${flag[0].toFixed(1)} ${flag[1].toFixed(1)})`} opacity={pull}>
            <path d="M0 0V-18" strokeWidth="1.6" />
            <path d="M0 -18h11l-3 4.5 3 4.5H0z" strokeWidth="1" style={{ fill: 'var(--color-snow)' }} />
          </g>
        )}
        {dot && pull > 0 && (
          <g transform={`translate(${dot[0].toFixed(1)} ${dot[1].toFixed(1)})`} opacity={pull}>
            <circle r="5" className="here-pulse" strokeWidth="1.4" stroke={HERE} />
            <circle r="5" strokeWidth="1.6" fill={HERE} style={{ stroke: 'var(--color-night)' }} />
          </g>
        )}
      </svg>
      <p className="mt-2 text-center text-base text-mist" style={{ opacity: pull }}>{caption}</p>
      <button type="button" onClick={onDone} className="absolute right-0 top-0 min-h-[44px] px-2 text-sm text-mist underline underline-offset-[3px]">
        Skip
      </button>
    </div>
  )
}
