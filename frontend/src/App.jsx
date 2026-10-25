import { useCallback, useEffect, useMemo, useState } from 'react'
import Snap from './screens/Snap.jsx'
import Locating from './screens/Locating.jsx'
import Confirm from './screens/Confirm.jsx'
import SecondPhoto from './screens/SecondPhoto.jsx'
import { nextStep } from './lib/tiers.js'
import { spotName } from './lib/spots.js'
import Route from './screens/Route.jsx'
import PawBurst from './components/PawBurst.jsx'
import ManualStart from './screens/ManualStart.jsx'
import { createApi } from './api.js'
import { buildingConfig } from './lib/campuses.js'
import CampusPicker from './screens/CampusPicker.jsx'
import Intro from './components/Intro.jsx'

// Read ?to=164 so a QR code on the demo slide can pre-fill the destination.
function initialDest(fallback) {
  if (typeof window === 'undefined') return fallback
  const to = new URLSearchParams(window.location.search).get('to')
  return to && to.trim() ? to.trim() : fallback
}

// The opening plays once per browser session (storage can be blocked, in which
// case it simply plays again).
const OPENING_KEY = 'hound-opening-seen'
function openingSeen() { try { return sessionStorage.getItem(OPENING_KEY) === '1' } catch { return false } }

// Snap → Locating → (second photo) → Confirm or picker → Route, one step at a time.
export default function App() {
  const env = import.meta.env || {}
  const [selection, setSelection] = useState({ school: 'bu', building: 'cds' })
  const [choosing, setChoosing] = useState(false)
  const building = buildingConfig(selection.school, selection.building, env)
  const api = useMemo(() => createApi(building?.apiBase || ''), [building?.apiBase])
  // The logo intro plays over whatever screen opens first.
  const [intro, setIntro] = useState(() => !openingSeen())
  const endIntro = useCallback(() => { setIntro(false); try { sessionStorage.setItem(OPENING_KEY, '1') } catch { /* plays again next time */ } }, [])
  const splash = intro && <Intro onDone={endIntro} />
  if (choosing || !building?.available) {
    return <>{splash}<CampusPicker current={building || { schoolId: 'bu' }} env={env}
      onCancel={() => setChoosing(false)}
      onSelect={(school, id) => { setSelection({ school, building: id }); setChoosing(false) }} /></>
  }
  return <>{splash}<Navigation key={`${selection.school}:${selection.building}`} api={api} building={building}
    onSchoolChange={() => setChoosing(true)} /></>
}

function Navigation({ api, building, onSchoolChange }) {
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
  const [toast, setToast] = useState(null) // { msg, celebrate }

  // Server status from GET /health: 'checking' | 'waking' (reachable, model still loading) | 'ok' | 'down'.
  const [server, setServer] = useState(MOCK ? 'ok' : 'checking')
  const [model, setModel] = useState('')

  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url) }, [photo?.url])

  const flash = (msg, celebrate = false) => { setToast({ msg, celebrate }); setTimeout(() => setToast(null), 2600) }

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

  // `from` is where the home building drawing sat on screen, so the manual locator
  // can grow out of it. Buttons elsewhere pass a click event, which is ignored.
  const [flyFrom, setFlyFrom] = useState(null)
  const chooseStart = (from) => {
    if (photo?.url) URL.revokeObjectURL(photo.url)
    setFlyFrom(from && Number.isFinite(from.w) ? from : null)
    window.scrollTo(0, 0)
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

  const statusPill =
    MOCK ? { tone: 'muted', text: 'Demo data · backend not connected' }
    : server === 'checking' ? { tone: 'muted', text: 'Connecting to Hound Around…', live: true }
    : server === 'waking' ? { tone: 'muted', text: 'Server waking up, about 30 s…', live: true }
    : server === 'down' ? { tone: 'muted', text: 'Can’t reach the server right now' }
    : model.startsWith('stub') ? { tone: 'alert', text: 'Test backend · not real recognition' }
    : null

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col px-5 pt-[max(.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      {statusPill && (
        <div role="status" className={`mx-auto mb-1 flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${statusPill.tone === 'alert' ? 'bg-tint text-rose' : 'bg-card text-dim shadow-[0_1px_0_rgb(255_255_255/.04)_inset]'}`}>
          {statusPill.live && <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-fg" />}
          {statusPill.text}
        </div>
      )}

      {screen === 'snap' && (
        <Snap
          dest={dest} setDest={setDest}
          accessible={accessible} setAccessible={setAccessible}
          onPhoto={(p) => { setPhoto(p); setScreen('locating') }}
          onManual={chooseStart}
          destinations={building.destinations}
          destinationGroups={building.destinationGroups}
          resolvePlace={building.resolvePlace}
          roomLabels={building.roomLabels}
          buildingLabel={building.shortName || building.name}
          building={building}
          schoolName={building.schoolName}
          onSchoolChange={onSchoolChange}
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
              flash(size ? `Thanks, it learned that. ${size} frames indexed.` : 'Thanks, it learned that.', true)
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
        <ManualStart dest={building.resolvePlace(dest)} accessible={accessible} roomLabels={building.roomLabels}
          floors={building.floors} groups={building.destinationGroups} flyFrom={flyFrom}
          onCancel={restart} onStart={(start) => { setHere(start); setScreen('route') }} />
      )}
      {screen === 'route' && autoPicked && (
        // Auto-picked without a tap: one obvious way out if it's wrong.
        <p className="rise mt-2 flex items-center justify-between gap-3 rounded-2xl border border-edge bg-card px-4 py-2.5 text-[14px]">
          <span className="min-w-0 text-dim">Matched to <span className="font-semibold text-fg">{spotName(here, building.roomLabels)}</span></span>
          <button onClick={pickInstead} className="min-h-[36px] shrink-0 font-semibold underline underline-offset-[3px]">Not here?</button>
        </p>
      )}
      {screen === 'route' && (
        <Route
          from={here} heading={here === loc?.spot ? loc?.heading : undefined} photo={here === loc?.spot ? photo : null}
          dest={dest} accessible={accessible}
          onRestart={restart}
          api={api}
          resolvePlace={building.resolvePlace}
          roomLabels={building.roomLabels}
        />
      )}

      {toast && (
        <div role="status" className="rise fixed inset-x-4 top-[max(.75rem,env(safe-area-inset-top))] z-30 mx-auto flex max-w-sm items-center gap-3 rounded-lg border border-edge bg-raise px-4 py-3 text-left text-[14px] text-fg shadow-[var(--shadow-float)]">
          {toast.celebrate && <PawBurst size={30} className="shrink-0" />}
          <span className="flex-1">{toast.msg}</span>
        </div>
      )}
    </div>
  )
}
