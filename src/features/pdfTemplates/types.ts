export type PdfTemplateType = "html" | "pdf_master"

export interface PdfTemplate {
  id: string
  name: string
  description: string | null
  html_content: string | null
  template_type: PdfTemplateType
  source_pdf_url: string | null
  preview_image_url: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CreatePdfTemplateInput {
  name: string
  description?: string
  html_content: string
}

export interface UpdatePdfTemplateInput {
  name?: string
  description?: string
  html_content?: string
}

// ─── PDF master (in-place editing) ────────────────────────────────────────────

export interface PdfHotspotBase {
  /** Namespaced as `${editorPage.clientId}:${originalId}` — unique per editor
   * page *instance*, so a duplicated page's hotspots don't collide with the
   * page it was duplicated from (see EditorPage). */
  id: string
  /** The plain hotspot id from the one-time analysis, before namespacing —
   * this is the id the server's own session metadata actually knows about. */
  originalId: string
  /** The ORIGINAL pristine document's page number this hotspot belongs to.
   * Stable regardless of how pages get reordered/duplicated/removed in the
   * editor — it's a reference into the analysis result, not display order. */
  page: number
  /** [x0, y0, x1, y1] in PDF points, top-left origin */
  bbox: [number, number, number, number]
}

export interface PdfTextHotspot extends PdfHotspotBase {
  type: "text"
  /** One paragraph — may contain "\n" between its original wrapped lines. */
  text: string
  font: string
  /** Id of this paragraph's OWN embedded typeface in the session's font set
   * (see fetchPdfMasterSessionFonts). Empty when the face isn't embedded or
   * couldn't be extracted, in which case preview/export fall back to the
   * bundled Heebo. Matching on this is what lets the browser measure with
   * the exact same face the export draws with. */
  fontId: string
  /** From the span's own flags bitfield, NOT sniffed from the font name —
   * real catalogs embed subset faces named things like "ABCDEF+Gotham-Medium"
   * that contain no "bold"/"italic" substring at all. */
  bold: boolean
  italic: boolean
  size: number
  color: number
  /** Average baseline-to-baseline gap between this paragraph's original
   * lines (server-measured, not assumed) — drives preview line spacing when
   * replacement text wraps across more than one line. */
  lineHeight: number
  /** Baseline y (PDF points) of the FIRST line — where the preview anchors
   * the first drawn line. Without this the only information available is
   * the bbox's bottom edge, which used to be a fine stand-in for a
   * single-line box but anchors a multi-line paragraph's replacement text
   * at the very bottom of the whole block. */
  originY: number
  /** Direction of the ORIGINAL PDF text at analysis time. Editing derives
   * direction fresh from whatever is currently typed (see
   * pdfTextFit.ts's detectTextDirection) rather than trusting this while a
   * hotspot is being edited — this field is what a fresh page load starts
   * from, and what gets written back after a save (see commitEditText) so a
   * later re-open still starts from the right direction. */
  rtl: boolean
  /** The backend does not send this yet — always undefined today. When
   * absent, the frontend falls back to the safe default (RTL → right,
   * LTR → left) rather than claiming to know the PDF's true original
   * alignment. See PdfTextRenderPlan.align for where the resolved value
   * actually gets used. */
  align?: PdfTextAlign
}

export interface PdfImageHotspot extends PdfHotspotBase {
  type: "image"
}

export type PdfHotspot = PdfTextHotspot | PdfImageHotspot

/** One embedded typeface lifted out of the source PDF, so the browser can
 * register it via FontFace and preview/measure text in the document's real
 * face instead of a generic substitute. */
export interface PdfSessionFont {
  /** "ttf" | "otf" — only browser-loadable formats are sent. */
  ext: string
  /** The face's own name, for display ("Heebo Bold"). */
  name: string
  /** The characters this face can actually DRAW. A subsetted font keeps a
   * cmap entry for a character whose outline it discarded, so the character
   * maps to a glyph and that glyph is empty — it renders as nothing at all.
   * Verified on a real catalogue: one embedded face could only draw the six
   * letters of "Carnaby", and another had no capital Y, which is why typing
   * "Yash" produced "ash". Empty string means "unknown, trust the font". */
  usable: string
  /** base64-encoded font file. */
  data: string
}

/**
 * Something the user ADDED on top of a page, as opposed to a hotspot (a
 * region the PDF already contained). Hotspots can only ever be replaced in
 * place; an overlay can sit anywhere, at any size, at any angle — including
 * over empty space the original document never used.
 *
 * Geometry is stored in PDF POINTS in the page's UNROTATED coordinate space,
 * the same space hotspot bboxes use. Keeping it unrotated is what lets page
 * rotation stay a page attribute applied last at export: an overlay placed
 * on a turned page still lands where it was dropped.
 */
export interface PdfOverlayBase {
  id: string
  /** The editor page (clientId, not page number) this belongs to — so a
   * duplicated page carries its own independent copies of the overlays. */
  pageClientId: string
  /** Top-left corner and size, PDF points, before the item's own rotation. */
  x: number
  y: number
  width: number
  height: number
  /** The item's OWN rotation in degrees (any angle, not just quarter turns),
   * about its centre. Separate from the page's rotation. */
  rotation: number
}

export interface PdfImageOverlay extends PdfOverlayBase {
  type: "image"
  /** Object URL for on-screen rendering only. The real file is held
   * separately (it isn't serialisable state) and sent at export. */
  previewUrl: string
}

/** Shared alignment type for anything that draws text: existing PDF text
 * hotspots (PdfTextHotspot.align, PdfTextRenderPlan.align) and user-added
 * text overlays alike. `PdfOverlayAlign` is kept as a name so existing
 * overlay code (PdfOverlayToolbar.tsx) doesn't need to change imports. */
export type PdfTextAlign = "left" | "center" | "right"
export type PdfOverlayAlign = PdfTextAlign

export interface PdfTextOverlay extends PdfOverlayBase {
  type: "text"
  text: string
  /** Id of one of the document's own embedded faces, or "" for the bundled
   * default — so added text can be made to match the catalogue's typeface
   * instead of looking pasted on. */
  fontId: string
  fontSize: number
  /** "#rrggbb". */
  color: string
  bold: boolean
  italic: boolean
  align: PdfOverlayAlign
}

export type PdfOverlay = PdfImageOverlay | PdfTextOverlay

/**
 * The single decision about how to render one text edit — wrapping, size,
 * font choice, direction and alignment — computed ONCE (see pdfTextFit.ts's
 * fitText) and then just read by every consumer (the live modal preview,
 * the page canvas after Save, the pending-edit record). Before this existed
 * the same questions ("does this need the fallback font?", "is this RTL?")
 * got asked independently in three different places, sometimes against the
 * OLD text instead of the text actually being drawn — which is exactly how
 * typing "Yash" over "Carnaby" rendered as "ash": the fallback check ran
 * against "Carnaby" (which the embedded font COULD draw) instead of "Yash"
 * (which it couldn't).
 */
export interface PdfTextRenderPlan {
  /** The exact text this plan was computed for. */
  text: string
  /** Wrapped lines, in logical (typed) order. */
  lines: string[]
  /** Final font size in points — below the hotspot's own size when auto-fit
   * shrank it. */
  fontSize: number
  /** Final baseline-to-baseline spacing, scaled with fontSize. */
  lineHeight: number
  /** Total visible height the lines occupy, PDF points. */
  heightPts: number
  /** True when the text still doesn't fit even at the smallest allowed size. */
  overflows: boolean
  /** True when auto-fit had to reduce the size to make it fit. */
  shrunk: boolean
  /** True when the document's own embedded font cannot draw this text (a
   * subset missing an outline for one of its characters — see
   * pdfFonts.ts's fontCanDraw) and the generic fallback face must be used
   * instead, for measuring AND drawing alike. */
  useFallbackFont: boolean
  /** Detected fresh from THIS text (see pdfTextFit.ts's detectTextDirection)
   * — not the hotspot's original PDF direction, which can be wrong the
   * moment the language of the replacement text changes. */
  direction: "ltr" | "rtl"
  /** Resolved alignment: the hotspot's own align if the backend ever sends
   * one, otherwise the safe default (right for RTL, left for LTR). */
  align: PdfTextAlign
}

export interface PdfSessionPage {
  page: number
  width: number
  height: number
}

/**
 * One page as currently arranged in the editor — distinct from
 * PdfSessionPage (the one-time analysis result). Pages can be duplicated or
 * removed after "Use Template" without re-running analysis, so this is what
 * actually drives display order/composition; PdfSessionPage stays the fixed
 * source of truth for "what page N of the original document looks like."
 */
export interface EditorPage {
  /** Stable client-generated id — keys canvases/page-states/hotspot
   * namespacing. Never derived from array position, since that shifts
   * whenever a page is added/removed/reordered. */
  clientId: string
  /** Which page of the ORIGINAL pristine document this displays. The same
   * originalPage can appear in more than one EditorPage (duplicates). */
  originalPage: number
  width: number
  height: number
  /** Quarter turns applied in the editor: 0 | 90 | 180 | 270, relative to
   * however the source page already sat. Rotation is a page ATTRIBUTE in
   * PDF, not a redraw — so text edits and replaced images keep their exact
   * coordinates and the turn is applied last, at export. */
  rotation: number
}

export interface PdfSession {
  session_id: string
  templateId: string
  templateName: string
  page_count: number
  pages: PdfSessionPage[]
  hotspots: PdfHotspot[]
}

/** Immediate response from starting a session — analysis runs as a background
 * job (can take minutes for a large catalog), so this returns right away with
 * a jobId instead of the full session. Poll fetchPdfMasterSessionJobStatus
 * with it until status is "done". */
export interface PdfSessionJobStart {
  jobId: string
  templateId: string
  templateName: string
}

export type PdfSessionJobResult = Omit<PdfSession, "templateId" | "templateName">

export type PdfSessionJobStatus =
  | { status: "pending" }
  | { status: "done"; result: PdfSessionJobResult }
  | { status: "failed"; error: string }
