import { useEffect, useState } from 'react'
import { locate } from '../api.js'

// Two plain frames behind the photo give the stack its depth. They are not
// matched images: only the user's own photo is ever shown.
const STACK = [
  { '--r': '-6deg', '--sx': '-44px', '--sy': '30px', '--sr': '-18deg', background: '#1F1F1F' },
  { '--r': '5deg', '--sx': '46px', '--sy': '24px', '--sr': '16deg', background: '#2A2A2A', animationDelay: '60ms' },
]

export default function Locating({ photo, onDone, onCancel, onManual, api, buildingLabel = 'the selected building' }) {
  const [error, setError] = useState('')
  const [stage, setStage] = useState('sending') // 'sending' -> 'matching'
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setError('')
    setStage('sending')

    // Flip to "Matching…" once the upload has had a moment to leave the device.
    const stageTimer = setTimeout(() => live && setStage('matching'), 900)

    // requestJson enforces its own ~8s timeout and returns a friendly, retryable
    // message; we only surface it. The controller cancels the in-flight /locate on
    // retake/unmount so a stale result never lands.
    const locateRequest = api?.locate || locate
    locateRequest(photo.blob, { signal: controller.signal })
      .then((r) => { if (live) onDone(r) })
      .catch((e) => {
        // Aborts come from retake/unmount only; that path unmounts us, so ignore it.
        if (!live || e?.name === 'AbortError') return
        setError(e)
      })

    return () => {
      live = false
      clearTimeout(stageTimer)
      controller.abort() // never surface a stale result after retake/unmount
    }
  }, [photo.blob, api, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  const unrecognized = error?.code === 'unrecognized_location'

  return (
    <main className="flex flex-1 flex-col gap-6 pt-6">
      <div className="relative mx-auto aspect-[3/4] w-[58%] max-w-[230px]">
        {STACK.map((style, i) => <span key={i} aria-hidden className="settle absolute inset-0 rounded-[2px]" style={style} />)}
        <div className="settle absolute inset-0 overflow-hidden rounded-[2px] bg-panel" style={{ '--sy': '40px', animationDelay: '120ms' }}>
          <img src={photo.url} alt="Your hallway photo" className={`h-full w-full object-cover ${error ? 'opacity-50' : ''}`} />
          {!error && <span aria-hidden className="scan absolute inset-x-0 h-[2px] bg-snow/80" />}
        </div>
      </div>

      {!error ? (
        <div role="status" aria-live="polite" className="space-y-5">
          <div className="space-y-2">
            <h2 className="font-display text-[40px] font-semibold leading-none">{stage === 'sending' ? 'Sending' : 'Matching'}</h2>
            <p className="text-[17px] leading-snug text-mist">Comparing your photo with hallway views in {buildingLabel}. This usually takes a second.</p>
          </div>
          <ul className="space-y-3 text-base">
            <li className="flex items-center gap-3">
              {stage === 'sending'
                ? <span aria-hidden className="grid w-[18px] place-items-center"><span className="breathe block h-2.5 w-2.5 rounded-full bg-snow" /></span>
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="M5 12l5 5 9-10" /></svg>}
              {stage === 'sending' ? 'Sending your photo' : 'Photo sent'}
            </li>
            <li className={`flex items-center gap-3 ${stage === 'sending' ? 'text-dim' : ''}`}>
              <span aria-hidden className="grid w-[18px] place-items-center">
                {stage === 'sending'
                  ? <span className="block h-2.5 w-2.5 rounded-full border-[1.5px] border-dim" />
                  : <span className="breathe block h-2.5 w-2.5 rounded-full bg-snow" />}
              </span>
              Finding your spot
            </li>
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="font-display text-[36px] font-semibold leading-[1.02]">{unrecognized ? 'We don’t recognize this spot' : 'No match yet'}</h2>
          <p role="alert" className="break-words text-[17px] leading-snug text-mist">{error.message || 'Please try another photo.'}</p>
        </div>
      )}

      <div className="mt-auto space-y-2">
        {error && (
          <button onClick={unrecognized ? onCancel : () => setAttempt((a) => a + 1)}
            className="press min-h-[56px] w-full rounded-sm bg-snow font-display text-[19px] font-semibold text-night">
            {unrecognized ? 'Take another photo' : 'Try again'}
          </button>
        )}
        {error && (
          <button onClick={onManual} className="min-h-[44px] w-full text-base underline underline-offset-[3px]">Type the room you’re next to</button>
        )}
        {(!error || !unrecognized) && (
          <button onClick={onCancel} className="min-h-[44px] w-full text-base underline underline-offset-[3px]">{error ? 'Retake photo' : 'Cancel'}</button>
        )}
      </div>
    </main>
  )
}
