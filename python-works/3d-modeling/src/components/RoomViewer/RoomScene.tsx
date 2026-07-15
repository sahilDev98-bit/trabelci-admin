import * as THREE from 'three'
import { SurfacePlane } from './SurfacePlane'
import type { RoomTemplate } from '../../types'

interface RoomSceneProps {
  room: RoomTemplate
  disableTextures?: boolean
}

export function RoomScene({ room, disableTextures = false }: RoomSceneProps) {
  const { floorWidth: fw, floorDepth: fd, wallHeight: wh } = room
  const scale = 0.01
  const W = fw * scale
  const D = fd * scale
  const H = wh > 0 ? wh * scale : 0

  const wallBottomY = H / 2
  const backWallZ = -D / 2
  const leftWallX = -W / 2
  const rightWallX = W / 2

  return (
    <group>
      {/* Soft ambient base — a distance-independent fill, so raising it lifts
          the whole room evenly with no risk of a proximity hotspot */}
      <ambientLight intensity={1.0} color="#ffffff" />

      {/* Ceiling studio downlights — kept at room center (away from the back
          wall) so falloff doesn't clip a surface right underneath one, but
          intensity restored partway since the increased distance already
          costs them ~4x brightness at the wall versus their old position */}
      <pointLight position={[-W * 0.3, H * 0.96, 0]} intensity={0.75} distance={W * 5} color="#ffffff" />
      <pointLight position={[0,        H * 0.96, 0]} intensity={0.75} distance={W * 5} color="#ffffff" />
      <pointLight position={[W * 0.3,  H * 0.96, 0]} intensity={0.75} distance={W * 5} color="#ffffff" />

      {/* Main overhead directional — also distance-independent, so this is the
          other safe lever for overall brightness without hotspot risk */}
      <directionalLight
        position={[0, H * 3.5, D * 0.8]}
        intensity={0.85}
        color="#ffffff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
      />

      {/* Edge strips — subtle accent to define room edges */}
      <directionalLight position={[-W * 2.2, H * 0.8, -D * 0.1]} intensity={0.2} color="#ffffff" />
      <directionalLight position={[W * 2.2,  H * 0.8, -D * 0.1]} intensity={0.2} color="#ffffff" />

      {room.surfaces.includes('floor') && (
        <SurfacePlane
          surfaceId="floor"
          room={room}
          width={W}
          height={D}
          position={[0, 0, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          disableTexture={disableTextures}
        />
      )}

      {H > 0 && room.surfaces.includes('wall1') && (
        <SurfacePlane
          surfaceId="wall1"
          room={room}
          width={W}
          height={H}
          position={[0, wallBottomY, backWallZ]}
          rotation={[0, 0, 0]}
          disableTexture={disableTextures}
        />
      )}

      {H > 0 && room.surfaces.includes('wall2') && (
        <SurfacePlane
          surfaceId="wall2"
          room={room}
          width={D}
          height={H}
          position={[leftWallX, wallBottomY, 0]}
          rotation={[0, Math.PI / 2, 0]}
          disableTexture={disableTextures}
        />
      )}

      {H > 0 && room.surfaces.includes('wall3') && (
        <SurfacePlane
          surfaceId="wall3"
          room={room}
          width={D}
          height={H}
          position={[rightWallX, wallBottomY, 0]}
          rotation={[0, -Math.PI / 2, 0]}
          disableTexture={disableTextures}
        />
      )}

      {/* Ceiling — bright white like the reference room */}
      {H > 0 && (
        <mesh position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[W, D]} />
          <meshStandardMaterial color={0xffffff} roughness={0.88} metalness={0} side={THREE.FrontSide} />
        </mesh>
      )}
    </group>
  )
}
