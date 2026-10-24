import { useEffect, useRef, useState } from 'react'
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
  const [failure, setFailure] = useState(null)
  const pending = useRef(null)
  const votes = Math.round((loc.confidence || 0) * 10)
  const maxVotes = Math.max(1, ...(loc.top3 || []).map((t) => t.votes || 0))

  useEffect(() => () => pending.current?.abort(), [])

  async function pick(spot) {
    if (pending.current) return
    if (spot === loc.spot) return onConfirm(spot, null)
    const controller = new AbortController()
    pending.current = controller
    setFailure(null)
    setSaving(spot)
    try {
      const res = await correct(loc.photo_id, spot, { signal: controller.signal })
      // Surface the new index size so the toast can read "N frames indexed".
      if (!controller.signal.aborted) onConfirm(spot, res?.index_size ?? true)
    } catch (error) {
      if (!controller.signal.aborted) setFailure({ spot, error })
    } finally {
      if (!controller.signal.aborted) setSaving('')
      if (pending.current === controller) pending.current = null
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
        <div className="mt-6 rounded-2xl border border-line bg-white p-4 shadow-sm">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted">Match strength</span>
            <span><span className="font-display text-lg font-extrabold text-scarlet">{votes}</span><span className="font-semibold text-muted">/10 frames agree</span></span>
          </div>
          <div className="mt-2 flex gap-1" role="img" aria-label={`${votes} of 10 frames agree`}>
            {Array.from({ length: 10 }).map((_, i) => (
              <span key={i} className="h-2.5 flex-1 overflow-hidden rounded-full bg-line">
                {i < votes && <span className="grow-x block h-full w-full rounded-full bg-scarlet" style={{ animationDelay: `${i * 0.04}s` }} />}
              </span>
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
                className="relative flex w-full items-center justify-between overflow-hidden rounded-2xl border border-line bg-white px-4 py-4 text-left shadow-sm transition active:scale-[.99] active:border-scarlet disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">
                {/* Vote bar fills proportionally to the strongest candidate. */}
                <span aria-hidden className="grow-x absolute inset-y-0 left-0 bg-scarlet/5" style={{ width: `${Math.round((t.votes / maxVotes) * 100)}%`, animationDelay: `${i * 0.06}s` }} />
                <span className="relative">
                  <span className="block font-semibold">{spotName(t.spot)}</span>
                  <span className="block text-sm text-muted">{floorName(floorNum(t.spot))}{i === 0 ? ' · best guess' : ''}</span>
                </span>
                <span className="relative text-sm font-medium text-muted">{saving === t.spot ? 'Saving…' : `${t.votes} votes`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-3 pt-8">
        {failure && (
          <div className="space-y-3 rounded-2xl border border-line bg-white p-4">
            <div role="alert">
              <p className="font-semibold">Couldn’t confirm your correction was saved</p>
              <p className="mt-1 text-sm text-muted">{failure.error.message || 'Please try again.'}</p>
            </div>
            {failure.error.retryable && (
              <button onClick={() => pick(failure.spot)} disabled={!!saving}
                className="min-h-[44px] w-full rounded-xl border border-line py-3 font-semibold disabled:opacity-60">
                Try saving again
              </button>
            )}
            <button onClick={() => onConfirm(failure.spot, null)} disabled={!!saving}
              className="min-h-[44px] w-full rounded-xl bg-scarlet py-3 font-semibold text-white disabled:opacity-60">
              Continue from {spotName(failure.spot)}
            </button>
          </div>
        )}
        {!picking ? (
          <>
            <p className="text-center font-display text-lg font-bold">Right spot?</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setPicking(true)} className="min-h-[44px] rounded-2xl border border-line bg-white py-4 font-semibold shadow-sm transition active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">Not quite</button>
              <button onClick={() => pick(loc.spot)} className="min-h-[44px] rounded-2xl bg-scarlet py-4 font-semibold text-white shadow-[0_12px_28px_-10px_rgba(204,0,0,.6)] transition active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">Yes, route me</button>
            </div>
          </>
        ) : !failure && (
          <p className="text-center text-sm text-muted">Your pick teaches the app this spot for next time.</p>
        )}
        <button onClick={onRetake} className="min-h-[44px] w-full py-3 text-sm font-medium text-muted">None of these. Retake photo</button>
      </div>
    </main>
  )
}

function floorNum(spot) {
  const c = floorOf(spot).code
  return c === 'B1' ? -1 : Number(c.replace('F', '')) || null
}
