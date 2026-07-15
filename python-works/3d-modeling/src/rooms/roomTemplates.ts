import type { RoomTemplate } from '../types'

/**
 * All dimensions in cm. Widths/heights are chosen to be exact multiples of
 * common tile sizes (120×120, 60×120, 80×80) so tile grids land cleanly.
 *
 * Living Room matches the luxury render:  7 tiles × 3 tiles  @ 120×120 cm
 *   → wall 840 × 360 cm
 */
export const roomTemplates: RoomTemplate[] = [
  {
    id: 'living-room',
    name: 'Living Room',
    category: 'living',
    previewColor: '#7c6f5a',
    previewGradient: 'from-amber-800 to-amber-600',
    floorWidth: 720,   // 6 × 120 cm  →  6 tiles across (matches reference)
    floorDepth: 600,   // 5 × 120 cm  →  closer back wall = larger-looking tiles
    wallHeight: 300,   // 2.5 × 120 cm  →  2 full + partial row (matches reference)
    surfaces: ['floor', 'wall1', 'wall2', 'wall3'],
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    category: 'kitchen',
    previewColor: '#5a7c6f',
    previewGradient: 'from-teal-800 to-teal-600',
    floorWidth: 480,   // 4 × 120 cm
    floorDepth: 360,
    wallHeight: 300,   // 2.5 × 120 cm  (common kitchen ceiling)
    surfaces: ['floor', 'wall1', 'wall2', 'wall3'],
  },
  {
    id: 'bathroom',
    name: 'Bathroom',
    category: 'bathroom',
    previewColor: '#5a6f7c',
    previewGradient: 'from-sky-800 to-sky-600',
    floorWidth: 240,   // 2 × 120 cm
    floorDepth: 200,
    wallHeight: 240,   // 2 × 120 cm
    surfaces: ['floor', 'wall1', 'wall2', 'wall3'],
  },
  {
    id: 'bedroom',
    name: 'Bedroom',
    category: 'bedroom',
    previewColor: '#6f5a7c',
    previewGradient: 'from-violet-800 to-violet-600',
    floorWidth: 600,   // 5 × 120 cm
    floorDepth: 480,
    wallHeight: 300,   // 2.5 × 120 cm
    surfaces: ['floor', 'wall1', 'wall2', 'wall3'],
  },
  // Photo-based bedroom — selected explicitly by id (setRoomById), never by
  // category: setRoomByCategory('bedroom') must keep resolving to the plain
  // 3D bedroom above (first match wins). No workflow template points here
  // anymore (Medium Bedroom uses the plain 3D room like every other template);
  // kept for explicit selection from the Scenes list.
  {
    id: 'bedroom-photo',
    name: 'Bedroom — Real Photo',
    category: 'bedroom',
    previewColor: '#6f5a7c',
    previewGradient: 'from-violet-800 to-violet-600',
    floorWidth: 480,
    floorDepth: 420,
    wallHeight: 300,
    surfaces: ['floor', 'wall1', 'wall2', 'wall3'],
    // Real bedroom photo with the back wall (wall1), right wall (wall3) and
    // floor annotated as changeable marble regions. The left side is all
    // window, so wall2 has no region and assignments to it are ignored here.
    photoRoom: {
      // BASE_URL-relative so the photo resolves both on the Vite dev server
      // ('/') and when the built app is served under /viewer/ ('./').
      src: import.meta.env.BASE_URL + 'rooms/bedroom-photo.jpeg',
      width: 1000,
      height: 560,
      surfaces: [
        { surfaceId: 'wall1', quad: [[190, 0], [838, 0], [838, 351], [190, 351]], widthCm: 480, heightCm: 260,
          relight: { strength: 0.4, lo: 0.78, hi: 1.22, saturation: 0.82 } },
        { surfaceId: 'wall3', quad: [[838, 0], [1000, -138], [1000, 382], [838, 351]], widthCm: 150, heightCm: 280,
          relight: { strength: 0.45, lo: 0.72, hi: 1.2, saturation: 0.82 } },
        { surfaceId: 'floor', quad: [[190, 351], [838, 351], [1943, 560], [-823, 560]], widthCm: 480, heightCm: 380,
          relight: { strength: 0.3, lo: 0.8, hi: 1.15, specular: 0.6, saturation: 0.8 } },
      ],
      occluders: [
        // headboard unit incl. nightstands (a clean rectangle in the photo,
        // measured: x 195–808, top edge y 232, nightstand bottoms y 361)
        [[195, 232], [808, 232], [808, 361], [195, 361]],
        // bed body: pillows → mattress → wooden platform (platform is a near-
        // rectangle x 295–731 ending at y 402; the LED glow below it is NOT
        // occluded — the relight/specular pass recreates it on the new marble)
        [[284, 288], [716, 288], [723, 353], [725, 358], [725, 402], [295, 402], [295, 358], [302, 353]],
        // left pendant: cord + bulb
        [[264, 0], [272, 0], [272, 250], [264, 250]],
        [[251, 252], [256, 240], [268, 235], [280, 240], [285, 252], [280, 264], [268, 269], [256, 264]],
        // right pendant: cord + bulb
        [[733, 0], [741, 0], [741, 247], [733, 247]],
        [[720, 249], [725, 237], [737, 232], [749, 237], [754, 249], [749, 261], [737, 266], [725, 261]],
        // plant pot (right side) — the foliage itself is green-keyed below
        [[916, 305], [978, 305], [988, 330], [983, 368], [962, 385], [930, 385], [910, 368], [904, 330]],
      ],
      greenKeyOccluders: [
        // generous region around the plant: only leaf/stem pixels are copied.
        // (The leaf ends ~y355; what's below it on the floor is its reflection,
        // which must NOT be copied — the marble gets fresh reflections instead.)
        [[1000, 90], [890, 90], [815, 130], [780, 200], [788, 275], [795, 330], [830, 365], [870, 380], [1000, 380]],
      ],
    },
  },
  {
    id: 'commercial-hall',
    name: 'Commercial Hall',
    category: 'commercial',
    previewColor: '#4a5568',
    previewGradient: 'from-gray-700 to-gray-500',
    floorWidth: 1200,  // 10 × 120 cm
    floorDepth: 960,
    wallHeight: 480,   // 4 × 120 cm  (high commercial ceiling)
    surfaces: ['floor', 'wall1', 'wall2', 'wall3'],
  },
  {
    id: 'outdoor-patio',
    name: 'Outdoor Patio',
    category: 'outdoor',
    previewColor: '#6b7c5a',
    previewGradient: 'from-green-800 to-green-600',
    floorWidth: 720,   // 6 × 120 cm
    floorDepth: 600,
    wallHeight: 0,
    surfaces: ['floor'],
  },
]

export const categoryLabels: Record<string, string> = {
  living: 'Living Room',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  bedroom: 'Bedroom',
  commercial: 'Commercial',
  outdoor: 'Outdoor',
}

export const categories = ['living', 'kitchen', 'bathroom', 'bedroom', 'commercial', 'outdoor'] as const
