// Spots you saved, kept on this phone only (localStorage, one list per building).
// Nothing here is sent anywhere. A saved spot is a destination value the app can
// route to, plus your own name and note for it.
const KEY = (building) => `hound.saved.${building || 'default'}`
export const MAX_SAVED = 12

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

export function loadSaved(building) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY(building)) || '[]')
    return Array.isArray(list)
      ? list.filter((x) => x && typeof x.value === 'string' && x.value).map((x) => ({ value: clean(x.value, 40), name: clean(x.name, 40), note: clean(x.note, 60) })).slice(0, MAX_SAVED)
      : []
  } catch { return [] }
}

export function storeSaved(building, list) {
  try { localStorage.setItem(KEY(building), JSON.stringify(list.slice(0, MAX_SAVED))) } catch { /* storage unavailable: keep for this visit only */ }
}

// Add or update by destination value (one entry per place); newest first.
export function upsertSaved(list, spot) {
  const entry = { value: clean(spot.value, 40), name: clean(spot.name, 40), note: clean(spot.note, 60) }
  if (!entry.value) return list
  return [entry, ...list.filter((x) => x.value.toLowerCase() !== entry.value.toLowerCase())].slice(0, MAX_SAVED)
}

// A saved spot's own photo, if you added one: a small JPEG thumbnail kept on this
// phone only, under its own key. It is never sent anywhere, and it is separate from
// the hallway photos used for matching (those are never stored).
const PHOTO_KEY = (building, value) => `hound.savedPhoto.${building || 'default'}.${String(value).toLowerCase()}`

export function loadPhoto(building, value) {
  try {
    const v = localStorage.getItem(PHOTO_KEY(building, value))
    return v && v.startsWith('data:image/jpeg;base64,') ? v : null
  } catch { return null }
}

// Returns false if the phone has no room for it (the spot still saves without it).
export function storePhoto(building, value, dataUrl) {
  try {
    if (dataUrl) localStorage.setItem(PHOTO_KEY(building, value), dataUrl)
    else localStorage.removeItem(PHOTO_KEY(building, value))
    return true
  } catch { return false }
}
