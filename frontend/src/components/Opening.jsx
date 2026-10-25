import { useEffect, useRef, useState } from 'react'
import Paw from './Paw.jsx'
import { prefersReducedMotion } from '../lib/motion.js'

const SEEN_KEY = 'hound-opening-seen'

// Plays once per browser session, never with reduced motion. Storage can be
// blocked, in which case the opening simply plays again.
export function shouldShowOpening() {
  if (prefersReducedMotion()) return false
  try { return window.sessionStorage.getItem(SEEN_KEY) !== '1' } catch { return true }
}

// Transit lines in the app's colours, converging on the mark (after AP Transit's
// loader). Grey for the network, maroon for the Hound Around line.
const LINES = [
  ['#3A3A3A', 'M-10 180 H120 L195 255 V340', 0],
  ['#6B1A28', 'M400 120 H300 L245 175 V340', 0.12],
  ['#2A2A2A', 'M60 -10 V80 L130 150 H210', 0.24],
  ['#3A3A3A', 'M340 -10 V60 L290 110 V220', 0.06],
  ['#2A2A2A', 'M400 380 H310 L280 410', 0.3],
  ['#9E2A3B', 'M-10 470 H100 L150 420 H165', 0.2, 2.5],
  ['#9E2A3B', 'M400 470 H290 L240 420 H225', 0.3, 2.5],
  ['#6B1A28', 'M-10 560 H90 L150 500 H160', 0.36],
  ['#3A3A3A', 'M400 600 H290 L230 540 V500', 0.14],
  ['#2A2A2A', 'M195 860 V700 L235 660 H330 L400 590', 0.22],
  ['#3A3A3A', 'M-10 760 H60 L140 680 V560', 0.04],
]

export default function Opening({ onDone }) {
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    try { window.sessionStorage.setItem(SEEN_KEY, '1') } catch { /* storage blocked */ }
    setLeaving(true)
    setTimeout(onDone, 320)
  }
  useEffect(() => {
    const timer = setTimeout(finish, 1900)
    return () => clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button type="button" onClick={finish} aria-label="Skip the intro"
      className={`fixed inset-0 z-50 block h-full w-full cursor-default overflow-hidden bg-night text-snow ${leaving ? 'leave' : ''}`}>
      <svg viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
        {LINES.map(([stroke, d, delay, width]) => (
          <path key={d} className="draw" d={d} fill="none" stroke={stroke} strokeWidth={width || 1.5}
            strokeLinecap="round" strokeLinejoin="round" style={{ animationDelay: `${delay}s` }} />
        ))}
      </svg>
      <span className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3.5">
        <span className="fade-up" style={{ animationDelay: '.7s' }}><Paw size={52} color="#FFFFFF" here pop /></span>
        <span className="fade-up font-display text-4xl font-semibold leading-none" style={{ animationDelay: '.78s' }}>Hound Around</span>
        <span className="fade-up text-base text-mist" style={{ animationDelay: '.86s' }}>Never lost around here.</span>
      </span>
      <span className="absolute inset-x-0 bottom-[max(3rem,env(safe-area-inset-bottom))] text-center text-sm text-dim">Tap to skip</span>
    </button>
  )
}
