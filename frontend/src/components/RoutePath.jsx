// One floor of the route, drawn as a line from "you are here" to the leg's end.
//
// Privacy line (ethics slide: no public building map): this draws ONLY the
// user's own path. The backend sends the points already normalized to this leg,
// so there is no floor plan, no other hallway and no real coordinate here.
// The line draws itself in; with motion off, the global reduced-motion rules
// jump every animation to its end, so the path simply appears.

const SIZE = 100

export default function RoutePath({ points, endLabel = '', exitMode = null, label = '' }) {
  const pts = points.map(([x, y]) => [x * SIZE, y * SIZE])
  const [sx, sy] = pts[0]
  const [ex, ey] = pts[pts.length - 1]
  const line = pts.map((p) => p.join(',')).join(' ')
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}
      className="block aspect-square w-[min(100%,320px,34vh)] self-center rounded-sm border border-rule bg-panel">
      {pts.length > 1 && (
        <>
          {/* Wide soft underlay so the line reads at a glance. */}
          <polyline points={line} fill="none" stroke="#3A0E15" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          <polyline className="route-draw" points={line} pathLength="1" fill="none" stroke="var(--color-maroon-line)"
            strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          {/* Destination or floor-change marker, revealed once the line lands. */}
          <g className="route-end">
            <rect x={ex - 7} y={ey - 7} width="14" height="14" rx="1.5" fill="var(--color-snow)" />
            {exitMode === 'stairs'
              ? <path d={`M${ex - 4.5} ${ey + 4}h3v-2.7h3v-2.7h3v-2.6`} fill="none" stroke="var(--color-night)" strokeWidth="1.3" />
              : exitMode
              ? <path d={`M${ex} ${ey - 4}l-3 3h6zM${ex} ${ey + 4}l-3 -3h6z`} fill="var(--color-night)" />
              : <text x={ex} y={ey + 2.6} textAnchor="middle" fontFamily="Jost, sans-serif" fontWeight="600"
                  fontSize={endLabel.length > 3 ? 5 : 7} fill="var(--color-night)">{endLabel}</text>}
          </g>
        </>
      )}
      {/* You are here: BU red dot with a slow pulse ring. */}
      <circle className="here-pulse" cx={sx} cy={sy} r="5" fill="none" stroke="var(--color-here)" strokeWidth="1.2" />
      <circle cx={sx} cy={sy} r="3.6" fill="var(--color-here)" stroke="var(--color-snow)" strokeWidth="1.2" />
    </svg>
  )
}
