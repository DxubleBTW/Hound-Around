import { useReducedMotion } from '../lib/useReducedMotion.js'
import Paw from './Paw.jsx'

// A small celebratory paw-print that lands with a ring of sparks. Used for the
// "it learned" moment and the arrival flourish. Reduced-motion users get the
// static paw with no burst or sparks.
export default function PawBurst({ size = 72, className = '' }) {
  const reduced = useReducedMotion()
  const sparks = [0, 60, 120, 180, 240, 300]
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }} aria-hidden>
      {!reduced && sparks.map((deg) => {
        const rad = (deg * Math.PI) / 180
        const dist = size * 0.62
        return (
          <span
            key={deg}
            className="spark absolute block rounded-full bg-maroon-line"
            style={{
              width: Math.max(4, size * 0.07),
              height: Math.max(4, size * 0.07),
              '--dx': `${Math.cos(rad) * dist}px`,
              '--dy': `${Math.sin(rad) * dist}px`,
              animationDelay: '.12s',
            }}
          />
        )
      })}
      <span className={reduced ? '' : 'burst'}><Paw size={size * 0.8} color="#B0384A" /></span>
    </span>
  )
}
