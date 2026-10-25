import { useEffect, useState } from 'react'

// Opening moment: the paw outline from the logo pops in, the name
// rises in letter by letter with the catchphrase under it, then the paw snaps out
// like a shutter. About 2.4 s; a tap skips it.
const PAW = [
  { cx: 32, cy: 40, rx: 11, ry: 9 },
  { cx: 18, cy: 27, rx: 5, ry: 6.5 },
  { cx: 27, cy: 19, rx: 5, ry: 6.5 },
  { cx: 37, cy: 19, rx: 5, ry: 6.5 },
  { cx: 46, cy: 27, rx: 5, ry: 6.5 },
]
const NAME = 'Hound Around'
const TAG = ['Snap a hallway.', 'Find your room.']

export default function Intro({ onDone }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const out = setTimeout(() => setLeaving(true), 1750)
    const done = setTimeout(onDone, 2400)
    return () => { clearTimeout(out); clearTimeout(done) }
  }, [onDone])
  return (
    <div onClick={onDone} role="presentation"
      className={`intro fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink text-fg ${leaving ? 'intro-leave' : ''}`}>
      {/* Logo and name side by side, large enough to read at a glance. */}
      <div className="flex items-center gap-4 px-6">
        <svg viewBox="4 8 56 44" width="112" height="88" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="intro-paw shrink-0" aria-hidden>
          {PAW.map((e, k) => <ellipse key={k} {...e} />)}
        </svg>
        <div className="intro-title">
          <p className="font-display text-[46px] font-bold leading-[.95] tracking-tight" aria-label={NAME}>
            {/* One word per line; letters rise in one after another across both. */}
            {NAME.split(' ').map((word, w, words) => {
              const before = words.slice(0, w).join(' ').length + (w ? 1 : 0)
              return (
                <span key={word} className="block whitespace-nowrap" aria-hidden>
                  {[...word].map((ch, k) => (
                    <span key={k} className="intro-letter" style={{ animationDelay: `${300 + (before + k) * 32}ms` }}>{ch}</span>
                  ))}
                </span>
              )
            })}
          </p>
          {/* The catchphrase rises in the same way, picking up where the name ends. */}
          <p className="mt-2.5 text-[15px] font-semibold leading-snug text-dim" aria-label={TAG.join(' ')}>
            {TAG.map((line, l) => (
              <span key={line} className="block whitespace-nowrap" aria-hidden>
                {[...line].map((ch, k) => (
                  <span key={k} className="intro-letter" style={{ animationDelay: `${560 + (l * TAG[0].length + k) * 14}ms` }}>{ch === ' ' ? '\u00a0' : ch}</span>
                ))}
              </span>
            ))}
          </p>
        </div>
      </div>
    </div>
  )
}
