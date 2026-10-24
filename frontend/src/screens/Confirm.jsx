import { useState } from 'react'
import { correct } from '../api.js'
import { floorName, floorOf, spotName } from '../lib/spots.js'

// Contract rule: below ~0.6 confidence, or when the top 3 span floors, show the top-3 picker.
function needsPicker(loc) {
  const floors = new Set((loc.top3 || []).map((t) => floorOf(t.spot).code))
  return loc.confidence < 0.6 || floors.size > 1
}

export default function Confirm({ photo, loc, onConfirm, onRetake }) {
  const [picking, setPicking] = useState(() => needsPicker(loc))
  const [saving, setSaving] = useState('')
  const votes = Math.round((loc.confidence || 0) * 10)

  async function pick(spot) {
    if (spot === loc.spot) return onConfirm(spot, null)
    setSaving(spot)
    try {
      const res = await correct(loc.photo_id, spot)
      onConfirm(spot, res?.index_size ?? true) // surface the new index size in the toast
    } catch {
      onConfirm(spot, null) // still route them; the correction just didn't save
    }
  }

  return (
    <main className="rise flex flex-1 flex-col">
      <div className="mt-4 flex items-center gap-4">
        <img src={photo.url} alt="" className="h-20 w-16 rounded-xl object-cover" />
        <div>
          {picking
            ? <h2 className="font-display text-2xl font-extrabold leading-tight">Hmm, not sure.<br />Which spot is this?</h2>
            : <p className="text-sm font-medium text-muted">You’re at</p>}
          {!picking && (
            <>
              <h2 className="font-display text-3xl font-extrabold leading-tight">{spotName(loc.spot)}</h2>
              <span className="mt-1 inline-block rounded-full bg-scarlet/10 px-2.5 py-0.5 text-sm font-semibold text-scarlet">
                {floorName(loc.floor)}
              </span>
            </>
          )}
        </div>
      </div>

      {!picking && (
        <div className="mt-6">
          <div className="flex justify-between text-sm"><span className="text-muted">Match strength</span><span className="font-semibold">{votes}/10 frames agree</span></div>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <span key={i} className={`h-2 flex-1 rounded-full ${i < votes ? 'bg-scarlet' : 'bg-line'}`} />
            ))}
          </div>
          {loc.ocr_room && <p className="mt-3 text-sm text-muted">Saw sign: Room {loc.ocr_room}</p>}
        </div>
      )}

      {picking && loc.ocr_room && (
        <p className="mt-4 text-sm text-muted">Saw sign: Room {loc.ocr_room}</p>
      )}

      {picking && (
        <ul className="mt-6 space-y-3">
          {(loc.top3 || []).map((t, i) => (
            <li key={t.spot}>
              <button onClick={() => pick(t.spot)} disabled={!!saving}
                className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-4 text-left active:border-scarlet disabled:opacity-60">
                <span>
                  <span className="block font-semibold">{spotName(t.spot)}</span>
                  <span className="block text-sm text-muted">{floorName(floorNum(t.spot))}{i === 0 ? ' · best guess' : ''}</span>
                </span>
                <span className="text-sm text-muted">{saving === t.spot ? 'Saving…' : `${t.votes} votes`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-3 pt-8">
        {!picking ? (
          <>
            <p className="text-center font-display text-lg font-bold">Right spot?</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setPicking(true)} className="rounded-2xl border border-line bg-white py-4 font-semibold">Not quite</button>
              <button onClick={() => pick(loc.spot)} className="rounded-2xl bg-scarlet py-4 font-semibold text-white">Yes, route me</button>
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-muted">Your pick teaches the app this spot for next time.</p>
        )}
        <button onClick={onRetake} className="w-full py-3 text-sm font-medium text-muted">None of these. Retake photo</button>
      </div>
    </main>
  )
}

function floorNum(spot) {
  const c = floorOf(spot).code
  return c === 'B1' ? -1 : Number(c.replace('F', '')) || null
}
