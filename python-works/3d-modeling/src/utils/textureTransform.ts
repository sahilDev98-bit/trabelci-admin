import type { BookmatchMode } from '../types'

/**
 * Builds a CanvasTexture source for bookmatch mode.
 * Draws the slab image into a 2×tile or 2×2 tile meta-unit with mirroring.
 * Returns a data URL or null if bookmatch is off.
 */
export function buildBookmatchCanvas(
  img: HTMLImageElement,
  mode: BookmatchMode
): HTMLCanvasElement | null {
  if (mode === 'off') return null

  const w = img.naturalWidth
  const h = img.naturalHeight
  const canvas = document.createElement('canvas')

  if (mode === 'horizontal') {
    canvas.width = w * 2
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    ctx.save()
    ctx.translate(w * 2, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(img, 0, 0, w, h)
    ctx.restore()
  } else if (mode === 'vertical') {
    canvas.width = w
    canvas.height = h * 2
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, w, h)
    ctx.save()
    ctx.translate(0, h * 2)
    ctx.scale(1, -1)
    ctx.drawImage(img, 0, 0, w, h)
    ctx.restore()
  } else if (mode === 'quad') {
    canvas.width = w * 2
    canvas.height = h * 2
    const ctx = canvas.getContext('2d')!
    // top-left: original
    ctx.drawImage(img, 0, 0, w, h)
    // top-right: flip horizontal
    ctx.save()
    ctx.translate(w * 2, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(img, 0, 0, w, h)
    ctx.restore()
    // bottom-left: flip vertical
    ctx.save()
    ctx.translate(0, h * 2)
    ctx.scale(1, -1)
    ctx.drawImage(img, 0, 0, w, h)
    ctx.restore()
    // bottom-right: flip both
    ctx.save()
    ctx.translate(w * 2, h * 2)
    ctx.scale(-1, -1)
    ctx.drawImage(img, 0, 0, w, h)
    ctx.restore()
  }

  return canvas
}

export function getSurfaceDimensions(
  surfaceId: string,
  room: { floorWidth: number; floorDepth: number; wallHeight: number }
): { width: number; height: number } {
  if (surfaceId === 'floor') return { width: room.floorWidth, height: room.floorDepth }
  // Side walls span the depth of the room
  if (surfaceId === 'wall2' || surfaceId === 'wall3') return { width: room.floorDepth, height: room.wallHeight }
  // Back/front walls span the width of the room
  return { width: room.floorWidth, height: room.wallHeight }
}
