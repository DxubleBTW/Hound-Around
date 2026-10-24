import { useEffect, useState } from 'react'
import { route } from '../api.js'
import { spotName } from '../lib/spots.js'

// Ethics rule from the brief: no public building map. Users only see their next turn.
export default function Route({ from, heading, dest, accessible, onRestart }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [i, setI] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const requestKey = JSON.stringify([from, dest.trim(), accessible, heading])

  useEffect(() => {
    let live = true
    const controller = new AbortController()
    setData(null)
    setError('')
    setI(0)
    route({ from, to: dest.trim(), accessible, heading }, { signal: controller.signal })
      .then((result) => live && setData({ key: requestKey, result }))
      .catch((e) => live && e.name !== 'AbortError' && setError({ key: requestKey, message: e.message || 'No route found' }))
    return () => { live = false; controller.abort() }
  }, [from, dest, accessible, heading, requestKey, attempt])

  if (error && error.key === requestKey) {
    return (
      <main className="rise flex flex-1 flex-col justify-center text-center">
        <p className="font-display text-2xl font-bold">Couldn’t find a route to {dest}</p>
        <p role="alert" className="mt-2 text-sm text-muted">{error.message}</p>
        <button onClick={() => setAttempt((a) => a + 1)} className="mt-6 rounded-2xl border border-line py-4 font-semibold">Try again</button>
        <button onClick={onRestart} className="mt-6 rounded-2xl bg-scarlet py-4 font-semibold text-white">Start over</button>
      </main>
    )
  }
  if (!data || data.key !== requestKey) return <main role="status" className="flex flex-1 items-center justify-center text-muted">Planning your route…</main>

  const result = data.result
  const steps = result.steps || []
  const arrived = i >= steps.length
  const step = steps[i]
  const remaining = steps.slice(i).reduce((a, s) => a + (s.meters || 0), 0)
  const mins = Math.max(1, Math.round((result.est_seconds * (remaining / (result.total_meters || 1))) / 60))

  return (
    <main className="rise flex flex-1 flex-col">
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="font-medium text-muted">From {spotName(from)}</span>
        {accessible && <span className="rounded-full bg-ink/5 px-2.5 py-0.5 font-medium">♿ Elevators only</span>}
      </div>
      <h2 className="mt-1 font-display text-xl font-bold">To Room {dest}</h2>

      <div className="mt-4 flex gap-1">
        {steps.map((_, k) => <span key={k} className={`h-1.5 flex-1 rounded-full ${k < i ? 'bg-scarlet' : k === i ? 'bg-scarlet/50' : 'bg-line'}`} />)}
      </div>

      {!arrived ? (
        <section key={i} className="rise mt-8 flex-1">
          <p className="text-sm font-semibold uppercase tracking-wider text-scarlet">Step {i + 1} of {steps.length}</p>
          <p className="mt-3 font-display text-4xl font-extrabold leading-[1.08] tracking-tight">{step.instruction}</p>
          {step.meters > 0 && <p className="mt-4 text-lg text-muted">about {step.meters} m</p>}
          <p className="mt-8 text-sm text-muted">{remaining} m left · ~{mins} min</p>
        </section>
      ) : (
        <section className="rise mt-12 flex-1 text-center">
          <p className="text-6xl">🐾</p>
          <p className="mt-4 font-display text-4xl font-extrabold">You’ve arrived.</p>
          <p className="mt-2 text-muted">Room {dest}. Good dog.</p>
        </section>
      )}

      <div className="space-y-3 pt-6">
        {!arrived ? (
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} className="rounded-2xl border border-line bg-white py-4 font-semibold disabled:opacity-40">Back</button>
            <button onClick={() => setI(i + 1)} className="rounded-2xl bg-scarlet py-4 font-semibold text-white">{i === steps.length - 1 ? 'I’m here' : 'Next'}</button>
          </div>
        ) : (
          <button onClick={onRestart} className="w-full rounded-2xl bg-scarlet py-4 font-semibold text-white">Find another room</button>
        )}
        {!arrived && <button onClick={onRestart} className="w-full py-3 text-sm font-medium text-muted">Lost? Snap again</button>}
      </div>
    </main>
  )
}
