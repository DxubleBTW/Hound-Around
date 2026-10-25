import { useEffect, useState } from 'react'
import { route } from '../api.js'
import { floorName, floorOf, spotName } from '../lib/spots.js'
import { destinationLabel, resolveDestination } from '../lib/destinations.js'
import { arrowAria, moveLabel, prettifyLandmark } from '../lib/directions.js'
import { prefersReducedMotion, tick } from '../lib/motion.js'
import PawBurst from '../components/PawBurst.jsx'
import { ElevatorIcon } from '../components/Paw.jsx'

// Ethics rule from the brief: NO public building map. No floor plan, no SVG layout,
// no "you are here" dot or coordinate. We make directions feel full using WORDS only
// — the backend's own instruction prose plus the landmark it names. We parse the
// instruction to surface "heading toward …" and a one-step-ahead preview; we never
// re-derive or rewrite the directions themselves. The only text transform we apply
// is a DISPLAY-only reword (prettifyLandmark, see lib/directions.js) — the raw
// backend prose and stepKind's prefix matching are untouched.
//
// The big arrow below is a RELATIVE "next move" cue (turn left/right/straight/
// around/up/down), derived purely from the route step. It is NOT a magnetic or
// device compass: this app has a hard no-sensors rule (no DeviceOrientationEvent,
// no geolocation), so we never imply an absolute building bearing.
//
// Each step is a white sign. Tapping the sign means "I'm there" and shows the next
// one, the way you walk from one sign to the next in a building.

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

// Pull the landmark tail out of the backend instruction, e.g.
// "Turn right and walk toward Corridor by restrooms" -> "Corridor by restrooms".
// Defensive: returns '' when there is no "toward" tail, so callers just show the
// instruction. We only read what the backend emits; we never rewrite it.
function headingToward(instruction = '') {
  const m = instruction.match(/\btoward\s+(.+?)[.\s]*$/i)
  return m ? m[1].trim() : ''
}

// Floor name for a step, derived from its node id via spots.js (never invented).
function stepFloorName(node) {
  return node ? floorOf(node).name : ''
}

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

// Numeric floor level for a floor code, so we can tell up from down without
// inventing anything (B1 = -1, F1 = 1, F2 = 2). Returns null when unknown.
function floorLevel(code) {
  if (code === 'B1' || code === '-1') return -1
  const n = Number(String(code || '').replace(/^F/, ''))
  return Number.isFinite(n) ? n : null
}

// Relative travel direction for a vertical (elevator/stairs) step: 'up' | 'down'
// | '', derived from the current node's floor vs. the instruction's target level.
// Purely relative; never a magnetic bearing.
function verticalDir(node, instruction = '') {
  const from = floorLevel(floorOf(node).code)
  const to = floorLevel(floorBadge(instruction))
  if (from == null || to == null || from === to) return ''
  return to > from ? 'up' : 'down'
}

// Short floor mark for the big number: LL, 1, 2.
const shortFloor = (code) => (code === 'B1' || code === '-1' ? 'LL' : String(code || '').replace(/^F/, ''))

// "Turn left" -> "turn left", for the "Then …" preview sentence.
const lowerFirst = (s = '') => s.charAt(0).toLowerCase() + s.slice(1)

const linkClass = 'min-h-[44px] text-base underline underline-offset-[3px]'

export default function Route({ from, heading, dest, accessible, onRestart, api, resolvePlace = resolveDestination }) {
  const [response, setResponse] = useState(null)
  const [error, setError] = useState('')
  const [i, setI] = useState(0)
  const [dir, setDir] = useState('fwd') // which way the last step change moved
  const [attempt, setAttempt] = useState(0)
  // Resolve typed phrases ("floor 1 bathroom") to a value the backend understands.
  // Unknown values pass through untouched and the backend 422s them (handled below).
  const resolvedDest = resolvePlace(dest)
  const requestKey = JSON.stringify([from, resolvedDest, accessible, heading])
  const data = response?.key === requestKey ? response.data : null
  const reduced = prefersReducedMotion()

  // Advancing slides the next sign in from the right; going Back slides it in
  // from the left. Reduced-motion users get the static state.
  const go = (next) => { setDir(next >= i ? 'fwd' : 'back'); setI(next) }
  const signAnim = reduced ? '' : (dir === 'fwd' ? 'sign-fwd' : 'sign-back')

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setResponse(null)
    setError('')
    setI(0)
    setDir('fwd')
    const to = resolvedDest
    const run = (opts) => (api?.route || route)(opts, { signal: controller.signal })

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
          setError({ key: requestKey, message: 'No step-free route to that room. Choose another destination or turn off Elevators only.' })
        } else if (e?.status === 422) {
          // Unknown room / node. There is no /spots endpoint to autocomplete from,
          // so guide the user to a valid value instead of faking a list.
          setError({ key: requestKey, unknownDest: true, message: 'We couldn’t find that starting room or destination. Check both room numbers, or pick one of the listed rooms.' })
        } else {
          setError({ key: requestKey, message: e?.message || 'Couldn’t plan that route. Try again.' })
        }
      })
    return () => { live = false; controller.abort() }
  }, [from, resolvedDest, accessible, heading, requestKey, attempt, api])

  // Short vibration on each step change, where supported and motion is allowed.
  useEffect(() => { if (data) tick(15) }, [i, data])

  if (error && error.key === requestKey) {
    return (
      <main className="flex flex-1 flex-col pt-8">
        <div className="flex flex-1 flex-col justify-center gap-3">
          <h2 className="font-display text-[36px] font-semibold leading-[1.02]">
            {error.unknownDest ? 'We can’t find that place' : `No route to ${destinationLabel(resolvedDest)} yet`}
          </h2>
          <p role="alert" className="text-[17px] leading-snug text-mist">{error.message}</p>
        </div>
        <div className="space-y-2 pt-6">
          {/* A retry only helps when the destination itself is valid; for an unknown
              destination we send the user back to choose one instead. */}
          {!error.unknownDest && (
            <button onClick={() => setAttempt((value) => value + 1)} className="press min-h-[56px] w-full rounded-sm bg-snow font-display text-[19px] font-semibold text-night">Try again</button>
          )}
          <button onClick={onRestart} className={`${linkClass} w-full`}>{error.unknownDest ? 'Pick another destination' : 'Start over'}</button>
        </div>
      </main>
    )
  }
  if (!data) {
    return (
      <main role="status" className="flex flex-1 items-center justify-center gap-3 text-mist">
        <span aria-hidden className="breathe block h-2.5 w-2.5 rounded-full bg-snow" />
        Planning your route…
      </main>
    )
  }

  const steps = data.steps || []
  const arrived = i >= steps.length
  const step = steps[i]
  const kind = step ? stepKind(step.instruction) : null
  const vertical = !arrived && isVertical(kind)
  // The backend reports real meters as floats (e.g. 12.345); show whole meters.
  const remaining = Math.round(steps.slice(i).reduce((a, s) => a + (s.meters || 0), 0))
  const mins = Math.max(1, Math.round((data.est_seconds * (remaining / (data.total_meters || 1))) / 60))
  const floorChangeAhead = steps.slice(i).some((s) => isVertical(stepKind(s.instruction)))
  const destText = destinationLabel(resolvedDest)
  const fromText = destinationLabel(from) || spotName(from) || from
  const floorHere = step ? stepFloorName(step.node) : ''

  // Words on the sign. A walking step leads with the plain move and the reworded
  // landmark; a floor change leads with "Take the elevator to Floor 1". The raw
  // backend instruction (display-reworded) is the screen-reader label.
  let move = ''
  let detail = ''
  let badge = null
  let stairDir = ''
  if (step) {
    if (vertical) {
      badge = floorBadge(step.instruction)
      stairDir = verticalDir(step.node, step.instruction)
      const levelName = badge ? floorName(badge === 'B1' ? -1 : Number(badge)) : ''
      move = moveLabel(kind, levelName)
      const toward = prettifyLandmark(headingToward(step.instruction))
      detail = toward ? `toward ${lowerFirst(toward)}` : ''
    } else {
      move = kind ? moveLabel(kind) : ''
      const toward = prettifyLandmark(headingToward(step.instruction))
      detail = toward ? `toward ${lowerFirst(toward)}` : prettifyLandmark(step.instruction)
    }
  }
  const nextStep = steps[i + 1]
  const nextKind = nextStep ? stepKind(nextStep.instruction) : null
  const nextToward = nextStep ? prettifyLandmark(headingToward(nextStep.instruction)) : ''
  const last = i === steps.length - 1
  const meters = step?.meters > 0 ? Math.max(1, Math.round(step.meters)) : 0
  const tapHint = last ? 'Tap when you arrive' : vertical ? 'Tap when you’re out' : 'Tap when you’re there'

  return (
    <main className="flex flex-1 flex-col gap-5 pt-5">
      <header>
        {fromText && <p className="text-sm text-mist">From {fromText}</p>}
        <h2 className="font-display text-[36px] font-semibold leading-[1.02]">To {destText}</h2>
        {!arrived && (
          <p className="mt-1 text-base text-mist">
            {remaining} m to go, about {mins} min.{floorChangeAhead ? (accessible ? ' Includes an elevator ride.' : ' Includes a floor change.') : ''}
          </p>
        )}
        {accessible && <p className="mt-1.5 flex items-center gap-1.5 text-sm"><ElevatorIcon size={18} />Elevators only</p>}
      </header>

      {!arrived ? (
        <>
          {vertical && badge && <FloorHero from={shortFloor(floorOf(step.node).code)} to={shortFloor(badge)} dir={stairDir} />}

          <button key={i} onClick={() => go(i + 1)}
            aria-label={`Sign ${i + 1} of ${steps.length}. ${prettifyLandmark(step.instruction)}.${meters ? ` About ${meters} metres.` : ''} ${tapHint}.`}
            className={`${signAnim} press block w-full overflow-hidden rounded-[3px] bg-snow text-left text-night`}>
            <span className="flex justify-between bg-maroon px-4 py-2.5 text-sm font-bold text-snow">
              <span>Sign {i + 1} of {steps.length}</span>
              <span>{floorHere}</span>
            </span>
            <span className="flex items-center gap-4 px-4 pt-4">
              <DirectionArrow kind={kind} dir={stairDir} aria={arrowAria(kind)} />
              <span className="min-w-0">
                <span className="block font-display text-[30px] font-semibold leading-[1.02]">{move}</span>
                {detail && <span className="mt-1.5 block text-[17px] leading-snug text-[#262626]">{detail}</span>}
              </span>
            </span>
            <span className="flex items-baseline justify-between px-4 pb-4 pt-3">
              <span className="font-display text-xl font-semibold">{meters ? `${meters} m` : ''}</span>
              <span className="text-sm text-[#4A4A4A]">{tapHint}</span>
            </span>
          </button>

          {nextStep && (
            <p className="flex items-center gap-3 text-base">
              <TurnIcon kind={nextKind} />
              <span><span className="text-mist">Then </span>{lowerFirst(moveLabel(nextKind))}{nextToward ? ` toward ${lowerFirst(nextToward)}` : ''}</span>
            </p>
          )}
        </>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <PawBurst size={96} />
          <p className="mt-5 font-display text-[40px] font-semibold leading-none">You’ve arrived.</p>
          <p className="mt-3 text-[17px] text-mist">{destText} is right here. Good dog.</p>
        </section>
      )}

      <div className="mt-auto pt-2">
        {!arrived ? (
          <div className="flex justify-between gap-4">
            <button onClick={() => go(Math.max(0, i - 1))} disabled={i === 0} className={`${linkClass} disabled:text-[#5C5C5C] disabled:no-underline`}>Back</button>
            <button onClick={onRestart} className={linkClass}>Lost? Take a new photo</button>
          </div>
        ) : (
          <button onClick={onRestart} className="press min-h-[56px] w-full rounded-sm bg-snow font-display text-[19px] font-semibold text-night">Find another room</button>
        )}
      </div>
    </main>
  )
}

// Floor change: the big target floor and a short elevator track the red "you"
// dot rides along. Up or down comes from verticalDir; unknown falls back to down.
function FloorHero({ from, to, dir }) {
  const up = dir === 'up'
  return (
    <div className="flex items-center gap-6 pl-1" aria-hidden>
      <svg width="44" height="190" viewBox="0 0 44 190">
        <line x1="22" y1="30" x2="22" y2="160" stroke="#7A1F2B" strokeWidth="7" strokeLinecap="round" />
        <circle cx="22" cy="30" r="10" fill="#000" stroke={up ? '#fff' : '#5C5C5C'} strokeWidth="3" />
        <circle cx="22" cy="160" r="10" fill="#000" stroke={up ? '#5C5C5C' : '#fff'} strokeWidth="3" />
        <circle className="ride" cx="22" cy={up ? 160 : 30} r="6" fill="#CC0000" style={{ '--ride': up ? '-130px' : '130px' }} />
        <text x="22" y="12" textAnchor="middle" fontFamily="Jost, sans-serif" fontSize="14" fontWeight="600" fill={up ? '#fff' : '#8A8A8A'}>{up ? to : from}</text>
        <text x="22" y="186" textAnchor="middle" fontFamily="Jost, sans-serif" fontSize="14" fontWeight="600" fill={up ? '#8A8A8A' : '#fff'}>{up ? from : to}</text>
      </svg>
      <div>
        <p className="text-base text-mist">{up ? 'Going up to floor' : 'Going down to floor'}</p>
        <p className="font-display text-[140px] font-medium leading-[.8]">{to}</p>
      </div>
    </div>
  )
}

// The big RELATIVE directional arrow on the sign — black on white.
// Derived purely from the step kind (and, for vertical moves, an up/down `dir`),
// it points the next move: left / right / straight-ahead / U-turn / up / down.
//
// NOTE: this is a RELATIVE turn arrow, NOT a device/magnetic compass. The app has
// a hard no-sensors rule (no DeviceOrientationEvent, no geolocation), so it never
// implies an absolute building bearing — only "your next move is this way". The
// subtle nudge animation is gated by reduced motion via index.css.
function DirectionArrow({ kind, dir = '', aria = '' }) {
  const reduced = prefersReducedMotion()
  // For vertical steps, resolve to an explicit up/down arrow when we know which
  // way; otherwise fall back to the elevator/stairs glyph.
  const arrowKind = isVertical(kind) ? (dir === 'up' ? 'up' : dir === 'down' ? 'down' : kind) : kind
  // Gentle nudge in the direction of travel (purely decorative, relative only).
  const nudge = {
    left: { '--nudge-x': '-4px' }, right: { '--nudge-x': '4px' },
    up: { '--nudge-y': '-4px' }, down: { '--nudge-y': '4px' },
    continue: { '--nudge-y': '-4px' }, walk: { '--nudge-y': '-4px' },
    around: { '--nudge-y': '-3px' },
  }[arrowKind] || {}
  return (
    <span role="img" aria-label={aria} className="flex h-14 w-14 shrink-0 items-center justify-center">
      <span className={reduced ? '' : 'nudge'} style={nudge} aria-hidden>
        <svg width={56} height={56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {glyph(arrowKind)}
        </svg>
      </span>
    </span>
  )
}

// Small turn icon for the "Then …" preview.
function TurnIcon({ kind }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      {glyph(kind)}
    </svg>
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
    case 'up':
      return <><path d="M12 20V5" /><path d="M6 11l6-6 6 6" /></>
    case 'down':
      return <><path d="M12 4v15" /><path d="M6 13l6 6 6-6" /></>
    case 'elevator':
      return <><rect x="6" y="3" width="12" height="18" rx="1" /><path d="M12 8l-2 2h4l-2-2z" /><path d="M12 16l-2-2h4l-2 2z" /></>
    case 'stairs':
      return <><path d="M3 20h4v-4h4v-4h4v-4h4" /></>
    default:
      return <><path d="M12 20V5" /><path d="M6 11l6-6 6 6" /></>
  }
}
