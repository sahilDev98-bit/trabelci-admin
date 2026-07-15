export type RoomCategory = 'living' | 'kitchen' | 'bathroom' | 'bedroom' | 'commercial' | 'outdoor'
export type SurfaceId = 'floor' | 'wall1' | 'wall2' | 'wall3' | 'wall4'
export type BookmatchMode = 'off' | 'horizontal' | 'vertical' | 'quad'
export type ViewMode = 'single' | 'compare'

export interface RoomTemplate {
  id: string
  name: string
  category: RoomCategory
  previewColor: string
  previewGradient: string
  floorWidth: number   // cm (used as Three.js units)
  floorDepth: number   // cm
  wallHeight: number   // cm
  surfaces: SurfaceId[]
  // When set, the room renders as a real photo with marble composited into
  // the annotated surface regions instead of a 3D scene (fixed viewpoint).
  photoRoom?: PhotoRoomConfig
}

// A changeable surface region inside a room photo. The quad maps the tiled
// marble canvas (a rectangle in real-world space) onto the photo in
// perspective; widthCm/heightCm size that rectangle so tile counts are right.
export interface PhotoSurfaceConfig {
  surfaceId: SurfaceId
  quad: [number, number][]   // TL, TR, BR, BL in photo pixels (may extend off-frame)
  widthCm: number
  heightCm: number
  relight?: PhotoSurfaceRelight
}

// How strongly the photo's own light reshapes the composited marble. Kept
// gentle by default so the marble's true color/veining stays readable.
export interface PhotoSurfaceRelight {
  strength?: number   // 0..1 — fraction of the photo's shading applied (default 0.45)
  lo?: number         // darkest multiplier allowed (default 0.72)
  hi?: number         // brightest multiplier allowed (default 1.3)
  specular?: number   // 0..1 — re-adds the photo's bright reflections on top (default 0)
  saturation?: number // color saturation of the marble, 1 = untouched (default 1)
}

export interface PhotoRoomConfig {
  src: string
  width: number    // native photo px
  height: number
  surfaces: PhotoSurfaceConfig[]
  // Foreground objects (furniture, plants, lamps) — these photo regions are
  // redrawn on top of the composited marble so they stay in front of it.
  occluders: [number, number][][]
  // Like occluders, but only foliage-like pixels (green-dominant or very dark)
  // inside the polygon are copied back — pixel-accurate plant cutouts without
  // hand-painted masks.
  greenKeyOccluders?: [number, number][][]
}

export interface TileSettings {
  tileWidth: number    // cm
  tileHeight: number   // cm
  rotation: number     // degrees
  scaleX: number
  scaleY: number
  flipH: boolean
  flipV: boolean
  bookmatch: BookmatchMode
  groutSize: number    // 0-10 (line thickness factor)
  groutColor: string   // CSS hex color for grout lines
}

export interface SurfaceTextures {
  floor?: string
  wall1?: string
  wall2?: string
  wall3?: string
  wall4?: string
}

export interface CalculatorData {
  surfaceWidth: number
  surfaceHeight: number
  tileWidth: number
  tileHeight: number
  wastagePercent: number
}

export interface CalcResult {
  surfaceArea: number
  tileArea: number
  baseTiles: number
  withWastage: number
}
