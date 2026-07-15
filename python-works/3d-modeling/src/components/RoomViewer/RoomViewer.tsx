import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { RoomScene } from './RoomScene'
import { PhotoRoomViewer } from './PhotoRoomViewer'
import type { RoomTemplate } from '../../types'

interface RoomViewerProps {
  room: RoomTemplate
  id?: string
  disableTextures?: boolean
  showOrbitControls?: boolean
}

export function RoomViewer({ room, id, disableTextures = false, showOrbitControls = true }: RoomViewerProps) {
  // Photo-based rooms render a composited photograph instead of a 3D scene —
  // fixed viewpoint, photoreal. Replaces the WebGL canvas entirely so the
  // bridge's captureImage picks up the composite canvas.
  if (room.photoRoom) {
    return <PhotoRoomViewer room={room} id={id} />
  }

  const scale = 0.01
  const W = room.floorWidth * scale
  const D = room.floorDepth * scale
  const H = room.wallHeight > 0 ? room.wallHeight * scale : 1

  // Camera inside the room — 30% depth from front, eye-level height.
  // targetY = camY → perfectly horizontal look → ceiling stays above the frame.
  // At 75° FOV and 4.8m to back wall, the top of frame reaches ~2.9m
  // which is just under the 3.0m ceiling — ceiling never visible by default.
  const camX = 0
  const camY = H * 0.28           // ~84 cm — low eye height like a seated person
  const camZ = D * 0.3            // inside room; distance to back wall = D*0.8
  const targetX = 0
  const targetY = camY            // same as camera height → perfectly horizontal
  const targetZ = -D / 2          // aimed at back wall

  // Unique filter id per viewer instance so multiple viewers on the same
  // page don't share the same SVG filter definition.
  const filterId = `marble-sharpen-${id ?? 'default'}`

  return (
    <>
      {/* SVG unsharp-mask filter — a light touch of edge enhancement on marble
          veins without affecting colour or brightness. The kernel sum is 1
          (energy-preserving) so it only redistributes contrast, never
          bleaches. Amount kept low (0.12) so it enhances real vein edges
          instead of turning soft natural gradients into hard cartoon outlines. */}
      <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB">
            <feConvolveMatrix
              order="3"
              kernelMatrix="0 -0.12 0  -0.12 1.48 -0.12  0 -0.12 0"
              preserveAlpha="true"
            />
          </filter>
        </defs>
      </svg>
      <div id={id} className="w-full h-full"
        style={{ filter: `contrast(1.02) saturate(1.08) url(#${filterId})` }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{
          position: [camX, camY, camZ],
          fov: 75,
          near: 0.01,
          far: 1000,
        }}
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          // LinearToneMapping preserves marble color saturation.
          // ACES filmic desaturates vivid textures (gold/dark veins fade to grey).
          toneMapping: THREE.LinearToneMapping,
          // Enough exposure to keep the white marble background reading bright
          // without pushing it so far past clip that veining right under a
          // light washes out too — paired with the lighting rebalance in
          // RoomScene (point lights moved off the wall, more ambient/directional
          // fill carrying the overall brightness instead).
          toneMappingExposure: 1.45,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        <Suspense fallback={null}>
          <RoomScene room={room} disableTextures={disableTextures} />
          {/* Neutral warm-white interior background — replaces the black void */}
          <color attach="background" args={['#cac7c1']} />
          {/* Apartment env — a modest bump over the original 0.1 so the glossy
              clearcoat surfaces (see SurfacePlane) pick up a visible room
              reflection; 0.5 turned out way too strong combined with clearcoat
              and blew the whole wall out to flat white. */}
          <Environment preset="apartment" environmentIntensity={0.18} />
          {showOrbitControls && (
            <OrbitControls
              minPolarAngle={Math.PI / 2 - 0.18}  // max ~10° above horizontal → ceiling stays hidden
              maxPolarAngle={Math.PI / 2 + 0.35}  // allow looking down at floor
              target={[targetX, targetY, targetZ]}
              enablePan={false}
              zoomSpeed={0.7}
              rotateSpeed={0.4}
              minDistance={H * 0.5}
              maxDistance={D * 0.95}
            />
          )}
        </Suspense>
      </Canvas>
      </div>
    </>
  )
}
