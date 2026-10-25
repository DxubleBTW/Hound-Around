import { useEffect, useRef, useState } from 'react'
import { shrinkImage, BLUR_THRESHOLD } from '../lib/image.js'
import { ALL_DESTS, resolveDestination } from '../lib/destinations.js'
import { ElevatorIcon } from '../components/Paw.jsx'
import PhotoTips from '../components/PhotoTips.jsx'

// Quick-pick labels read as plain phrases ("Restrooms, Floor 1").
const plain = (label = '') => label.replace(/\s·\s/g, ', ')

export default function Snap({ dest, setDest, accessible, setAccessible, onPhoto, onManual, onBrowse, destinations = ALL_DESTS, resolvePlace = resolveDestination }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const [tips, setTips] = useState(false)
  const active = useRef(true)
  const preparation = useRef(0)
  useEffect(() => {
    active.current = true
    return () => { active.current = false; preparation.current += 1 }
  }, [])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const startedAt = performance.now()
    const request = ++preparation.current
    setHint('')
    setBusy(true)
    try {
      const blob = await shrinkImage(file)
      if (!active.current || request !== preparation.current) return
      // On-phone blur/blank check: don't upload a photo that can't match.
      if (typeof blob.sharpness === 'number' && blob.sharpness < BLUR_THRESHOLD) {
        setHint('That looked blurry or blank. Step back and point down the hallway or at a room number.')
        return
      }
      onPhoto({ blob, url: URL.createObjectURL(blob), startedAt })
    } catch (err) {
      if (active.current && request === preparation.current) setHint(err?.message || 'We could not prepare this photo. Take another photo or choose a JPEG or PNG file.')
    } finally {
      if (active.current && request === preparation.current) setBusy(false)
    }
  }

  const canShoot = !busy && dest.trim()
  const openCamera = () => { if (canShoot) input.current?.click() }

  return (
    <main className="flex flex-1 flex-col gap-5 pt-5">
      {/* The frame is a second, larger way to open the camera. There is no live
          viewfinder: it shows how to aim and repeats the privacy promise. */}
      <div className="relative flex min-h-[200px] flex-1 flex-col">
      <button type="button" onClick={openCamera} disabled={!canShoot} aria-label="Take a photo of the hallway"
        className="press relative min-h-[200px] flex-1 overflow-hidden rounded-[3px] bg-wine disabled:opacity-60">
        <svg viewBox="0 0 350 300" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <path d="M0 300 L120 170 H230 L350 300 M120 170 V0 M230 170 V0" fill="none" stroke="var(--color-maroon)" strokeOpacity=".45" strokeWidth="1.5" />
        </svg>
        {['left-4 top-4 border-l-2 border-t-2', 'right-4 top-4 border-r-2 border-t-2', 'bottom-4 left-4 border-b-2 border-l-2', 'bottom-4 right-4 border-b-2 border-r-2'].map((c) => (
          <span key={c} aria-hidden className={`absolute h-6 w-6 border-snow ${c}`} />
        ))}
        <span className="absolute inset-x-10 bottom-9 flex flex-col gap-1 text-center">
          <span className="text-base">{busy ? 'Preparing your photo…' : 'Point down the hall or at a room number.'}</span>
          <span className="text-sm text-mist">Your photo is deleted after matching.</span>
        </span>
      </button>
      {/* (i), just below the frame's bottom-right corner: how to take a photo that matches. */}
      <button type="button" onClick={() => setTips(true)} aria-label="Tips for taking a good photo" aria-haspopup="dialog"
        className="press -mr-1.5 mt-1 grid h-11 w-11 self-end place-items-center rounded-full">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-panel font-display text-[17px] font-semibold italic text-snow ring-1 ring-rule">i</span>
      </button>
      </div>
      <PhotoTips open={tips} onClose={() => setTips(false)} />

      <section className="space-y-3">
        <div>
          <label htmlFor="dest" className="text-sm text-mist">Going to</label>
          <div className="flex items-end gap-3 border-b-2 border-snow">
            <input
              id="dest" value={dest} onChange={(e) => setDest(e.target.value)}
              onBlur={(e) => { const r = resolvePlace(e.target.value); if (r !== e.target.value) setDest(r) }}
              list="dest-suggestions"
              placeholder={destinations[0]?.value ? `e.g. ${destinations[0].value}` : 'Room number'}
              className="min-w-0 flex-1 bg-transparent pb-1 font-display text-[30px] font-semibold leading-tight text-snow outline-none placeholder:text-dim"
              autoComplete="off" inputMode="text"
              aria-describedby="dest-hint"
            />
            <button type="button" onClick={onBrowse} aria-haspopup="dialog"
              className="min-h-[44px] shrink-0 pb-1 text-[15px] underline underline-offset-[3px]">
              Pick a room
            </button>
          </div>
          {/* Suggestions are drawn ONLY from the verified set so nothing implies rooms we can't route to. */}
          <datalist id="dest-suggestions">
            {destinations.map((d) => <option key={d.value} value={d.value}>{plain(d.label || d.name)}</option>)}
          </datalist>
          <p id="dest-hint" className="mt-1.5 text-sm text-mist">Type a room number, or pick one of this building’s rooms.</p>
        </div>


        <button onClick={() => setAccessible(!accessible)} role="switch" aria-checked={accessible}
          className="flex min-h-[52px] w-full items-center justify-between gap-3 text-left">
          <span className="flex items-center gap-3">
            <ElevatorIcon size={22} />
            <span>
              <span className="block">Elevators only</span>
              <span className="block text-sm text-mist">No stairs anywhere on your route</span>
            </span>
          </span>
          <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${accessible ? 'bg-snow' : 'bg-rule'}`}>
            <span className={`absolute left-1 top-1 h-5 w-5 rounded-full transition-transform duration-200 ease-[cubic-bezier(.23,1,.32,1)] ${accessible ? 'translate-x-5 bg-night' : 'bg-snow'}`} />
          </span>
        </button>
      </section>

      <div className="space-y-2">
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        {hint && <p role="alert" className="enter rounded-sm bg-wine px-4 py-3 text-[15px]">{hint}</p>}
        <button onClick={openCamera} disabled={!canShoot}
          className="press flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-sm bg-snow font-display text-[19px] font-semibold text-night disabled:opacity-50">
          <CameraIcon />
          {busy ? 'Preparing…' : 'Take photo'}
        </button>
        <button onClick={onManual} disabled={busy || !dest.trim()}
          className="min-h-[44px] w-full text-base underline underline-offset-[3px] disabled:text-dim disabled:no-underline">
          No camera? Type the room you’re next to
        </button>
      </div>
    </main>
  )
}

function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  )
}
