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
      <div className="relative mt-4 aspect-[3/4] w-full overflow-hidden rounded-3xl bg-ink shadow-[0_24px_50px_-20px_rgba(26,20,20,.7)]">
        <img src={photo.url} alt="Your hallway photo" className="h-full w-full object-cover opacity-80" />
        {!error && (
          <>
            {/* Dark vignette keeps the scan motif legible over any photo. */}
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-ink/30" />
            <div className="scan-line absolute inset-x-0 h-1 bg-scarlet shadow-[0_0_24px_6px_rgba(204,0,0,.55)]" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-4 text-paper">
              <span className="paw-trail inline-flex gap-1 text-lg" aria-hidden><span>🐾</span><span>🐾</span><span>🐾</span></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-paper/80">sniffing</span>
            </div>
          </>
        )}
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
          {/* Pulsing match meter: a live "working" rhythm, not a real progress value. */}
          <div className="mx-auto mt-6 flex max-w-[12rem] items-center justify-center gap-1.5" aria-hidden>
            {Array.from({ length: 7 }).map((_, i) => (
              <span
                key={i}
                className={`pulse-soft h-6 w-2 rounded-full ${stage === 'matching' ? 'bg-scarlet' : 'bg-line'}`}
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-8 text-center">
          <p className="font-display text-2xl font-bold">Hmm, no match yet</p>
          <p className="mt-2 break-words text-sm text-muted">{error}</p>
          <button onClick={() => setAttempt((a) => a + 1)} className="mt-6 min-h-[44px] w-full rounded-2xl bg-scarlet py-4 font-semibold text-white shadow-[0_12px_28px_-10px_rgba(204,0,0,.6)] transition active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">Try again</button>
        </div>
      )}

      <button onClick={onCancel} className="mt-auto min-h-[44px] py-4 text-sm font-medium text-muted">Retake photo</button>
    </main>
  )
}
