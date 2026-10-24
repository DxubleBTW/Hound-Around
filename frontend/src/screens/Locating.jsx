import { useEffect, useState } from 'react'
import { locate } from '../api.js'

export default function Locating({ photo, onDone, onCancel }) {
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    const controller = new AbortController()
    setError('')
    locate(photo.blob, { signal: controller.signal })
      .then((r) => live && onDone(r))
      .catch((e) => live && e.name !== 'AbortError' && setError(e.message || 'Please try again.'))
    return () => { live = false; controller.abort() }
  }, [photo.blob, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="rise flex flex-1 flex-col">
      <div className="relative mt-4 aspect-[3/4] w-full overflow-hidden rounded-3xl bg-ink">
        <img src={photo.url} alt="Your hallway photo" className="h-full w-full object-cover opacity-80" />
        {!error && <div className="scan-line absolute inset-x-0 h-1 bg-scarlet shadow-[0_0_24px_6px_rgba(204,0,0,.55)]" />}
      </div>

      {!error ? (
        <div role="status" className="mt-8 text-center">
          <p className="font-display text-2xl font-bold">
            <span className="sniff inline-block" aria-hidden="true">🐾</span> Sending photo and matching…
          </p>
          <p className="mt-2 text-muted">This can take a few seconds.</p>
        </div>
      ) : (
        <div role="alert" className="mt-8 text-center">
          <p className="font-display text-2xl font-bold">Couldn’t locate this photo</p>
          <p className="mt-2 break-words text-sm text-muted">{error}</p>
          <button onClick={() => setAttempt((a) => a + 1)} className="mt-6 w-full rounded-2xl bg-scarlet py-4 font-semibold text-white">Try again</button>
        </div>
      )}

      <button onClick={onCancel} className="mt-auto py-4 text-sm font-medium text-muted">Retake photo</button>
    </main>
  )
}
