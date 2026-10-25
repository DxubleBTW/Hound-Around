import { useEffect, useRef, useState } from 'react'
import { stockPhoto } from '../lib/stockPhotos.js'

// The ☰ menu of places (opened from the header): one tab per group of verified
// destinations (lib/destinations.js), then "Spots to know" photo tiles. Choosing
// anything sets where you're going and closes the menu. The photos are generic
// stock scenes (lib/stockPhotos.js), never CDS: no building photo is shown or stored.
const TILES = [
  { value: 'F2_open_study', photo: stockPhoto('libraryAisle'), h: 190 },
  { value: 'F1_cafe_entry', photo: stockPhoto('latte'), h: 150 },
  { value: 'Spark', photo: stockPhoto('laptops'), h: 150 },
  { value: '164', photo: stockPhoto('classroom'), h: 190 },
]

const split = (label = '') => label.split(' · ')

export default function PlacesMenu({ open, onClose, groups, selected, onPick }) {
  const [tab, setTab] = useState(0)
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    panel.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const find = (v) => { for (const g of groups) { const item = g.items.find((q) => q.value === v); if (item) return { item, g } } return null }
  const tiles = TILES.map((t) => ({ ...t, ...find(t.value) })).filter((t) => t.item)
  const group = groups[tab] || groups[0]
  const pick = (value) => { onPick(value); onClose() }

  return (
    <div className={`fixed inset-0 z-40 bg-night transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} aria-hidden={!open}>
      <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Places in CDS"
        className={`mx-auto flex h-full max-w-md flex-col overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] outline-none transition-transform duration-300 ease-[cubic-bezier(.23,1,.32,1)] ${open ? 'translate-y-0' : '-translate-y-3'}`}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[26px] font-semibold">Places in CDS</h2>
          <button type="button" onClick={onClose} aria-label="Close places" className="grid h-11 w-11 place-items-center rounded-sm hover:bg-panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* One tab per group of places. */}
        <div role="tablist" aria-label="Kinds of places" className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
          {groups.map((g, k) => (
            <button key={g.title} type="button" role="tab" aria-selected={k === tab} onClick={() => setTab(k)}
              className={`press min-h-[40px] shrink-0 rounded-sm px-3.5 text-[15px] ${k === tab ? 'bg-snow font-bold text-night' : 'bg-panel text-snow'}`}>
              {g.title}
            </button>
          ))}
        </div>
        <ul role="tabpanel" aria-label={group?.title} className="mt-3 space-y-1">
          {(group?.items || []).map((q) => {
            const [name, floor] = split(q.label || q.name)
            const on = selected === q.value
            return (
              <li key={q.value}>
                <button type="button" onClick={() => pick(q.value)} aria-pressed={on}
                  className={`press flex min-h-[56px] w-full items-center justify-between gap-3 rounded-sm px-3 text-left ${on ? 'bg-snow text-night' : 'hover:bg-panel'}`}>
                  <span className="min-w-0">
                    <span className="block text-[17px] font-semibold">{name}</span>
                    {(q.note || floor || q.floor) && (
                      <span className={`block text-sm ${on ? 'text-night/70' : 'text-mist'}`}>{[q.note, floor || q.floor].filter(Boolean).join(' · ')}</span>
                    )}
                  </span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                </button>
              </li>
            )
          })}
        </ul>

        {tiles.length > 0 && (
          <section className="mt-6" aria-labelledby="spots-to-know">
            <h3 id="spots-to-know" className="font-display text-[22px] font-semibold">Spots to know</h3>
            <div className="mt-3 columns-2 gap-3">
              {tiles.map(({ value, photo, h, item, g }) => {
                const [title, floor] = split(item.label)
                return (
                  <button key={value} type="button" onClick={() => pick(value)} style={{ height: h }}
                    className="press group relative mb-3 block w-full break-inside-avoid overflow-hidden rounded-[3px] text-left">
                    <img src={photo} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                    <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" aria-hidden />
                    <span className="absolute left-2 top-2 rounded-sm bg-maroon px-2 py-0.5 text-[11px] font-bold text-white">{g.title}</span>
                    <span className="absolute inset-x-2.5 bottom-2.5 text-snow">
                      <span className="block text-[15px] font-bold leading-tight">{title}</span>
                      <span className="mt-0.5 block text-[12px] text-white/75">{[item.note, floor || item.floor].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-dim">Photos are stock images, not CDS.</p>
          </section>
        )}
      </aside>
    </div>
  )
}
