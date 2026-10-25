// One floor of the route, drawn as the hallway you walk: two walls along your
// path, short open stubs where another hallway, stair or entrance meets it,
// door marks, numbered turns, and the line from "you are here" to the end.
//
// Privacy line (ethics slide: no public building map): the backend sends only
// this leg's own path, normalized to itself, plus unit directions for openings
// beside it. Stubs are drawn a fixed few units long, so nothing past the path
// (no floor plan, no other hallway's shape, no real coordinate) is shown.
// The map is turned so your first stretch points up (lib/legs.js trackUp).
// The line draws itself in; with motion off, the global reduced-motion rules
// jump every animation to its end, so the path simply appears.

import { trackUp } from '../lib/legs.js'

const SIZE = 100
const HALL = 7 // hallway width in viewBox units
const WALL = 1.1 // wall thickness
const STUB = 9 // how far an opening is drawn

export default function RoutePath({ leg, marks = [], endLabel = '', exitMode = null, label = '' }) {
  const { points, branches } = trackUp(leg)
  const pts = points.map(([x, y]) => [x * SIZE, y * SIZE])
  const [sx, sy] = pts[0]
  const [ex, ey] = pts[pts.length - 1]
  const line = pts.map((p) => p.join(',')).join(' ')
  // Openings: hallway-like ones become stubs; doors become a mark on the wall.
  const stubs = []
  const doors = []
  branches.forEach((list, i) => list.forEach((b) => {
    const [x, y] = pts[i]
    if (b.kind === 'door') doors.push({ x, y, dx: b.dx, dy: b.dy })
    else stubs.push({ x1: x, y1: y, x2: x + b.dx * STUB, y2: y + b.dy * STUB })
  }))
  // Crop to the route's own shape (plus room for stubs and markers), so a long,
  // narrow route fills the width instead of floating in an empty square.
  const PAD = 13
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  let [x0, x1, y0, y1] = [Math.min(...xs) - PAD, Math.max(...xs) + PAD, Math.min(...ys) - PAD, Math.max(...ys) + PAD]
  const MIN = 45
  if (x1 - x0 < MIN) { const c = (x0 + x1) / 2; [x0, x1] = [c - MIN / 2, c + MIN / 2] }
  if (y1 - y0 < MIN) { const c = (y0 + y1) / 2; [y0, y1] = [c - MIN / 2, c + MIN / 2] }
  return (
    <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} role="img" aria-label={label}
      className="block max-h-[36vh] w-full self-center rounded-2xl border border-edge bg-bg">
      <defs>
        {/* Openings fade out: you see that a hallway is there, not where it goes. */}
        {stubs.map((s, i) => (
          <linearGradient key={i} id={`stub-${i}`} gradientUnits="userSpaceOnUse" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}>
            <stop offset="0.35" stopColor="var(--t-card)" />
            <stop offset="1" stopColor="var(--t-bg)" />
          </linearGradient>
        ))}
      </defs>
      {pts.length > 1 && (
        <>
          {/* Walls first (wide grey strokes), then the floor on top: openings cut through the walls. */}
          <polyline points={line} fill="none" stroke="color-mix(in srgb, var(--t-fg) 38%, transparent)" strokeWidth={HALL + 2 * WALL}
            strokeLinejoin="round" strokeLinecap="square" />
          {stubs.map((s, i) => (
            <line key={`w${i}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="color-mix(in srgb, var(--t-fg) 38%, transparent)"
              strokeWidth={HALL + 2 * WALL} opacity="0.55" />
          ))}
          {stubs.map((s, i) => (
            <line key={`f${i}`} x1={s.x1} y1={s.y1} x2={s.x2 + (s.x2 - s.x1) * 0.15} y2={s.y2 + (s.y2 - s.y1) * 0.15}
              stroke={`url(#stub-${i})`} strokeWidth={HALL} />
          ))}
          <polyline points={line} fill="none" stroke="var(--t-card)" strokeWidth={HALL}
            strokeLinejoin="round" strokeLinecap="square" />
          {/* Doors beside the path: a short bright mark in the wall on that side. */}
          {doors.map((d, i) => {
            const cx = d.x + d.dx * (HALL / 2 + WALL / 2)
            const cy = d.y + d.dy * (HALL / 2 + WALL / 2)
            return <line key={i} x1={cx - d.dy * 2.2} y1={cy + d.dx * 2.2} x2={cx + d.dy * 2.2} y2={cy - d.dx * 2.2}
              stroke="var(--t-fg)" strokeWidth={WALL + 0.4} />
          })}
          {/* Your route down the middle of the hallway. */}
          <polyline className="path-draw" points={line} pathLength="1" fill="none" stroke="var(--t-fg)"
            strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <g className="path-end">
            {/* Destination or floor-change marker, revealed once the line lands. */}
            <rect x={ex - 7} y={ey - 7} width="14" height="14" rx="1.5" fill="var(--t-fg)" />
            {exitMode === 'stairs'
              ? <path d={`M${ex - 4.5} ${ey + 4}h3v-2.7h3v-2.7h3v-2.6`} fill="none" stroke="var(--t-ink)" strokeWidth="1.3" />
              : exitMode
              ? <path d={`M${ex} ${ey - 4}l-3 3h6zM${ex} ${ey + 4}l-3 -3h6z`} fill="var(--t-ink)" />
              : <text x={ex} y={ey + 2.6} textAnchor="middle" fontFamily="var(--font-sans)" fontWeight="600"
                  fontSize={endLabel.length > 3 ? 5 : 7} fill="var(--t-ink)">{endLabel}</text>}
            {/* Numbered turns, matching the directions list; on top so a turn just before the end stays readable. */}
            {marks.map((m) => {
              const [mx, my] = pts[m.index]
              return (
                <g key={m.n}>
                  <circle cx={mx} cy={my} r="3.6" fill="var(--t-fg)" stroke="var(--t-bg)" strokeWidth="0.8" />
                  <text x={mx} y={my + 1.6} textAnchor="middle" fontFamily="var(--font-sans)" fontWeight="700"
                    fontSize="4.6" fill="var(--t-ink)">{m.n}</text>
                </g>
              )
            })}
          </g>
          {/* Which way to set off: the map is turned so that's always up. */}
          <path d={`M${sx} ${sy - 8}l-3 4.4h6z`} fill="#CC0000" />
        </>
      )}
      {/* You are here: BU red dot with a slow pulse ring. */}
      <circle className="here-ring" cx={sx} cy={sy} r="5" fill="none" stroke="#CC0000" strokeWidth="1.2" />
      <circle cx={sx} cy={sy} r="3.6" fill="#CC0000" stroke="var(--t-bg)" strokeWidth="1.2" />
    </svg>
  )
}
