import { useState } from 'react'

// Room aliases already resolve through the existing /route endpoint. A typed
// starting location is a routing choice, never a training label/correction.
export default function ManualStart({ onStart, onCancel, landmarks = [] }) {
  const [start, setStart] = useState('')
  return (
    <main className="rise flex flex-1 flex-col pt-6">
      <h1 className="font-display text-3xl font-extrabold">Choose your starting location</h1>
      <p className="mt-3 text-muted">Enter the room number beside you, or choose an approved landmark. You can get directions without another photo.</p>
      <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); if (start.trim()) onStart(start.trim()) }}>
        <label className="block font-semibold" htmlFor="manual-start">Room number beside you</label>
        <input id="manual-start" value={start} onChange={(event) => setStart(event.target.value)}
          className="w-full rounded-2xl border border-line bg-white p-4 text-lg" autoComplete="off" />
        {landmarks.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-2 font-semibold">Or choose a landmark</legend>
            {landmarks.map((landmark) => (
              <button key={landmark.spot} type="button" onClick={() => onStart(landmark.spot)}
                className="min-h-[44px] w-full rounded-2xl border border-line bg-white p-4 text-left">
                {landmark.label} · {landmark.floor === -1 ? 'Lower level' : `Floor ${landmark.floor}`}
              </button>
            ))}
          </fieldset>
        )}
        <button disabled={!start.trim()} className="min-h-[44px] w-full rounded-2xl bg-scarlet p-4 font-semibold text-white disabled:opacity-50">Get directions</button>
      </form>
      <p className="mt-4 text-sm text-muted">This selection does not teach the recognition model.</p>
      <button onClick={onCancel} className="mt-auto min-h-[44px] py-4 font-semibold">Back to camera</button>
    </main>
  )
}
