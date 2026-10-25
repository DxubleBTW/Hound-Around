// The paw from the Hound Around logo (public/favicon.svg), drawn in currentColor
// so it can replace emoji paws anywhere in the UI.
export default function Paw({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="4 8 56 44" fill="currentColor" className={className} aria-hidden>
      <ellipse cx="32" cy="40" rx="11" ry="9" />
      <ellipse cx="18" cy="27" rx="5" ry="6.5" />
      <ellipse cx="27" cy="19" rx="5" ry="6.5" />
      <ellipse cx="37" cy="19" rx="5" ry="6.5" />
      <ellipse cx="46" cy="27" rx="5" ry="6.5" />
    </svg>
  )
}
