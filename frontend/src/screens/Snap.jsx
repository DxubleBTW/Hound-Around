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
        <div className="drift mt-6 overflow-hidden rounded-3xl bg-gradient-to-br from-scarlet via-scarlet-dark to-ink p-6 text-paper shadow-[0_24px_50px_-20px_rgba(204,0,0,.6)]">
          <p className="font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight">
            Never lost <span className="text-paper/80">around here.</span>
          </p>
          <p className="mt-3 text-paper/85">Snap the hallway you’re in. We’ll sniff out where you are and walk you to your room.</p>
        </div>
      </header>

      <section className="mt-8 space-y-3">
        <label htmlFor="dest" className="text-sm font-semibold">Where to?</label>
        <input
          id="dest" value={dest} onChange={(e) => setDest(e.target.value)}
          placeholder="Room number, e.g. 164"
          className="w-full rounded-2xl border border-line bg-white px-4 py-3.5 text-lg shadow-sm outline-none transition focus:border-scarlet focus:ring-2 focus:ring-scarlet/20"
          autoComplete="off" inputMode="text"
        />
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button key={q.room} onClick={() => setDest(q.room)}
              className={`min-h-[44px] rounded-full border px-3 py-1.5 text-sm transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet ${dest === q.room ? 'border-scarlet bg-scarlet/10 font-semibold text-scarlet shadow-sm' : 'border-line text-muted'}`}>
              {q.label}
            </button>
          ))}
        </div>

        <button onClick={() => setAccessible(!accessible)} role="switch" aria-checked={accessible}
          className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-3.5 shadow-sm transition active:scale-[.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">
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
          className="group relative flex min-h-[44px] w-full items-center justify-center gap-3 overflow-hidden rounded-3xl bg-gradient-to-b from-scarlet to-scarlet-dark py-5 font-display text-xl font-bold text-white shadow-[0_14px_34px_-10px_rgba(204,0,0,.65)] transition-transform duration-150 active:scale-[.98] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scarlet">
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/10 to-white/15 opacity-0 transition-opacity group-active:opacity-100" />
          {busy ? <span className="paw-trail inline-flex gap-1" aria-hidden><span>🐾</span><span>🐾</span><span>🐾</span></span> : <CameraIcon />}
          <span className="relative">{busy ? 'Preparing…' : 'Snap the hallway'}</span>
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
