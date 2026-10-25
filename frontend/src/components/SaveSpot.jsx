import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { focusRing } from './ui.jsx'
import { makeThumbnail } from '../lib/thumbnail.js'

// Small window to save a spot to "Spots to know": which place, and what to call it.
// The place is any listed destination or a room number (checked when you route).
export default function SaveSpot({ open, onClose, onSave, onRemove, initial = null, destinations = [], resolvePlace = (v) => v, nameFor = (v) => v }) {
  const [place, setPlace] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [named, setNamed] = useState(false) // stop auto-filling once you type a name
  const [photo, setPhoto] = useState(null) // a small JPEG data URL, or null
  const [photoError, setPhotoError] = useState('')
  const picker = useRef(null)
  const first = useRef(null)
  useEffect(() => {
    if (!open) return
    setPlace(initial?.value ? nameFor(initial.value) : '')
    setName(initial?.name || (initial?.value ? nameFor(initial.value) : ''))
    setNote(initial?.note || '')
    setNamed(!!initial?.name)
    setPhoto(initial?.photo || null)
    setPhotoError('')
    setTimeout(() => first.current?.focus(), 30)
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null
  // A listed place by its short name ("Open student work area"), else the resolver.
  const toValue = (text) => {
    const t = text.trim().toLowerCase()
    const byName = destinations.find((d) => (d.label || '').split(' · ')[0].toLowerCase() === t)
    return byName ? byName.value : resolvePlace(text.trim())
  }
  const value = toValue(place)
  const listed = destinations.some((d) => d.value === value)
  const looksLikeRoom = /^[a-z]?\d+[a-z]?$/i.test(value) || /^[bf]\d?_/i.test(value)
  const ok = value.trim() && (listed || looksLikeRoom) && name.trim()
  // Drawn at the top of the page so no animated screen can trap or cover it.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center px-5" role="dialog" aria-modal="true" aria-labelledby="save-title">
      <button aria-label="Close" onClick={onClose} className="rise absolute inset-0 h-full w-full bg-black/60 backdrop-blur-sm" tabIndex={-1} />
      <form onSubmit={(e) => {
          e.preventDefault()
          if (!ok) return
          const kept = onSave({ value, name, note, photo })
          if (kept === false) { setPhoto(null); setPhotoError('This phone is out of space for photos, so the spot was saved without one.') }
        }}
        className="glass-strong pop-in relative w-full max-w-[22rem] rounded-[30px] p-5 pt-6">
        <button type="button" onClick={onClose} aria-label="Close" className={`lg absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full ${focusRing}`}><Icon name="close" size={16} /></button>
        <span aria-hidden className="lg-bright flex h-12 w-12 items-center justify-center rounded-2xl"><Icon name="bookmark" size={22} /></span>
        <p id="save-title" className="font-display mt-4 text-[24px] font-bold leading-tight">{initial?.name ? 'Edit saved spot' : 'Save a spot'}</p>
        <p className="mt-1 text-[14px] text-dim">It shows up in Spots to know on this phone.</p>

        <label htmlFor="save-place" className="mt-4 block text-[13px] font-semibold text-dim">Place</label>
        <input id="save-place" ref={first} value={place} list="save-places" autoComplete="off"
          onChange={(e) => { setPlace(e.target.value); if (!named) setName(nameFor(toValue(e.target.value)) || e.target.value) }}
          placeholder="Room number or a place, e.g. 263"
          className="glass mt-1.5 h-[48px] w-full rounded-2xl px-4 text-[16px] outline-none placeholder:text-dim focus:ring-2 focus:ring-fg" />
        <datalist id="save-places">{destinations.map((d) => <option key={d.value} value={(d.label || '').split(' · ')[0]} />)}</datalist>
        {place.trim() && !listed && (
          <p className="mt-1.5 text-[12px] text-dim">{looksLikeRoom ? 'Not in the suggestions. We’ll check it when you route.' : 'Pick a place from the list or type a room number.'}</p>
        )}

        <label htmlFor="save-name" className="mt-3 block text-[13px] font-semibold text-dim">Name</label>
        <input id="save-name" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setNamed(true) }} placeholder="e.g. My study table"
          className="glass mt-1.5 h-[48px] w-full rounded-2xl px-4 text-[16px] outline-none placeholder:text-dim focus:ring-2 focus:ring-fg" />

        <label htmlFor="save-note" className="mt-3 block text-[13px] font-semibold text-dim">Note <span className="font-normal">(optional)</span></label>
        <input id="save-note" value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Quiet after 5 pm"
          className="glass mt-1.5 h-[48px] w-full rounded-2xl px-4 text-[16px] outline-none placeholder:text-dim focus:ring-2 focus:ring-fg" />

        {/* Your own photo for the tile (optional). It stays on this phone. */}
        <span className="mt-3 block text-[13px] font-semibold text-dim">Photo <span className="font-normal">(optional)</span></span>
        <div className="mt-1.5 flex items-center gap-3">
          {photo
            ? <img src={photo} alt="Your photo for this spot" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-fg/15" />
            : <span className="lg flex h-16 w-16 items-center justify-center rounded-2xl text-dim" aria-hidden><Icon name="camera" size={22} /></span>}
          <div className="flex flex-col items-start gap-1">
            <button type="button" onClick={() => picker.current?.click()} className={`lg min-h-[40px] rounded-full px-4 text-[13px] font-bold ${focusRing}`}>{photo ? 'Change photo' : 'Add a photo'}</button>
            {photo && <button type="button" onClick={() => setPhoto(null)} className={`min-h-[32px] rounded-full px-2 text-[12px] font-semibold text-dim hover:text-fg ${focusRing}`}>Remove photo</button>}
          </div>
          <input ref={picker} type="file" accept="image/*" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try { setPhoto(await makeThumbnail(file)); setPhotoError('') } catch (err) { setPhotoError(err?.message || 'That photo couldn’t be opened. Try another one.') }
          }} />
        </div>
        {photoError && <p role="alert" className="mt-1.5 text-[12px] text-rose">{photoError}</p>}

        <button type="submit" disabled={!ok}
          className={`lg-bright mt-5 inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold disabled:opacity-40 ${focusRing}`}>
          <Icon name="bookmark" size={18} />Save spot
        </button>
        {onRemove && initial?.name && (
          <button type="button" onClick={onRemove} className={`mt-2 min-h-[44px] w-full rounded-2xl text-[14px] font-semibold text-dim hover:text-fg ${focusRing}`}>Remove from Spots to know</button>
        )}
        <p className="mt-3 text-center text-[12px] text-faint">Saved on this phone only, photo included. Nothing is uploaded.</p>
      </form>
    </div>,
    document.body,
  )
}
