import { create } from 'zustand'
import type { RoomTemplate, SurfaceId, TileSettings, CalculatorData, ViewMode } from '../types'

export const DEFAULT_TILE_SETTINGS: TileSettings = {
  tileWidth: 120,
  tileHeight: 120,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  flipH: false,
  flipV: false,
  bookmatch: 'off',
  groutSize: 1,
  groutColor: '#dedad4',
}

const DEFAULT_CALC: CalculatorData = {
  surfaceWidth: 720,
  surfaceHeight: 300,
  tileWidth: 120,
  tileHeight: 120,
  wastagePercent: 10,
}

export interface MarbleSKU {
  id: string
  name: string
  urls: string[]         // one or more blob URLs for this SKU's slabs
}

interface AppState {
  selectedRoom: RoomTemplate | null
  selectedSurface: SurfaceId | null

  // Active images (1 = single upload, many = SKU folder)
  uploadedImages: string[]
  uploadedSKUs: MarbleSKU[]
  activeSKUId: string | null

  // What's been applied per surface — array because SKU can have many images
  surfaceApplied: Partial<Record<SurfaceId, string[]>>

  // Per-surface tile settings — each surface has its own independent settings
  surfaceTileSettings: Partial<Record<SurfaceId, TileSettings>>
  // Bumped by regenerateArrangement() to force a fresh random tile layout
  // (buildTileCanvas mixes this into its seed) without changing any images/settings
  surfaceArrangementSeed: Partial<Record<SurfaceId, number>>
  calculatorData: CalculatorData
  viewMode: ViewMode
  showCalculator: boolean
  // Scenery furniture (e.g. the bedroom set) — hidden for captures that feed
  // the AI photoreal furnishing step, which needs a clean empty room
  showFurniture: boolean

  // Room / surface
  setRoom: (room: RoomTemplate) => void
  updateRoomDimensions: (patch: Partial<Pick<RoomTemplate, 'floorWidth' | 'floorDepth' | 'wallHeight'>>) => void
  setSurface: (id: SurfaceId | null) => void

  // Single image upload
  setSingleImage: (url: string) => void

  // SKU folder management
  addSKU: (sku: MarbleSKU) => void
  removeSKU: (id: string) => void
  setActiveSKU: (id: string | null) => void
  addImageToActiveSKU: (url: string) => void

  // Inline upload queue management
  addUploadedImage: (url: string) => void
  removeUploadedImage: (url: string) => void
  clearUploadedImages: () => void

  // Apply
  applyToSurface: () => void
  removeSurfaceApplied: (id: SurfaceId) => void

  // Settings — only patches the currently selected surface
  updateTileSettings: (patch: Partial<TileSettings>) => void
  regenerateArrangement: (id: SurfaceId) => void
  updateCalculator: (patch: Partial<CalculatorData>) => void
  setViewMode: (mode: ViewMode) => void
  toggleCalculator: () => void
  setShowFurniture: (visible: boolean) => void
  reset: () => void
}

export const useStore = create<AppState>((set, get) => ({
  selectedRoom: null,
  selectedSurface: null,
  uploadedImages: [],
  uploadedSKUs: [],
  activeSKUId: null,
  surfaceApplied: {},
  surfaceTileSettings: {},
  surfaceArrangementSeed: {},
  calculatorData: { ...DEFAULT_CALC },
  viewMode: 'single',
  showCalculator: false,
  showFurniture: true,

  setRoom: (room) => set({
    selectedRoom: room,
    selectedSurface: null,
    surfaceApplied: {},
    surfaceTileSettings: {},
    surfaceArrangementSeed: {},
    uploadedImages: [],
    activeSKUId: null,
    calculatorData: {
      ...DEFAULT_CALC,
      surfaceWidth: room.floorWidth,
      surfaceHeight: room.floorDepth,
    },
  }),

  updateRoomDimensions: (patch) => {
    const { selectedRoom, selectedSurface, calculatorData } = get()
    if (!selectedRoom) return
    const room = { ...selectedRoom, ...patch }
    const isFloor = selectedSurface === 'floor'
    set({
      selectedRoom: room,
      calculatorData: selectedSurface
        ? {
            ...calculatorData,
            surfaceWidth: isFloor ? room.floorWidth : room.floorWidth,
            surfaceHeight: isFloor ? room.floorDepth : room.wallHeight,
          }
        : { ...calculatorData, surfaceWidth: room.floorWidth, surfaceHeight: room.floorDepth },
    })
  },

  setSurface: (id) => {
    const { selectedRoom, surfaceTileSettings, calculatorData } = get()
    if (!selectedRoom || !id) { set({ selectedSurface: id }); return }
    const isFloor = id === 'floor'
    const surfaceSettings = surfaceTileSettings[id] ?? DEFAULT_TILE_SETTINGS
    set({
      selectedSurface: id,
      calculatorData: {
        ...calculatorData,
        surfaceWidth: isFloor ? selectedRoom.floorWidth : selectedRoom.floorWidth,
        surfaceHeight: isFloor ? selectedRoom.floorDepth : selectedRoom.wallHeight,
        tileWidth: surfaceSettings.tileWidth,
        tileHeight: surfaceSettings.tileHeight,
      },
    })
  },

  // Single image — replaces current upload queue
  setSingleImage: (url) => set({ uploadedImages: [url], activeSKUId: null }),

  // SKU management
  addSKU: (sku) => set((s) => ({ uploadedSKUs: [...s.uploadedSKUs, sku] })),
  removeSKU: (id) => set((s) => ({
    uploadedSKUs: s.uploadedSKUs.filter((k) => k.id !== id),
    activeSKUId: s.activeSKUId === id ? null : s.activeSKUId,
    uploadedImages: s.activeSKUId === id ? [] : s.uploadedImages,
  })),
  setActiveSKU: (id) => {
    const { uploadedSKUs } = get()
    const sku = uploadedSKUs.find((k) => k.id === id)
    set({ activeSKUId: id, uploadedImages: sku ? sku.urls : [] })
  },
  addImageToActiveSKU: (url) => {
    const { activeSKUId, uploadedSKUs, uploadedImages } = get()
    const newImages = [...uploadedImages, url]
    set({ uploadedImages: newImages })
    if (activeSKUId) {
      set({
        uploadedSKUs: uploadedSKUs.map((s) =>
          s.id === activeSKUId ? { ...s, urls: newImages } : s
        ),
      })
    }
  },

  // Inline queue management
  addUploadedImage: (url) => set((s) => ({ uploadedImages: [...s.uploadedImages, url], activeSKUId: null })),
  removeUploadedImage: (url) => set((s) => ({ uploadedImages: s.uploadedImages.filter((u) => u !== url) })),
  clearUploadedImages: () => set({ uploadedImages: [], activeSKUId: null }),

  applyToSurface: () => {
    const { selectedSurface, uploadedImages, surfaceApplied } = get()
    if (!selectedSurface || uploadedImages.length === 0) return
    set({ surfaceApplied: { ...surfaceApplied, [selectedSurface]: [...uploadedImages] } })
  },

  removeSurfaceApplied: (id) => {
    const { surfaceApplied } = get()
    const next = { ...surfaceApplied }
    delete next[id]
    set({ surfaceApplied: next })
  },

  updateTileSettings: (patch) => {
    const { selectedSurface, surfaceTileSettings, calculatorData } = get()
    if (!selectedSurface) return
    const current = surfaceTileSettings[selectedSurface] ?? { ...DEFAULT_TILE_SETTINGS }
    const updated = { ...current, ...patch }
    set({
      surfaceTileSettings: { ...surfaceTileSettings, [selectedSurface]: updated },
      calculatorData: {
        ...calculatorData,
        tileWidth: updated.tileWidth,
        tileHeight: updated.tileHeight,
      },
    })
  },

  regenerateArrangement: (id) => set((s) => ({
    surfaceArrangementSeed: { ...s.surfaceArrangementSeed, [id]: (s.surfaceArrangementSeed[id] ?? 0) + 1 },
  })),

  setShowFurniture: (visible) => set({ showFurniture: visible }),

  updateCalculator: (patch) => set((s) => ({
    calculatorData: { ...s.calculatorData, ...patch },
  })),

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleCalculator: () => set((s) => ({ showCalculator: !s.showCalculator })),

  reset: () => set({
    uploadedImages: [],
    activeSKUId: null,
    surfaceApplied: {},
    surfaceTileSettings: {},
    surfaceArrangementSeed: {},
    selectedSurface: null,
  }),
}))
