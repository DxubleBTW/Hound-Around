import { useEffect, useRef, useState } from 'react'
import { correct } from '../api.js'
import { floorName, floorOf, spotName } from '../lib/spots.js'
import Icon from '../components/Icon.jsx'
import { Button, Sheet, TextAction, TopBar, focusRing } from '../components/ui.jsx'

// `mode` comes from lib/tiers.js: 'confirm' ("Right spot?"), 'picker' (top 3),
// or 'retake' (the old very-low-confidence fallback for uncalibrated backends;
// actual unrelated-photo rejection is the backend's 422, handled in Locating).
// `fused` marks the picker after a second photo.
export default function Confirm({ photo, loc, mode = 'confirm', fused = false, onConfirm, onRetake, onManual, api, buildingLabel = 'the selected building', roomLabels = {} }) {
  const [picking, setPicking] = useState(mode === 'picker')
  const [saving, setSaving] = useState('')
  const [failure, setFailure] = useState(null)
  const pending = useRef(null)
  const strength = Math.round((loc.confidence || 0) * 100)
  const filled = Math.round((loc.confidence || 0) * 10)
  const maxVotes = Math.max(1, ...(loc.top3 || []).map((t) => t.votes || 0))

  useEffect(() => () => pending.current?.abort(), [])

  // Extremely uncertain answer: preserve the retake fallback and offer manual routing.
  if (mode === 'retake') {
    return (
      <main className="rise flex flex-1 flex-col">
        <TopBar onBack={onRetake} backLabel="Retake photo" />
        <img src={photo.url} alt="Your hallway photo" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-[var(--shadow-float)]" />
        <Sheet>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-tint text-rose"><Icon name="search" size={22} /></span>
          <p className="font-display mt-4 text-balance text-[22px] font-bold">I can’t tell where this is.</p>
          <p className="mt-1 text-[15px] text-dim">Point your camera down a hallway or at a room-number sign, and make sure you’re inside {buildingLabel}.</p>
          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={onRetake} className="w-full"><Icon name="camera" size={20} />Take another photo</Button>
            <Button variant="secondary" onClick={onManual} className="w-full">Use the manual locator</Button>
          </div>
        </Sheet>
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
      <TopBar onBack={onRetake} backLabel="Retake photo" title={picking ? 'Which spot is this?' : ''} />
      <img src={photo.url} alt="Your hallway photo" className={`w-full rounded-3xl object-cover shadow-[var(--shadow-float)] ${picking ? 'aspect-[16/9]' : 'aspect-[4/3]'}`} />

      <Sheet>
        {!picking ? (
          <section>
            <p className="text-[13px] font-medium text-dim">You’re at</p>
            <h1 className="font-display text-balance text-[26px] font-bold leading-tight">{spotName(loc.spot, roomLabels)}</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-dim">
              <span>{floorName(loc.floor)}</span><span aria-hidden>·</span>
              <span className={`font-semibold ${strength >= 80 ? 'text-fg' : 'text-fg'}`}>{strength}% match</span>
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => pick(loc.spot)} className="flex-1 whitespace-nowrap px-4"><Icon name="walk" size={19} />Yes, route me</Button>
              <Button variant="tonal" onClick={() => setPicking(true)} className="shrink-0 whitespace-nowrap px-4">Not quite</Button>
              <Button variant="secondary" onClick={onRetake} className="w-12 shrink-0 px-0!" aria-label="Retake photo"><Icon name="camera" size={20} /></Button>
            </div>
            <dl className="mt-5 divide-y divide-edge/70 border-t border-edge/70">
              <div className="flex min-h-[56px] items-center gap-4">
                <dt className="flex items-center gap-4 text-[15px]"><Icon name="elevator" className="text-dim" />Floor</dt>
                <dd className="ml-auto text-[15px] font-semibold">{floorName(loc.floor)}</dd>
              </div>
              <div className="py-3">
                <div className="flex items-center gap-4">
                  <dt className="flex items-center gap-4 text-[15px]"><Icon name="pin" className="text-dim" />Match strength</dt>
                  <dd className="ml-auto text-[15px] font-semibold tabular-nums">{strength}%</dd>
                </div>
                <div className="mt-2.5 ml-10 flex gap-1" role="img" aria-label={`Match strength ${strength} percent`}>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-raise">
                      {i < filled && <span className="grow-x block h-full w-full rounded-full bg-fg" style={{ animationDelay: `${i * 0.04}s` }} />}
                    </span>
                  ))}
                </div>
              </div>
              {loc.ocr_room && (
                <div className="flex min-h-[56px] items-center gap-4">
                  <dt className="flex items-center gap-4 text-[15px]"><Icon name="sign" className="text-dim" />Saw sign</dt>
                  <dd className="ml-auto text-[15px] font-semibold">Room {loc.ocr_room}</dd>
                </div>
              )}
            </dl>
          </section>
        ) : (
          <section>
            <p className="text-[15px] text-dim">{fused ? 'We combined both photos. Pick where you’re standing.' : 'Hmm, not sure. Pick where you’re standing.'} Your pick teaches the app this spot for next time.</p>
            {loc.ocr_room && <p className="mt-2 flex items-center gap-2 text-[14px] text-dim"><Icon name="sign" size={18} />Saw sign: Room {loc.ocr_room}</p>}
            <ul className="mt-3">
              {(loc.top3 || []).map((t, i) => (
                <li key={t.spot}>
                  <button onClick={() => pick(t.spot)} disabled={!!saving}
                    className={`-mx-2 flex min-h-[68px] w-[calc(100%+1rem)] items-center gap-4 rounded-2xl px-2 text-left transition-colors hover:bg-raise disabled:opacity-60 ${focusRing}`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${i === 0 ? 'bg-fg text-ink' : 'bg-raise text-dim'}`}><Icon name="pin" size={20} /></span>
                    <span className="min-w-0 flex-1 border-b border-edge/70 py-3">
                      <span className="block text-[16px] font-semibold">{spotName(t.spot, roomLabels)}{i === 0 && <span className="ml-2 rounded-full bg-tint px-2 py-0.5 align-middle text-[12px] font-semibold text-rose">Best guess</span>}</span>
                      <span className="block text-[14px] text-dim">{floorName(floorNum(t.spot))} · {saving === t.spot ? 'Saving…' : `${t.votes} votes`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="secondary" onClick={onRetake} className="w-full"><Icon name="camera" size={19} />None of these. Retake photo</Button>
              <TextAction onClick={onManual} className="self-center">Use the manual locator</TextAction>
            </div>
          </section>
        )}

        {failure && (
          <div className="mt-5 space-y-3 rounded-2xl bg-tint p-4">
            <div role="alert">
              <p className="font-semibold">Couldn’t confirm your correction was saved</p>
              <p className="mt-1 text-[14px] text-dim">{failure.error.message || 'Please try again.'}</p>
            </div>
            {failure.error.retryable && (
              <Button variant="secondary" onClick={() => pick(failure.spot)} disabled={!!saving} className="w-full">Try saving again</Button>
            )}
            <Button onClick={() => onConfirm(failure.spot, null)} disabled={!!saving} className="w-full">Continue from {spotName(failure.spot, roomLabels)}</Button>
          </div>
        )}
        {!picking && <TextAction onClick={onManual} className="mt-3 self-start">Use the manual locator</TextAction>}
      </Sheet>
    </main>
  )
}

function floorNum(spot) {
  const c = floorOf(spot).code
  return c === 'B1' ? -1 : Number(c.replace('F', '')) || null
}
