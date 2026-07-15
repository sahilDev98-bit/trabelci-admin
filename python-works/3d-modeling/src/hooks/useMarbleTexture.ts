import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { buildBookmatchCanvas } from '../utils/textureTransform'
import type { TileSettings, BookmatchMode } from '../types'

interface UseMarbleTextureOptions {
  textureUrl: string | null
  surfaceWidth: number
  surfaceHeight: number
  tileSettings: TileSettings
}

export function useMarbleTexture({ textureUrl, surfaceWidth, surfaceHeight, tileSettings }: UseMarbleTextureOptions) {
  const textureRef = useRef<THREE.Texture | null>(null)

  useEffect(() => {
    if (!textureUrl) {
      if (textureRef.current) {
        textureRef.current.dispose()
        textureRef.current = null
      }
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const bookmatchCanvas = buildBookmatchCanvas(img, tileSettings.bookmatch)
      const texture = bookmatchCanvas
        ? new THREE.CanvasTexture(bookmatchCanvas)
        : new THREE.Texture(img)
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      applyTextureSettings(texture, surfaceWidth, surfaceHeight, tileSettings)
      texture.needsUpdate = true
      if (textureRef.current) textureRef.current.dispose()
      textureRef.current = texture
    }
    img.src = textureUrl
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureUrl, tileSettings.bookmatch])

  useEffect(() => {
    if (!textureRef.current) return
    applyTextureSettings(textureRef.current, surfaceWidth, surfaceHeight, tileSettings)
    textureRef.current.needsUpdate = true
  }, [surfaceWidth, surfaceHeight, tileSettings])

  return textureRef
}

function applyTextureSettings(
  texture: THREE.Texture,
  surfaceWidth: number,
  surfaceHeight: number,
  settings: TileSettings
) {
  const { tileWidth, tileHeight, rotation, flipH, flipV, bookmatch } = settings

  // For bookmatch the meta-tile is 2× the single tile
  const metaW = bookmatch === 'horizontal' || bookmatch === 'quad' ? tileWidth * 2 : tileWidth
  const metaH = bookmatch === 'vertical' || bookmatch === 'quad' ? tileHeight * 2 : tileHeight

  let hRepeat = surfaceWidth / metaW
  let vRepeat = surfaceHeight / metaH

  if (flipH) hRepeat = -hRepeat
  if (flipV) vRepeat = -vRepeat

  texture.repeat.set(hRepeat, vRepeat)
  texture.rotation = (rotation * Math.PI) / 180
  texture.center.set(0.5, 0.5)
  texture.offset.set(flipH ? 1 : 0, flipV ? 1 : 0)
}

// Helper for non-hook usage (returns a plain texture)
export function createMarbleTexture(
  textureUrl: string,
  surfaceWidth: number,
  surfaceHeight: number,
  tileSettings: TileSettings,
  bookmatchMode: BookmatchMode,
  onReady: (t: THREE.Texture) => void
) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const bookmatchCanvas = buildBookmatchCanvas(img, bookmatchMode)
    // Use the already-loaded img (or canvas) directly — never call TextureLoader.load()
    // again because that starts a second async fetch and the texture won't be ready
    // when onReady fires.
    const texture = bookmatchCanvas
      ? new THREE.CanvasTexture(bookmatchCanvas)
      : new THREE.Texture(img)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    applyTextureSettings(texture, surfaceWidth, surfaceHeight, tileSettings)
    texture.needsUpdate = true
    onReady(texture)
  }
  img.src = textureUrl
}
