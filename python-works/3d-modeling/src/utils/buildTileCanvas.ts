import type { BookmatchMode } from '../types'

export interface TileCanvasOptions {
  images: HTMLImageElement[]
  surfaceWidthCm: number
  surfaceHeightCm: number
  tileWidthCm: number
  tileHeightCm: number
  groutSize: number
  groutColor?: string
  bookmatch: BookmatchMode
  flipH?: boolean
  flipV?: boolean
  rotation?: number  // degrees
  seed?: number       // bumped to force a different random multi-slab layout
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    return (s >>> 0) / 0x100000000
  }
}

export function buildTileCanvas(opts: TileCanvasOptions): HTMLCanvasElement {
  const {
    images,
    surfaceWidthCm, surfaceHeightCm,
    tileWidthCm, tileHeightCm,
    groutSize,
    groutColor = '#d4d0cc',
    bookmatch,
    flipH = false,
    flipV = false,
    rotation = 0,
    seed = 0,
  } = opts

  const isMulti = images.length > 1

  const tilesH = Math.ceil(surfaceWidthCm / tileWidthCm)
  const tilesV = Math.ceil(surfaceHeightCm / tileHeightCm)

  const maxCanvas = 4096
  const tilePx = Math.min(1024, Math.floor(maxCanvas / Math.max(tilesH, tilesV)))

  const canvasW = tilesH * tilePx
  const canvasH = Math.round((surfaceHeightCm / tileHeightCm) * tilePx)

  // grout multiplier of 4 makes the slider (0-10) produce 0-40px gaps,
  // which stays visible at typical 3D view scale after mipmapping
  const groutPx = Math.round(groutSize * 4)
  const half = groutPx / 2

  // Compute extra tiles needed when the layout is rotated
  const rotRad = (rotation * Math.PI) / 180
  const cosA = Math.abs(Math.cos(rotRad))
  const sinA = Math.abs(Math.sin(rotRad))
  const rotatedW = canvasW * cosA + canvasH * sinA
  const rotatedH = canvasW * sinA + canvasH * cosA
  const padH = rotation !== 0 ? Math.ceil((rotatedW - canvasW) / 2 / tilePx) + 1 : 0
  const padV = rotation !== 0 ? Math.ceil((rotatedH - canvasH) / 2 / tilePx) + 1 : 0

  const rowMin = -padV
  const rowMax = tilesV + padV
  const colMin = -padH
  const colMax = tilesH + padH

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')!

  // Grout background — fill entire canvas before any rotation
  ctx.fillStyle = groutColor
  ctx.fillRect(0, 0, canvasW, canvasH)

  // Seeded assignment for original tile grid only (keeps placement stable across
  // grout/color/flip/rotation changes)
  const rand = seededRandom(tilesH * 7919 + tilesV * 6271 + images.length * 4969 + seed * 104729)
  const tileIdx: number[][] = []
  if (isMulti) {
    const n = images.length
    for (let row = 0; row < tilesV; row++) {
      tileIdx[row] = []
      for (let col = 0; col < tilesH; col++) {
        const forbidden = new Set<number>()
        if (col > 0) forbidden.add(tileIdx[row][col - 1])
        if (row > 0) forbidden.add(tileIdx[row - 1][col])
        const pool = Array.from({ length: n }, (_, i) => i).filter(i => !forbidden.has(i))
        tileIdx[row][col] = pool[Math.floor(rand() * pool.length)]
      }
    }
  }

  // Apply rotation around canvas center — tiles drawn inside this transform
  ctx.save()
  if (rotation !== 0) {
    ctx.translate(canvasW / 2, canvasH / 2)
    ctx.rotate(rotRad)
    ctx.translate(-canvasW / 2, -canvasH / 2)
  }

  for (let row = rowMin; row < rowMax; row++) {
    for (let col = colMin; col < colMax; col++) {
      const tx = col * tilePx + half
      const ty = row * tilePx + half
      const tw = tilePx - groutPx
      const th = tilePx - groutPx

      if (tw <= 0 || th <= 0) continue

      // Wrap out-of-range indices back into the seeded tileIdx grid
      const r = ((row % tilesV) + tilesV) % tilesV
      const c = ((col % tilesH) + tilesH) % tilesH
      const img = isMulti ? images[tileIdx[r][c]] : images[0]

      // Positive modulo so bookmatch mirroring is consistent for negative col/row
      const colParity = ((col % 2) + 2) % 2
      const rowParity = ((row % 2) + 2) % 2
      const mirrorH = (!isMulti && (bookmatch === 'horizontal' || bookmatch === 'quad') && colParity !== 0) !== flipH
      const mirrorV = (!isMulti && (bookmatch === 'vertical' || bookmatch === 'quad') && rowParity !== 0) !== flipV

      ctx.save()
      ctx.beginPath()
      ctx.rect(tx, ty, tw, th)
      ctx.clip()
      ctx.translate(tx + tw / 2, ty + th / 2)
      ctx.scale(mirrorH ? -1 : 1, mirrorV ? -1 : 1)
      ctx.drawImage(img, -tw / 2, -th / 2, tw, th)
      ctx.restore()
    }
  }

  ctx.restore()

  return canvas
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

// Decode cache — the same marble data URLs get re-applied on every settings
// tweak, and re-decoding multi-MB images each time is what made the viewer
// lag. Capped so long sessions with many SKUs can't grow it unbounded.
const IMAGE_CACHE_MAX = 48
const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadImageCached(url: string): Promise<HTMLImageElement> {
  let promise = imageCache.get(url)
  if (!promise) {
    promise = loadImage(url)
    promise.catch(() => imageCache.delete(url))
    imageCache.set(url, promise)
    if (imageCache.size > IMAGE_CACHE_MAX) {
      const oldest = imageCache.keys().next().value!
      imageCache.delete(oldest)
    }
  }
  return promise
}
