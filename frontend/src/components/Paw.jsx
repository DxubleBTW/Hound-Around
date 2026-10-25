// The Hound Around paw mark. `here` adds the red "you are here" dot in the pad;
// `pop` lets that dot land with the opening animation.
export default function Paw({ size = 22, color = 'currentColor', here = false, pop = false, className = '', label = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className}
      role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      <ellipse cx="24" cy="31" rx="10" ry="8.5" fill={color} />
      <circle cx="11" cy="20" r="4.5" fill={color} />
      <circle cx="19" cy="12" r="4.5" fill={color} />
      <circle cx="29" cy="12" r="4.5" fill={color} />
      <circle cx="37" cy="20" r="4.5" fill={color} />
      {here && <circle className={pop ? 'pop' : ''} style={pop ? { animationDelay: '1s' } : undefined} cx="24" cy="31" r="3.5" fill="#CC0000" />}
    </svg>
  )
}

export function ElevatorIcon({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M9 9l3-3 3 3M9 15l3 3 3-3" />
    </svg>
  )
}
