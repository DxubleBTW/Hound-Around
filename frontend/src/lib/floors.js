import { floorOf } from './spots.js'

// Short floor mark used on signs and badges: "LL", "1", "2".
export function floorMark(code) {
  if (code === 'B1') return 'LL'
  return code ? String(code).replace(/^F/, '') : ''
}

// Node id behind a verified destination: node ids carry their floor; a room
// number finds its node in the public room labels. Never guessed.
export function destinationNode(value, roomLabels = {}) {
  if (/^[bf]\d?_/i.test(value)) return value
  return Object.keys(roomLabels).find((id) => roomLabels[id] === `Room ${value}`) || ''
}

export function destinationFloor(value, roomLabels = {}) {
  const node = destinationNode(value, roomLabels)
  return node ? floorOf(node) : { code: '', name: '' }
}
