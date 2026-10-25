import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shrinkImage, BLUR_THRESHOLD } from '../lib/image.js'
import { ALL_DESTS, destinationLabel, resolveDestination } from '../lib/destinations.js'
import { destinationFloor } from '../lib/floors.js'
import Paw from '../components/Paw.jsx'
import Icon from '../components/Icon.jsx'
import Illustration from '../components/Illustration.jsx'
import Scene from '../components/Scene.jsx'
import Highlights from '../components/Highlights.jsx'
import BuildingArt from '../components/BuildingArt.jsx'
import ThemeSwitch from '../components/ThemeSwitch.jsx'
import { switchTheme, useTheme } from '../lib/theme.js'
import PhotoLoader from '../components/PhotoLoader.jsx'
import SaveSpot from '../components/SaveSpot.jsx'
import { loadPhoto, loadSaved, storePhoto, storeSaved, upsertSaved } from '../lib/savedSpots.js'
import MenuSheet from '../components/MenuSheet.jsx'
import CameraTips from '../components/CameraTips.jsx'
import { Chip, focusRing } from '../components/ui.jsx'

// The ways of finding you, as a layered deck.
const METHODS = [
  { id: 'camera', icon: 'camera', title: 'Use camera', body: 'Snap the hallway you’re in' },
  { id: 'manual', icon: 'door', title: 'Manual locator', body: 'Type the room number beside you' },
]

export default function Snap({ dest, setDest, accessible, setAccessible, onPhoto, onManual, destinations = ALL_DESTS, destinationGroups, resolvePlace = resolveDestination, roomLabels = {}, buildingLabel = 'this building', building = null, schoolName = '', onSchoolChange }) {
  // Only sections that have somewhere to go.
  const groups = (destinationGroups || [{ title: 'Destinations', items: destinations }]).filter((g) => g.items.length)
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const [menu, setMenu] = useState(false)
  const [tips, setTips] = useState(false)
  // Photo tips show when you choose the camera, unless you asked to skip them on this phone.
  const [skipTips, setSkipTips] = useState(() => { try { return localStorage.getItem('hound.skipPhotoTips') === '1' } catch { return false } })
  const rememberSkip = (v) => { setSkipTips(v); try { localStorage.setItem('hound.skipPhotoTips', v ? '1' : '0') } catch { /* storage unavailable */ } }
  // Where the building drawing is on screen (and its angle), for the manual locator to grow from.
  const buildingRect = () => {
    const el = document.querySelector('[data-building-art]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height, yaw: Number(el.dataset.yaw) }
  }
  const startCamera = () => { if (skipTips) input.current?.click(); else setTips(true) }
  const [open, setOpen] = useState(null) // which section bar is expanded; null = the one holding your pick, else the first
  const [query, setQuery] = useState('') // what you last typed; drives Results, never the bars
  // Spots you saved (this phone only), and the save/edit window.
  const [saved, setSaved] = useState(() => loadSaved(building?.id).map((sp) => ({ ...sp, photo: loadPhoto(building?.id, sp.value) })))
  const [saving, setSaving] = useState(null) // null, or { value?, name?, note? } to start from
  const keepSaved = (list) => { setSaved(list); storeSaved(building?.id, list.map(({ photo, ...rest }) => rest)) }
  // Save or update a spot (its photo under its own key); false if the photo didn't fit.
  const saveSpot = (sp) => {
    const moved = saving?.value && saving.value !== sp.value
    if (moved) storePhoto(building?.id, saving.value, null)
    const kept = storePhoto(building?.id, sp.value, sp.photo)
    const photo = kept ? sp.photo : null
    keepSaved(upsertSaved(moved ? saved.filter((x) => x.value !== saving.value) : saved, sp).map((x) => (x.value === sp.value ? { ...x, photo } : x)))
    if (kept) setSaving(null)
    return kept
  }
  const nameFor = (v) => {
    const item = groups.flatMap((g) => g.items).find((q) => q.value === v)
    return item ? (item.label || '').split(' · ')[0] : v ? destinationLabel(v, roomLabels) : ''
  }
  const theme = useTheme()
  const [pop, setPop] = useState(0)
  // Deck drag: the front card follows the finger; past 70 px it flips to the back.
  const [slide, setSlide] = useState(0)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef(null)
  const moved = useRef(false)
  const onDeckDown = (e) => { start.current = e.clientX; moved.current = false; setDragging(true); e.currentTarget.setPointerCapture?.(e.pointerId) }
  const onDeckMove = (e) => {
    if (start.current == null) return
    const dx = e.clientX - start.current
    if (Math.abs(dx) > 6) moved.current = true
    setDrag(dx)
  }
  const onDeckUp = () => {
    if (start.current == null) return
    if (Math.abs(drag) > 70) setSlide((k) => (k + 1) % METHODS.length)
    start.current = null; setDragging(false); setDrag(0)
  }
  // Places panel: opens when you tap the search bar; swipe its handle down to put it away.
  const [hidden, setHidden] = useState(true)
  const [pull, setPull] = useState(0)
  const pullStart = useRef(null)
  const pulled = useRef(false)
  const onPanelDown = (e) => { pullStart.current = e.clientY; pulled.current = false; e.currentTarget.setPointerCapture?.(e.pointerId) }
  const onPanelMove = (e) => {
    if (pullStart.current == null) return
    const dy = e.clientY - pullStart.current
    if (Math.abs(dy) > 6) pulled.current = true
    setPull(Math.max(0, dy))
  }
  const onPanelUp = () => {
    if (pullStart.current == null) return
    if (!pulled.current || pull > 60) setHidden(true)
    pullStart.current = null; setPull(0)
  } // bumps on every choice, replaying the pop
  const active = useRef(true)
  const preparation = useRef(0)
  useEffect(() => {
    active.current = true
    return () => { active.current = false; preparation.current += 1 }
  }, [])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const request = ++preparation.current
    setHint('')
    setBusy(true)
    try {
      const blob = await shrinkImage(file)
      if (!active.current || request !== preparation.current) return
      // On-phone blur/blank check: don't upload a photo that can't match.
      if (typeof blob.sharpness === 'number' && blob.sharpness < BLUR_THRESHOLD) {
        setHint('That looked blurry or blank. Step back and point down the hallway or at a room number.')
        return
      }
      onPhoto({ blob, url: URL.createObjectURL(blob) })
    } catch (err) {
      if (active.current && request === preparation.current) setHint(err?.message || 'We could not prepare this photo. Take another photo or choose a JPEG or PNG file.')
    } finally {
      if (active.current && request === preparation.current) setBusy(false)
    }
  }

  const resolved = resolvePlace(dest)
  const hasDest = !!dest.trim()
  const picked = groups.flatMap((g) => g.items).find((q) => q.value === resolved)
  // Listed places read by their own name; internal ids (like F2_open_study) never show.
  const placeName = picked ? (picked.label || '').split(' · ')[0] : destinationLabel(resolved, roomLabels)
  const fieldValue = picked && dest === picked.value && !/^[a-z]?\d+[a-z]?$/i.test(dest) ? placeName : dest
  const floor = hasDest ? (() => { const f = destinationFloor(resolved, roomLabels); return f.name ? f : { name: picked?.floor || ((picked?.label || '').split(' · ')[1] || '') } })() : { name: '' }
  // A typed place we can't match: not a listed destination, not a room number or node id.
  const known = groups.some((g) => g.items.some((q) => q.value === resolved))
  const notFound = hasDest && !known && !/^[a-z]?\d+[a-z]?$/i.test(resolved) && !/^[bf]\d?_/i.test(resolved)
  // Search results across every section. Words match a place's name, note, floor or
  // section ("food", "study", "bathroom"); a typed phrase the resolver maps (like
  // "floor 2 bathroom") comes first. Only listed places, plus the typed room itself.
  const q = query.trim().toLowerCase()
  const ALIASES = { bathroom: 'restroom', toilet: 'restroom', washroom: 'restroom', cafe: 'café', coffee: 'café', eat: 'food', lunch: 'food', snack: 'food', library: 'study', work: 'study', hack: 'hacking' }
  const words = q.split(/\s+/).filter(Boolean).map((w) => Object.entries(ALIASES).find(([k]) => w.startsWith(k))?.[1] || w)
  const hit = q && groups.flatMap((g) => g.items.map((item) => ({ item, g }))).filter(({ item, g }) => {
    const hay = [item.value, item.label, item.note, item.floor, destinationFloor(item.value, roomLabels).name, g.title].filter(Boolean).join(' ').toLowerCase()
    return item.value.toLowerCase() === resolvePlace(query).toLowerCase() || words.every((w) => hay.includes(w))
  }).sort((a, b) => (b.item.value === resolvePlace(query)) - (a.item.value === resolvePlace(query)))
  const results = hit || []
  const typedRoom = /^[a-z]?\d+[a-z]?$/i.test(query.trim()) && !results.some(({ item }) => item.value.toLowerCase() === q) ? query.trim().toUpperCase() : ''
  const openTitle = open ?? (groups.find((g) => g.items.some((q) => q.value === resolved)) || groups[0])?.title
  // Bullets for the chosen place: its sourced details, then what the route itself tells us.
  const bullets = [...(picked?.details || []), 'Step-free route by elevator'].filter(Boolean)

  return (
    <main className="rise flex flex-1 flex-col">
      {/* Floating search bar, as in a maps app. */}
      <div className="sticky top-[max(.5rem,env(safe-area-inset-top))] z-10 mt-2">
        <label htmlFor="dest" className="sr-only">Where to?</label>
        <div className="glass flex h-[52px] items-center gap-2 rounded-full pl-1.5 pr-1.5">
          <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" aria-haspopup="dialog"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-fg hover:bg-raise ${focusRing}`}><Icon name="menu" size={22} /></button>
          <input
            id="dest" value={fieldValue} onChange={(e) => { setDest(e.target.value); setQuery(e.target.value); setHidden(false) }}
            onFocus={() => setHidden(false)} onClick={() => setHidden(false)}
            onBlur={(e) => { const r = resolvePlace(e.target.value); if (r !== e.target.value) setDest(r) }}
            list="dest-suggestions"
            placeholder={`Search rooms in ${buildingLabel}`}
            className="h-full min-w-0 flex-1 bg-transparent px-1 text-[16px] outline-none placeholder:text-dim"
            autoComplete="off" inputMode="text"
            aria-describedby="dest-hint"
          />
          {dest
            ? <button type="button" onClick={() => { setDest(''); setQuery('') }} aria-label="Clear destination" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-dim hover:bg-raise ${focusRing}`}><Icon name="close" size={20} /></button>
            : <Icon name="search" size={20} className="mr-2 shrink-0 text-dim" />}
          <button type="button" onClick={onSchoolChange} aria-label={`Change school. Current: ${schoolName}, ${buildingLabel}`}
            className={`lg flex h-10 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-bold ${focusRing}`}>
            <Icon name="school" size={17} />{buildingLabel}
          </button>
        </div>
        {/* Suggestions are drawn ONLY from the verified set so nothing implies rooms we can't route to. */}
        <datalist id="dest-suggestions">
          {destinations.map((d) => <option key={d.value} value={d.value}>{d.label || d.name}</option>)}
        </datalist>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <Chip selected={accessible} icon="elevator" onClick={() => setAccessible(!accessible)} role="switch" aria-checked={accessible}>Elevators only</Chip>
        <ThemeSwitch />
      </div>
      {/* A layered deck: drag the front card sideways to flip to the next way of finding you. */}
      <div className="relative mt-4" style={{ height: 132 + (METHODS.length - 1) * 12 }} role="group" aria-label="Ways to find where you are">
        {METHODS.map((m, k) => {
          const depth = (k - slide + METHODS.length) % METHODS.length
          const front = depth === 0
          const camera = m.id === 'camera'
          const off = !hasDest || notFound
          const style = front
            ? { transform: `translateX(${drag}px) rotate(${drag / 28}deg)`, zIndex: 10, transition: dragging ? 'none' : undefined }
            : { transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.05})`, zIndex: 10 - depth }
          return (
            <button key={m.id} type="button" disabled={busy} tabIndex={front ? 0 : -1} aria-hidden={!front}
              onPointerDown={front ? onDeckDown : undefined} onPointerMove={front ? onDeckMove : undefined}
              onPointerUp={front ? onDeckUp : undefined} onPointerCancel={front ? onDeckUp : undefined}
              onClick={() => { if (moved.current || off) return; if (camera) startCamera(); else onManual(buildingRect()) }}
              aria-label={`${m.title}. ${off ? 'Pick a destination first' : m.body}`}
              style={{ ...style, touchAction: 'pan-y' }}
              className={`lg-bright deck-solid absolute inset-x-0 top-0 flex h-[132px] w-full origin-top select-none items-center gap-3 overflow-hidden rounded-[26px] pl-3 pr-5 text-left transition-[transform,opacity] duration-300 ease-out disabled:opacity-50 ${front ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'} ${focusRing}`}>
              {/* A little scene of each way of finding you; paws while a photo is being prepared. */}
              <span className={`flex h-[120px] w-[96px] shrink-0 items-end justify-center ${front ? '' : 'opacity-0'}`}>
                {busy && camera
                  ? <span className="paw-trail mb-10 inline-flex gap-0.5" aria-hidden><span><Paw size={12} /></span><span><Paw size={12} /></span><span><Paw size={12} /></span></span>
                  : <Illustration name={m.id} className="h-full w-full" />}
              </span>
              <span className={`min-w-0 flex-1 ${front ? '' : 'opacity-0'}`}>
                <span className="font-display block text-[22px] font-bold leading-tight">{busy && camera ? 'Preparing…' : m.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-ink/65">{off ? 'Pick a destination first' : m.body}</span>
                <span className="mt-2 block text-[12px] font-semibold text-ink/50">{k + 1} of {METHODS.length} · swipe for {METHODS[(k + 1) % METHODS.length].title.toLowerCase()}</span>
              </span>
              <Icon name="back" size={22} className={`shrink-0 rotate-180 ${front ? '' : 'opacity-0'} text-ink`} />
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
        {METHODS.map((m, k) => <span key={m.id} className={`h-1.5 rounded-full transition-all ${k === slide ? 'w-5 bg-fg' : 'w-1.5 bg-fg/25'}`} />)}
      </div>

      {/* The building you chose, then the spots worth knowing inside it. */}
      <BuildingArt id={building?.id} name={building?.name} address={building?.address} school={schoolName} />
      <Highlights groups={groups} selected={resolved} onPick={(v) => { setDest(v); setPop((n) => n + 1) }}
        saved={saved} onAdd={() => setSaving({})} onEdit={(sp) => setSaving(sp)} />
      <div className="h-8" aria-hidden />

      <p id="dest-hint" className="sr-only">Type a room number or choose one of this building’s suggestions.</p>

      {/* The places panel layers over the deck; swipe it down to a peek and back up. */}
      <section aria-label="Places" aria-hidden={hidden}
        style={{ transform: hidden ? 'translateY(calc(100% + 24px))' : `translateY(${pull}px)`, visibility: hidden ? 'hidden' : 'visible', transition: pullStart.current != null ? 'none' : hidden ? 'transform .3s ease-out, visibility 0s .3s' : 'transform .3s ease-out' }}
        className="glass-strong fixed inset-x-0 bottom-0 z-10 mx-auto flex max-h-[72vh] max-w-md flex-col rounded-t-[30px] border-b-0 transition-transform duration-300 ease-out">
        <button type="button" onPointerDown={onPanelDown} onPointerMove={onPanelMove} onPointerUp={onPanelUp} onPointerCancel={onPanelUp}
          aria-label="Hide places" style={{ touchAction: 'none' }}
          className={`flex w-full shrink-0 cursor-grab flex-col items-center pb-1 pt-2.5 ${focusRing} rounded-t-[30px]`}>
          <span aria-hidden className="h-1 w-9 rounded-full bg-fg/30" />
        </button>
        <div className={`no-scrollbar min-h-0 flex-1 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] ${hidden ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {notFound ? (
          <section className="flex items-start gap-3" aria-live="polite">
            <span className="lg flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-[20px] font-bold" aria-hidden>?</span>
            <div>
              <p className="text-[16px] font-semibold">No match for “{dest.trim()}”</p>
              <p className="text-[14px] text-dim">Try a room number like 164, or pick a place below.</p>
            </div>
          </section>
        ) : hasDest ? (
          <section>
            {/* Keyed by the value, so choosing another room rolls the new name in. */}
            <p className="font-display text-[24px] font-bold leading-tight" aria-live="polite">
              <span key={resolved} className="value-in">{placeName}</span>
            </p>
            <p className="mt-0.5 text-[14px] text-dim">
              <span key={`${resolved}|${accessible}`} className="value-in value-in-late">{[floor.name, buildingLabel, accessible ? 'Elevators only' : ''].filter(Boolean).join(' · ')}</span>
            </p>
            {hint && <p role="alert" className="mt-3 rounded-xl bg-tint px-4 py-3 text-[14px] text-rose">{hint}</p>}
          </section>
        ) : (
          <section>
            <p className="font-display text-[22px] font-bold">Where to?</p>
            <p className="mt-0.5 text-[14px] text-dim">Search or pick a room below.</p>
          </section>
        )}

        {/* One long bar per section; open one to see its places. */}
        <div className="-mx-2.5 mt-6 flex flex-col gap-2.5">
          {groups.map((g) => {
            const isOpen = g.title === openTitle
            const has = g.items.some((q) => q.value === resolved)
            return (
              <section key={g.title}>
                <button type="button" onClick={() => setOpen(isOpen ? '' : g.title)} aria-expanded={isOpen} aria-controls={`sec-${g.icon}`}
                  className={`lg relative isolate flex min-h-[64px] w-full items-center gap-3 overflow-hidden rounded-[20px] px-3.5 text-left text-white ${isOpen ? 'ring-2 ring-white/80' : ''} ${focusRing}`}>
                  {/* The place's colours behind frosted glass; a scrim keeps the label readable. */}
                  <Scene name={g.icon} className={`-z-10 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-75'}`} />
                  <span className="absolute inset-0 -z-10 bg-gradient-to-r from-black/55 via-black/30 to-black/15" aria-hidden />
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30 [backdrop-filter:blur(8px)]"><Icon name={g.icon || 'door'} size={18} /></span>
                  <span className="flex-1 text-[16px] font-semibold [text-shadow:0_1px_8px_rgba(0,0,0,.45)]">{g.title}</span>
                  {has && !isOpen && <span className="h-2 w-2 rounded-full bg-white" aria-label="Your pick is here" />}
                  <span className="rounded-full bg-black/30 px-2 py-0.5 text-[12px] font-semibold tabular-nums">{g.items.length}</span>
                  <Icon name="chevron" size={18} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <ul id={`sec-${g.icon}`} className="rise mt-1 px-3.5">
                    {g.items.map((q) => {
                      const [title, rest] = (q.label || q.name).split(' · ')
                      const f = destinationFloor(q.value, roomLabels)
                      const where = [q.note, rest || q.floor || f.name].filter(Boolean).join(' · ')
                      const selected = resolved === q.value
                      return (
                        <li key={q.value}>
                          <button type="button" onClick={() => { setDest(q.value); setPop((n) => n + 1) }} aria-pressed={selected}
                            className={`-mx-2 flex min-h-[60px] w-[calc(100%+1rem)] items-center gap-4 rounded-2xl px-2 text-left transition-colors ${selected ? 'bg-tint' : 'hover:bg-raise'} ${focusRing}`}>
                            <span className="min-w-0 flex-1 border-b border-edge/70 py-3">
                              <span className="block text-[16px] font-semibold">{title}</span>
                              <span className="block text-[14px] text-dim">{where}</span>
                            </span>
                            {selected && <span className="pop shrink-0"><Icon name="check" size={20} strokeWidth={2.4} className="text-rose" /></span>}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
        </div>

        {/* Everything your search matches, from every section. The bars above stay as they are. */}
        {q && (
          <section className="mt-7" aria-live="polite">
            <h2 className="text-[13px] font-semibold uppercase tracking-[.08em] text-dim">Results for “{query.trim()}”</h2>
            <ul className="mt-1">
              {results.map(({ item, g }) => {
                const [title, rest] = (item.label || item.name).split(' · ')
                const where = [item.note, rest || item.floor || destinationFloor(item.value, roomLabels).name].filter(Boolean).join(' · ')
                const selected = resolved === item.value
                return (
                  <li key={item.value}>
                    <button type="button" onClick={() => { setDest(item.value); setPop((n) => n + 1) }} aria-pressed={selected}
                      className={`-mx-2 flex min-h-[60px] w-[calc(100%+1rem)] items-center gap-4 rounded-2xl px-2 text-left transition-colors ${selected ? 'bg-tint' : 'hover:bg-raise'} ${focusRing}`}>
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-fg text-ink' : 'bg-raise text-dim'}`}><Icon name={g.icon || 'door'} size={20} /></span>
                      <span className="min-w-0 flex-1 border-b border-edge/70 py-3">
                        <span className="block text-[16px] font-semibold">{title}</span>
                        <span className="block text-[14px] text-dim">{[g.title !== title && g.title, where].filter(Boolean).join(' · ')}</span>
                      </span>
                      {selected && <span className="pop shrink-0"><Icon name="check" size={20} strokeWidth={2.4} className="text-rose" /></span>}
                    </button>
                  </li>
                )
              })}
              {typedRoom && (
                <li>
                  <button type="button" onClick={() => { setDest(typedRoom); setPop((n) => n + 1) }} aria-pressed={resolved === typedRoom}
                    className={`-mx-2 flex min-h-[60px] w-[calc(100%+1rem)] items-center gap-4 rounded-2xl px-2 text-left ${resolved === typedRoom ? 'bg-tint' : 'hover:bg-raise'} ${focusRing}`}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raise text-dim"><Icon name="door" size={20} /></span>
                    <span className="min-w-0 flex-1 border-b border-edge/70 py-3">
                      <span className="block text-[16px] font-semibold">Room {typedRoom}</span>
                      <span className="block text-[14px] text-dim">Not in the suggestions · checked when you route</span>
                    </span>
                  </button>
                </li>
              )}
              {!results.length && !typedRoom && (
                <li className="flex items-center gap-3 py-3 text-[14px] text-dim">
                  <span className="lg flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-[18px] font-bold text-fg" aria-hidden>?</span>
                  Nothing in {buildingLabel} matches. Try a room number or a word like food or study.
                </li>
              )}
            </ul>
          </section>
        )}
        </div>
      </section>

      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />

      {/* The choice pop: what you picked, and the route it starts. */}
      {/* Fixed layers go to <body> so an ancestor's transform or blur can't re-anchor them. */}
      {createPortal(<>
      {busy && <PhotoLoader title="Preparing your photo…" detail="Shrinking it on your phone and checking it’s sharp."
        steps={[{ label: 'Photo ready', state: 'now' }, { label: 'Photo sent', state: 'todo' }, { label: 'Matching hallway views', state: 'todo' }]} />}
      {pop > 0 && hasDest && !notFound && !saving && (
        <div key={pop} className={`pop-in lg-bright fixed inset-x-4 z-20 ${hidden ? 'bottom-[max(1.25rem,env(safe-area-inset-bottom))]' : 'bottom-[132px]'} mx-auto max-w-[24rem] rounded-[28px] p-4 pr-3`} role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-fg"><Icon name={picked ? (groups.find((g) => g.items.includes(picked))?.icon || 'pin') : 'pin'} size={20} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex w-full items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                <span className="shrink-0">You</span><span className="route-draw route-dots block h-1.5 min-w-[48px] grow basis-0 text-ink/45" /><span className="min-w-0 truncate">{floor.name || buildingLabel}</span>
              </div>
              <p className="truncate text-[17px] font-bold text-ink"><span key={resolved} className="value-in">{placeName}</span></p>
            </div>
            <button type="button" onClick={() => setSaving(saved.find((x) => x.value === resolved) || { value: resolved })}
              aria-label={saved.some((x) => x.value === resolved) ? 'Edit saved spot' : 'Save this spot'}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-ink/10 ${saved.some((x) => x.value === resolved) ? 'bg-ink text-fg' : 'text-ink/70'} ${focusRing}`}>
              <Icon name="bookmark" size={17} strokeWidth={2} />
            </button>
            <button type="button" onClick={() => setPop(0)} aria-label="Hide details" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/60 hover:bg-ink/10 ${focusRing}`}><Icon name="close" size={18} /></button>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5 border-t border-ink/10 pt-3 text-[14px] text-ink/75">
            {bullets.map((b, k) => (
              <li key={`${resolved}${k}`} className="value-in flex! items-start gap-2.5" style={{ animationDelay: `${80 + k * 60}ms` }}>
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink/45" aria-hidden />{b}
              </li>
            ))}
          </ul>
        </div>
      )}

      </>, document.body)}
      <MenuSheet open={menu} onClose={() => setMenu(false)} items={[
        { section: 'Find where I am', icon: 'camera', label: 'Find me with the camera', note: hasDest ? 'Snap the hallway you’re in' : 'Pick a destination first', primary: true, disabled: !hasDest || busy,
          onClick: () => { setMenu(false); startCamera() } },
        { icon: 'door', label: 'Manual locator', note: hasDest ? 'Type the room you’re next to' : 'Pick a destination first', disabled: !hasDest || busy,
          onClick: () => { setMenu(false); onManual(buildingRect()) } },
        { section: 'Route', icon: 'elevator', label: 'Elevators only', note: 'Accessible route, no stairs', toggle: accessible,
          onClick: () => setAccessible(!accessible) },
        { section: 'Appearance', icon: theme === 'dark' ? 'moon' : 'sun', label: 'Dark mode', note: theme === 'dark' ? 'On' : 'Off', toggle: theme === 'dark',
          onClick: (e) => { const r = e.currentTarget.getBoundingClientRect(); switchTheme(theme === 'dark' ? 'light' : 'dark', { x: r.right - 30, y: r.top + r.height / 2 }) } },
        { section: 'Building', icon: 'school', label: 'Change building', note: `${schoolName} · ${buildingLabel}`,
          onClick: () => { setMenu(false); onSchoolChange?.() } },
      ]} />
      <SaveSpot open={!!saving} initial={saving} onClose={() => setSaving(null)}
        destinations={destinations} resolvePlace={resolvePlace} nameFor={nameFor}
        onSave={saveSpot}
        onRemove={() => { storePhoto(building?.id, saving?.value, null); keepSaved(saved.filter((x) => x.value !== saving?.value)); setSaving(null) }} />
      <CameraTips open={tips} onClose={() => setTips(false)} skip={skipTips} onSkipChange={rememberSkip}
        onContinue={() => { setTips(false); input.current?.click() }} />
    </main>
  )
}
