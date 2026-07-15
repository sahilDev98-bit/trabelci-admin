import { useEffect, useMemo, useRef } from 'react'
import { useStore, DEFAULT_TILE_SETTINGS } from '../../store/useStore'
import { buildTileCanvas, loadImageCached } from '../../utils/buildTileCanvas'
import { beginLoad, endLoad } from '../../utils/textureLoadTracker'
import {
  buildLumMap, buildQuadMask, drawWarped, relightRegion, drawOccluders,
  drawGreenKeyedOccluders, pointInQuad,
} from '../../utils/photoCompositor'
import type { RoomTemplate } from '../../types'

interface PhotoRoomViewerProps {
  room: RoomTemplate
  id?: string
}

// Photo-based room: a real photograph with marble composited into annotated
// surface regions (see PhotoRoomConfig). Fixed viewpoint — no orbit — but
// photoreal lighting for free. Drives the same store/bridge state as the 3D
// scene, so the workflow's assign/settings/capture flow works unchanged.
export function PhotoRoomViewer({ room, id }: PhotoRoomViewerProps) {
  const cfg = room.photoRoom!
  const canvasRef = useRef<HTMLCanvasElement>(null!)

  const { surfaceApplied, surfaceTileSettings, surfaceArrangementSeed, setSurface } = useStore()

  // Everything the composite depends on, collapsed to a string so the effect
  // reruns exactly when a relevant piece of state changes. Image URLs are
  // data URLs that can be many MB each — NEVER stringify their contents
  // (doing so on every store change is a guaranteed jank/OOM crash); a
  // length+tail fingerprint identifies them just as well.
  const imageFingerprint = (url: string) => url.length + ':' + url.slice(-32)
  const compositeKey = useMemo(() => JSON.stringify({
    applied: cfg.surfaces.map((s) => (surfaceApplied[s.surfaceId] ?? []).map(imageFingerprint)),
    settings: cfg.surfaces.map((s) => surfaceTileSettings[s.surfaceId] ?? null),
    seeds: cfg.surfaces.map((s) => surfaceArrangementSeed[s.surfaceId] ?? 0),
  }), [cfg, surfaceApplied, surfaceTileSettings, surfaceArrangementSeed])

  useEffect(() => {
    let cancelled = false
    beginLoad() // synchronous, so bridge waitUntilIdle sees the work start

    ;(async () => {
      const photo = await loadImageCached(cfg.src)
      const lum = buildLumMap(photo, cfg.width, cfg.height)

      const work = document.createElement('canvas')
      work.width = cfg.width
      work.height = cfg.height
      const ctx = work.getContext('2d')!
      ctx.drawImage(photo, 0, 0, cfg.width, cfg.height)

      for (const surface of cfg.surfaces) {
        const urls = surfaceApplied[surface.surfaceId] ?? []
        if (!urls.length) continue
        const images = await Promise.all(urls.map(loadImageCached))
        if (cancelled) return

        const t = { ...DEFAULT_TILE_SETTINGS, ...surfaceTileSettings[surface.surfaceId] }
        const tileCanvas = buildTileCanvas({
          images,
          surfaceWidthCm: surface.widthCm,
          surfaceHeightCm: surface.heightCm,
          tileWidthCm: t.tileWidth,
          tileHeightCm: t.tileHeight,
          groutSize: t.groutSize,
          groutColor: t.groutColor,
          bookmatch: t.bookmatch,
          flipH: t.flipH,
          flipV: t.flipV,
          rotation: t.rotation,
          seed: surfaceArrangementSeed[surface.surfaceId] ?? 0,
        })

        drawWarped(ctx, tileCanvas, surface.quad)
        const { mask, mean } = buildQuadMask(surface.quad, lum)
        relightRegion(ctx, lum, mask, mean, surface.relight)
      }

      drawOccluders(ctx, photo, cfg.occluders, cfg.width, cfg.height)
      drawGreenKeyedOccluders(ctx, photo, cfg.greenKeyOccluders ?? [], cfg.width, cfg.height)

      if (cancelled || !canvasRef.current) return
      const out = canvasRef.current
      out.width = cfg.width
      out.height = cfg.height
      out.getContext('2d')!.drawImage(work, 0, 0)
    })()
      .catch((err) => console.error('[PhotoRoomViewer] composite failed:', err))
      .finally(() => endLoad())

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositeKey])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    // object-fit: contain — map the click back to photo pixel space
    const scale = Math.min(rect.width / cfg.width, rect.height / cfg.height)
    const offsetX = (rect.width - cfg.width * scale) / 2
    const offsetY = (rect.height - cfg.height * scale) / 2
    const x = (e.clientX - rect.left - offsetX) / scale
    const y = (e.clientY - rect.top - offsetY) / scale
    for (const surface of cfg.surfaces) {
      if (pointInQuad(x, y, surface.quad)) {
        setSurface(surface.surfaceId)
        return
      }
    }
  }

  return (
    <div id={id} className="w-full h-full" style={{ background: '#cac7c1' }}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
      />
    </div>
  )
}
