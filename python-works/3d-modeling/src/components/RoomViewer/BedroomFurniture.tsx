// Procedural bedroom furnishings (no external models): floating wood platform
// bed with warm underglow, full-width headboard panel, floating nightstands,
// two pendant lights and a potted plant — styled after the reference photo.
// Every mesh disables raycasting so clicks pass straight through to the
// marble SurfacePlanes behind/below; the furniture is scenery only.

interface BedroomFurnitureProps {
  W: number // room width in world units (1 unit = 100 cm)
  D: number // room depth
  H: number // wall height
}

const noRaycast = () => null

const WOOD = '#6e4b2e'
const WOOD_DARK = '#54371f'
const FABRIC_WHITE = '#f4f3ef'
const FABRIC_GREY = '#b8b5aa'
const GLOW = '#ffc98a'

export function BedroomFurniture({ W, D, H }: BedroomFurnitureProps) {
  const backZ = -D / 2

  // Everything scales off the room so Small/Medium/Master bedrooms all work
  const headboardW = Math.min(W * 0.72, 3.8)
  const headboardH = 0.95
  const bedW = Math.min(1.85, headboardW * 0.55)
  const bedL = Math.min(2.0, D * 0.48)
  const platformY = 0.14           // floating gap under the platform for the glow
  const platformH = 0.16
  const bedCenterZ = backZ + 0.14 + bedL / 2
  const mattressTop = platformY + platformH + 0.22

  const standX = headboardW / 2 - 0.32
  const pendantX = headboardW / 2 - 0.22
  const pendantZ = backZ + 0.5
  const bulbY = Math.min(1.55, H * 0.52)

  const plantX = W / 2 - 0.55
  const plantZ = backZ + Math.min(D * 0.35, 1.4)
  const leafAngles = [0, 0.9, 1.8, 2.7, 3.6, 4.5, 5.4]

  return (
    <group>
      {/* ── Headboard: full-width wood panel on the back wall ── */}
      <mesh position={[0, headboardH / 2 + 0.12, backZ + 0.05]} raycast={noRaycast} castShadow>
        <boxGeometry args={[headboardW, headboardH, 0.07]} />
        <meshStandardMaterial color={WOOD} roughness={0.55} metalness={0.05} />
      </mesh>
      {/* warm LED strip glowing beneath the headboard */}
      <mesh position={[0, 0.11, backZ + 0.05]} raycast={noRaycast}>
        <boxGeometry args={[headboardW * 0.97, 0.02, 0.05]} />
        <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={1.6} />
      </mesh>
      <pointLight position={[0, 0.18, backZ + 0.25]} intensity={0.35} distance={2.2} color={GLOW} />

      {/* ── Floating nightstands at the headboard's ends ── */}
      {[-standX, standX].map((x) => (
        <mesh key={`stand${x}`} position={[x, 0.42, backZ + 0.28]} raycast={noRaycast} castShadow>
          <boxGeometry args={[0.55, 0.3, 0.38]} />
          <meshStandardMaterial color={WOOD_DARK} roughness={0.5} metalness={0.05} />
        </mesh>
      ))}

      {/* ── Platform bed ── */}
      {/* wood platform, floating with underglow */}
      <mesh position={[0, platformY + platformH / 2, bedCenterZ]} raycast={noRaycast} castShadow>
        <boxGeometry args={[bedW + 0.2, platformH, bedL + 0.15]} />
        <meshStandardMaterial color={WOOD} roughness={0.5} metalness={0.05} />
      </mesh>
      <mesh position={[0, platformY - 0.02, bedCenterZ]} raycast={noRaycast}>
        <boxGeometry args={[bedW * 0.85, 0.02, bedL * 0.85]} />
        <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={1.4} />
      </mesh>
      <pointLight position={[0, 0.08, bedCenterZ]} intensity={0.3} distance={1.8} color={GLOW} />

      {/* mattress */}
      <mesh position={[0, platformY + platformH + 0.11, bedCenterZ]} raycast={noRaycast} castShadow>
        <boxGeometry args={[bedW, 0.22, bedL]} />
        <meshStandardMaterial color={FABRIC_WHITE} roughness={0.95} />
      </mesh>
      {/* duvet draped over the foot two-thirds, slightly wider than the mattress */}
      <mesh position={[0, mattressTop - 0.06, bedCenterZ + bedL * 0.14]} raycast={noRaycast} castShadow>
        <boxGeometry args={[bedW + 0.08, 0.09, bedL * 0.66]} />
        <meshStandardMaterial color={FABRIC_WHITE} roughness={0.95} />
      </mesh>
      {/* folded duvet edge */}
      <mesh position={[0, mattressTop - 0.03, bedCenterZ - bedL * 0.16]} raycast={noRaycast}>
        <boxGeometry args={[bedW + 0.08, 0.05, 0.14]} />
        <meshStandardMaterial color={'#e7e5df'} roughness={0.95} />
      </mesh>

      {/* pillows: grey pair leaning on the headboard, white pair in front */}
      {[-bedW / 4, bedW / 4].map((x) => (
        <mesh
          key={`pg${x}`}
          position={[x, mattressTop + 0.16, bedCenterZ - bedL / 2 + 0.12]}
          rotation={[-0.28, 0, 0]}
          raycast={noRaycast}
          castShadow
        >
          <boxGeometry args={[bedW * 0.42, 0.34, 0.12]} />
          <meshStandardMaterial color={FABRIC_GREY} roughness={0.95} />
        </mesh>
      ))}
      {[-bedW / 4, bedW / 4].map((x) => (
        <mesh
          key={`pw${x}`}
          position={[x, mattressTop + 0.1, bedCenterZ - bedL / 2 + 0.3]}
          rotation={[-0.2, 0, 0]}
          raycast={noRaycast}
          castShadow
        >
          <boxGeometry args={[bedW * 0.4, 0.26, 0.14]} />
          <meshStandardMaterial color={FABRIC_WHITE} roughness={0.95} />
        </mesh>
      ))}

      {/* ── Pendant lights: thin cords from the ceiling with warm glowing bulbs ── */}
      {[-pendantX, pendantX].map((x) => (
        <group key={`pend${x}`}>
          <mesh position={[x, (H + bulbY) / 2, pendantZ]} raycast={noRaycast}>
            <cylinderGeometry args={[0.008, 0.008, H - bulbY, 6]} />
            <meshStandardMaterial color={'#1a1a1a'} roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[x, bulbY, pendantZ]} raycast={noRaycast}>
            <sphereGeometry args={[0.085, 24, 16]} />
            <meshStandardMaterial color={'#fff4dd'} emissive={'#ffd9a0'} emissiveIntensity={1.8} />
          </mesh>
          <pointLight position={[x, bulbY, pendantZ]} intensity={0.35} distance={3} color={'#ffe3b8'} />
        </group>
      ))}

      {/* ── Potted plant near the right wall ── */}
      <group position={[plantX, 0, plantZ]}>
        <mesh position={[0, 0.21, 0]} raycast={noRaycast} castShadow>
          <cylinderGeometry args={[0.2, 0.16, 0.42, 24]} />
          <meshStandardMaterial color={'#9b968c'} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.42, 0]} raycast={noRaycast}>
          <cylinderGeometry args={[0.18, 0.18, 0.03, 24]} />
          <meshStandardMaterial color={'#3d2f24'} roughness={1} />
        </mesh>
        {leafAngles.map((a, i) => {
          const lean = 0.55 + (i % 3) * 0.18
          const height = 0.6 + (i % 2) * 0.2
          return (
            <mesh
              key={`leaf${i}`}
              position={[Math.sin(a) * 0.28, 0.42 + height / 2, Math.cos(a) * 0.28]}
              rotation={[Math.cos(a) * lean * 0.5, a, Math.sin(a) * lean * 0.5]}
              scale={[0.3, height, 0.06]}
              raycast={noRaycast}
              castShadow
            >
              <sphereGeometry args={[0.5, 12, 8]} />
              <meshStandardMaterial color={i % 2 ? '#2e6b3f' : '#3a7d4a'} roughness={0.85} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}
