import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { PHOTO_TIPS } from './TipsSheet.jsx'
import { focusRing } from './ui.jsx'

// A small window before the camera opens: how to take a photo we can match.
// "Don't show this again" is remembered on this phone only.
export default function CameraTips({ open, onClose, onContinue, skip, onSkipChange }) {
  const go = useRef(null)
  useEffect(() => {
    if (!open) return
    go.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  // Drawn at the top of the page so no animated screen can trap or cover it.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center px-5" role="dialog" aria-modal="true" aria-labelledby="camera-tips-title">
      <button aria-label="Close tips" onClick={onClose} className="rise absolute inset-0 h-full w-full bg-black/60 backdrop-blur-sm" tabIndex={-1} />
      <div className="glass-strong pop-in relative w-full max-w-[22rem] rounded-[30px] p-5 pt-6">
        <button onClick={onClose} aria-label="Close" className={`lg absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full ${focusRing}`}><Icon name="close" size={16} /></button>
        <span aria-hidden className="lg-bright flex h-12 w-12 items-center justify-center rounded-2xl"><Icon name="camera" size={24} /></span>
        <p id="camera-tips-title" className="font-display mt-4 text-[24px] font-bold leading-tight">Before you snap</p>
        <p className="mt-1 text-[14px] text-dim">A good photo finds your spot in one try.</p>
        <ul className="mt-4 flex flex-col gap-3">
          {PHOTO_TIPS.map((t) => (
            <li key={t.title} className="flex items-start gap-3">
              <span className="lg flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"><Icon name={t.icon} size={18} /></span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold leading-tight">{t.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-dim">{t.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <label htmlFor="camera-tips-skip" className="mt-5 flex min-h-[40px] cursor-pointer items-center gap-2.5 text-[14px]">
          <input id="camera-tips-skip" type="checkbox" checked={skip} onChange={(e) => onSkipChange(e.target.checked)} className="h-[18px] w-[18px] accent-fg" />
          Don’t show this again
        </label>
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className={`lg min-h-[50px] flex-1 rounded-2xl text-[15px] font-semibold ${focusRing}`}>Not now</button>
          <button ref={go} onClick={onContinue} className={`lg-bright inline-flex min-h-[50px] flex-[1.6] items-center justify-center gap-2 rounded-2xl text-[15px] font-bold ${focusRing}`}><Icon name="camera" size={18} />Open camera</button>
        </div>
        <p className="mt-3 text-center text-[12px] text-faint">Your photo is deleted right after matching. No GPS.</p>
      </div>
    </div>,
    document.body,
  )
}
