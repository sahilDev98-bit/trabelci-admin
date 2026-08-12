/**
 * Obtains the PDFium WASM binary and the bundled fallback fonts.
 *
 * Both are served from this app's own /public directory rather than a CDN:
 * the editor must keep working offline and behind a customer firewall, and
 * a font that fails to load would silently change how an edit renders.
 */
import { initPdfium, type WrappedPdfiumModule } from "./core"

const WASM_URL = "/pdf-engine/pdfium.wasm"

export const FONT_URLS = {
  regular: "/pdf-engine/fonts/Heebo-Regular.ttf",
  bold: "/pdf-engine/fonts/Heebo-Bold.ttf",
  hebrew: "/pdf-engine/fonts/NotoSansHebrew.ttf",
} as const

export type FallbackFontKey = keyof typeof FONT_URLS

let pdfiumPromise: Promise<WrappedPdfiumModule> | null = null

/** Initialises PDFium once per context (main thread or worker) and reuses
 * it. Cached as the PROMISE, not the result, so two callers racing during
 * startup can't each start their own instantiation. */
export function getPdfium(): Promise<WrappedPdfiumModule> {
  if (!pdfiumPromise) {
    pdfiumPromise = (async () => {
      const res = await fetch(WASM_URL)
      if (!res.ok) throw new Error(`Failed to load PDFium WASM (${res.status}) from ${WASM_URL}`)
      return initPdfium(await res.arrayBuffer())
    })().catch((err) => {
      // Clear the cache on failure so a later attempt can retry rather
      // than replaying the rejection forever.
      pdfiumPromise = null
      throw err
    })
  }
  return pdfiumPromise
}

const fontCache = new Map<FallbackFontKey, Promise<Uint8Array>>()

export function getFallbackFont(key: FallbackFontKey): Promise<Uint8Array> {
  let cached = fontCache.get(key)
  if (!cached) {
    cached = (async () => {
      const res = await fetch(FONT_URLS[key])
      if (!res.ok) throw new Error(`Failed to load fallback font "${key}" (${res.status})`)
      return new Uint8Array(await res.arrayBuffer())
    })().catch((err) => {
      fontCache.delete(key)
      throw err
    })
    fontCache.set(key, cached)
  }
  return cached
}
