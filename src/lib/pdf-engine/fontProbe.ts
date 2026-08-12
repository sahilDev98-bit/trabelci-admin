// Answers "can this embedded font actually DRAW this text" — the exact
// question that caused "Carnaby" -> "Yash" to render as "ash" in production.
//
// Raw PDFium's public C API does NOT expose this as a single call: reading
// per-character glyph existence (FPDFFont_GetGlyphPath) needs a GLYPH INDEX,
// not a Unicode codepoint, and there is no exposed codepoint->glyph-index
// mapping function for a font already loaded inside a PDFium document. The
// practical approach — used here, and what any real implementation would
// also need — is to pull the font's raw bytes out via FPDFFont_GetFontData
// and parse them with a real font library (opentype.js) that reads the
// cmap AND glyf tables directly. That mirrors (and gives us a SECOND,
// independent check against) the same "usable_chars" approach the current
// PyMuPDF backend uses.
import { opentype, type OpentypeFont } from "./opentype"

export interface CoverageResult {
  parsed: boolean
  parseError?: string
  numGlyphs?: number
  /** Per-character: does the font map it to a glyph AND does that glyph
   * have a non-empty outline? A cmap entry with zero path commands is
   * EXACTLY the subset bug: character "exists" but draws nothing. */
  chars: { char: string; hasCmapEntry: boolean; hasOutline: boolean; safe: boolean }[]
  allSafe: boolean
}

export function probeFontCoverage(fontBytes: Uint8Array, text: string): CoverageResult {
  let font: OpentypeFont
  try {
    const ab = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength)
    font = opentype.parse(ab)
  } catch (err) {
    return { parsed: false, parseError: String(err), chars: [], allSafe: false }
  }

  const seen = new Set<string>()
  const chars: CoverageResult["chars"] = []
  for (const ch of text) {
    if (ch.trim() === "" || seen.has(ch)) continue
    seen.add(ch)
    const cp = ch.codePointAt(0) ?? 0
    // charToGlyphIndex is present on every real opentype.js Font but is
    // absent from some versions of the published typings, so it is probed
    // rather than assumed.
    const lookup = (font as unknown as { charToGlyphIndex?: (c: string) => number }).charToGlyphIndex
    const glyphIndex = typeof lookup === "function" ? lookup.call(font, ch) : 0
    const hasCmapEntry = glyphIndex > 0
    let hasOutline = false
    if (hasCmapEntry) {
      try {
        const glyph = font.glyphs.get(glyphIndex)
        const path = glyph.getPath(0, 0, 1000)
        hasOutline = (path.commands?.length ?? 0) > 0
      } catch {
        hasOutline = false
      }
    }
    chars.push({ char: ch, hasCmapEntry, hasOutline, safe: hasCmapEntry && hasOutline })
    void cp
  }

  return {
    parsed: true,
    numGlyphs: font.numGlyphs,
    chars,
    allSafe: chars.every((c) => c.safe),
  }
}
