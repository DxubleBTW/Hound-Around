import Icon from './Icon.jsx'
import { focusRing } from './ui.jsx'
import { stockPhoto } from '../lib/stockPhotos.js'

const studyAisle = stockPhoto('libraryAisle')
const lab = stockPhoto('laptops')
const cafe = stockPhoto('latte')
const hall = stockPhoto('classroom')
const book = stockPhoto('bookshelf')
const coffee = stockPhoto('food')
const restroom = stockPhoto('washroom')

// A saved spot borrows its section's photo (or its own tile's), so it fits in.
const SECTION_PHOTO = { flag: hall, book, coffee, restroom }

// Tiles for places worth knowing about. Every `value` is a verified destination in
// lib/destinations.js; the tile only adds a photo and a shape. Heights vary so the
// two columns stagger like a pinboard.
const TILES = [
  { value: 'F2_open_study', photo: studyAisle, h: 230 },
  { value: 'F1_cafe_entry', photo: cafe, h: 170 },
  { value: 'Spark', photo: lab, h: 180 },
  { value: '164', photo: hall, h: 220 },
]

export default function Highlights({ groups, selected, onPick, saved = [], onAdd, onEdit }) {
  const find = (v) => { for (const g of groups) { const item = g.items.find((q) => q.value === v); if (item) return { item, g } } return null }
  const tiles = TILES.map((t) => ({ ...t, ...find(t.value) })).filter((t) => t.item)
  return (
    <section className="mt-7" aria-labelledby="highlights">
      <h2 id="highlights" className="font-display text-[22px] font-bold">Spots to know</h2>
      <div className="mt-3 columns-2 gap-3">
        {/* Yours first: spots you saved, then a tile to add one. */}
        {saved.map((sp) => {
          const hit = find(sp.value)
          const photo = sp.photo || TILES.find((t) => t.value === sp.value)?.photo || (hit && SECTION_PHOTO[hit.g.icon])
          const on = selected === sp.value
          return (
            <div key={`saved-${sp.value}`} className={`relative mb-3 break-inside-avoid overflow-hidden rounded-[22px] ${on ? 'ring-2 ring-fg' : ''}`} style={{ height: photo ? 170 : 132 }}>
              <button type="button" onClick={() => onPick(sp.value)} aria-pressed={on} className={`group absolute inset-0 block text-left ${focusRing} rounded-[22px]`}>
                {photo
                  ? <img src={photo} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  : <span className="lg absolute inset-0" aria-hidden />}
                <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" aria-hidden />
                <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-black">
                  <Icon name="bookmark" size={12} strokeWidth={2.2} />Saved
                </span>
                <span className="absolute inset-x-3 bottom-3 text-white">
                  <span className="block text-[16px] font-extrabold leading-tight">{sp.name}</span>
                  <span className="mt-0.5 block text-[12px] text-white/75">{sp.note || (hit ? (hit.item.label || '').split(' · ')[0] : `Room ${sp.value.toUpperCase()} · checked when you route`)}</span>
                </span>
              </button>
              <button type="button" onClick={() => onEdit(sp)} aria-label={`Edit ${sp.name}`}
                className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/20 [backdrop-filter:blur(10px)] ${focusRing}`}>
                <Icon name="more" size={16} />
              </button>
            </div>
          )
        })}
        {onAdd && (
          <button type="button" onClick={onAdd}
            className={`mb-3 flex h-[132px] w-full break-inside-avoid flex-col items-center justify-center gap-2 rounded-[22px] border-[1.5px] border-dashed border-fg/25 text-[14px] font-bold text-dim hover:border-fg/45 hover:text-fg ${focusRing}`}>
            <span className="lg flex h-10 w-10 items-center justify-center rounded-full text-fg"><Icon name="plus" size={20} /></span>
            Save a spot
          </button>
        )}
        {tiles.map(({ value, photo, h, item, g }) => {
          const [title, floor] = item.label.split(' · ')
          const on = selected === value
          return (
            <button key={value} type="button" onClick={() => onPick(value)} aria-pressed={on}
              style={{ height: h }}
              className={`group relative mb-3 block w-full break-inside-avoid overflow-hidden rounded-[22px] text-left ${on ? 'ring-2 ring-fg' : ''} ${focusRing}`}>
              <img src={photo} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" aria-hidden />
              <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/20 [backdrop-filter:blur(10px)_saturate(1.4)]">
                <Icon name={g.icon || 'pin'} size={13} />{g.title}
              </span>
              {on && <span className="pop absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-white text-black"><Icon name="check" size={16} strokeWidth={2.6} /></span>}
              <span className="absolute inset-x-3 bottom-3 text-white">
                <span className="block text-[16px] font-extrabold leading-tight">{title}</span>
                <span className="mt-0.5 block text-[12px] text-white/75">{[item.note, floor || item.floor].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
