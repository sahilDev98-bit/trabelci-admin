import { useRef, useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore, DEFAULT_TILE_SETTINGS } from '../../store/useStore'
import { notifySurfacePicked } from '../../apiBridge'
import { getSurfaceDimensions } from '../../utils/textureTransform'
import { buildTileCanvas, loadImageCached } from '../../utils/buildTileCanvas'
import { beginLoad, endLoad } from '../../utils/textureLoadTracker'
import type { SurfaceId, RoomTemplate } from '../../types'

interface SurfacePlaneProps {
  surfaceId: SurfaceId
  room: RoomTemplate
  width: number
  height: number
  position: [number, number, number]
  rotation: [number, number, number]
  disableTexture?: boolean
}

export function SurfacePlane({
  surfaceId, room, width, height, position, rotation, disableTexture = false
}: SurfacePlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null!)
  const currentTextureRef = useRef<THREE.Texture | null>(null)
  const [hovered, setHovered] = useState(false)
  const { gl } = useThree()
  const maxAnisotropy = gl.capabilities.getMaxAnisotropy()

  const { surfaceApplied, surfaceTileSettings, surfaceArrangementSeed, setSurface } = useStore()
  const appliedUrls = disableTexture ? [] : (surfaceApplied[surfaceId] ?? [])
  const { width: sw, height: sh } = getSurfaceDimensions(surfaceId, room)
  const tileSettings = surfaceTileSettings[surfaceId] ?? DEFAULT_TILE_SETTINGS
  const arrangementSeed = surfaceArrangementSeed[surfaceId] ?? 0

  // Serialize applied URLs for use as effect dependency
  const appliedKey = appliedUrls.join('|')

  useEffect(() => {
    if (!meshRef.current) return
    const material = meshRef.current.material as THREE.MeshPhysicalMaterial

    if (appliedUrls.length === 0) {
      currentTextureRef.current?.dispose()
      currentTextureRef.current = null
      material.map = null
      if (surfaceId === 'floor') {
        material.color.set(0xf8f6f2)   // near-white polished floor (like the reference)
        material.roughness = 0.02
        material.metalness = 0.05
      } else {
        material.color.set(0xe8e4de)   // light warm cream (bright interior wall)
        material.roughness = 0.9
        material.metalness = 0
      }
      material.clearcoat = 0
      material.envMapIntensity = 0.25
      material.needsUpdate = true
      return
    }

    let cancelled = false
    beginLoad()

    Promise.all(appliedUrls.map(loadImageCached))
      .then((images) => {
        if (cancelled || !meshRef.current) return
        const mat = meshRef.current.material as THREE.MeshPhysicalMaterial

        // Build the full-surface tile canvas — each tile drawn individually at
        // source resolution with correct grout lines and per-tile bookmatch
        const canvas = buildTileCanvas({
          images,
          surfaceWidthCm: sw,
          surfaceHeightCm: sh,
          tileWidthCm: tileSettings.tileWidth,
          tileHeightCm: tileSettings.tileHeight,
          groutSize: tileSettings.groutSize,
          groutColor: tileSettings.groutColor,
          bookmatch: tileSettings.bookmatch,
          flipH: tileSettings.flipH,
          flipV: tileSettings.flipV,
          rotation: tileSettings.rotation,
          seed: arrangementSeed,
        })

        const texture = new THREE.CanvasTexture(canvas)

        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = maxAnisotropy
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.generateMipmaps = true
        texture.wrapS = THREE.ClampToEdgeWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping
        texture.needsUpdate = true

        currentTextureRef.current?.dispose()
        currentTextureRef.current = texture

        mat.map = texture
        mat.color.set(0xffffff)
        // Glass-like glossy finish: a clearcoat layer (like real polished
        // marble's lacquer-thin reflective top) is what actually reads as
        // "glossy" — tiny direct-light specular dots alone get lost against
        // busy veining. clearcoatRoughness stays near 0 for a sharp, glassy
        // reflection; base roughness is a bit softer so the marble underneath
        // still looks like stone, not chrome.
        mat.roughness = surfaceId === 'floor' ? 0.25 : 0.3
        mat.metalness = 0
        mat.clearcoat = 0.8
        mat.clearcoatRoughness = 0.1
        mat.envMapIntensity = 0.6
        mat.needsUpdate = true
      })
      .catch((err) => console.error('[SurfacePlane] Image load error:', err))
      .finally(() => endLoad())

    return () => { cancelled = true }
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    appliedKey, sw, sh, maxAnisotropy, arrangementSeed,
    tileSettings.tileWidth, tileSettings.tileHeight,
    tileSettings.groutSize, tileSettings.groutColor, tileSettings.bookmatch,
    tileSettings.flipH, tileSettings.flipV, tileSettings.rotation,
  ])

  // Subtle emissive on hover only — selection leaves the surface untinted so
  // the applied marble reads in its true colors. Set imperatively so it never
  // resets map.
  useEffect(() => {
    if (!meshRef.current) return
    const mat = meshRef.current.material as THREE.MeshPhysicalMaterial
    if (hovered) {
      mat.emissive.set(0x444444)
      mat.emissiveIntensity = 0.08
    } else {
      mat.emissive.set(0x000000)
      mat.emissiveIntensity = 0
    }
  }, [hovered])

  useEffect(() => {
    return () => { currentTextureRef.current?.dispose() }
  }, [])

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    setSurface(surfaceId)
    notifySurfacePicked(surfaceId, e.clientX, e.clientY)
  }

  return (
    <mesh
      ref={meshRef}
      position={position}
      rotation={rotation}
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
      receiveShadow
    >
      <planeGeometry args={[width, height]} />
      <meshPhysicalMaterial
        color={surfaceId === 'floor' ? 0xf8f6f2 : 0xe8e4de}
        roughness={surfaceId === 'floor' ? 0.02 : 0.9}
        metalness={surfaceId === 'floor' ? 0.05 : 0}
        side={THREE.FrontSide}
      />
    </mesh>
  )
}
