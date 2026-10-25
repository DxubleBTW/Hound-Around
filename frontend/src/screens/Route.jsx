import { useEffect, useState } from 'react'
import { route } from '../api.js'
import { floorName, floorOf, spotName } from '../lib/spots.js'
import { destinationLabel, resolveDestination } from '../lib/destinations.js'
import { arrowAria, moveLabel, prettifyLandmark } from '../lib/directions.js'
import { prefersReducedMotion, tick } from '../lib/motion.js'
import { compactSteps } from '../lib/steps.js'
import { exitLabel, stepsByLeg, usableLegs } from '../lib/legs.js'
import PawBurst from '../components/PawBurst.jsx'
import RoutePath from '../components/RoutePath.jsx'
import Icon from '../components/Icon.jsx'
import { floorMark } from '../lib/floors.js'
import { BottomBar, Button, Sheet, TextAction, TopBar, focusRing } from '../components/ui.jsx'

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

export default function Route({ from, heading, photo = null, dest, accessible, onRestart, api, resolvePlace = resolveDestination, roomLabels = {} }) {
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
          setError({ key: requestKey, message: 'No step-free route to that room. Choose another destination or check the route setting.' })
        } else if (e?.status === 422) {
          // Unknown room / node. There is no /spots endpoint to autocomplete from,
          // so guide the user to a valid value instead of faking a list.
          setError({ key: requestKey, unknownDest: true, message: 'We could not resolve the starting location or destination. Check both room numbers or choose a listed place.' })
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
      <main className="rise flex flex-1 flex-col">
        <TopBar onBack={onRestart} backLabel="Start over" />
        <Sheet>
          {error.unknownDest
            ? <span className="lg flex h-11 w-11 items-center justify-center rounded-full font-display text-[22px] font-bold" aria-hidden>?</span>
            : <span className="flex h-11 w-11 items-center justify-center rounded-full bg-tint text-rose"><Icon name="flag" size={22} /></span>}
          <p className="font-display mt-4 text-balance text-[22px] font-bold">
            {error.unknownDest ? 'Can’t find that place' : `Couldn’t find a route to ${destinationLabel(resolvedDest, roomLabels)}`}
          </p>
          <p role="alert" className="mt-1 text-[15px] text-dim">{error.message}</p>
          {/* A retry only helps when the destination itself is valid; for an unknown
              destination we send the user back to choose one instead. */}
          <div className="mt-5 flex flex-col gap-2">
            {!error.unknownDest && <Button onClick={() => setAttempt((value) => value + 1)} className="w-full">Try again</Button>}
            <Button variant={error.unknownDest ? 'primary' : 'secondary'} onClick={onRestart} className="w-full">{error.unknownDest ? 'Pick another destination' : 'Start over'}</Button>
          </div>
        </Sheet>
      </main>
    )
  }
  if (!data) {
    return (
      <main role="status" aria-label="Planning your route…" className="flex flex-1 flex-col pt-2">
        <div className="h-[112px] animate-pulse rounded-3xl bg-edge/70" />
        <div className="mt-6 space-y-3">{[0, 1, 2].map((k) => <div key={k} className="h-14 animate-pulse rounded-2xl bg-card" />)}</div>
        <p className="mt-6 text-center text-[14px] text-dim">Planning your route…</p>
      </main>
    )
  }

  // Tiny "keep straight" steps fold into the next sign (lib/steps.js).
  const steps = compactSteps(data.steps || [], stepKind)
  const arrived = i >= steps.length
  const step = steps[i]
  const kind = step ? stepKind(step.instruction) : null
  // The backend reports real meters as floats (e.g. 12.345); show whole meters.
  const remaining = Math.round(steps.slice(i).reduce((a, s) => a + (s.meters || 0), 0))
  const mins = Math.max(1, Math.round((data.est_seconds * (remaining / (data.total_meters || 1))) / 60))
  const destText = destinationLabel(resolvedDest, roomLabels)
  const floorHere = step ? stepFloorName(step.node) : ''
  // Plain move label from the step kind, then ONE supporting line: the landmark the
  // backend names, or its own (display-reworded) instruction when it names none.
  // We never invent a turn or distance the backend didn't give. Landmarks are reworded for DISPLAY only.
  const toward = step ? prettifyLandmark(headingToward(step.instruction), roomLabels[step.node]) : ''
  const nextStep = steps[i + 1]
  const nextKind = nextStep ? stepKind(nextStep.instruction) : null
  const nextToward = nextStep ? prettifyLandmark(headingToward(nextStep.instruction), roomLabels[nextStep.node]) : ''
  const vertical = !arrived && isVertical(kind)
  const badge = vertical ? floorBadge(step.instruction) : null
  const stairDir = vertical ? verticalDir(step.node, step.instruction) : ''
  const levelName = badge ? floorName(badge === 'B1' ? -1 : Number(badge)) : ''
  const move = vertical ? moveLabel(kind, levelName) : kind ? moveLabel(kind) : ''
  const detail = vertical
    ? prettifyLandmark(step.instruction, roomLabels[step.node])
    : toward ? `toward ${toward}` : (step ? prettifyLandmark(step.instruction, roomLabels[step.node]) : '')

  // The floor you're on, drawn as your own path (lib/legs.js, components/RoutePath.jsx):
  // the leg holding this step. Older backends send no legs; then it's words only.
  const legs = usableLegs(data)
  const groups = legs ? stepsByLeg(steps, stepKind, legs.length) : null
  let legIndex = 0
  if (groups) { let seen = 0; legIndex = groups.findIndex((g) => (seen += g.length) > i); if (legIndex < 0) legIndex = groups.length - 1 }
  const leg = groups ? legs[legIndex] : null

  if (arrived) {
    return (
      <main className="rise flex flex-1 flex-col">
        <div className="mt-2 flex items-center gap-4 rounded-3xl bg-fg px-5 py-5 text-ink shadow-[var(--shadow-float)]">
          <Icon name="flag" size={34} strokeWidth={2.2} />
          <div><p className="font-display text-[24px] font-bold leading-tight">You’ve arrived</p><p className="text-[15px] text-ink/65">{destText}</p></div>
        </div>
        <Sheet className="items-center text-center">
          <PawBurst size={72} className="mt-4" />
          <p className="font-display mt-4 text-[26px] font-bold">{destText}. Good dog.</p>
          <p className="mt-1 text-[15px] text-dim">{Math.round(data.total_meters)} m walked{accessible ? ' · elevators only' : ''}</p>
          <Button onClick={onRestart} className="mt-6 w-full">Find another room</Button>
          <TextAction onClick={() => go(steps.length - 1)} className="mt-1">See the last step again</TextAction>
        </Sheet>
      </main>
    )
  }

  const arrowOf = (k, dir) => (isVertical(k) ? (dir === 'up' ? 'up' : dir === 'down' ? 'down' : k) : k)
  const label = (st) => {
    const kd = stepKind(st.instruction)
    const t = prettifyLandmark(headingToward(st.instruction), roomLabels[st.node])
    return { kd, title: isVertical(kd) ? moveLabel(kd, '') : moveLabel(kd), sub: isVertical(kd) ? prettifyLandmark(st.instruction, roomLabels[st.node]) : (t ? `toward ${t.toLowerCase()}` : '') }
  }
  const floorsOnRoute = [...new Set(steps.map((st) => stepFloorName(st.node)).filter(Boolean))]
  // A typed starting room reads as "Room 263"; a matched spot uses its place name.
  const fromText = /^[a-z]?\d+[a-z]?$/i.test(String(from)) ? `Room ${String(from).toUpperCase()}` : (spotName(from, roomLabels) || from)

  return (
    <main className="rise flex flex-1 flex-col">
      <div className="relative flex min-h-[56px] items-center justify-center">
        <button onClick={onRestart} aria-label="Exit route" className={`lg absolute left-0 flex h-11 w-11 items-center justify-center rounded-full ${focusRing}`}><Icon name="back" size={22} /></button>
        <h1 className="font-display px-12 text-center text-[26px] font-bold leading-tight">To {destText}</h1>
      </div>

      {/* Summary card: your photo, where you started, distance and time. */}
      <section className="glass mt-3 overflow-hidden rounded-[26px]">
        <div className="flex items-center gap-4 p-3">
          {photo?.url
            ? <img src={photo.url} alt="Your hallway photo" className="h-[88px] w-[104px] shrink-0 rounded-2xl object-cover" />
            : <span className="flex h-[88px] w-[104px] shrink-0 items-center justify-center rounded-2xl bg-fg/10"><Icon name="door" size={30} /></span>}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">Destination</p>
            <p className="font-display truncate text-[22px] font-bold leading-tight">{destText}</p>
            <p className="truncate text-[13px] text-dim">From {fromText}</p>
            <p className="mt-1 text-[13px] tabular-nums"><span key={remaining} className="value-in">{remaining} m</span> · about {mins} min</p>
          </div>
        </div>
        {/* The route, outlined while you walk it: done steps solid, this step outlined, the rest faint. */}
        <div className="flex items-center gap-1.5 px-3 pb-3" role="img" aria-label={`Route: step ${i + 1} of ${steps.length} to ${destText}`}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-fg" />
          {steps.map((_, k) => (
            <span key={k} className={`relative h-2 flex-1 overflow-hidden rounded-full ${k < i ? 'bg-fg' : k === i ? 'ring-[1.5px] ring-fg' : 'ring-1 ring-fg/25'}`}>
              {k === i && <span className="route-now absolute inset-y-0 left-0 rounded-full bg-fg/70" />}
            </span>
          ))}
          <Icon name="flag" size={15} className="shrink-0" />
        </div>
        <div className="flex items-center gap-2 border-t border-fg/10 px-3 py-2.5">
          {floorsOnRoute.map((f) => <span key={f} className="rounded-full bg-fg/10 px-2.5 py-1 text-[12px] font-medium">{f}</span>)}
          {accessible && <span className="inline-flex items-center gap-1 rounded-full bg-fg/10 px-2.5 py-1 text-[12px] font-medium"><Icon name="elevator" size={13} />Elevators only</span>}
          <button onClick={onRestart} className={`lg ml-auto h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold ${focusRing}`}>Snap again</button>
        </div>
      </section>

      {/* The move to make now. Tap it when you get there. */}
      <button key={i} type="button" onClick={() => go(i + 1)} aria-label={`Now: ${move}. ${detail}. Tap when you’re there.`}
        className={`${stepAnim} lg-bright mt-3 flex items-center gap-4 rounded-[26px] p-4 text-left ${focusRing}`}>
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-ink text-fg ${reduced ? '' : 'arrow-nudge'}`} style={NUDGE[vertical ? (stairDir || kind) : kind] || {}} role="img" aria-label={arrowAria(kind)}>
          <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{glyph(arrowOf(kind, stairDir))}</svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink/50">Now · step {i + 1} of {steps.length}</span>
          <span className="font-display block text-[23px] font-bold leading-tight text-ink">{move}</span>
          {detail && <span className="block text-[14px] leading-snug text-ink/65">{detail}</span>}
        </span>
        {step.meters > 0 && <span className="shrink-0 text-[16px] font-bold tabular-nums text-ink">{Math.max(1, Math.round(step.meters))} m</span>}
      </button>

      {vertical && (
        <section className="glass mt-3 flex items-center gap-6 rounded-[26px] px-6 py-5">
          <ElevatorTrack from={floorMark(floorOf(step.node).code)} to={badge === 'B1' ? 'LL' : badge} dir={stairDir} />
          <div>
            <p className="text-[14px] text-dim">{stairDir === 'down' ? 'Going down to' : stairDir === 'up' ? 'Going up to' : 'Change to'}</p>
            <p className="font-display text-[30px] font-bold leading-tight">{levelName || 'next floor'}</p>
          </div>
        </section>
      )}

      {leg && (
        <section key={`leg${legIndex}`} className={`${stepAnim} glass mt-3 rounded-[26px] p-4`} aria-labelledby="leg-title">
          <div className="flex items-baseline justify-between gap-3">
            <p id="leg-title" className="font-display text-[18px] font-bold">{floorName(leg.floor)}</p>
            {legs.length > 1 && <p className="text-[13px] text-dim">Part {legIndex + 1} of {legs.length}</p>}
          </div>
          <div className="mt-3 flex justify-center">
            <RoutePath points={leg.points} exitMode={leg.exit?.mode} endLabel={(destText.match(/\b(B?\d{2,3}[A-Z]?)\b/) || [])[1] || ''}
              label={leg.exit
                ? `Your path on ${floorName(leg.floor)}, from you to the ${leg.exit.mode === 'stairs' ? 'stairs' : 'elevator'}.`
                : `Your path on ${floorName(leg.floor)}, from you to ${destText}.`} />
          </div>
          <p className="mt-3 flex items-center gap-2 text-[14px] font-semibold">
            <Icon name={leg.exit ? 'elevator' : 'flag'} size={17} />
            {leg.exit ? exitLabel(leg.exit) : `Follow the line to ${destText}`}
          </p>
        </section>
      )}

      {/* The whole trip as a timeline, markers down the left. */}
      <ol className="mt-5" aria-label="Directions">
        {[{ marker: 'Start', title: fromText, sub: 'Where you are now', icon: 'pin', state: 'done' },
          ...steps.map((st, k) => { const l = label(st); return { marker: String(k + 1), title: l.title, sub: [l.sub, st.meters > 0 ? `${Math.max(1, Math.round(st.meters))} m` : ''].filter(Boolean).join(' · '), glyphKind: l.kd, k, state: k < i ? 'done' : k === i ? 'now' : 'next' } }),
          { marker: 'End', title: destText, sub: floorsOnRoute[floorsOnRoute.length - 1] || '', icon: 'flag', state: 'next' }]
          .map((row, n, all) => (
          <li key={n} className="flex gap-3">
            <div className="flex w-11 shrink-0 flex-col items-center">
              <span className={`text-[11px] font-semibold ${row.state === 'now' ? 'text-fg' : 'text-dim'}`}>{row.marker === 'Start' || row.marker === 'End' ? row.marker : 'Step'}</span>
              <span className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-[14px] font-bold tabular-nums ${row.state === 'now' ? 'bg-fg text-ink' : 'bg-fg/10'}`}>
                {row.marker === 'Start' || row.marker === 'End' ? <Icon name={row.icon} size={15} /> : row.marker}
              </span>
              {n < all.length - 1 && <span aria-hidden className={`mt-1 w-px flex-1 ${row.state === 'done' ? 'bg-fg/60' : 'bg-fg/15'}`} />}
            </div>
            <button type="button" disabled={row.k === undefined} onClick={() => row.k !== undefined && go(row.k)}
              className={`glass mb-3 flex min-h-[64px] flex-1 items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-opacity ${row.state === 'now' ? 'ring-2 ring-fg' : row.state === 'done' ? 'opacity-55' : ''} ${focusRing}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fg/10">
                {row.glyphKind
                  ? <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{glyph(row.glyphKind)}</svg>
                  : <Icon name={row.icon} size={19} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{row.title}</span>
                {row.sub && <span className="block text-[13px] text-dim">{row.sub}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="h-36" aria-hidden />

      {/* Trip sheet: time, distance, and the controls. */}
      <BottomBar>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-[22px] font-bold leading-tight text-fg tabular-nums" aria-live="polite">
              <span key={mins} className="value-in">{mins} min</span>
            </p>
            <p className="truncate text-[14px] text-dim tabular-nums">
              <span key={remaining} className="value-in value-in-late">{remaining} m</span> · {floorHere ? `${floorHere} · ` : ''}Arrive {destText}{accessible ? ' · Elevators only' : ''}
            </p>
          </div>
          <button onClick={() => go(Math.max(0, i - 1))} disabled={i === 0} aria-label="Previous step"
            className={`lg flex h-12 w-12 shrink-0 items-center justify-center rounded-full disabled:opacity-35 ${focusRing}`}><Icon name="back" size={22} /></button>
        </div>
        <div className="mt-2 grid grid-cols-[1fr_2fr] gap-2">
          <Button variant="secondary" onClick={onRestart}>Exit</Button>
          <Button onClick={() => go(i + 1)}>{i === steps.length - 1 ? 'I’m here' : vertical ? 'Done' : 'Next'}</Button>
        </div>
      </BottomBar>
    </main>
  )
}

const NUDGE = {
  left: { '--nudge-x': '-4px' }, right: { '--nudge-x': '4px' },
  up: { '--nudge-y': '-4px' }, down: { '--nudge-y': '4px' },
  continue: { '--nudge-y': '-4px' }, walk: { '--nudge-y': '-4px' },
  around: { '--nudge-y': '-3px' },
}

// Vertical track between two floors; the car slides from one to the other.
function ElevatorTrack({ from, to, dir }) {
  const down = dir === 'down'
  return (
    <div className="relative h-28 w-10 shrink-0" aria-hidden>
      <span className="absolute left-1/2 top-3 bottom-3 w-1 -translate-x-1/2 rounded-full bg-edge" />
      <span className="absolute -left-5 top-1 text-[13px] font-bold text-dim">{down ? from : to}</span>
      <span className="absolute -left-5 bottom-1 text-[13px] font-bold text-dim">{down ? to : from}</span>
      <span className="elevator-car absolute left-1/2 h-7 w-7 -translate-x-1/2 rounded-full border-[3px] border-fg bg-fg shadow-[var(--shadow-float)]"
        style={{ '--car-from': down ? '0px' : 'calc(100% - 28px)', '--car-to': down ? 'calc(100% - 28px)' : '0px' }} />
    </div>
  )
}

// Arrow glyphs for each move. RELATIVE turns only (left/right/straight/around/up/down),
// never a device compass: the app has a hard no-sensors rule.
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
