import { useEffect, useRef, useState } from 'react'
import { shrinkImage, BLUR_THRESHOLD } from '../lib/image.js'

// The first photo wasn't conclusive (look-alike hallways, identical elevator
// lobbies). A photo facing the other way usually settles it: the backend adds
// both photos' votes. Measured on held-out walks, this tier plus auto-pick and
// the picker raise user success from 68% to 73% (ml/calibration.py).
export default function SecondPhoto({ photo, onPhoto, onSkip, onManual }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const active = useRef(true)
  useEffect(() => () => { active.current = false }, [])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setHint('')
    setBusy(true)
    try {
      const blob = await shrinkImage(file)
      if (!active.current) return
      if (typeof blob.sharpness === 'number' && blob.sharpness < BLUR_THRESHOLD) {
        setHint('That looked blurry or blank. Hold still and point down the hallway.')
        return
      }
      onPhoto({ blob, url: URL.createObjectURL(blob) })
    } catch (err) {
      if (active.current) setHint(err?.message || 'We could not prepare this photo. Try again.')
    } finally {
      if (active.current) setBusy(false)
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-6 pt-6">
      <div className="flex items-center gap-5">
        <img src={photo.url} alt="Your first photo" className="h-28 w-[84px] shrink-0 rounded-[2px] object-cover opacity-70" />
        <TurnAround />
      </div>
      <div className="space-y-2.5">
        <h2 className="font-display text-[38px] font-semibold leading-[1.02]">Almost. Turn around and snap once more</h2>
        <p className="text-[17px] leading-snug text-mist">
          A few hallways here look alike. A photo facing the other way usually tells them apart.
        </p>
        {hint && <p role="alert" className="text-base">{hint}</p>}
      </div>
      <div className="mt-auto space-y-2">
        <button onClick={() => input.current?.click()} disabled={busy}
          className="press min-h-[56px] w-full rounded-sm bg-snow font-display text-[19px] font-semibold text-night disabled:opacity-60">
          {busy ? 'Preparing…' : 'Take the second photo'}
        </button>
        <div className="flex justify-between gap-4">
          <button onClick={onSkip} className="min-h-[44px] text-base underline underline-offset-[3px]">Skip, show the closest spots</button>
          <button onClick={onManual} className="min-h-[44px] text-right text-base underline underline-offset-[3px]">Type a room</button>
        </div>
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      </div>
    </main>
  )
}

// A half-turn arrow: "face the other way".
function TurnAround() {
  return (
    <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-snow">
      <path d="M7 18V9a5 5 0 0 1 10 0v6" />
      <path d="M13.5 12.5L17 16l3.5-3.5" />
      <circle cx="7" cy="19.5" r="1.4" fill="var(--color-here)" stroke="none" />
    </svg>
  )
}
