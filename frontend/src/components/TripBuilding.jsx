import { useEffect, useMemo, useState } from 'react'
import { bounds, points, project, render } from '../lib/box3d.js'
import { ABOVE, floorModel } from '../lib/floorModel.js'
import { prefersReducedMotion } from '../lib/motion.js'

// Your trip through CDS, on the same 3D drawing as the home screen and the
// manual locator: the building opened into its floors, seen from above. The
// floor you're on is lit with a dot on it, the destination floor carries a
// flag, and on an elevator or stairs step a dot rides the shaft between them.
// Massing only (lib/floorModel.js): no rooms, corridors or plans.
const RIDE_MS = 1700
const HERE = '#CC0000'
const EXPLODE = 0.75

export default function TripBuilding({ floors, here, to, ride = null, label = '' }) {
  const [p, setP] = useState(1)
  const still = prefersReducedMotion()
  // The ride loops: up (or down) the shaft, a short pause at the new floor.
  useEffect(() => {
    if (!ride || still) { setP(1); return undefined }
    let raf = 0
    let start = 0
    const tick = (now) => {
      if (!start) start = now
      const k = ((now - start) % (RIDE_MS + 700)) / RIDE_MS
      setP(Math.min(1, k))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ride?.from, ride?.to, still]) // eslint-disable-line react-hooks/exhaustive-deps

  // Every floor pulled out a little (an exploded view), so each top face shows
  // and a dot on a lower floor isn't hidden under the one above it.
  const { parts, tower } = useMemo(
    () => floorModel(floors, 1, Object.fromEntries(floors.map((f) => [f.code, EXPLODE])), ABOVE.yaw), [floors])
  const shapes = useMemo(() => render([...parts, ...tower], ABOVE, () => 4.5), [parts, tower])
  // Frame: the floors plus the foot of the tower, with room on the right for labels.
  const frame = useMemo(() => {
    const f = bounds(render([...parts, tower[0]], ABOVE), 6)
    return [f[0] - 4, f[1] - 14, f[2] + 74, f[3] + 18]
  }, [parts, tower])

  const slabOf = (code) => parts.find((s) => s.code === code)
  // Where a dot sits on a floor: the middle of its top face.
  const topCentre = (s) => project([s.x, s.y + s.h, s.z], ABOVE)
  const rightEdge = (s) => [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    .map(([a, b]) => project([s.x + a * s.w / 2, s.y + s.h / 2, s.z + b * s.d / 2], ABOVE))
    .reduce((m, q) => (q[0] > m[0] ? q : m), [-Infinity, 0])

  const hereSlab = slabOf(ride ? ride.from : here)
  const toSlab = slabOf(to)
  const rideTo = ride ? slabOf(ride.to) : null
  const a = hereSlab && topCentre(hereSlab)
  const b = rideTo && topCentre(rideTo)
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
  const dot = ride && a && b ? [a[0] + (b[0] - a[0]) * ease(p), a[1] + (b[1] - a[1]) * ease(p)] : a
  const lit = ride ? (p >= 1 ? ride.to : ride.from) : here

  const flag = toSlab && topCentre(toSlab)
  const labels = [
    hereSlab && { code: hereSlab.code, text: ride ? 'From here' : 'You', at: rightEdge(hereSlab) },
    rideTo && rideTo.code !== hereSlab?.code && { code: rideTo.code, text: 'Step out here', at: rightEdge(rideTo) },
    toSlab && ![hereSlab?.code, rideTo?.code].includes(toSlab.code) && { code: toSlab.code, text: 'Destination', at: rightEdge(toSlab) },
  ].filter(Boolean)
  const col = Math.max(...labels.map((l) => l.at[0]), -Infinity) + 14

  return (
    <svg viewBox={frame.map((v) => v.toFixed(1)).join(' ')} role="img" aria-label={label}
      className="h-[210px] w-full" fill="none" stroke="currentColor"
      strokeLinejoin="round" strokeLinecap="round">
      <g aria-hidden="true">
        {shapes.map((s) => {
          const slab = s.box < parts.length ? parts[s.box] : null
          const on = slab && slab.code === lit
          const dest = slab && slab.code === to && !on
          return (
            <g key={s.key} opacity={!slab ? 0.3 : on || dest ? 1 : 0.55}>
              <polygon points={points(s.pts)} strokeWidth={on ? 2.2 : dest ? 1.8 : 1.2}
                style={{ fill: on ? `color-mix(in srgb, var(--color-snow) ${s.kind === 'top' ? 34 : 22}%, var(--color-night))` : 'var(--color-night)' }} />
              {s.lines.map(([x, y, strong], k) => (
                <path key={k} d={`M${x[0].toFixed(1)} ${x[1].toFixed(1)}L${y[0].toFixed(1)} ${y[1].toFixed(1)}`} strokeWidth=".5" opacity={strong ? 0.45 : 0.2} />
              ))}
            </g>
          )
        })}
        {/* The shaft you ride, and your dot on it. */}
        {ride && a && b && <path d={`M${points([a])}L${points([b])}`} strokeWidth="1.4" strokeDasharray="3 3" opacity=".8" />}
        {flag && (to !== lit || !ride) && (
          <g transform={`translate(${flag[0].toFixed(1)} ${flag[1].toFixed(1)})`}>
            <path d="M0 0V-17" strokeWidth="1.6" />
            <path d="M0 -17h10l-3 4 3 4H0z" strokeWidth="1" style={{ fill: 'var(--color-snow)' }} />
          </g>
        )}
        {dot && (
          <g transform={`translate(${dot[0].toFixed(1)} ${dot[1].toFixed(1)})`}>
            {/* "You are here" in the same red as the hallway drawing (RoutePath). */}
            {!still && !ride && <circle r="5" className="here-pulse" strokeWidth="1.4" stroke={HERE} />}
            <circle r="5" strokeWidth="1.6" fill={HERE} style={{ stroke: 'var(--color-night)' }} />
          </g>
        )}
        {labels.map((l) => (
          <g key={l.code + l.text}>
            <path d={`M${(l.at[0] + 3).toFixed(1)} ${l.at[1].toFixed(1)}L${(col - 3).toFixed(1)} ${l.at[1].toFixed(1)}`} strokeWidth="1" opacity=".5" />
            <text x={col} y={l.at[1] + 3.5} stroke="none" fontSize="10" fontWeight="700"
              style={{ fill: 'var(--color-snow)', fontFamily: 'var(--font-sans)' }}>{l.text}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}
