// Explicitly public school/building metadata. No floor plans, graph edges,
// private node directory, photos, or credentials belong in this catalog.
// Add another school only after its separate backend/data package is reviewed.
import { ALL_DESTS, DEST_GROUPS, resolveDestination } from './destinations.js'
import { BU_CDS_ROOM_LABELS } from './publicRoomLabels.js'

const passThrough = (input) => String(input || '').trim()

export const CAMPUSES = [{
  id: 'bu', name: 'Boston University',
  buildings: [{
    id: 'cds', name: 'Center for Computing & Data Sciences', shortName: 'CDS',
    apiEnv: 'VITE_API_URL', enabled: true,
    destinations: ALL_DESTS,
    destinationGroups: DEST_GROUPS,
    roomLabels: BU_CDS_ROOM_LABELS,
    landmarks: [], // Only explicitly approved public landmark IDs may be added.
  }],
}]

function validBase(base) {
  if (/[\\\s?#]/.test(base)) return false
  if (base.startsWith('/') && !base.startsWith('//')) return !base.includes('..')
  try {
    const url = new URL(base)
    const transport = url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    return transport && !url.username && !url.password
      && !url.search && !url.hash
  } catch { return false }
}

export function buildingConfig(schoolId, buildingId, env = {}, campuses = CAMPUSES) {
  const school = campuses.find((item) => item.id === schoolId)
  const building = school?.buildings.find((item) => item.id === buildingId)
  if (!building) return null
  const raw = /^VITE_[A-Z0-9_]+$/.test(building.apiEnv) ? env[building.apiEnv] : null
  const base = typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : ''
  const isDefault = schoolId === 'bu' && buildingId === 'cds'
  return { ...building, schoolId, schoolName: school.name, apiBase: base,
    available: building.enabled === true && (base ? validBase(base) : isDefault),
    destinations: building.destinations || [], landmarks: building.landmarks || [],
    roomLabels: building.roomLabels || {},
    resolvePlace: isDefault ? resolveDestination : passThrough }
}
