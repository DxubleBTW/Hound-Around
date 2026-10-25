import { useEffect, useMemo, useState } from 'react'
import Snap from './screens/Snap.jsx'
import Locating from './screens/Locating.jsx'
import Confirm from './screens/Confirm.jsx'
import SecondPhoto from './screens/SecondPhoto.jsx'
import { nextStep } from './lib/tiers.js'
import { spotName } from './lib/spots.js'
import Route from './screens/Route.jsx'
import PawBurst from './components/PawBurst.jsx'
import Paw from './components/Paw.jsx'
import StepLine from './components/StepLine.jsx'
import Opening, { shouldShowOpening } from './components/Opening.jsx'
import ManualStart from './screens/ManualStart.jsx'
import { createApi } from './api.js'
import { buildingConfig } from './lib/campuses.js'
import { motionPaused, setMotionPaused } from './lib/motion.js'
import CampusPicker from './screens/CampusPicker.jsx'

// Read ?to=164 so a QR code on the demo slide can pre-fill the destination.
function initialDest(fallback) {
  if (typeof window === 'undefined') return fallback
  const to = new URLSearchParams(window.location.search).get('to')
  return to && to.trim() ? to.trim() : fallback
}

// Which station of the step line each screen sits at. Manual start skips the line.
const STEP_OF = { snap: 0, locating: 1, second: 1, confirm: 2, route: 3 }

// Four screens: Snap → Locating → Confirm ("Right spot?") → Route (one step at a time).
export default function App() {
  const env = import.meta.env || {}
  const [selection, setSelection] = useState({ school: 'bu', building: 'cds' })
  const [choosing, setChoosing] = useState(false)
  const [opening, setOpening] = useState(shouldShowOpening)
  const [paused, setPaused] = useState(motionPaused)
  const building = buildingConfig(selection.school, selection.building, env)
  const api = useMemo(() => createApi(building?.apiBase || ''), [building?.apiBase])

  useEffect(() => { setMotionPaused(paused) }, [paused])
  const motion = { paused, toggle: () => setPaused((p) => !p) }

  let body
  if (choosing || !building?.available) {
    body = <CampusPicker current={building || { schoolId: 'bu' }} env={env}
      onCancel={() => setChoosing(false)}
      onSelect={(school, id) => { setSelection({ school, building: id }); setChoosing(false) }} />
  } else {
    body = <Navigation key={`${selection.school}:${selection.building}`} api={api} building={building}
      motion={motion} onSchoolChange={() => setChoosing(true)} />
  }
  return (
    <>
      {body}
      {opening && <Opening onDone={() => setOpening(false)} />}
    </>
  )
}

function Navigation({ api, building, motion, onSchoolChange }) {
  const { MOCK, health } = api
  const [screen, setScreen] = useState('snap')
  const [dest, setDest] = useState(() => {
    const fallback = building.destinations[0]?.value || ''
    return building.schoolId === 'bu' && building.id === 'cds' ? initialDest(fallback) : fallback
  })
  const [accessible, setAccessible] = useState(false)
  const [photo, setPhoto] = useState(null) // { blob, url }
  const [loc, setLoc] = useState(null) // /locate response
  const [here, setHere] = useState(null) // confirmed spot
  const [firstLoc, setFirstLoc] = useState(null) // first photo's answer while the second is matched
  const [confirmMode, setConfirmMode] = useState('confirm') // lib/tiers.js
  const [autoPicked, setAutoPicked] = useState(false) // route started without a confirm tap
  const [toast, setToast] = useState(null) // { msg, detail, celebrate }

  // Server status from GET /health: 'checking' | 'waking' (reachable, model still loading) | 'ok' | 'down'.
  const [server, setServer] = useState(MOCK ? 'ok' : 'checking')
  const [model, setModel] = useState('')

  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url) }, [photo?.url])

  const flash = (msg, detail = '', celebrate = false) => { setToast({ msg, detail, celebrate }); setTimeout(() => setToast(null), 3200) }

  // Hugging Face Spaces sleep when idle; the first request wakes them. Poll /health until ready (max ~2 min).
  useEffect(() => {
    if (MOCK) return
    let live = true
    let timer
    let tries = 0
    const check = async () => {
      const h = await health()
      if (!live) return
      setModel(h.model)
      if (h.ok) return setServer('ok')
      setServer(h.reachable ? 'waking' : 'down')
      if (++tries < 24) timer = setTimeout(check, 5000)
    }
    check()
    return () => { live = false; clearTimeout(timer) }
  }, [MOCK, health])

  const restart = () => {
    if (photo?.url) URL.revokeObjectURL(photo.url) // drop the local preview; nothing is kept
    setPhoto(null); setLoc(null); setHere(null); setFirstLoc(null); setAutoPicked(false); setScreen('snap')
  }

  const chooseStart = () => {
    if (photo?.url) URL.revokeObjectURL(photo.url)
    setPhoto(null); setLoc(null); setHere(null); setFirstLoc(null); setAutoPicked(false); setScreen('manual')
  }

  // Calibrated tiers: sure -> straight to the route; unsure -> one more photo
  // facing the other way; in between (or after the second photo) -> pick.
  const located = (r) => {
    const step = nextStep(r, { fused: !!firstLoc })
    setLoc(r)
    if (step === 'auto') { setHere(r.spot); setAutoPicked(true); setScreen('route') }
    else if (step === 'second') setScreen('second')
    else { setConfirmMode(step); setScreen('confirm') }
  }

  const pickInstead = () => { setAutoPicked(false); setConfirmMode('picker'); setScreen('confirm') }

  const status =
    MOCK ? { text: 'Demo data. The backend isn’t connected.' }
    : server === 'checking' ? { text: 'Connecting to Hound Around…', live: true }
    : server === 'waking' ? { text: 'The server is waking up. About 30 seconds.', live: true }
    : server === 'down' ? { text: 'Can’t reach the server right now. Try again in a minute.' }
    : model.startsWith('stub') ? { text: 'Test backend. This isn’t real recognition.' }
    : null

  const step = STEP_OF[screen]

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Paw size={22} color="#FFFFFF" />
            <span className="font-display text-xl font-semibold leading-none">Hound Around</span>
          </div>
          <button onClick={onSchoolChange}
            className="flex min-h-[36px] items-center text-left text-sm text-mist underline decoration-rule underline-offset-[3px] hover:text-snow">
            In {building.shortName || building.name}, {building.schoolName}
          </button>
        </div>
        <button type="button" onClick={motion.toggle} aria-pressed={motion.paused}
          aria-label={motion.paused ? 'Play motion' : 'Pause motion'}
          className="press -mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-sm text-snow hover:bg-panel">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            {motion.paused ? <path d="M8 5.5v13l10-6.5z" fill="currentColor" /> : <path d="M9 6v12M15 6v12" />}
          </svg>
        </button>
      </header>

      {status && (
        <p role="status" className="mt-1 flex items-center gap-2 text-sm text-mist">
          {status.live && <span aria-hidden className="breathe inline-block h-2 w-2 rounded-full bg-snow" />}
          {status.text}
        </p>
      )}

      {step !== undefined && <div className="mt-5"><StepLine current={step} /></div>}

      <div key={screen} className="enter flex flex-1 flex-col">
        {screen === 'snap' && (
          <Snap
            dest={dest} setDest={setDest}
            accessible={accessible} setAccessible={setAccessible}
            onPhoto={(p) => { setPhoto(p); setScreen('locating') }}
            onManual={chooseStart}
            destinations={building.destinations}
            destinationGroups={building.destinationGroups}
            resolvePlace={building.resolvePlace}
          />
        )}
        {screen === 'locating' && (
          <Locating
            photo={photo}
            previous={firstLoc?.photo_id}
            onDone={located}
            onCancel={restart}
            onManual={chooseStart}
            api={api}
            buildingLabel={building.shortName || building.name}
          />
        )}
        {screen === 'second' && (
          <SecondPhoto
            photo={photo}
            onPhoto={(p) => { setFirstLoc(loc); setPhoto(p); setScreen('locating') }}
            onSkip={() => { setConfirmMode('picker'); setScreen('confirm') }}
            onManual={chooseStart}
          />
        )}
        {screen === 'confirm' && (
          <Confirm
            photo={photo} loc={loc} mode={confirmMode} fused={!!firstLoc}
            onConfirm={(spot, learned) => {
              setHere(spot)
              if (learned) {
                const size = Number.isFinite(learned) ? learned : null
                flash('Got it. The next person here gets it right.', size ? `Hallway views: ${size.toLocaleString()}` : '', true)
              }
              setScreen('route')
            }}
            onRetake={restart}
            onManual={chooseStart}
            api={api}
            buildingLabel={building.shortName || building.name}
            roomLabels={building.roomLabels}
          />
        )}
        {screen === 'manual' && (
          <ManualStart landmarks={building.landmarks} accessible={accessible} onCancel={restart} onStart={(start) => { setHere(start); setScreen('route') }} />
        )}
        {screen === 'route' && autoPicked && (
          // Auto-picked without a tap: one obvious way out if it's wrong.
          <p className="mt-4 flex items-center justify-between gap-3 rounded-sm bg-panel px-3.5 py-2.5 text-sm">
            <span className="min-w-0 text-mist">Matched to {spotName(here, building.roomLabels)}</span>
            <button onClick={pickInstead} className="min-h-[36px] shrink-0 underline underline-offset-[3px]">Not here?</button>
          </p>
        )}
        {screen === 'route' && (
          <Route
            from={here} heading={here === loc?.spot ? loc?.heading : undefined}
            dest={dest} accessible={accessible}
            onRestart={restart}
            api={api}
            resolvePlace={building.resolvePlace}
            roomLabels={building.roomLabels}
          />
        )}
      </div>

      {toast && (
        <div role="status" className="toast-in fixed inset-x-5 top-[max(1rem,env(safe-area-inset-top))] z-40 mx-auto flex max-w-sm items-center gap-3 rounded-sm bg-panel px-4 py-3.5 text-left">
          {toast.celebrate && <PawBurst size={34} className="shrink-0" />}
          <span className="flex-1">
            <span className="block font-display text-[17px] font-semibold leading-tight">{toast.msg}</span>
            {toast.detail && <span className="mt-0.5 block text-sm text-mist">{toast.detail}</span>}
          </span>
        </div>
      )}
    </div>
  )
}
