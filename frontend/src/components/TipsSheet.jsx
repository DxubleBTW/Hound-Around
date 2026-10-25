import { useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { focusRing } from './ui.jsx'

// How to get a good match. Each tip maps to something the app actually does:
// it compares your photo to hallway views, reads room-number signs, and turns
// away blurry or blank photos before they are sent.
export const PHOTO_TIPS = [
  { icon: 'hallway', title: 'Point down the hallway', body: 'Hold the phone upright and aim along the hall, not at the floor or a blank wall.' },
  { icon: 'sign', title: 'Include a room-number sign', body: 'If a door sign is in view, get it in the frame. We read the number to confirm your floor.' },
  { icon: 'hand', title: 'Hold still for a moment', body: 'A sharp photo matches best. Blurry or dark photos are turned away so you can retake them.' },
  { icon: 'sun', title: 'Use the hallway light', body: 'Avoid pointing straight at windows or bright lights.' },
]

export default function TipsSheet({ open, onClose, onContinue, skip = false, onSkipChange }) {
  const close = useRef(null)
  useEffect(() => {
    if (!open) return
    close.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="tips-title">
      <button aria-label="Close tips" onClick={onClose} className="rise absolute inset-0 h-full w-full bg-black/45 backdrop-blur-sm" tabIndex={-1} />
      <div className="glass-strong rise absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-[30px] border-b-0 px-5 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <span aria-hidden className="mx-auto mb-3 block h-1 w-9 rounded-full bg-fg/25" />
        <p id="tips-title" className="font-display text-[24px] font-bold">Before you snap</p>
        <p className="mt-1 text-[14px] text-dim">Four quick things that help us find your spot from one photo.</p>
        <ul className="mt-4 space-y-3">
          {PHOTO_TIPS.map((t, k) => (
            <li key={t.title} className="flex gap-3">
              <span className="lg flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"><Icon name={t.icon} size={20} /></span>
              <span>
                <span className="block text-[15px] font-semibold">{k + 1}. {t.title}</span>
                <span className="block text-[13px] leading-snug text-dim">{t.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-center gap-2 text-[12px] text-dim"><Icon name="lock" size={14} />Your photo is deleted after matching. No GPS, no tracking.</p>
        <label className="mt-4 flex min-h-[44px] items-center gap-3 text-[14px]">
          <input type="checkbox" checked={skip} onChange={(e) => onSkipChange?.(e.target.checked)} className="h-5 w-5 rounded accent-fg" />
          Skip these tips next time
        </label>
        <button ref={close} onClick={onContinue || onClose} className={`lg-bright mt-2 inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold ${focusRing}`}><Icon name="camera" size={20} />Open camera</button>
        <button onClick={onClose} className={`mt-1 min-h-[44px] w-full rounded-full text-[15px] font-semibold text-dim hover:text-fg ${focusRing}`}>Not now</button>
      </div>
    </div>
  )
}
