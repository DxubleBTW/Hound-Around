import { useEffect, useMemo, useState } from 'react'
import { points, render } from '../lib/box3d.js'
import { CDS_BOXES, STREET, STREET_VIEWBOX, STREET_YAW } from '../lib/cdsModel.js'
import { useReducedMotion } from '../lib/useReducedMotion.js'

// The school picker's slot: empty until a school is chosen (tap or drop), then
// its building assembles there, the CDS boxes dropping into place from the
// podium up. Same massing drawing as the route intro (lib/cdsModel.js); shape only.
// With motion off the building simply appears.
const DROP_MS = 520
const STAGGER_MS = 140
const FALL = 46 // how far above its place each box starts, in drawing units

const easeOut = (t) => 1 - Math.pow(1 - t, 3)

export default function CampusBuild({ school }) {
  const [clock, setClock] = useState(0)
  const still = useReducedMotion()
  const total = DROP_MS + STAGGER_MS * (CDS_BOXES.length - 1)
  useEffect(() => {
    if (!school) { setClock(0); return undefined }
    if (still) { setClock(total); return undefined }
    let raf = 0
    let start = 0
    const tick = (now) => {
      if (!start) start = now
      const ms = now - start
      setClock(ms)
      if (ms < total) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [school, still, total])

  const progress = CDS_BOXES.map((_, i) => easeOut(Math.min(1, Math.max(0, (clock - i * STAGGER_MS) / DROP_MS))))
  const boxes = CDS_BOXES.map((b, i) => ({ ...b, y: b.y + FALL * (1 - progress[i]) }))
  const shapes = useMemo(() => render(boxes, { ...STREET, yaw: STREET_YAW }, (_, i) => (i ? 4.5 : 0)),
    [clock]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg viewBox={STREET_VIEWBOX.join(' ')} className="h-full w-full" fill="none" stroke="currentColor"
      strokeLinejoin="round" strokeLinecap="round" role="img"
      aria-label={school ? `${school} building` : 'Empty: choose a school'}>
      <path d="M-122 123H122" strokeWidth="1" opacity=".3" />
      {school && shapes.map((s) => (
        <g key={s.key} opacity={progress[s.box]}>
          <polygon points={points(s.pts)} strokeWidth={s.box === 0 ? 1.2 : 1.4}
            style={{ fill: s.kind === 'under' ? 'color-mix(in srgb, var(--color-night) 88%, white)' : 'var(--color-night)' }} />
          {s.lines.map(([a, c, strong], k) => (
            <path key={k} d={`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${c[0].toFixed(1)} ${c[1].toFixed(1)}`} strokeWidth=".55" opacity={strong ? 0.55 : 0.25} />
          ))}
        </g>
      ))}
    </svg>
  )
}
