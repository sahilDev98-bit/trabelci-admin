// Registers the SAME fallback face the Python export actually uses
// (FONT_FILES["regular"/"bold"] in pdf_editor.py are Heebo-Regular.ttf /
// Heebo-Bold.ttf) — found already installed and already used elsewhere in
// this app (SkuSheetCeramic.tsx imports these same weights), so this is
// the real backend font, not a lookalike or a CDN fetch. Loading it here
// is what lets FALLBACK_FONT_STACK below name it directly instead of a
// generic system font that merely resembles it.
import "@fontsource/heebo/400.css"
import "@fontsource/heebo/700.css"

import type { PdfSessionFont } from "@/features/pdfTemplates/types"

/**
 * Registers the source PDF's OWN embedded typefaces with the browser so the
 * editor can measure and draw a text edit in the exact face the exported PDF
 * will use.
 *
 * This is what closes the gap that made text editing unpredictable: the
 * preview used to measure in `system-ui` while the server drew in Heebo —
 * two different rulers, so a line that looked like it fit could wrap (or
 * not) completely differently in the downloaded file. Same font on both
 * sides means the wrap points, the line count and the fit verdict shown on
 * screen are the ones that actually happen.
 */

/** CSS font-family name for a session font id. Namespaced by session so two
 * templates open in different tabs can't collide on the same family name. */
export function pdfFontFamily(sessionId: string, fontId: string): string {
  return `pdfmaster-${sessionId}-${fontId}`
}

/**
 * Used whenever a hotspot has no usable embedded face, or its embedded
 * subset can't draw the text being typed (see fontCanDraw below).
 *
 * "Heebo" first, deliberately: it's the exact family the backend falls
 * back to, covering Latin AND Hebrew (the same package ships
 * heebo-hebrew-*.woff2 alongside heebo-latin-*.woff2 — confirmed present
 * in node_modules/@fontsource/heebo/files). `system-ui, sans-serif` stays
 * after it purely as a browser-safety net for the split second before the
 * webfont has finished loading, or on the off chance loading it failed —
 * it should essentially never be the face actually rendered with.
 *
 * This is the ONE place that name is chosen. If a project ever needs a
 * closer match to the backend's Noto Sans Hebrew safety-net font instead,
 * this is the only line that has to change — no font files were invented
 * or fetched from an external CDN to build this; only a package already
 * vendored in this repo (`@fontsource/heebo`, dependency in package.json)
 * was reused.
 */
export const FALLBACK_FONT_STACK = "Heebo, system-ui, sans-serif"

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return buffer
}

/**
 * Load every supplied face into `document.fonts`, returning the set of font
 * ids that are actually usable for measurement.
 *
 * Deliberately resilient: a single malformed face must not take the editor
 * down with it, so each one is loaded independently and failures are simply
 * left out of the returned set (those hotspots then fall back, exactly as
 * they behaved before this existed).
 */
export async function loadPdfSessionFonts(
  sessionId: string,
  fonts: Record<string, PdfSessionFont>,
): Promise<Set<string>> {
  if (typeof document === "undefined" || !("fonts" in document)) return new Set()

  const loaded = new Set<string>()
  await Promise.all(
    Object.entries(fonts).map(async ([fontId, font]) => {
      try {
        const face = new FontFace(pdfFontFamily(sessionId, fontId), base64ToBuffer(font.data))
        await face.load()
        document.fonts.add(face)
        loaded.add(fontId)
      } catch {
        // Unusable face — leave it out; callers fall back to the generic stack.
      }
    }),
  )
  return loaded
}

/** Remove this session's faces again — without this, opening several
 * templates in one page-load would keep every previous document's fonts
 * resident for the lifetime of the tab. */
export function unloadPdfSessionFonts(sessionId: string): void {
  if (typeof document === "undefined" || !("fonts" in document)) return
  const prefix = `pdfmaster-${sessionId}-`
  const toDelete: FontFace[] = []
  document.fonts.forEach((face) => {
    if (face.family.startsWith(prefix)) toDelete.push(face)
  })
  for (const face of toDelete) document.fonts.delete(face)
}

/**
 * Can this face actually draw every character of `text`?
 *
 * Not the same question as "is the font loaded". An embedded subset maps
 * characters it cannot draw — the cmap entry survives, the outline doesn't —
 * so the browser silently renders them as nothing. `usable` lists the
 * characters the document itself draws in this face, which is the only
 * reliable answer available.
 *
 * This and hotspotCanvasFont below are the only two primitives fallback
 * decisions are built from. They're deliberately dumb (pure functions, no
 * state) — the actual DECISION of whether a given edit needs the fallback
 * belongs in exactly one place, pdfTextFit.ts's fitText, which calls this
 * once per edit against the CURRENT text and hands the answer down through
 * PdfTextRenderPlan.useFallbackFont to everything that draws. Calling
 * fontCanDraw again at a drawing site — instead of reading the plan's
 * useFallbackFont — is how "Yash" checked against "Carnaby" and rendered
 * as "ash": the same question, asked twice, against two different texts.
 */
export function fontCanDraw(usableChars: string, text: string): boolean {
  if (!usableChars) return true // unknown — no reason to distrust it
  const usable = new Set(usableChars)
  for (const ch of text) {
    if (ch.trim() === "") continue // whitespace never needs a glyph
    if (!usable.has(ch)) return false
  }
  return true
}

/**
 * The canvas `font` shorthand for a hotspot.
 *
 * When the document's own face is available it is used ALONE, with no
 * bold/italic keywords: the embedded face already *is* the bold (or italic)
 * cut, so asking canvas to bold it again would trigger synthetic emboldening
 * on top of a font that's already heavy — wider glyphs than the real ones,
 * which throws off every width measurement taken from it. The keywords are
 * only meaningful on the generic fallback stack, where one family really
 * does have to stand in for all four styles.
 */
export function hotspotCanvasFont(
  hotspot: { fontId: string; bold: boolean; italic: boolean; size: number },
  sessionId: string | null,
  availableFontIds: Set<string>,
  sizeOverride?: number,
  /** Set when the document's own face can't draw the text — forces the
   * generic stack rather than letting characters vanish. */
  forceFallback = false,
): string {
  const size = sizeOverride ?? hotspot.size
  if (!forceFallback && sessionId && hotspot.fontId && availableFontIds.has(hotspot.fontId)) {
    return `${size}px ${pdfFontFamily(sessionId, hotspot.fontId)}`
  }
  const style = hotspot.italic ? "italic " : ""
  const weight = hotspot.bold ? "bold " : ""
  return `${style}${weight}${size}px ${FALLBACK_FONT_STACK}`
}
