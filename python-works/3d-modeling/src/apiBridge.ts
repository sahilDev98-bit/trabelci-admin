import { useStore, DEFAULT_TILE_SETTINGS } from './store/useStore'
import { roomTemplates } from './rooms/roomTemplates'
import { isIdle, onIdle } from './utils/textureLoadTracker'
import type { RoomTemplate, SurfaceId, TileSettings } from './types'

// Dev-only bridge letting an external process drive the room/material state
// without going through the UI — either same-process automation (window.__modelingBridge)
// or a parent page embedding this app in an iframe (postMessage, see below).
export interface ModelingBridge {
  setRoomByCategory: (category: string) => boolean
  setRoomById: (id: string) => boolean
  setRoomDimensions: (patch: Partial<Pick<RoomTemplate, 'floorWidth' | 'floorDepth' | 'wallHeight'>>) => void
  applySurfaceImages: (assignments: Partial<Record<SurfaceId, string[]>>) => void
  setTileSettings: (settings: Partial<Record<SurfaceId, Partial<TileSettings>>>) => void
  regenerateArrangement: (surfaceId: SurfaceId) => void
  setFurnitureVisible: (visible: boolean) => void
  captureImage: () => string | null
  isReady: () => boolean
}

declare global {
  interface Window {
    __modelingBridge?: ModelingBridge
  }
}

window.__modelingBridge = {
  setRoomByCategory(category) {
    const room = roomTemplates.find((r) => r.category === category) ?? roomTemplates[0]
    useStore.getState().setRoom(room)
    return !!room
  },

  // Selects a specific room template (e.g. 'bedroom-photo') — for variants
  // that share a category with another room and can't be reached by
  // setRoomByCategory's first-match rule.
  setRoomById(id) {
    const room = roomTemplates.find((r) => r.id === id)
    if (!room) return false
    useStore.getState().setRoom(room)
    return true
  },

  // Overrides the currently selected room's real-world size (cm) — call after
  // setRoomByCategory. Only the provided keys are changed; omitted dimensions
  // keep the room template's default.
  setRoomDimensions(patch) {
    useStore.getState().updateRoomDimensions(patch)
  },

  applySurfaceImages(assignments) {
    useStore.setState((s) => ({
      surfaceApplied: { ...s.surfaceApplied, ...assignments },
    }))
  },

  setTileSettings(settings) {
    useStore.setState((s) => {
      const next = { ...s.surfaceTileSettings }
      for (const [surfaceId, patch] of Object.entries(settings) as [SurfaceId, Partial<TileSettings>][]) {
        next[surfaceId] = { ...DEFAULT_TILE_SETTINGS, ...next[surfaceId], ...patch }
      }
      return { surfaceTileSettings: next }
    })
  },

  regenerateArrangement(surfaceId) {
    useStore.getState().regenerateArrangement(surfaceId)
  },

  // Hide/show scenery furniture (e.g. the bedroom set) — the AI furnishing
  // step captures with it hidden so FLUX gets a clean empty marble room.
  setFurnitureVisible(visible) {
    useStore.getState().setShowFurniture(visible)
  },

  // Same-page canvas read — no cross-process capture race, preserveDrawingBuffer
  // is already on, so this reliably reflects the last rendered frame.
  captureImage() {
    const canvas = document.querySelector('canvas')
    return canvas ? canvas.toDataURL('image/png') : null
  },

  isReady() {
    return isIdle()
  },
}

function waitUntilIdle(timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    // Double rAF lets the freshly-built texture reach the screen before a
    // capture reads the canvas — but the browser stops firing rAF entirely
    // while this (cross-origin) iframe is scrolled offscreen, so it must be
    // raced against a plain timer or captureImage never replies and the
    // parent times out.
    const settle = () => {
      requestAnimationFrame(() => requestAnimationFrame(finish))
      setTimeout(finish, 600)
    }
    // Give React a moment to schedule/commit the state update and run
    // SurfacePlane's loading effect (which calls beginLoad() synchronously at
    // the start) before checking idle — otherwise "nothing has started
    // loading yet" is indistinguishable from "already finished loading",
    // and callers race ahead of the texture actually being built.
    setTimeout(() => {
      if (isIdle()) { settle(); return }
      const unsubscribe = onIdle(() => { unsubscribe(); settle() })
      setTimeout(() => { unsubscribe(); finish() }, timeoutMs)
    }, 50)
  })
}

// Lets a parent page embedding this app in an iframe drive the same bridge
// via postMessage — used by the modeling-automation workflow's "Arrange &
// Review" step so the user interacts with this real app directly instead of
// a server-side render of it.
window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return
  if (!data.type.startsWith('modelingBridge:')) return

  const reply = (payload: Record<string, unknown>) => {
    const target = event.source as Window | null
    target?.postMessage({ type: 'modelingBridge:response', requestId: data.requestId, ...payload }, '*')
  }

  const bridge = window.__modelingBridge!

  ;(async () => {
    try {
      switch (data.type) {
        case 'modelingBridge:setRoomByCategory':
          reply({ ok: bridge.setRoomByCategory(data.category) })
          break
        case 'modelingBridge:setRoomById':
          reply({ ok: bridge.setRoomById(data.id) })
          break
        case 'modelingBridge:setRoomDimensions':
          bridge.setRoomDimensions(data.dimensions)
          reply({ ok: true })
          break
        case 'modelingBridge:applySurfaceImages':
          bridge.applySurfaceImages(data.assignments)
          reply({ ok: true })
          break
        case 'modelingBridge:setTileSettings':
          bridge.setTileSettings(data.settings)
          reply({ ok: true })
          break
        case 'modelingBridge:regenerateArrangement':
          bridge.regenerateArrangement(data.surfaceId)
          reply({ ok: true })
          break
        case 'modelingBridge:setFurnitureVisible':
          bridge.setFurnitureVisible(!!data.visible)
          reply({ ok: true })
          break
        case 'modelingBridge:captureImage':
          await waitUntilIdle()
          reply({ ok: true, dataUrl: bridge.captureImage() })
          break
        case 'modelingBridge:waitUntilReady':
          await waitUntilIdle()
          reply({ ok: true })
          break
        case 'modelingBridge:ping':
          reply({ ok: true })
          break
        default:
          reply({ ok: false, error: `unknown message type ${data.type}` })
      }
    } catch (err) {
      reply({ ok: false, error: String(err) })
    }
  })()
})

// Tell an embedding parent this bridge is attached and ready for commands.
if (window.parent !== window) {
  window.parent.postMessage({ type: 'modelingBridge:hello' }, '*')
}

// Lets the embedding page react to a surface being clicked in the 3D view
// (e.g. open its marble picker next to the click). x/y are viewport
// coordinates inside this iframe; the parent offsets them by the iframe's
// own position.
export function notifySurfacePicked(surfaceId: SurfaceId, x: number, y: number) {
  if (window.parent === window) return
  window.parent.postMessage({ type: 'modelingBridge:surfacePicked', surfaceId, x, y }, '*')
}
