import { useState } from 'react'

// Room aliases already resolve through the existing /route endpoint. A typed
// starting location is a routing choice, never a training label/correction.
export default function ManualStart({ onStart, onCancel, landmarks = [], accessible = false }) {
  const [start, setStart] = useState('')
  const room = start.trim()
  return (
    <main className="flex flex-1 flex-col pt-8">
      <form className="flex flex-1 flex-col gap-6" onSubmit={(event) => { event.preventDefault(); if (room) onStart(room) }}>
        <div className="space-y-2.5">
          <h1 className="font-display text-[38px] font-semibold leading-[1.02]">Which room are you next to?</h1>
          <p className="text-[17px] leading-snug text-mist">Read the number on the nearest door. No photo needed.</p>
        </div>
        <div>
          <label className="text-sm text-mist" htmlFor="manual-start">Room number</label>
          <div className="flex items-center gap-3.5 border-b-2 border-snow pb-1">
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-full bg-here" />
            <input id="manual-start" value={start} onChange={(event) => setStart(event.target.value)}
              placeholder="263" autoComplete="off"
              className="min-w-0 flex-1 bg-transparent font-display text-[64px] font-semibold leading-none text-snow outline-none placeholder:text-[#3A3A3A]" />
          </div>
        </div>
        {room && <p className="enter text-[17px] leading-snug">We’ll route you from Room {room}{accessible ? ', using elevators only' : ''}.</p>}
        {landmarks.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm text-mist">Or choose a landmark</legend>
            {landmarks.map((landmark) => (
              <button key={landmark.spot} type="button" onClick={() => onStart(landmark.spot)}
                className="press min-h-[52px] w-full rounded-sm bg-panel px-4 text-left">
                {landmark.label}, {landmark.floor === -1 ? 'Lower level' : `Floor ${landmark.floor}`}
              </button>
            ))}
          </fieldset>
        )}
        <p className="text-[15px] leading-snug text-mist">Typing a room doesn’t teach the photo matcher. Only a confirmed photo does.</p>
        <div className="mt-auto space-y-2">
          <button disabled={!room} className="press min-h-[56px] w-full rounded-sm bg-snow font-display text-[19px] font-semibold text-night disabled:opacity-40">Get directions</button>
          <button type="button" onClick={onCancel} className="min-h-[44px] w-full text-base underline underline-offset-[3px]">Back to camera</button>
        </div>
      </form>
    </main>
  )
}
