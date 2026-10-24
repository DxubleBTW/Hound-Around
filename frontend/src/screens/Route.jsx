import { useEffect, useState } from 'react'
import { route } from '../api.js'
import { spotName } from '../lib/spots.js'
import { prefersReducedMotion, tick } from '../lib/motion.js'
import PawBurst from '../components/PawBurst.jsx'

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

// Pull the destination level out of "Take the elevator to 1, toward ..." for the
// big floor badge. Backend emits the level token; we only display it, never invent it.
function floorBadge(instruction = '') {
  const m = instruction.match(/to\s+(-?\d+|B\d+|[A-Za-z0-9]+),/)
  if (!m) return null
  const token = m[1]
  if (token === '-1' || token === 'B1') return 'B1'
  if (/^\d+$/.test(token)) return token
  return token
}

export default function Route({ from, heading, dest, accessible, onRestart }) {
  const [response, setResponse] = useState(null)
  const [error, setError] = useState('')
  const [i, setI] = useState(0)
  const [dir, setDir] = useState('fwd') // which way the last step change moved
  const [attempt, setAttempt] = useState(0)
  const requestKey = JSON.stringify([from, dest.trim(), accessible, heading])
  const data = response?.key === requestKey ? response.data : null
  const reduced = prefersReducedMotion()

  // Advancing slides the next step in from the right ('rise-left'); going Back
  // slides it in from the left. Reduced-motion users get the static state.
  const go = (next) => { setDir(next >= i ? 'fwd' : 'back'); setI(next) }
  const stepAnim = reduced ? '' : (dir === 'fwd' ? 'rise-left' : 'rise-right')

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setResponse(null)
    setError('')
    setI(0)
    setDir('fwd')
    const to = dest.trim()
    const run = (opts) => route(opts, { signal: controller.signal })

    run({ from, to, accessible, heading })
      .catch((e) => {
        // A 422 caused by the heading hint: retry once WITHOUT heading.
        if (e?.status === 422 && heading) return run({ from, to, accessible })
        throw e
      })
      .then((r) => { if (live) setResponse({ key: requestKey, data: r }) })
      .catch((e) => {
        if (!live || e?.name === 'AbortError') return
        if (e?.status === 404 && accessible) {
          setError({ key: requestKey, message: 'No step-free route to that room. Choose another destination or check the route setting.' })
        } else {
          setError({ key: requestKey, message: e?.message || 'Couldn’t plan that route. Try again.' })
        }
      })
    return () => { live = false; controller.abort() }
  }, [from, dest, accessible, heading, requestKey, attempt])

  // Short vibration on each step change, where supported and motion is allowed.
  useEffect(() => { if (data) tick(15) }, [i, data])

  if (error && error.key === requestKey) {
    return (
      <main className="rise flex flex-1 flex-col justify-center text-center">
        <p className="font-display text-2xl font-bold">Couldn’t find a route to {dest}</p>
        <p role="alert" className="mt-2 text-sm text-muted">{error.message}</p>
        <button onClick={() => setAttempt((value) => value + 1)} className="mt-6 min-h-[44px] rounded-2xl border border-line bg-white py-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">Try again</button>
        <button onClick={onRestart} className="mt-6 min-h-[44px] rounded-2xl bg-scarlet py-4 font-semibold text-white shadow-[0_12px_28px_-10px_rgba(204,0,0,.6)] transition active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">Start over</button>
      </main>
    )
  }
  if (!data) return <main role="status" className="flex flex-1 items-center justify-center text-muted">Planning your route…</main>

  const steps = data.steps || []
  const arrived = i >= steps.length
  const step = steps[i]
  const kind = step ? stepKind(step.instruction) : null
  // The backend reports real meters as floats (e.g. 12.345); show whole meters.
  const remaining = Math.round(steps.slice(i).reduce((a, s) => a + (s.meters || 0), 0))
  const mins = Math.max(1, Math.round((data.est_seconds * (remaining / (data.total_meters || 1))) / 60))
  const riseClass = reduced ? '' : 'rise'

  // Full-screen floor-change card for elevator/stairs steps.
  if (!arrived && isVertical(kind)) {
    const badge = floorBadge(step.instruction)
    return (
      <main className={`${riseClass} flex flex-1 flex-col`}>
        <div className="mt-4 flex gap-1">
          {steps.map((_, k) => <span key={k} className={`h-1.5 flex-1 rounded-full ${k < i ? 'bg-scarlet' : k === i ? 'bg-scarlet/50' : 'bg-line'}`} />)}
        </div>
        {/* Dark, immersive "moment" so a floor change reads as a distinct event. */}
        <section key={i} className={`${stepAnim} mt-4 flex flex-1 flex-col items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-b from-ink to-scarlet-dark p-6 text-center text-paper shadow-[0_24px_50px_-20px_rgba(26,20,20,.7)]`}>
          {badge && (
            <span className="mb-6 flex h-28 w-28 flex-col items-center justify-center rounded-3xl bg-paper/10 ring-1 ring-paper/20">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-paper/70">Floor</span>
              <span className="font-display text-5xl font-extrabold leading-none">{badge}</span>
            </span>
          )}
          <span className="flex h-24 w-24 items-center justify-center rounded-2xl bg-paper/10 text-paper">
            <TurnIcon kind={kind} big bare />
          </span>
          <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-paper/80">Change floors</p>
          <p className="mt-3 font-display text-3xl font-extrabold leading-[1.08] tracking-tight">{step.instruction}</p>
        </section>
        <div className="space-y-3 pt-6">
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <button onClick={() => go(Math.max(0, i - 1))} disabled={i === 0} className="min-h-[44px] rounded-2xl border border-line bg-white py-4 font-semibold shadow-sm transition active:scale-[.98] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">Back</button>
            <button onClick={() => go(i + 1)} className="min-h-[44px] rounded-2xl bg-scarlet py-4 font-semibold text-white shadow-[0_12px_28px_-10px_rgba(204,0,0,.6)] transition active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">{i === steps.length - 1 ? 'I’m here' : 'Done'}</button>
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
        <section key={i} className={`${stepAnim} mt-8 flex-1`}>
          <div className="flex items-center gap-4">
            <TurnIcon kind={kind} />
            <p className="text-sm font-semibold uppercase tracking-wider text-scarlet">Step {i + 1} of {steps.length}</p>
          </div>
          <p className="mt-4 font-display text-[2.75rem] font-extrabold leading-[1.05] tracking-tight">{step.instruction}</p>
          {step.meters > 0 && <p className="mt-4 text-lg text-muted">about {Math.max(1, Math.round(step.meters))} m</p>}
          <p className="mt-8 inline-flex rounded-full bg-ink/5 px-3 py-1 text-sm font-medium text-muted">{remaining} m left · ~{mins} min</p>
        </section>
      ) : (
        <section className={`${riseClass} mt-12 flex-1 text-center`}>
          <PawBurst size={96} className="mx-auto" />
          <p className="mt-4 font-display text-4xl font-extrabold">You’ve arrived.</p>
          <p className="mt-2 text-muted">Room {dest}. Good dog.</p>
        </section>
      )}

      <div className="space-y-3 pt-6">
        {!arrived ? (
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <button onClick={() => go(Math.max(0, i - 1))} disabled={i === 0} className="min-h-[44px] rounded-2xl border border-line bg-white py-4 font-semibold shadow-sm transition active:scale-[.98] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">Back</button>
            <button onClick={() => go(i + 1)} className="min-h-[44px] rounded-2xl bg-scarlet py-4 font-semibold text-white shadow-[0_12px_28px_-10px_rgba(204,0,0,.6)] transition active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">{i === steps.length - 1 ? 'I’m here' : 'Next'}</button>
          </div>
        ) : (
          <button onClick={onRestart} className="min-h-[44px] w-full rounded-2xl bg-scarlet py-4 font-semibold text-white shadow-[0_12px_28px_-10px_rgba(204,0,0,.6)] transition active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">Find another room</button>
        )}
        {!arrived && <button onClick={onRestart} className="min-h-[44px] w-full py-3 text-sm font-medium text-muted">Lost? Snap again</button>}
      </div>
    </main>
  )
}

// Large turn icon keyed to the step kind. Sized >= 44px; `big` variant for the
// full-screen floor-change card. `bare` drops the own background/color so the
// icon can sit inside a surface the caller styles (e.g. the floor-change card).
function TurnIcon({ kind, big = false, bare = false }) {
  const size = big ? 60 : 36
  const svg = (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {glyph(kind)}
    </svg>
  )
  if (bare) return <span aria-hidden>{svg}</span>
  const box = big ? 'h-24 w-24' : 'h-14 w-14'
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center rounded-2xl bg-scarlet/10 text-scarlet`} aria-hidden>
      {svg}
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
