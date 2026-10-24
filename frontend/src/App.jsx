import { useEffect, useState } from 'react'
import Snap from './screens/Snap.jsx'
import Locating from './screens/Locating.jsx'
import Confirm from './screens/Confirm.jsx'
import Route from './screens/Route.jsx'
import PawBurst from './components/PawBurst.jsx'
import { MOCK, health } from './api.js'

// Read ?to=164 so a QR code on the demo slide can pre-fill the destination.
function initialDest() {
  if (typeof window === 'undefined') return '164'
  const to = new URLSearchParams(window.location.search).get('to')
  return to && to.trim() ? to.trim() : '164'
}

// Four screens: Snap → Locating → Confirm ("Right spot?") → Route (one step at a time).
export default function App() {
  const [screen, setScreen] = useState('snap')
  const [dest, setDest] = useState(initialDest)
  const [accessible, setAccessible] = useState(false)
  const [photo, setPhoto] = useState(null) // { blob, url }
  const [loc, setLoc] = useState(null) // /locate response
  const [here, setHere] = useState(null) // confirmed spot
  const [toast, setToast] = useState(null) // { msg, celebrate }

  // Server status from GET /health: 'checking' | 'waking' (reachable, model still loading) | 'ok' | 'down'.
  const [server, setServer] = useState(MOCK ? 'ok' : 'checking')
  const [model, setModel] = useState('')

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
  }, [])

  const restart = () => {
    if (photo?.url) URL.revokeObjectURL(photo.url) // drop the local preview; nothing is kept
    setPhoto(null); setLoc(null); setHere(null); setScreen('snap')
  }

  const statusPill =
    MOCK ? { tone: 'muted', text: 'Demo data · backend not connected' }
    : server === 'checking' ? { tone: 'muted', text: 'Connecting to Hound Around…', live: true }
    : server === 'waking' ? { tone: 'muted', text: 'Server waking up, about 30 s…', live: true }
    : server === 'down' ? { tone: 'muted', text: 'Can’t reach the server right now' }
    : model.startsWith('stub') ? { tone: 'alert', text: 'Test backend · not real recognition' }
    : null

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      {statusPill && (
        <div
          role="status"
          className={`mb-2 flex items-center gap-1.5 self-center rounded-full px-3 py-1 text-[11px] font-medium ${
            statusPill.tone === 'alert' ? 'bg-scarlet/10 text-scarlet' : 'bg-ink/5 text-muted'
          }`}
        >
          {statusPill.live && <span className="pulse-soft inline-block h-1.5 w-1.5 rounded-full bg-scarlet" />}
          {statusPill.text}
        </div>
      )}

      {screen === 'snap' && (
        <Snap
          dest={dest} setDest={setDest}
          accessible={accessible} setAccessible={setAccessible}
          onPhoto={(p) => { setPhoto(p); setScreen('locating') }}
        />
      )}
      {screen === 'locating' && (
        <Locating
          photo={photo}
          onDone={(r) => { setLoc(r); setScreen('confirm') }}
          onCancel={restart}
        />
      )}
      {screen === 'confirm' && (
        <Confirm
          photo={photo} loc={loc}
          onConfirm={(spot, learned) => {
            setHere(spot)
            if (learned) {
              const size = Number.isFinite(learned) ? learned : null
              flash(size ? `Thanks, it learned that. ${size} frames indexed.` : 'Thanks, it learned that.', true)
            }
            setScreen('route')
          }}
          onRetake={restart}
        />
      )}
      {screen === 'route' && (
        <Route
          from={here} heading={here === loc?.spot ? loc?.heading : undefined}
          dest={dest} accessible={accessible}
          onRestart={restart}
        />
      )}

      {toast && (
        <div className="rise fixed inset-x-4 bottom-6 mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-left text-sm font-medium text-paper shadow-[0_18px_40px_-12px_rgba(26,20,20,.6)]">
          {toast.celebrate && <PawBurst size={34} className="shrink-0" />}
          <span className="flex-1">{toast.msg}</span>
        </div>
      )}
    </div>
  )
}
