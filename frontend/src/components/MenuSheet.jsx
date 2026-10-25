import { useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { focusRing } from './ui.jsx'

// A bottom-sheet menu: how to find you (camera or typing), the route setting,
// and the building. Closes on the backdrop, Escape, or after a choice.
export default function MenuSheet({ open, onClose, items }) {
  const first = useRef(null)
  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Menu">
      <button aria-label="Close menu" onClick={onClose} className="rise absolute inset-0 h-full w-full bg-black/45 backdrop-blur-sm" tabIndex={-1} />
      <div className="glass-strong rise absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-[30px] border-b-0 px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <span aria-hidden className="mx-auto mb-2 block h-1 w-9 rounded-full bg-edge" />
        <ul>
          {items.map((item, k) => (
            <li key={item.label}>
              {item.section && <p className="px-3 pb-1 pt-3 text-[13px] font-semibold text-dim">{item.section}</p>}
              <button ref={k === 0 ? first : undefined} onClick={item.onClick} disabled={item.disabled}
                role={item.toggle !== undefined ? 'switch' : undefined} aria-checked={item.toggle}
                className={`flex min-h-[60px] w-full items-center gap-4 rounded-2xl px-3 text-left transition-colors hover:bg-raise disabled:opacity-40 ${focusRing}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${item.primary ? 'bg-fg text-ink' : 'bg-raise text-fg'}`}><Icon name={item.icon} size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-semibold">{item.label}</span>
                  {item.note && <span className="block text-[13px] text-dim">{item.note}</span>}
                </span>
                {item.toggle !== undefined && (
                  <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${item.toggle ? 'bg-fg' : 'bg-edge'}`}>
                    <span className={`absolute top-1 h-5 w-5 rounded-full transition-all ${item.toggle ? 'left-6 bg-ink' : 'left-1 bg-card shadow'}`} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onClose} className={`mt-1 min-h-[48px] w-full rounded-full text-[15px] font-semibold text-dim hover:bg-raise ${focusRing}`}>Close</button>
      </div>
    </div>
  )
}
