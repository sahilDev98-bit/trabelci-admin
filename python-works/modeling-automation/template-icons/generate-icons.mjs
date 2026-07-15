// Generates isometric "miniature room" SVG icons for the workflow's room
// templates — white/light-grey 3D cutaway rooms with simple furniture hints,
// proportioned from each template's real cm dimensions.
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const OUT = 'f:\\work\\ra\\trabelci-admin\\python-works\\modeling-automation\\template-icons'
mkdirSync(OUT, { recursive: true })

const VB_W = 280, VB_H = 160, PAD = 16
const C = Math.cos(Math.PI / 6), S = 0.5

// palette
const P = {
  floorTop: '#fbfaf8', floorRight: '#e6e2dc', floorFront: '#eeebe6',
  wallLeftIn: '#f1efeb', wallRightIn: '#e7e4de', wallTop: '#ffffff', wallEnd: '#dcd8d1',
  stroke: '#c9c5bd',
  whiteTop: '#ffffff', whiteR: '#edebe7', whiteF: '#f4f2ee',
  greyTop: '#efedea', greyR: '#d8d5cf', greyF: '#e2dfd9',
  woodTop: '#e3d7c6', woodR: '#c9b9a2', woodF: '#d6c8b4',
  glassTop: '#eef4f6', leaf1: '#8db884', leaf2: '#6f9d68', leaf3: '#a3c79a',
  grassTop: '#d7e6cd', grassRight: '#b7cdaa', grassFront: '#c6d9ba',
}

function makeIcon(t) {
  const W = t.floorWidth, D = t.floorDepth
  const H = t.wallHeight > 0 ? Math.min(t.wallHeight, 320) : 0
  const T = Math.max(10, Math.min(W, D) * 0.045) // wall thickness
  const FL = 12 // floor slab thickness

  const furniture = []
  const shapes = { furniture }
  const heff = Math.max(H, (BUILDERS[t.kind] || (() => 0))(shapes, W, D, H) || 0, 60)

  // fit projected bounds to the viewBox
  const spanX = (W + D + 2 * T) * C
  const spanY = (W + D + 2 * T) * S + heff + FL
  const scale = Math.min((VB_W - 2 * PAD) / spanX, (VB_H - 2 * PAD) / spanY)
  const midX = ((W + T) - (D + T)) * C / 2
  const midY = (((W + T) + (D + T)) * S + FL - heff) / 2
  const offX = VB_W / 2 - midX * scale
  const offY = VB_H / 2 - midY * scale

  const px = (x, z, y = 0) =>
    `${((x - z) * C * scale + offX).toFixed(1)},${(((x + z) * S - y) * scale + offY).toFixed(1)}`
  const poly = (pts, fill, extra = '') =>
    `<polygon points="${pts.map(p => px(...p)).join(' ')}" fill="${fill}" stroke="${P.stroke}" stroke-width="1" stroke-linejoin="round"${extra}/>`

  const el = []

  // soft drop shadow under the floor slab
  el.push(`<polygon points="${[[0, 0], [W + T, 0], [W + T, D + T], [0, D + T]].map(p => px(p[0], p[1], -FL - 6)).join(' ')}" fill="#000" opacity="0.10" filter="url(#blur)"/>`)

  // floor slab: top + two front faces
  el.push(poly([[0, D, -FL], [W, D, -FL], [W, D, 0], [0, D, 0]], P.floorFront))
  el.push(poly([[W, 0, -FL], [W, D, -FL], [W, D, 0], [W, 0, 0]], P.floorRight))

  if (H > 0) {
    // left wall (x∈[-T,0], z∈[0,D]) — inner face, top, front end
    el.push(poly([[0, 0, 0], [0, D, 0], [0, D, H], [0, 0, H]], P.wallLeftIn))
    el.push(poly([[-T, 0, H], [0, 0, H], [0, D, H], [-T, D, H]], P.wallTop))
    el.push(poly([[-T, D, -FL], [0, D, -FL], [0, D, H], [-T, D, H]], P.wallEnd))
    // right wall (z∈[-T,0], x∈[0,W]) — inner face, top, front end
    el.push(poly([[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]], P.wallRightIn))
    el.push(poly([[0, -T, H], [W, -T, H], [W, 0, H], [0, 0, H]], P.wallTop))
    el.push(poly([[W, -T, -FL], [W, 0, -FL], [W, 0, H], [W, -T, H]], P.wallEnd))
  }

  // floor top (over wall bases so the room reads as one platform)
  el.push(poly([[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]], shapes.floorColor || P.floorTop))

  // furniture boxes, painter-sorted back-to-front
  furniture.sort((a, b) => (a.x + a.z) - (b.x + b.z))
  for (const f of furniture) {
    if (f.type === 'ellipse') {
      const [cx, cy] = px(f.x, f.z, f.y).split(',').map(Number)
      el.push(`<ellipse cx="${cx}" cy="${cy}" rx="${(f.rx * scale).toFixed(1)}" ry="${(f.ry * scale).toFixed(1)}" fill="${f.fill}" stroke="${P.stroke}" stroke-width="0.8"/>`)
      continue
    }
    const { x, z, w, d, h, y = 0, top = P.whiteTop, right = P.whiteR, front = P.whiteF } = f
    el.push(poly([[x, z + d, y], [x + w, z + d, y], [x + w, z + d, y + h], [x, z + d, y + h]], front))
    el.push(poly([[x + w, z, y], [x + w, z + d, y], [x + w, z + d, y + h], [x + w, z, y + h]], right))
    el.push(poly([[x, z, y + h], [x + w, z, y + h], [x + w, z + d, y + h], [x, z + d, y + h]], top))
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB_W} ${VB_H}">
<defs><filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter></defs>
<rect width="${VB_W}" height="${VB_H}" fill="#f7f6f3"/>
${el.join('\n')}
</svg>\n`
}

// ── furniture builders: push boxes into shapes.furniture, return tallest y ──
const wood = { top: P.woodTop, right: P.woodR, front: P.woodF }
const grey = { top: P.greyTop, right: P.greyR, front: P.greyF }

function bed(f, W, D, bw, bl) {
  const cx = W / 2
  f.push({ x: cx - bw / 2 - 8, z: 4, w: bw + 16, d: 10, h: 78, ...wood })                 // headboard
  f.push({ x: cx - bw / 2 - 6, z: 14, w: bw + 12, d: bl + 10, h: 20, ...wood })           // platform
  f.push({ x: cx - bw / 2, z: 18, w: bw, d: bl, h: 22, y: 20 })                            // mattress
  f.push({ x: cx - bw / 2 + 8, z: 22, w: bw / 2 - 12, d: 26, h: 14, y: 42, ...grey })      // pillows
  f.push({ x: cx + 4, z: 22, w: bw / 2 - 12, d: 26, h: 14, y: 42, ...grey })
  return 98
}

function plant(f, x, z, s = 1) {
  f.push({ x, z, w: 34 * s, d: 34 * s, h: 34 * s, ...grey })
  f.push({ type: 'ellipse', x: x + 17 * s, z: z + 17 * s, y: 62 * s, rx: 26 * s, ry: 20 * s, fill: P.leaf2 })
  f.push({ type: 'ellipse', x: x + 4 * s, z: z + 22 * s, y: 48 * s, rx: 18 * s, ry: 14 * s, fill: P.leaf1 })
  f.push({ type: 'ellipse', x: x + 28 * s, z: z + 8 * s, y: 50 * s, rx: 16 * s, ry: 13 * s, fill: P.leaf3 })
}

const BUILDERS = {
  'bedroom-small': (s, W, D) => bed(s.furniture, W, D, 140, 190),
  'bedroom-medium': (s, W, D) => {
    const h = bed(s.furniture, W, D, 160, 200)
    s.furniture.push({ x: W / 2 - 160 / 2 - 50, z: 14, w: 38, d: 38, h: 40, ...wood })
    s.furniture.push({ x: W / 2 + 160 / 2 + 12, z: 14, w: 38, d: 38, h: 40, ...wood })
    return h
  },
  'bedroom-master': (s, W, D) => {
    const h = bed(s.furniture, W, D, 180, 210)
    s.furniture.push({ x: W / 2 - 180 / 2 - 56, z: 14, w: 42, d: 42, h: 42, ...wood })
    s.furniture.push({ x: W / 2 + 180 / 2 + 14, z: 14, w: 42, d: 42, h: 42, ...wood })
    plant(s.furniture, W - 70, D * 0.45, 0.9)
    return h
  },
  'living': (s, W, D) => {
    const f = s.furniture, sl = Math.min(220, D * 0.5), z0 = D * 0.22
    f.push({ x: 8, z: z0, w: 84, d: sl, h: 36 })                                           // sofa base
    f.push({ x: 8, z: z0, w: 20, d: sl, h: 66, ...grey })                                  // backrest
    f.push({ x: 8, z: z0 - 16, w: 84, d: 16, h: 50, ...grey })                             // arms
    f.push({ x: 8, z: z0 + sl, w: 84, d: 16, h: 50, ...grey })
    f.push({ x: W * 0.45, z: z0 + sl * 0.2, w: 110, d: 62, h: 30, ...wood })               // coffee table
    plant(f, W - 66, 30, 0.85)
    return 70
  },
  'dining': (s, W, D) => {
    const f = s.furniture, cx = W / 2, cz = D / 2
    f.push({ x: cx - 62, z: cz - 42, w: 124, d: 84, h: 58, ...grey })                      // pedestal
    f.push({ x: cx - 80, z: cz - 55, w: 160, d: 110, h: 10, y: 58, ...wood })              // table top
    for (const [dx, dz] of [[-120, -30], [-120, 40], [96, -30], [96, 40]]) {
      f.push({ x: cx + dx, z: cz + dz, w: 34, d: 34, h: 42 })
      f.push({ x: cx + dx + (dx < 0 ? 0 : 26), z: cz + dz, w: 8, d: 34, h: 72, ...grey })  // backrest
    }
    return 80
  },
  'kitchen': (s, W, D) => {
    const f = s.furniture
    f.push({ x: 10, z: 6, w: W - 90, d: 60, h: 86, ...grey })                              // counter run
    f.push({ x: 10, z: 4, w: W - 90, d: 62, h: 8, y: 86 })                                 // worktop
    f.push({ x: 6, z: 70, w: 60, d: D * 0.42, h: 86, ...grey })                            // side counter
    f.push({ x: 4, z: 68, w: 62, d: D * 0.42 + 4, h: 8, y: 86 })
    f.push({ x: 10, z: 2, w: W - 130, d: 26, h: 56, y: 172 })                              // upper cabinets
    return 236
  },
  'kitchen-luxury': (s, W, D) => {
    BUILDERS['kitchen'](s, W, D)
    s.furniture.push({ x: W * 0.42, z: D * 0.45, w: 170, d: 90, h: 86, ...wood })          // island
    s.furniture.push({ x: W * 0.42 - 6, z: D * 0.45 - 4, w: 182, d: 98, h: 8, y: 86 })
    return 236
  },
  'bathroom': (s, W, D) => {
    const f = s.furniture
    f.push({ x: 6, z: D * 0.3, w: 78, d: Math.min(170, D * 0.55), h: 52 })                 // tub
    f.push({ x: 16, z: D * 0.3 + 12, w: 58, d: Math.min(170, D * 0.55) - 24, h: 4, y: 48, top: '#dfeef2', right: '#dfeef2', front: '#dfeef2' })
    f.push({ x: W * 0.55, z: 4, w: 40, d: 14, h: 70, ...grey })                            // cistern
    f.push({ x: W * 0.55, z: 18, w: 40, d: 44, h: 40 })                                    // toilet
    return 80
  },
  'lobby': (s, W, D, H) => {
    const f = s.furniture
    f.push({ x: W * 0.3, z: D * 0.35, w: 100, d: 100, h: H || 380 })                       // columns
    f.push({ x: W * 0.64, z: D * 0.35, w: 100, d: 100, h: H || 380 })
    f.push({ x: W * 0.28, z: D * 0.06, w: 440, d: 130, h: 140, ...wood })                  // reception desk
    plant(f, W * 0.06, D * 0.5, 2.4)
    return H || 380
  },
  'office': (s, W, D, H) => {
    const f = s.furniture
    f.push({ x: W * 0.3, z: D * 0.3, w: 260, d: 130, h: 95, ...grey })                     // desk pedestal
    f.push({ x: W * 0.3 - 16, z: D * 0.3 - 12, w: 292, d: 154, h: 12, y: 95, ...wood })    // desk top
    f.push({ x: W * 0.36, z: D * 0.3 + 190, w: 75, d: 75, h: 70, ...grey })                // chair
    f.push({ x: W * 0.36 + 60, z: D * 0.3 + 190, w: 15, d: 75, h: 125, ...grey })
    f.push({ x: 10, z: D * 0.15, w: 75, d: 330, h: 120 })                                  // credenza
    plant(f, W - 130, 50, 1.7)
    return 150
  },
  'retail': (s, W, D) => {
    const f = s.furniture
    for (let i = 0; i < 3; i++) {                                                          // wall shelves
      f.push({ x: 30, z: 4, w: W * 0.55, d: 50, h: 16, y: 100 + i * 90, ...grey })
      f.push({ x: 6, z: D * 0.12, w: 50, d: D * 0.5, h: 16, y: 100 + i * 90, ...grey })
    }
    f.push({ x: W * 0.45, z: D * 0.45, w: 300, d: 150, h: 130, ...grey })                  // display table
    f.push({ x: W * 0.45 - 12, z: D * 0.45 - 9, w: 324, d: 168, h: 12, y: 130 })
    return 300
  },
  'jewelry': (s, W, D) => {
    const f = s.furniture
    const cases = [[W * 0.16, D * 0.5], [W * 0.5, D * 0.55], [W * 0.36, D * 0.14]]
    for (const [x, z] of cases) {
      f.push({ x, z, w: 170, d: 85, h: 100, ...grey })
      f.push({ x: x - 6, z: z - 5, w: 182, d: 95, h: 13, y: 100, top: P.glassTop, right: '#dee8ea', front: '#e8f0f2' })
    }
    return 120
  },
  'patio': (s, W, D) => {
    const f = s.furniture
    f.push({ x: -20, z: 0, w: 24, d: D, h: 80, ...grey })                                  // parapets
    f.push({ x: 0, z: -20, w: W, d: 24, h: 80, ...grey })
    plant(f, 40, 40, 2.4)
    plant(f, W - 140, 60, 1.9)
    f.push({ x: W * 0.45, z: D * 0.45, w: 170, d: 170, h: 85, ...wood })                   // table
    return 170
  },
  'lawn': (s, W, D) => {
    s.floorColor = P.grassTop
    const f = s.furniture
    const g = { top: P.leaf1, right: P.leaf2, front: P.leaf3 }
    f.push({ x: 0, z: -30, w: W, d: 55, h: 110, ...g })                                    // hedges
    f.push({ x: -30, z: 0, w: 55, d: D, h: 110, ...g })
    plant(f, W * 0.38, D * 0.38, 3.0)
    plant(f, W * 0.7, D * 0.62, 2.2)
    return 210
  },
}

const TEMPLATES = [
  { id: 'small-bedroom', kind: 'bedroom-small', floorWidth: 360, floorDepth: 360, wallHeight: 300 },
  { id: 'medium-bedroom', kind: 'bedroom-medium', floorWidth: 480, floorDepth: 420, wallHeight: 300 },
  { id: 'master-bedroom', kind: 'bedroom-master', floorWidth: 600, floorDepth: 500, wallHeight: 300 },
  { id: 'small-living-room', kind: 'living', floorWidth: 500, floorDepth: 400, wallHeight: 300 },
  { id: 'large-living-room', kind: 'living', floorWidth: 720, floorDepth: 600, wallHeight: 300 },
  { id: 'dining-room', kind: 'dining', floorWidth: 500, floorDepth: 450, wallHeight: 300 },
  { id: 'kitchen', kind: 'kitchen', floorWidth: 420, floorDepth: 360, wallHeight: 300 },
  { id: 'luxury-kitchen', kind: 'kitchen-luxury', floorWidth: 600, floorDepth: 500, wallHeight: 300 },
  { id: 'bathroom', kind: 'bathroom', floorWidth: 300, floorDepth: 240, wallHeight: 300 },
  { id: 'hotel-lobby', kind: 'lobby', floorWidth: 1200, floorDepth: 900, wallHeight: 400 },
  { id: 'office-reception', kind: 'office', floorWidth: 1000, floorDepth: 800, wallHeight: 350 },
  { id: 'retail-showroom', kind: 'retail', floorWidth: 1500, floorDepth: 1000, wallHeight: 400 },
  { id: 'jewelry-store', kind: 'jewelry', floorWidth: 800, floorDepth: 600, wallHeight: 350 },
  { id: 'outdoor-patio', kind: 'patio', floorWidth: 800, floorDepth: 800, wallHeight: 0 },
  { id: 'lawn-garden-area', kind: 'lawn', floorWidth: 1200, floorDepth: 1200, wallHeight: 0 },
]

for (const t of TEMPLATES) {
  writeFileSync(join(OUT, `${t.id}.svg`), makeIcon(t))
  console.log(`wrote ${t.id}.svg`)
}
