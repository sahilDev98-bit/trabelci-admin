// Composites tiled marble into annotated regions of a room photo:
//  1. perspective-warps the tile canvas into each surface's quad,
//  2. re-lights the marble with the photo's own (blurred) luminance so real
//     shadows, sun patches and reflections survive the material swap,
//  3. redraws the photo's foreground objects (occluders) on top.

type Pt = [number, number]

// Projective mapping from the unit square to an arbitrary quad (TL,TR,BR,BL).
export function squareToQuad(q: Pt[]): (u: number, v: number) => Pt {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q
  const dx1 = x1 - x2, dy1 = y1 - y2
  const dx2 = x3 - x2, dy2 = y3 - y2
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  const den = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / den
  const h = (dx1 * sy - sx * dy1) / den
  const a = x1 - x0 + g * x1
  const b = x3 - x0 + h * x3
  const c = x0
  const d = y1 - y0 + g * y1
  const e = y3 - y0 + h * y3
  const f = y0
  return (u, v) => {
    const w = g * u + h * v + 1
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]
  }
}

function quadPath(ctx: CanvasRenderingContext2D, quad: Pt[]) {
  ctx.beginPath()
  ctx.moveTo(quad[0][0], quad[0][1])
  for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i][0], quad[i][1])
  ctx.closePath()
}

// Affine-maps `src` so that source triangle `s` lands exactly on destination
// triangle `d`, clipped to `d` (expanded ~0.75px outward so neighbouring
// triangles overlap and no background peeks through the seams).
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  s: Pt[],
  d: Pt[],
) {
  const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = s
  const [[dx0, dy0], [dx1, dy1], [dx2, dy2]] = d
  const den = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1)
  if (!den) return
  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / den
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / den
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / den
  const dd = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / den
  const e = dx0 - a * sx0 - c * sy0
  const f = dy0 - b * sx0 - dd * sy0

  const cx = (dx0 + dx1 + dx2) / 3
  const cy = (dy0 + dy1 + dy2) / 3
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < 3; i++) {
    const vx = d[i][0] - cx
    const vy = d[i][1] - cy
    const len = Math.hypot(vx, vy) || 1
    const x = d[i][0] + (vx / len) * 0.75
    const y = d[i][1] + (vy / len) * 0.75
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.clip()
  ctx.setTransform(a, b, c, dd, e, f)
  ctx.drawImage(src, 0, 0)
  ctx.restore()
}

// Perspective-draws `src` into `quad` by subdividing into triangle pairs.
// Triangles map their three corners exactly (unlike parallelogram cells,
// which drift under strong foreshortening and leave background slivers
// between cells — the "grey gaps" bug on the floor).
export function drawWarped(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  quad: Pt[],
  subdiv = 16,
) {
  const map = squareToQuad(quad)
  ctx.save()
  quadPath(ctx, quad)
  ctx.clip()
  const sw = src.width / subdiv
  const sh = src.height / subdiv
  for (let j = 0; j < subdiv; j++) {
    for (let i = 0; i < subdiv; i++) {
      const q00 = map(i / subdiv, j / subdiv)
      const q10 = map((i + 1) / subdiv, j / subdiv)
      const q01 = map(i / subdiv, (j + 1) / subdiv)
      const q11 = map((i + 1) / subdiv, (j + 1) / subdiv)
      const s00: Pt = [i * sw, j * sh]
      const s10: Pt = [(i + 1) * sw, j * sh]
      const s01: Pt = [i * sw, (j + 1) * sh]
      const s11: Pt = [(i + 1) * sw, (j + 1) * sh]
      drawTriangle(ctx, src, [s00, s10, s01], [q00, q10, q01])
      drawTriangle(ctx, src, [s11, s01, s10], [q11, q01, q10])
    }
  }
  ctx.restore()
}

export interface LumMap {
  data: Uint8ClampedArray // one gray value per photo pixel
  width: number
  height: number
}

// Blurred luminance of the photo — blur via downscale/upscale so tile veins
// of the ORIGINAL floor don't ghost through, while broad shadows/highlights
// (which is what we want to keep) survive.
export function buildLumMap(photo: HTMLImageElement, width: number, height: number): LumMap {
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(width / 14))
  small.height = Math.max(1, Math.round(height / 14))
  const sctx = small.getContext('2d')!
  sctx.drawImage(photo, 0, 0, small.width, small.height)

  const full = document.createElement('canvas')
  full.width = width
  full.height = height
  const fctx = full.getContext('2d')!
  fctx.imageSmoothingEnabled = true
  fctx.drawImage(small, 0, 0, width, height)

  const img = fctx.getImageData(0, 0, width, height).data
  const lum = new Uint8ClampedArray(width * height)
  for (let i = 0; i < lum.length; i++) {
    lum[i] = 0.2126 * img[i * 4] + 0.7152 * img[i * 4 + 1] + 0.0722 * img[i * 4 + 2]
  }
  return { data: lum, width, height }
}

// Rasterized point-in-quad mask + the photo's mean luminance inside it.
export function buildQuadMask(quad: Pt[], lum: LumMap): { mask: Uint8ClampedArray; mean: number } {
  const c = document.createElement('canvas')
  c.width = lum.width
  c.height = lum.height
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  quadPath(ctx, quad)
  ctx.fill()
  const alpha = ctx.getImageData(0, 0, lum.width, lum.height).data
  const mask = new Uint8ClampedArray(lum.width * lum.height)
  let sum = 0
  let count = 0
  for (let i = 0; i < mask.length; i++) {
    if (alpha[i * 4 + 3] > 128) {
      mask[i] = 1
      sum += lum.data[i]
      count++
    }
  }
  return { mask, mean: count ? sum / count : 128 }
}

// Reshapes the already-drawn marble with the photo's light distribution —
// gently: only `strength` of the shading is applied and the multiplier is
// clamped, so the marble's own color and veining stay readable instead of
// bleaching to white in sunlit areas or crushing in shadow. `specular`
// re-adds the photo's bright reflections (glossy floor sheen, light pools)
// as a soft screen-blend toward white on top of the new material.
export function relightRegion(
  ctx: CanvasRenderingContext2D,
  lum: LumMap,
  mask: Uint8ClampedArray,
  mean: number,
  relight?: { strength?: number; lo?: number; hi?: number; specular?: number; saturation?: number },
) {
  const strength = relight?.strength ?? 0.45
  const lo = relight?.lo ?? 0.72
  const hi = relight?.hi ?? 1.3
  const specular = relight?.specular ?? 0
  const saturation = relight?.saturation ?? 1

  const img = ctx.getImageData(0, 0, lum.width, lum.height)
  const d = img.data
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const rel = lum.data[i] / mean
    let f = 1 + (rel - 1) * strength
    if (f < lo) f = lo
    else if (f > hi) f = hi
    let r = d[i * 4] * f
    let g = d[i * 4 + 1] * f
    let b = d[i * 4 + 2] * f
    if (saturation !== 1) {
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = gray + (r - gray) * saturation
      g = gray + (g - gray) * saturation
      b = gray + (b - gray) * saturation
    }
    if (specular > 0 && rel > 1.2) {
      // only the photo's clearly-brighter-than-average spots read as
      // reflections; ease them in and lift toward white (screen blend)
      const s = Math.min(1, (rel - 1.2) * 2.0) * specular
      r += (255 - r) * s
      g += (255 - g) * s
      b += (255 - b) * s
    }
    d[i * 4] = r
    d[i * 4 + 1] = g
    d[i * 4 + 2] = b
  }
  ctx.putImageData(img, 0, 0)
}

export function drawOccluders(
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement,
  occluders: Pt[][],
  width: number,
  height: number,
) {
  ctx.save()
  ctx.beginPath()
  for (const poly of occluders) {
    ctx.moveTo(poly[0][0], poly[0][1])
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
    ctx.closePath()
  }
  ctx.clip()
  ctx.drawImage(photo, 0, 0, width, height)
  ctx.restore()
}

// Copies back only the foliage-like pixels (green-dominant or very dark, e.g.
// stems) of the photo inside the given polygons, with 1px dilation so
// anti-aliased leaf edges don't fringe. Pixel-accurate plant occlusion
// without hand-painted masks.
export function drawGreenKeyedOccluders(
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement,
  polys: Pt[][],
  width: number,
  height: number,
) {
  if (!polys.length) return

  const photoCanvas = document.createElement('canvas')
  photoCanvas.width = width
  photoCanvas.height = height
  const pctx = photoCanvas.getContext('2d')!
  pctx.drawImage(photo, 0, 0, width, height)
  const photoData = pctx.getImageData(0, 0, width, height).data

  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = width
  maskCanvas.height = height
  const mctx = maskCanvas.getContext('2d')!
  mctx.fillStyle = '#fff'
  mctx.beginPath()
  for (const poly of polys) {
    mctx.moveTo(poly[0][0], poly[0][1])
    for (let i = 1; i < poly.length; i++) mctx.lineTo(poly[i][0], poly[i][1])
    mctx.closePath()
  }
  mctx.fill()
  const polyMask = mctx.getImageData(0, 0, width, height).data

  const keyed = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    if (polyMask[i * 4 + 3] <= 128) continue
    const r = photoData[i * 4], g = photoData[i * 4 + 1], b = photoData[i * 4 + 2]
    // green threshold slightly loose so shadowed (desaturated) leaves still
    // key; the dark rule stays tight or floor shadows/reflections speckle in
    const green = g > r * 1.03 && g > b * 1.03
    const dark = r + g + b < 210
    if (green || dark) keyed[i] = 1
  }

  // 1px dilation
  const dilated = new Uint8Array(keyed)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (keyed[i - 1] || keyed[i + 1] || keyed[i - width] || keyed[i + width]) dilated[i] = 1
    }
  }

  const out = ctx.getImageData(0, 0, width, height)
  for (let i = 0; i < width * height; i++) {
    if (!dilated[i]) continue
    out.data[i * 4] = photoData[i * 4]
    out.data[i * 4 + 1] = photoData[i * 4 + 1]
    out.data[i * 4 + 2] = photoData[i * 4 + 2]
  }
  ctx.putImageData(out, 0, 0)
}

export function pointInQuad(x: number, y: number, quad: Pt[]): boolean {
  // ray-cast point-in-polygon (works for any simple polygon, quads included)
  let inside = false
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const [xi, yi] = quad[i]
    const [xj, yj] = quad[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
