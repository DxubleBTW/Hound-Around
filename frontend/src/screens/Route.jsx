import { useEffect, useState } from 'react'
import { route, friendlyError } from '../api.js'
import { spotName } from '../lib/spots.js'
import { prefersReducedMotion, tick } from '../lib/motion.js'

// Ethics rule from the brief: no public building map. Users only see their next turn.

// Classify a step by the EXACT instruction prefixes api/routing.py emits, so the
// client never re-derives prose. Returns a kind used for the icon and the
// floor-change card.
function stepKind(instruction = '') {
  if (instruction.startsWith('Take the elevator')) return 'elevator'
  if (instruction.startsWith('Take the stairs')) return 'stairs'
  if (instruction.startsWith('Turn left and walk')) return 'left'
  if (instruction.startsWith('Turn right and walk')) return 'right'
  if (instruction.startsWith('Turn around and walk')) return 'around'
  if (instruction.startsWith('Continue')) return 'continue'
  return 'walk' // "Walk" and any unexpected prefix
}

const isVertical = (k) => k === 'elevator' || k === 'stairs'

export default function Route({ from, heading, dest, accessible, onRestart }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [i, setI] = useState(0)
  const reduced = prefersReducedMotion()

  useEffect(() => {
    let live = true
    setError('')
    const to = dest.trim()
    const run = (opts) => route(opts)

    run({ from, to, accessible, heading })
      .catch((e) => {
        // A 422 caused by the heading hint: retry once WITHOUT heading.
        if (e?.status === 422 && heading) return run({ from, to, accessible })
        throw e
      })
      .then((r) => { if (live) setData(r) })
      .catch((e) => {
        if (!live) return
        if (e?.status === 404 && accessible) {
          setError('No step-free route to that room. Turn off “Elevators only” to use stairs.')
        } else {
          setError(friendlyError(e, 'route'))
        }
      })
    return () => { live = false }
  }, [from, dest, accessible, heading])

  // Short vibration on each step change, where supported and motion is allowed.
  useEffect(() => { if (data) tick(15) }, [i, data])

  if (error) {
    return (
      <main className="rise flex flex-1 flex-col justify-center text-center">
        <p className="font-display text-2xl font-bold">Couldn’t find a route to {dest}</p>
        <p className="mt-2 text-sm text-muted">{error}</p>
        <button onClick={onRestart} className="mt-6 min-h-[44px] rounded-2xl bg-scarlet py-4 font-semibold text-white">Start over</button>
      </main>
    )
  }
  if (!data) return <main className="flex flex-1 items-center justify-center text-muted">Planning your route…</main>

  const steps = data.steps || []
  const arrived = i >= steps.length
  const step = steps[i]
  const kind = step ? stepKind(step.instruction) : null
  const remaining = steps.slice(i).reduce((a, s) => a + (s.meters || 0), 0)
  const mins = Math.max(1, Math.round((data.est_seconds * (remaining / (data.total_meters || 1))) / 60))
  const riseClass = reduced ? '' : 'rise'

  // Full-screen floor-change card for elevator/stairs steps.
  if (!arrived && isVertical(kind)) {
    return (
      <main className={`${riseClass} flex flex-1 flex-col`}>
        <div className="mt-4 flex gap-1">
          {steps.map((_, k) => <span key={k} className={`h-1.5 flex-1 rounded-full ${k < i ? 'bg-scarlet' : k === i ? 'bg-scarlet/50' : 'bg-line'}`} />)}
        </div>
        <section key={i} className={`${riseClass} flex flex-1 flex-col items-center justify-center text-center`}>
          <TurnIcon kind={kind} big />
          <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-scarlet">Change floors</p>
          <p className="mt-3 font-display text-4xl font-extrabold leading-[1.08] tracking-tight">{step.instruction}</p>
        </section>
        <div className="space-y-3 pt-6">
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} className="min-h-[44px] rounded-2xl border border-line bg-white py-4 font-semibold disabled:opacity-40">Back</button>
            <button onClick={() => setI(i + 1)} className="min-h-[44px] rounded-2xl bg-scarlet py-4 font-semibold text-white">{i === steps.length - 1 ? 'I’m here' : 'Done'}</button>
          </div>
          <button onClick={onRestart} className="min-h-[44px] w-full py-3 text-sm font-medium text-muted">Lost? Snap again</button>
        </div>
      </main>
    )
  }

  return (
    <main className={`${riseClass} flex flex-1 flex-col`}>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="font-medium text-muted">From {spotName(from)}</span>
        {accessible && <span className="rounded-full bg-ink/5 px-2.5 py-0.5 font-medium">♿ Elevators only</span>}
      </div>
      <h2 className="mt-1 font-display text-xl font-bold">To Room {dest}</h2>

      <div className="mt-4 flex gap-1">
        {steps.map((_, k) => <span key={k} className={`h-1.5 flex-1 rounded-full ${k < i ? 'bg-scarlet' : k === i ? 'bg-scarlet/50' : 'bg-line'}`} />)}
      </div>

      {!arrived ? (
        <section key={i} className={`${riseClass} mt-8 flex-1`}>
          <div className="flex items-center gap-4">
            <TurnIcon kind={kind} />
            <p className="text-sm font-semibold uppercase tracking-wider text-scarlet">Step {i + 1} of {steps.length}</p>
          </div>
          <p className="mt-3 font-display text-4xl font-extrabold leading-[1.08] tracking-tight">{step.instruction}</p>
          {step.meters > 0 && <p className="mt-4 text-lg text-muted">about {step.meters} m</p>}
          <p className="mt-8 text-sm text-muted">{remaining} m left · ~{mins} min</p>
        </section>
      ) : (
        <section className={`${riseClass} mt-12 flex-1 text-center`}>
          <p className="text-6xl">🐾</p>
          <p className="mt-4 font-display text-4xl font-extrabold">You’ve arrived.</p>
          <p className="mt-2 text-muted">Room {dest}. Good dog.</p>
        </section>
      )}

      <div className="space-y-3 pt-6">
        {!arrived ? (
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} className="min-h-[44px] rounded-2xl border border-line bg-white py-4 font-semibold disabled:opacity-40">Back</button>
            <button onClick={() => setI(i + 1)} className="min-h-[44px] rounded-2xl bg-scarlet py-4 font-semibold text-white">{i === steps.length - 1 ? 'I’m here' : 'Next'}</button>
          </div>
        ) : (
          <button onClick={onRestart} className="min-h-[44px] w-full rounded-2xl bg-scarlet py-4 font-semibold text-white">Find another room</button>
        )}
        {!arrived && <button onClick={onRestart} className="min-h-[44px] w-full py-3 text-sm font-medium text-muted">Lost? Snap again</button>}
      </div>
    </main>
  )
}

// Large turn icon keyed to the step kind. Sized >= 44px; `big` variant for the
// full-screen floor-change card.
function TurnIcon({ kind, big = false }) {
  const box = big ? 'h-24 w-24' : 'h-12 w-12'
  const size = big ? 56 : 30
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center rounded-2xl bg-scarlet/10 text-scarlet`} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {glyph(kind)}
      </svg>
    </span>
  )
}

function glyph(kind) {
  switch (kind) {
    case 'left':
      return <><path d="M14 20V11a4 4 0 0 0-4-4H5" /><path d="M8 4L5 7l3 3" /></>
    case 'right':
      return <><path d="M10 20V11a4 4 0 0 1 4-4h5" /><path d="M16 4l3 3-3 3" /></>
    case 'around':
      return <><path d="M9 20V10a4 4 0 0 1 8 0v4" /><path d="M6 11l3 3 3-3" /></>
    case 'continue':
    case 'walk':
      return <><path d="M12 20V5" /><path d="M6 11l6-6 6 6" /></>
    case 'elevator':
      return <><rect x="6" y="3" width="12" height="18" rx="1" /><path d="M12 8l-2 2h4l-2-2z" /><path d="M12 16l-2-2h4l-2 2z" /></>
    case 'stairs':
      return <><path d="M3 20h4v-4h4v-4h4v-4h4" /></>
    default:
      return <><path d="M12 20V5" /><path d="M6 11l6-6 6 6" /></>
  }
}
