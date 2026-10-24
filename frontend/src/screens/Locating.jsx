import { useEffect, useState } from 'react'
import { locate } from '../api.js'

export default function Locating({ photo, onDone, onCancel }) {
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
    locate(photo.blob, { signal: controller.signal })
      .then((r) => { if (live) onDone(r) })
      .catch((e) => {
        // Aborts come from retake/unmount only; that path unmounts us, so ignore it.
        if (!live || e?.name === 'AbortError') return
        setError(e?.message || 'That took too long. Tap to try again.')
      })

    return () => {
      live = false
      clearTimeout(stageTimer)
      controller.abort() // never surface a stale result after retake/unmount
    }
  }, [attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="rise flex flex-1 flex-col">
      <div className="relative mt-4 aspect-[3/4] w-full overflow-hidden rounded-3xl bg-ink">
        <img src={photo.url} alt="Your hallway photo" className="h-full w-full object-cover opacity-80" />
        {!error && <div className="scan-line absolute inset-x-0 h-1 bg-scarlet shadow-[0_0_24px_6px_rgba(204,0,0,.55)]" />}
      </div>

      {!error ? (
        <div className="mt-8 text-center">
          <p className="font-display text-2xl font-bold">
            <span className="sniff inline-block">🐾</span> {stage === 'sending' ? 'Sending…' : 'Matching…'}
          </p>
          <p className="mt-2 text-muted">
            {stage === 'sending'
              ? 'Uploading your photo.'
              : 'Comparing your photo to thousands of CDS hallway frames.'}
          </p>
        </div>
      ) : (
        <div className="mt-8 text-center">
          <p className="font-display text-2xl font-bold">Hmm, no match yet</p>
          <p className="mt-2 break-words text-sm text-muted">{error}</p>
          <button onClick={() => setAttempt((a) => a + 1)} className="mt-6 min-h-[44px] w-full rounded-2xl bg-scarlet py-4 font-semibold text-white">Try again</button>
        </div>
      )}

      <button onClick={onCancel} className="mt-auto min-h-[44px] py-4 text-sm font-medium text-muted">Retake photo</button>
    </main>
  )
}
