// The CDS massing used by both building drawings: six glass boxes stacked off-centre
// on a low podium, as seen from across the river. Boxes are { x, z, w, d, y, h }
// for lib/box3d.js. Shape only; no floor plans.
export const CDS_BOXES = [
  { x: 0, z: 0, w: 176, d: 70, y: 0, h: 22 }, // podium
  { x: -6, z: 0, w: 92, d: 62, y: 22, h: 34 },
  { x: 16, z: -6, w: 104, d: 66, y: 56, h: 36 },
  { x: -20, z: 8, w: 104, d: 62, y: 92, h: 34 },
  { x: 12, z: 0, w: 112, d: 68, y: 126, h: 34 },
  { x: -14, z: -6, w: 98, d: 62, y: 160, h: 32 },
  { x: 2, z: 4, w: 84, d: 56, y: 192, h: 30 },
]
// Street-level camera looking up, and the frame the home drawing uses.
export const STREET = { eye: 6, dist: 330, pitch: 0.3, f: 360 }
export const STREET_VIEWBOX = [-122, -142, 244, 268]
export const STREET_YAW = 0.62
