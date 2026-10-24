import { useRef, useState } from 'react'
import { shrinkImage, BLUR_THRESHOLD } from '../lib/image.js'

const QUICK = [
  { room: '164', label: 'Room 164 · Closing Ceremony' },
  { room: 'B62', label: 'B62' },
]

export default function Snap({ dest, setDest, accessible, setAccessible, onPhoto }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setHint('')
    setBusy(true)
    try {
      const blob = await shrinkImage(file)
      // On-phone blur/blank check: don't upload a photo that can't match.
      if (typeof blob.sharpness === 'number' && blob.sharpness < BLUR_THRESHOLD) {
        setHint('That looked blurry or blank. Step back and point down the hallway or at a room number.')
        return
      }
      onPhoto({ blob, url: URL.createObjectURL(blob) })
    } catch (err) {
      setHint(err?.message || 'We could not prepare this photo. Take another photo or choose a JPEG or PNG file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="rise flex flex-1 flex-col">
      <header className="pt-6">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Hound Around</h1>
        </div>
        <p className="mt-6 font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight">
          Never lost <span className="text-scarlet">around here.</span>
        </p>
        <p className="mt-3 text-muted">Snap the hallway you’re in. We’ll tell you where you are and walk you to your room.</p>
      </header>

      <section className="mt-8 space-y-3">
        <label htmlFor="dest" className="text-sm font-semibold">Where to?</label>
        <input
          id="dest" value={dest} onChange={(e) => setDest(e.target.value)}
          placeholder="Room number, e.g. 164"
          className="w-full rounded-2xl border border-line bg-white px-4 py-3.5 text-lg outline-none focus:border-scarlet"
          autoComplete="off" inputMode="text"
        />
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button key={q.room} onClick={() => setDest(q.room)}
              className={`min-h-[44px] rounded-full border px-3 py-1.5 text-sm ${dest === q.room ? 'border-scarlet bg-scarlet/5 text-scarlet' : 'border-line text-muted'}`}>
              {q.label}
            </button>
          ))}
        </div>

        <button onClick={() => setAccessible(!accessible)} role="switch" aria-checked={accessible}
          className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-3.5">
          <span className="text-left">
            <span className="block font-semibold">Elevators only</span>
            <span className="block text-sm text-muted">Accessible route, no stairs</span>
          </span>
          <span className={`relative h-7 w-12 rounded-full transition ${accessible ? 'bg-scarlet' : 'bg-line'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${accessible ? 'left-6' : 'left-1'}`} />
          </span>
        </button>
      </section>

      <div className="mt-auto pt-8">
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
        <button onClick={() => input.current?.click()} disabled={busy || !dest.trim()}
          className="flex min-h-[44px] w-full items-center justify-center gap-3 rounded-3xl bg-scarlet py-5 font-display text-xl font-bold text-white shadow-[0_10px_30px_-10px_rgba(204,0,0,.6)] active:scale-[.98] disabled:opacity-50">
          <CameraIcon /> {busy ? 'Preparing…' : 'Snap the hallway'}
        </button>
        {hint && <p role="alert" className="mt-3 rounded-2xl bg-scarlet/5 px-4 py-3 text-center text-sm font-medium text-scarlet">{hint}</p>}
        <p className="mt-3 text-center text-xs text-muted">No GPS, no tracking. Your photo is deleted after matching.</p>
      </div>
    </main>
  )
}

function CameraIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  )
}
