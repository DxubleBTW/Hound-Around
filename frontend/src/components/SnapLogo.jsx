// The Hound Around logo (public/favicon.svg: cream paw on a scarlet tile) inside
// camera viewfinder corners. `mode` picks the motion: 'intro' frames it once,
// 'loop' keeps framing it while something is working.
export default function SnapLogo({ size = 112, mode = 'intro', className = '' }) {
  const c = 'M2 14V6a4 4 0 0 1 4-4h8' // one rounded corner; rotated for the other three
  const tile = size * 0.6
  return (
    <span className={`snap-logo snap-${mode} relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 100 100" className="snap-corners absolute inset-0 h-full w-full" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        {[0, 90, 180, 270].map((r) => <path key={r} d={c} transform={`rotate(${r} 50 50) translate(4 4) scale(1.4)`} />)}
      </svg>
      <svg viewBox="0 0 64 64" width={tile} height={tile} className="snap-tile relative">
        <rect width="64" height="64" rx="16" fill="#CC0000" />
        <g className="snap-paw" fill="#FBF7F2">
          <ellipse cx="32" cy="40" rx="11" ry="9" /><ellipse cx="18" cy="27" rx="5" ry="6.5" />
          <ellipse cx="27" cy="19" rx="5" ry="6.5" /><ellipse cx="37" cy="19" rx="5" ry="6.5" /><ellipse cx="46" cy="27" rx="5" ry="6.5" />
        </g>
      </svg>
    </span>
  )
}
