import { useState } from 'react'
import Snap from './screens/Snap.jsx'
import Locating from './screens/Locating.jsx'
import Confirm from './screens/Confirm.jsx'
import Route from './screens/Route.jsx'
import { MOCK } from './api.js'

// Four screens: Snap → Locating → Confirm ("Right spot?") → Route (one step at a time).
export default function App() {
  const [screen, setScreen] = useState('snap')
  const [dest, setDest] = useState('164')
  const [accessible, setAccessible] = useState(false)
  const [photo, setPhoto] = useState(null) // { blob, url }
  const [loc, setLoc] = useState(null) // /locate response
  const [here, setHere] = useState(null) // confirmed spot
  const [toast, setToast] = useState('')

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2600) }

  const restart = () => {
    if (photo?.url) URL.revokeObjectURL(photo.url) // drop the local preview; nothing is kept
    setPhoto(null); setLoc(null); setHere(null); setScreen('snap')
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      {MOCK && (
        <div className="mb-2 self-center rounded-full bg-ink/5 px-3 py-1 text-[11px] font-medium text-muted">
          Demo data · backend not connected
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
            if (learned) flash('Got it. Hound Around just learned from you.')
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
        <div className="rise fixed inset-x-4 bottom-6 mx-auto max-w-sm rounded-2xl bg-ink px-4 py-3 text-center text-sm font-medium text-paper shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
