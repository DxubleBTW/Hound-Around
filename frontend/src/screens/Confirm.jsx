import { useEffect, useRef, useState } from 'react'
import { correct } from '../api.js'
import { floorName, floorOf, spotName } from '../lib/spots.js'

// `mode` comes from lib/tiers.js: 'confirm' ("Right spot?"), 'picker' (top 3),
// or 'retake' (the old very-low-confidence fallback for uncalibrated backends;
// actual unrelated-photo rejection is the backend's 422, handled in Locating).
// `fused` marks the picker after a second photo.

// Short floor mark for the badge: LL, 1, 2.
function floorMark(spot) {
  const c = floorOf(spot).code
  return c === 'B1' ? 'LL' : String(c).replace('F', '')
}

const linkClass = 'min-h-[44px] text-base underline underline-offset-[3px] disabled:text-dim'

export default function Confirm({ photo, loc, mode = 'confirm', fused = false, onConfirm, onRetake, onManual, api, buildingLabel = 'the selected building', roomLabels = {} }) {
  const [picking, setPicking] = useState(mode === 'picker')
  const [saving, setSaving] = useState('')
  const [failure, setFailure] = useState(null)
  const pending = useRef(null)
  const strength = Math.round((loc.confidence || 0) * 100)
  const maxVotes = Math.max(1, ...(loc.top3 || []).map((t) => t.votes || 0))

  useEffect(() => () => pending.current?.abort(), [])

  // Extremely uncertain answer: preserve the retake fallback and offer manual routing.
  if (mode === 'retake') {
    return (
      <main className="flex flex-1 flex-col pt-8">
        <div className="flex flex-1 flex-col justify-center gap-5">
          <svg width="132" height="120" viewBox="0 0 132 120" aria-hidden>
            <path d="M8 104 H54 L76 82 V22" fill="none" stroke="#7A1F2B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M76 22 V6" fill="none" stroke="#7A1F2B" strokeWidth="3" strokeDasharray="3 7" strokeLinecap="round" />
            <circle cx="76" cy="54" r="11" fill="var(--color-night)" stroke="var(--color-snow)" strokeWidth="3" />
            <text x="76" y="60" textAnchor="middle" fontFamily="Jost, sans-serif" fontSize="15" fontWeight="600" fill="var(--color-snow)">?</text>
            <circle cx="30" cy="104" r="7" fill="#CC0000" />
          </svg>
          <h2 className="font-display text-[38px] font-semibold leading-[1.02]">We can’t tell where this is</h2>
          <p className="max-w-[32ch] text-[17px] leading-snug text-mist">
            Make sure you’re inside {buildingLabel}. Then point your camera down a hallway or at a room-number sign.
          </p>
        </div>
        <div className="space-y-2 pt-6">
          <button onClick={onRetake} className="press min-h-[56px] w-full rounded-sm bg-snow font-display text-[19px] font-semibold text-night">Take another photo</button>
          <button onClick={onManual} className={`${linkClass} w-full`}>Type the room you’re next to</button>
        </div>
      </main>
    )
  }

  async function pick(spot) {
    if (pending.current) return
    if (spot === loc.spot) return onConfirm(spot, null)
    const controller = new AbortController()
    pending.current = controller
    setFailure(null)
    setSaving(spot)
    try {
      const res = await (api?.correct || correct)(loc.photo_id, spot, { signal: controller.signal })
      // Surface the new index size so the toast can show the growing count.
      if (!controller.signal.aborted) onConfirm(spot, res?.index_size ?? true)
    } catch (error) {
      if (!controller.signal.aborted) setFailure({ spot, error })
    } finally {
      if (!controller.signal.aborted) setSaving('')
      if (pending.current === controller) pending.current = null
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-6 pt-6">
      {!picking ? (
        <>
          <div className="flex items-center gap-4">
            <img src={photo.url} alt="" className="h-24 w-[72px] shrink-0 rounded-[2px] object-cover" />
            <div className="min-w-0">
              <p className="text-sm text-mist">You’re at</p>
              <h2 className="font-display text-[32px] font-semibold leading-[1.05]">{spotName(loc.spot, roomLabels)}</h2>
              <span className="mt-2 inline-flex rounded-[3px] bg-maroon px-2 py-0.5 text-sm font-bold">{floorName(loc.floor)}</span>
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-mist">Match strength</span>
              <span className="font-bold">{strength}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rule" role="img" aria-label={`Match strength ${strength} percent`}>
              <div className="grow-x h-full bg-maroon-line" style={{ width: `${strength}%` }} />
            </div>
            {loc.ocr_room && <p className="mt-3 text-sm text-mist">Saw a sign for Room {loc.ocr_room}.</p>}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2.5">
            <h2 className="font-display text-[38px] font-semibold leading-[1.02]">Which spot is this?</h2>
            <p className="text-[17px] leading-snug text-mist">
              {fused ? 'We combined both photos. Pick where you’re standing.' : 'The match wasn’t strong enough to be sure. Pick where you’re standing.'}
            </p>
            {loc.ocr_room && <p className="text-sm text-mist">Saw a sign for Room {loc.ocr_room}.</p>}
          </div>
          <ul className="space-y-2">
            {(loc.top3 || []).map((t, i) => {
              const first = i === 0
              return (
                <li key={t.spot}>
                  <button onClick={() => pick(t.spot)} disabled={!!saving}
                    className={`press relative flex min-h-[76px] w-full items-center gap-3.5 overflow-hidden rounded-sm px-3.5 text-left disabled:opacity-60 ${first ? 'bg-snow text-night' : 'bg-wine text-snow'}`}>
                    <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[3px] bg-maroon font-display text-[21px] font-semibold text-white">{floorMark(t.spot)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] font-bold leading-snug">{spotName(t.spot, roomLabels)}</span>
                      <span className={`block text-sm ${first ? 'text-night/70' : 'text-mist'}`}>
                        {saving === t.spot ? 'Saving…' : `${floorName(floorOf(t.spot).code === 'B1' ? -1 : Number(floorMark(t.spot)))}${first ? '. Closest match.' : ''}`}
                      </span>
                    </span>
                    <span aria-hidden className="grow-x absolute bottom-0 left-0 h-[3px] bg-maroon-line"
                      style={{ width: `${Math.round(((t.votes || 0) / maxVotes) * 100)}%`, animationDelay: `${i * 60}ms` }} />
                  </button>
                </li>
              )
            })}
          </ul>
          {!failure && <p className="text-sm text-mist">Your pick teaches the app this spot for next time.</p>}
        </>
      )}

      <div className="mt-auto space-y-2">
        {failure && (
          <div className="enter space-y-3 rounded-sm bg-panel p-4">
            <div role="alert">
              <p className="font-bold">We couldn’t confirm your correction was saved</p>
              <p className="mt-1 text-sm text-mist">{failure.error.message || 'Please try again.'}</p>
            </div>
            {failure.error.retryable && (
              <button onClick={() => pick(failure.spot)} disabled={!!saving} className={`${linkClass} block`}>Try saving again</button>
            )}
            <button onClick={() => onConfirm(failure.spot, null)} disabled={!!saving}
              className="press min-h-[48px] w-full rounded-sm bg-snow font-display text-[17px] font-semibold text-night disabled:opacity-60">
              Continue from {spotName(failure.spot, roomLabels)}
            </button>
          </div>
        )}
        {!picking && (
          <>
            <p className="font-display text-xl font-semibold">Right spot?</p>
            <button onClick={() => pick(loc.spot)}
              className="press min-h-[56px] w-full rounded-sm bg-snow font-display text-[19px] font-semibold text-night">Yes, route me</button>
            <button onClick={() => setPicking(true)} className={`${linkClass} w-full`}>Not quite. Pick another spot</button>
          </>
        )}
        <div className="flex justify-between gap-4">
          <button onClick={onRetake} className={linkClass}>Retake photo</button>
          <button onClick={onManual} className={`${linkClass} text-right`}>Type the room you’re next to</button>
        </div>
      </div>
    </main>
  )
}
