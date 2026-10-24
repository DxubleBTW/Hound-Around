// Turn contract node ids (e.g. "F2_hall_e2", "B1_core_elev") into words a person can read.
// Node ids come from the backend; this file never invents nodes, it only formats them.

const FLOOR_NAMES = { B1: 'Lower level', F1: 'Floor 1', F2: 'Floor 2' }

const WORDS = {
  hall: 'Hallway', core: 'Tower', podium: 'Podium', elev: 'elevators', stair: 'Stairs',
  lobby: 'Lobby', cafe: 'Café', entry: 'entrance', restrooms: 'Restrooms', class70: '70-seat classroom',
  e: 'east', w: 'west', n: 'north', s: 'south',
}

export function floorOf(spot) {
  const code = String(spot || '').split('_')[0]
  return { code, name: FLOOR_NAMES[code] || code }
}

export function floorName(floorNum) {
  if (floorNum === -1) return 'Lower level'
  if (floorNum == null) return ''
  return `Floor ${floorNum}`
}

export function spotName(spot) {
  if (!spot) return 'Unknown spot'
  const parts = String(spot).split('_').slice(1)
  const words = parts.map((p) => {
    const room = p.match(/^room(\w+)$/)
    if (room) return `Room ${room[1]}`
    const m = p.match(/^([a-z]+)(\d+)$/)
    if (m && WORDS[m[1]]) return `${WORDS[m[1]]} ${m[2]}`
    return WORDS[p] || p
  })
  const s = words.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
