import { useEffect, useRef, useState } from 'react'
import { shrinkImage, BLUR_THRESHOLD } from '../lib/image.js'
import Icon from '../components/Icon.jsx'
import { Button, Sheet, TextAction } from '../components/ui.jsx'

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
    <main className="rise flex flex-1 flex-col">
      <div className="mt-4 flex items-center justify-center gap-5">
        <img src={photo.url} alt="Your first photo" className="h-36 w-[108px] rounded-2xl object-cover opacity-70 shadow-[var(--shadow-float)]" />
        <TurnAround />
      </div>
      <Sheet>
        <p className="font-display text-[26px] font-bold leading-tight">Almost. Turn around and snap once more</p>
        <p className="mt-1.5 text-[15px] text-dim">A few hallways here look alike. A photo facing the other way usually tells them apart.</p>
        {hint && <p role="alert" className="mt-3 rounded-xl bg-tint px-4 py-3 text-[14px]">{hint}</p>}
        <div className="mt-6 flex flex-col gap-2">
          <Button onClick={() => input.current?.click()} disabled={busy} className="w-full">
            <Icon name="camera" size={20} />{busy ? 'Preparing…' : 'Take the second photo'}
          </Button>
          <div className="flex justify-between gap-4">
            <TextAction onClick={onSkip}>Skip, show the closest spots</TextAction>
            <TextAction onClick={onManual}>Use the manual locator</TextAction>
          </div>
        </div>
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      </Sheet>
    </main>
  )
}

// A half-turn arrow: "face the other way".
function TurnAround() {
  return (
    <span className="lg flex h-24 w-24 items-center justify-center rounded-full" aria-hidden>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 18V9a5 5 0 0 1 10 0v6" />
        <path d="M13.5 12.5L17 16l3.5-3.5" />
        <circle cx="7" cy="19.5" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}
