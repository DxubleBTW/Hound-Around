import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// How to take a photo we can match (the (i) on the camera frame). Each tip maps
// to something the app does: it compares your photo with hallway views, reads
// room-number signs, and turns away blurry or blank photos before sending them.
// Tips from Jun's camera cards (PR #32).
const icon = (d) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)
export const PHOTO_TIPS = [
  { icon: icon(<path d="M3 21l6-7h6l6 7M9 14V3M15 14V3" />), title: 'Point down the hallway', body: 'Hold the phone upright and aim along the hall, not at the floor or a blank wall.' },
  { icon: icon(<><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M8 10h3M14 10h2M12 16v4" /></>), title: 'Include a room-number sign', body: 'If a door sign is in view, get it in the frame. We read the number to confirm your floor.' },
  { icon: icon(<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 14a1.5 1.5 0 0 1 2.5-1.6L8 15" />), title: 'Hold still for a moment', body: 'A sharp photo matches best. Blurry or dark photos are turned away so you can retake them.' },
  { icon: icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>), title: 'Use the hallway light', body: 'Avoid pointing straight at windows or bright lights.' },
]

export default function PhotoTips({ open, onClose }) {
  const done = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    done.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  // Drawn on the page body: the screen's entrance animation leaves a transform on
  // its container, which would otherwise trap this overlay inside it.
  return createPortal(
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="tips-title">
      <button aria-label="Close tips" onClick={onClose} tabIndex={-1} className="absolute inset-0 h-full w-full bg-black/60" />
      <div className="enter absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-[6px] bg-night px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 ring-1 ring-rule">
        <p id="tips-title" className="font-display text-[28px] font-semibold leading-tight">Taking a good photo</p>
        <p className="mt-1 text-[15px] text-mist">Four things that help us find your spot from one photo.</p>
        <ul className="mt-4 space-y-3.5">
          {PHOTO_TIPS.map((t, k) => (
            <li key={t.title} className="flex gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-panel">{t.icon}</span>
              <span>
                <span className="block font-bold">{k + 1}. {t.title}</span>
                <span className="block text-sm leading-snug text-mist">{t.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-mist">Your photo is deleted after matching. No GPS, no tracking.</p>
        <button ref={done} onClick={onClose}
          className="press mt-4 min-h-[52px] w-full rounded-sm bg-snow font-display text-[18px] font-semibold text-night">Got it</button>
      </div>
    </div>,
    document.body,
  )
}
