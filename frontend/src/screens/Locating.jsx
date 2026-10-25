import { useEffect, useState } from 'react'
import { locate } from '../api.js'
import Icon from '../components/Icon.jsx'
import PhotoLoader from '../components/PhotoLoader.jsx'
import { Button, Sheet, TextAction, TopBar } from '../components/ui.jsx'

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

  const unknown = error?.code === 'unrecognized_location'
  if (!error) {
    return (
      <PhotoLoader photoUrl={photo.url} flash={false}
        title={stage === 'sending' ? 'Sending your photo…' : 'Finding your spot…'}
        detail={stage === 'sending' ? 'Uploading it now. It’s deleted right after matching.' : `Comparing it to hallway views in ${buildingLabel}.`}
        steps={[
          { label: 'Photo ready', state: 'done' },
          { label: 'Photo sent', state: stage === 'sending' ? 'now' : 'done' },
          { label: 'Matching hallway views', state: stage === 'matching' ? 'now' : 'todo' },
        ]} />
    )
  }
  return (
    <main className="rise flex flex-1 flex-col">
      <TopBar onBack={onCancel} backLabel="Cancel and retake photo" title={error ? '' : 'Finding your spot'} />
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-edge shadow-[var(--shadow-float)]">
        <img src={photo.url} alt="Your hallway photo" className="h-full w-full object-cover" />
        {!error && <div className="scan-line absolute inset-x-0 h-0.5 bg-white shadow-[0_0_0_1px_rgb(204_0_0/.8)]" />}
      </div>

      <Sheet>
        {!error ? (
          <div role="status">
            <div className="relative -mx-5 -mt-5 mb-5 h-1 overflow-hidden rounded-t-[28px] bg-tint"><span className="progress-bar rounded-full bg-fg" /></div>
            <p className="font-display text-[22px] font-bold">{stage === 'sending' ? 'Sending your photo…' : 'Matching…'}</p>
            <p className="mt-1 text-[15px] text-dim">
              {stage === 'sending' ? 'Uploading your photo.' : `Comparing your photo to hallway views in ${buildingLabel}.`}
            </p>
            <ul className="mt-5 space-y-3 text-[15px]">
              <li className="flex items-center gap-3">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${stage === 'sending' ? 'bg-tint' : 'bg-fg text-ink'}`}>
                  {stage === 'sending' ? <span className="pulse-soft h-2 w-2 rounded-full bg-fg" aria-hidden /> : <Icon name="check" size={16} strokeWidth={2.6} />}
                </span>
                <span>Photo sent</span>
              </li>
              <li className="flex items-center gap-3">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${stage === 'matching' ? 'bg-tint' : 'bg-raise'}`}>
                  <span className={`h-2 w-2 rounded-full ${stage === 'matching' ? 'pulse-soft bg-fg' : 'bg-faint'}`} aria-hidden />
                </span>
                <span className={stage === 'matching' ? '' : 'text-dim'}>Finding your spot</span>
              </li>
            </ul>
          </div>
        ) : (
          <div>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-tint text-rose"><Icon name="pin" size={22} /></span>
            <p className="font-display mt-4 text-balance text-[22px] font-bold">{unknown ? 'We don’t recognize this spot' : 'Hmm, no match yet'}</p>
            <p role="alert" className="mt-1 break-words text-[15px] text-dim">{error.message || 'Please try another photo.'}</p>
            <div className="mt-5 flex flex-col gap-2">
              <Button onClick={unknown ? onCancel : () => setAttempt((a) => a + 1)} className="w-full">{unknown ? 'Take another photo' : 'Try again'}</Button>
              <Button variant="secondary" onClick={onManual} className="w-full">Use the manual locator</Button>
              {!unknown && <TextAction onClick={onCancel} className="self-center">Retake photo</TextAction>}
            </div>
          </div>
        )}
      </Sheet>
    </main>
  )
}
