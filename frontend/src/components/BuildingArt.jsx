import { useEffect, useMemo, useState } from 'react'
import { ease, points, render } from '../lib/box3d.js'
import { CDS_BOXES, STREET, STREET_VIEWBOX, STREET_YAW } from '../lib/cdsModel.js'

// White line drawings of each building, keyed by building id. Drawn by hand for this
// app from public photos of the building (no traced or copied artwork).
// CDS: six glass boxes stacked off-centre on a low base, wrapped in vertical fins.
// Modelled as boxes (lib/box3d.js) and drawn from street level looking up, so the
// overhangs show their undersides. The view turns a little as it appears and
// drifts as you scroll.
const YAW_FROM = 0.2, YAW_TO = STREET_YAW

function Cds() {
  const [yaw, setYaw] = useState(YAW_FROM)
  useEffect(() => {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0, start = 0, settled = still ? 1 : 0
    const scrollTurn = () => Math.max(-0.12, Math.min(0.12, (window.scrollY || 0) * 0.0006))
    const tick = (t) => {
      if (!start) start = t
      const p = Math.min(1, (t - start) / 1500)
      settled = ease(p)
      setYaw(YAW_FROM + (YAW_TO - YAW_FROM) * settled + scrollTurn())
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    if (still) setYaw(YAW_TO)
    else raf = requestAnimationFrame(tick)
    const onScroll = () => { if (!still && settled === 1) setYaw(YAW_TO + scrollTurn()) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll) }
  }, [])
  const shapes = useMemo(() => render(CDS_BOXES, { ...STREET, yaw }, (_, i) => (i ? 4.5 : 0)), [yaw])
  return (
    <svg viewBox={STREET_VIEWBOX.join(' ')} data-building-art data-yaw={yaw} className="h-full w-auto" fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M-122 123H122" strokeWidth="1" opacity=".3" />
      {shapes.map((s) => (
        <g key={s.key}>
          <polygon points={points(s.pts)} strokeWidth={s.box === 0 ? 1.2 : 1.4}
            style={{ fill: s.kind === 'under' ? 'color-mix(in srgb, var(--t-ink) 88%, white)' : 'var(--t-ink)' }} />
          {s.lines.map(([a, c, strong], k) => (
            <path key={k} d={`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${c[0].toFixed(1)} ${c[1].toFixed(1)}`} strokeWidth=".55" opacity={strong ? .55 : .25} />
          ))}
        </g>
      ))}
    </svg>
  )
}

const ART = { cds: Cds }

export default function BuildingArt({ id, name, address, school }) {
  const Art = ART[id]
  if (!Art) return null
  return (
    <figure className="mt-8 flex flex-col items-center text-center">
      <div className="relative flex h-[250px] items-end justify-center text-fg">
        <span className="absolute inset-x-[-30%] bottom-0 h-24 rounded-[50%] bg-fg/[.05] blur-2xl" aria-hidden />
        <Art />
      </div>
      <figcaption className="mt-3">
        <span className="font-display block text-[22px] font-bold leading-tight">{name}</span>
        <span className="mt-0.5 block text-[13px] text-dim">{[address, school].filter(Boolean).join(' · ')}</span>
      </figcaption>
    </figure>
  )
}
