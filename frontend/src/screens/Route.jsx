import { useEffect, useState } from 'react'
import { route } from '../api.js'
import { floorName, floorOf, spotName } from '../lib/spots.js'
import { destinationLabel, resolveDestination } from '../lib/destinations.js'
import { arrowAria, moveLabel, prettifyLandmark } from '../lib/directions.js'
import { prefersReducedMotion, tick } from '../lib/motion.js'
import { compactSteps } from '../lib/steps.js'
import { directionsShown, exitLabel, passesText, setDirectionsShown, stepsByLeg, turnMarks, usableLegs } from '../lib/legs.js'
import PawBurst from '../components/PawBurst.jsx'
import RoutePath from '../components/RoutePath.jsx'
import BuildingIntro from '../components/BuildingIntro.jsx'
import TripBuilding from '../components/TripBuilding.jsx'
import { ElevatorIcon } from '../components/Paw.jsx'

// Floor codes the building drawings use, from a leg's numeric floor.
const FLOOR_CODE = { '-1': 'B1', 1: 'F1', 2: 'F2' }
// How long the floor-change ride plays before the next floor's hallway draws in.
const RIDE_MS = 1900

// Ethics rule from the brief: NO public building map. No floor plan, no other
// hallways, no building coordinates. When the backend sends `legs`, the screen
// opens on the user's OWN path for one floor (normalized per leg server-side,
// see components/RoutePath.jsx); everything else stays words. Without legs it
// falls back to the sign-by-sign view below. We parse the
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

// A place name mid-sentence: "toward the main stairs", but "toward Room 263".
const place = (s = '') => (/^Room\b/.test(s) ? s : lowerFirst(s))

const linkClass = 'min-h-[44px] text-base underline underline-offset-[3px]'

export default function Route({ from, heading, dest, accessible, onRestart, onReady, api, resolvePlace = resolveDestination, roomLabels = {}, floors = [] }) {
  const [response, setResponse] = useState(null)
  const [error, setError] = useState('')
  const [i, setI] = useState(0)
  const [dir, setDir] = useState('fwd') // which way the last step change moved
  const [attempt, setAttempt] = useState(0)
  const [legIndex, setLegIndex] = useState(0)
  const [arrivedOnMap, setArrivedOnMap] = useState(false)
  const [introDone, setIntroDone] = useState(false) // the 3D CDS intro plays once per route
  const [showDirections, setShowDirections] = useState(directionsShown)
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
    setLegIndex(0)
    setArrivedOnMap(false)
    setIntroDone(false)
    setDir('fwd')
    const to = resolvedDest
    const run = (opts) => (api?.route || route)(opts, { signal: controller.signal })

    run({ from, to, accessible, heading })
      .catch((e) => {
        // A 422 caused by the heading hint: retry once WITHOUT heading.
        if (e?.status === 422 && heading) return run({ from, to, accessible })
        throw e
      })
      .then((r) => { if (live) { setResponse({ key: requestKey, data: r }); onReady?.() } })
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
  useEffect(() => { if (data) tick(15) }, [i, legIndex, data])

  if (error && error.key === requestKey) {
    return (
      <main className="flex flex-1 flex-col pt-8">
        <div className="flex flex-1 flex-col justify-center gap-3">
          <h2 className="font-display text-[36px] font-semibold leading-[1.02]">
            {error.unknownDest ? 'We can’t find that place' : `No route to ${destinationLabel(resolvedDest, roomLabels)} yet`}
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

  const steps = compactSteps(data.steps || [], stepKind)
  const legs = usableLegs(data)
  const arrived = i >= steps.length || arrivedOnMap
  const step = steps[i]
  const kind = step ? stepKind(step.instruction) : null
  const vertical = !arrived && isVertical(kind)
  // The backend reports real meters as floats (e.g. 12.345); show whole meters.
  const remaining = Math.round(steps.slice(i).reduce((a, s) => a + (s.meters || 0), 0))
  const mins = Math.max(1, Math.round((data.est_seconds * (remaining / (data.total_meters || 1))) / 60))
  const floorChangeAhead = steps.slice(i).some((s) => isVertical(stepKind(s.instruction)))
  const destText = destinationLabel(resolvedDest, roomLabels)
  const fromText = destinationLabel(from, roomLabels) || spotName(from, roomLabels) || from
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
      const toward = prettifyLandmark(headingToward(step.instruction), roomLabels[step.node])
      detail = toward ? `toward ${place(toward)}` : ''
    } else {
      move = kind ? moveLabel(kind) : ''
      const toward = prettifyLandmark(headingToward(step.instruction), roomLabels[step.node])
      // "Head toward" already ends in "toward": the landmark is the whole detail.
      detail = toward ? (kind === 'walk' ? toward : `toward ${place(toward)}`) : prettifyLandmark(step.instruction, roomLabels[step.node])
    }
  }
  const nextStep = steps[i + 1]
  const nextKind = nextStep ? stepKind(nextStep.instruction) : null
  const nextToward = nextStep ? prettifyLandmark(headingToward(nextStep.instruction), roomLabels[nextStep.node]) : ''
  const nextJoin = nextKind === 'walk' ? ' ' : ' toward '
  const last = i === steps.length - 1
  const meters = step?.meters > 0 ? Math.max(1, Math.round(step.meters)) : 0
  const tapHint = last ? 'Tap when you arrive' : vertical ? 'Tap when you’re out' : 'Tap when you’re there'

  if (legs && !arrived) {
    return (
      <RouteMap legs={legs} steps={steps} legIndex={legIndex} reduced={reduced} dir={dir}
        fromText={fromText} destText={destText} accessible={accessible} estSeconds={data.est_seconds}
        totalMeters={data.total_meters} roomLabels={roomLabels} onRestart={onRestart}
        floors={floors} showIntro={!introDone && floors.length > 0} onIntroDone={() => setIntroDone(true)}
        showDirections={showDirections}
        onToggleDirections={() => { setDirectionsShown(!showDirections); setShowDirections(!showDirections) }}
        onLeg={(next) => { setDir(next >= legIndex ? 'fwd' : 'back'); setLegIndex(next) }}
        onArrive={() => setArrivedOnMap(true)} />
    )
  }

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
            aria-label={`Sign ${i + 1} of ${steps.length}. ${prettifyLandmark(step.instruction, roomLabels[step.node])}.${meters ? ` About ${meters} metres.` : ''} ${tapHint}.`}
            className={`${signAnim} press block w-full overflow-hidden rounded-[3px] bg-snow text-left text-night`}>
            <span className="flex justify-between bg-maroon px-4 py-2.5 text-sm font-bold text-white">
              <span>Sign {i + 1} of {steps.length}</span>
              <span>{floorHere}</span>
            </span>
            <span className="flex items-center gap-4 px-4 pt-4">
              <DirectionArrow kind={kind} dir={stairDir} aria={arrowAria(kind)} />
              <span className="min-w-0">
                <span className="block font-display text-[30px] font-semibold leading-[1.02]">{move}</span>
                {detail && <span className="mt-1.5 block text-[17px] leading-snug text-night/85">{detail}</span>}
                {passesText(step.passes) && (
                  <span className="mt-1 block text-[15px] leading-snug text-night/70">{passesText(step.passes)}</span>
                )}
              </span>
            </span>
            <span className="flex items-baseline justify-between px-4 pb-4 pt-3">
              <span className="font-display text-xl font-semibold">{meters ? `${meters} m` : ''}</span>
              <span className="text-sm text-night/70">{tapHint}</span>
            </span>
          </button>

          {nextStep && (
            <p className="flex items-center gap-3 text-base">
              <TurnIcon kind={nextKind} />
              <span><span className="text-mist">Then </span>{lowerFirst(moveLabel(nextKind))}{nextToward ? `${nextJoin}${place(nextToward)}` : ''}</span>
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
            <button onClick={() => go(Math.max(0, i - 1))} disabled={i === 0} className={`${linkClass} disabled:text-dim disabled:no-underline`}>Back</button>
            <button onClick={onRestart} className={linkClass}>Lost? Take a new photo</button>
          </div>
        ) : (
          <button onClick={onRestart} className="press min-h-[56px] w-full rounded-sm bg-snow font-display text-[19px] font-semibold text-night">Find another room</button>
        )}
      </div>
    </main>
  )
}

// Words for one step in the optional directions list.
function stepWords(step, roomLabels) {
  const kind = stepKind(step.instruction)
  const toward = prettifyLandmark(headingToward(step.instruction), roomLabels[step.node])
  if (isVertical(kind)) {
    const badge = floorBadge(step.instruction)
    return { kind, text: moveLabel(kind, badge ? floorName(badge === 'B1' ? -1 : Number(badge)) : '') }
  }
  const join = kind === 'walk' ? ' ' : ' toward '
  return { kind, text: `${moveLabel(kind)}${toward ? join + place(toward) : ''}` }
}

// The route screen when the backend sends drawable legs: one floor at a time,
// path first. A floor change is a card the user taps once they're off the
// elevator; the next floor's path then draws in. Text directions are optional.
function RouteMap({ legs, steps, legIndex, reduced, dir, fromText, destText, accessible, estSeconds, totalMeters,
  roomLabels, onRestart, floors = [], showIntro = false, onIntroDone, showDirections, onToggleDirections, onLeg, onArrive }) {
  const leg = legs[legIndex]
  // Tapping a floor change first plays the ride on the 3D building, then the next
  // floor's hallway draws in.
  const [riding, setRiding] = useState(false)
  useEffect(() => {
    if (!riding) return undefined
    const timer = setTimeout(() => { setRiding(false); onLeg(legIndex + 1) }, RIDE_MS)
    return () => clearTimeout(timer)
  }, [riding]) // eslint-disable-line react-hooks/exhaustive-deps
  const hereFloor = FLOOR_CODE[leg.floor]
  const destFloor = FLOOR_CODE[legs[legs.length - 1].floor]
  const drawBuilding = floors.length > 0 && !!hereFloor
  const nextFloor = () => (drawBuilding ? setRiding(true) : onLeg(legIndex + 1))
  const groups = stepsByLeg(steps, stepKind, legs.length)
  const legSteps = groups ? groups[legIndex] : steps
  const remaining = Math.round((groups ? groups.slice(legIndex).flat() : steps)
    .reduce((a, s) => a + (s.meters || 0), 0))
  const mins = Math.max(1, Math.round((estSeconds * (remaining / (totalMeters || 1))) / 60))
  const floor = floorName(leg.floor)
  const roomNumber = (destText.match(/\b(B?\d{2,3}[A-Z]?)\b/) || [])[1] || ''
  const anim = reduced ? '' : (dir === 'fwd' ? 'sign-fwd' : 'sign-back')
  const pathLabel = leg.exit
    ? `Your path on ${floor}, from you to the ${leg.exit.mode === 'stairs' ? 'stairs' : 'elevator'}.`
    : `Your path on ${floor}, from you to ${destText}.`

  return (
    <main className="flex flex-1 flex-col gap-4 pt-5">
      <header>
        {fromText && <p className="text-sm text-mist">From {fromText}</p>}
        <h2 className="font-display text-[36px] font-semibold leading-[1.02]">To {destText}</h2>
        <p className="mt-1 text-base text-mist">{remaining} m to go, about {mins} min.</p>
        {accessible && <p className="mt-1.5 flex items-center gap-1.5 text-sm"><ElevatorIcon size={18} />Elevators only</p>}
      </header>

      {showIntro ? (
        // The route just loaded: the building opens up to your floor first.
        <BuildingIntro floors={floors} here={hereFloor} to={destFloor} still={reduced} onDone={onIntroDone}
          caption={`You’re on ${floor}${destFloor !== hereFloor ? `. ${destText} is on ${floorName(legs[legs.length - 1].floor)}.` : '.'}`} />
      ) : riding ? (
        <section className="flex flex-col gap-1">
          <p className="text-base text-mist">{leg.exit.to_floor > leg.floor ? 'Going up to' : 'Going down to'}</p>
          <p className="font-display text-[34px] font-semibold leading-none">{floorName(leg.exit.to_floor)}</p>
          <TripBuilding floors={floors} here={hereFloor} to={destFloor}
            ride={{ from: hereFloor, to: FLOOR_CODE[leg.exit.to_floor] }}
            label={`CDS: riding from ${floor} to ${floorName(leg.exit.to_floor)}.`} />
        </section>
      ) : (
        <section key={legIndex} className={`${anim} flex flex-col gap-2`}>
          <p className="flex items-baseline justify-between text-sm">
            <span className="font-display text-xl font-semibold">{floor}</span>
            {legs.length > 1 && <span className="text-mist">Part {legIndex + 1} of {legs.length}</span>}
          </p>
          <RoutePath leg={leg} marks={turnMarks(leg, legSteps, stepKind)} exitMode={leg.exit?.mode}
            endLabel={roomNumber} label={pathLabel} />
        </section>
      )}

      {!showIntro && !riding && <button onClick={leg.exit ? nextFloor : onArrive}
        className="press block w-full overflow-hidden rounded-[3px] bg-snow text-left text-night">
        <span className="flex items-center gap-3 px-4 py-3.5">
          {leg.exit?.mode === 'elevator' && <ElevatorIcon size={28} />}
          <span className="min-w-0">
            <span className="block font-display text-[24px] font-semibold leading-[1.05]">
              {leg.exit ? exitLabel(leg.exit) : `Follow the line to ${destText}`}
            </span>
            <span className="mt-1 block text-sm text-night/70">
              {leg.exit ? `Tap when you’re on ${floorName(leg.exit.to_floor)}` : 'Tap when you arrive'}
            </span>
          </span>
        </span>
      </button>}

      {!showIntro && <div>
        <button onClick={onToggleDirections} aria-expanded={showDirections} className={linkClass}>
          {showDirections ? 'Hide directions' : 'Show directions'}
        </button>
        {showDirections && (
          <ol className="mt-1 space-y-3">
            {legSteps.map((step, index) => {
              const { kind, text } = stepWords(step, roomLabels)
              const meters = step.meters > 0 ? Math.max(1, Math.round(step.meters)) : 0
              const passing = passesText(step.passes)
              return (
                <li key={`${step.node}-${index}`} className="flex items-start gap-3 text-base">
                  {/* Same number as the mark on the map. */}
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-snow font-display text-sm font-bold text-night">
                    {index + 1}
                  </span>
                  <TurnIcon kind={kind} />
                  <span className="min-w-0 flex-1">
                    {text}
                    {passing && <span className="mt-0.5 block text-sm text-mist">{passing}</span>}
                  </span>
                  {meters > 0 && <span className="text-sm text-mist">{meters} m</span>}
                </li>
              )
            })}
          </ol>
        )}
      </div>}

      <div className="mt-auto flex justify-between gap-4 pt-2">
        <button onClick={() => onLeg(Math.max(0, legIndex - 1))} disabled={legIndex === 0}
          className={`${linkClass} disabled:text-dim disabled:no-underline`}>Back</button>
        <button onClick={onRestart} className={linkClass}>Lost? Take a new photo</button>
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
        <circle cx="22" cy="30" r="10" fill="var(--color-night)" stroke={up ? 'var(--color-snow)' : 'var(--color-dim)'} strokeWidth="3" />
        <circle cx="22" cy="160" r="10" fill="var(--color-night)" stroke={up ? 'var(--color-dim)' : 'var(--color-snow)'} strokeWidth="3" />
        <circle className="ride" cx="22" cy={up ? 160 : 30} r="6" fill="#CC0000" style={{ '--ride': up ? '-130px' : '130px' }} />
        <text x="22" y="12" textAnchor="middle" fontFamily="Jost, sans-serif" fontSize="14" fontWeight="600" fill={up ? 'var(--color-snow)' : 'var(--color-dim)'}>{up ? to : from}</text>
        <text x="22" y="186" textAnchor="middle" fontFamily="Jost, sans-serif" fontSize="14" fontWeight="600" fill={up ? 'var(--color-dim)' : 'var(--color-snow)'}>{up ? from : to}</text>
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
    continue: { '--nudge-y': '-4px' },
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
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-mist)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
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
    case 'walk':
      // Facing unknown: a target, not a straight-ahead arrow.
      return <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /></>
    case 'continue':
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
