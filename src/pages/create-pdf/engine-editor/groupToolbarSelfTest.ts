// Does the toolbar offer the right tools for several things at once?
//
// The engine side is proven separately (groupOpsTest, against a real PDF).
// This is the other half: whether the buttons are actually there, and whether
// the ones that CANNOT act on a mixed selection are gone.
//
// The second part matters as much as the first. "Edit text" with a photo and
// a caption both selected has no honest meaning, and a colour swatch showing
// one line's colour while three things are selected states something untrue.
// A button that silently ignores most of your selection is worse than a
// button that is not there.
import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"

import { PdfEditorToolbar } from "./PdfEditorToolbar"

export interface GroupToolbarTestResult {
  errors: string[]
  /** With ONE text line selected. */
  single: { editText: boolean; rotate: boolean; count: string | null }
  /** With three things selected. */
  group: { editText: boolean; rotate: boolean; count: string | null }
  /** What the rotate buttons actually asked for. */
  groupOps: string[]
  /** The page-thumbnail toggle. */
  railButtonLabel: string | null
  railToggled: number
  /** The control that turns a box into a product slot. */
  slotControlPresent: boolean
  slotOptions: string[]
  slotChoiceReported: string | null
  slotControlHiddenForGroup: boolean
  /** The neutral option names the KIND of box selected. "Fixed text" in front
   * of a photograph reads as though the editor thinks the picture is
   * writing. */
  fixedLabelForText: string | null
  fixedLabelForImage: string | null
  fixedLabelForVector: string | null
  /** A native select's popup takes its colours from the select's own
   * background. A see-through one makes the browser composite the list
   * against white while the text stays light — invisible options. */
  slotSelectBackgrounds: string[]
  slotSelectOpaqueInBothStates: boolean
}

const SELECTION = { pageIndex: 0, kind: "text" as const, index: 0 }

function baseToolbar(overrides: Record<string, unknown>) {
  return {
    documentName: "group test",
    onZoomToSelection: () => {},
    onExit: () => {},
    selection: SELECTION,
    selectionCount: 1,
    selectionSlotField: null,
    selectionSlotProduct: 0,
    slotProductChoices: 1,
    onSetSlotField: () => {},
    slotFieldOptions: [],
    onTransformGroup: () => true,
    contentMode: "text" as const,
    onToggleContentMode: () => {},
    onAddText: () => {}, onAddImage: () => {},
    thumbnailRailOpen: true, onToggleThumbnailRail: () => {},
    templatePanelOpen: false,
    onToggleTemplatePanel: () => {},
    assetPanelOpen: false, onToggleAssetPanel: () => {},
    productPanelOpen: false, onToggleProductPanel: () => {},
    layersPanelOpen: false, onToggleLayersPanel: () => {},
    onOpenOrganizer: () => {},
    canUndo: false, canRedo: false, onUndo: () => {}, onRedo: () => {},
    onSaveTemplate: () => {},
    onGenerate: () => {},
    onAddPage: () => {},
    selectionLocked: false, onToggleLock: () => {}, onDuplicate: () => {},
    cropping: false, onToggleCrop: () => {},
    onEditSelectedText: () => {}, onReplaceSelectedImage: () => {},
    onReplaceSelectedVector: () => {}, onDeleteSelected: () => {},
    textStyle: null,
    onToggleBold: () => {}, onToggleItalic: () => {}, onTextColor: () => {},
    onScaleText: () => {}, onSetFont: () => {}, onAlignText: () => {},
    onTransformText: () => {}, onTransformImage: () => {}, onTransformVector: () => {},
    onDeselect: () => {}, onDownload: () => {}, downloading: false, busy: false,
    ...overrides,
  }
}

/** Buttons are found by their accessible label, which is what a user reads in
 * the tooltip — not by a class name that could change without the button
 * meaning anything different. */
const hasButton = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll("button"))
    .some((b) => (b.getAttribute("aria-label") ?? "").toLowerCase().includes(label.toLowerCase()))

const findButton = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll("button"))
    .find((b) => (b.getAttribute("aria-label") ?? "").toLowerCase().includes(label.toLowerCase())) ?? null

export async function runGroupToolbarSelfTest(): Promise<GroupToolbarTestResult> {
  const out: GroupToolbarTestResult = {
    errors: [],
    single: { editText: false, rotate: false, count: null },
    group: { editText: false, rotate: false, count: null },
    groupOps: [], railButtonLabel: null, railToggled: 0,
    slotControlPresent: false, slotOptions: [], slotChoiceReported: null,
    slotControlHiddenForGroup: false,
    fixedLabelForText: null, fixedLabelForImage: null, fixedLabelForVector: null,
    slotSelectBackgrounds: [], slotSelectOpaqueInBothStates: false,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  let root: Root | null = null

  const countLabel = () => {
    const el = Array.from(host.querySelectorAll("span"))
      .find((s) => /\bselected\b/i.test(s.textContent ?? ""))
    return el?.textContent?.trim() ?? null
  }

  try {
    root = createRoot(host)

    // ── One thing selected: the text tools are there ─────────────────
    root.render(createElement(PdfEditorToolbar, baseToolbar({ selectionCount: 1 })))
    await new Promise((r) => setTimeout(r, 60))
    out.single = {
      editText: Array.from(host.querySelectorAll("button"))
        .some((b) => (b.textContent ?? "").includes("Edit text")),
      rotate: hasButton(host, "Rotate left"),
      count: countLabel(),
    }
    if (!out.single.editText) {
      out.errors.push("with one line selected, 'Edit text' is missing — the control case is broken")
    }
    if (out.single.count !== null) {
      out.errors.push(`a single selection showed a count ("${out.single.count}"); it should not`)
    }

    // ── Three things selected ────────────────────────────────────────
    const ops: string[] = []
    root.render(createElement(PdfEditorToolbar, baseToolbar({
      selectionCount: 3,
      selectionSlotField: null,
    selectionSlotProduct: 0,
    slotProductChoices: 1,
    onSetSlotField: () => {},
    slotFieldOptions: [],
    onTransformGroup: (op: string) => { ops.push(op); return true },
    })))
    await new Promise((r) => setTimeout(r, 60))

    out.group = {
      editText: Array.from(host.querySelectorAll("button"))
        .some((b) => (b.textContent ?? "").includes("Edit text")),
      rotate: hasButton(host, "Rotate left"),
      count: countLabel(),
    }

    if (out.group.editText) {
      out.errors.push(
        "'Edit text' is still offered with three things selected — it can only act on one")
    }
    if (!out.group.rotate) {
      out.errors.push("a group cannot be rotated — the group tools are missing")
    }
    if (!out.group.count?.includes("3")) {
      out.errors.push(`the toolbar shows "${out.group.count}"; it should say how many are selected`)
    }

    // The buttons must actually ask for the group operation, not the
    // single-item one. Clicking each and recording what it called is the only
    // way to know which path it took.
    for (const label of ["Rotate left", "Rotate right", "Flip horizontally", "Flip vertically"]) {
      findButton(host, label)?.click()
    }
    await new Promise((r) => setTimeout(r, 30))
    out.groupOps = ops
    const expected = ["rotate-left", "rotate-right", "flip-horizontal", "flip-vertical"]
    if (JSON.stringify(ops) !== JSON.stringify(expected)) {
      out.errors.push(`the group buttons called ${JSON.stringify(ops)}, expected ${JSON.stringify(expected)}`)
    }

    // Still available for a group, because these DO mean something for
    // several objects at once.
    for (const label of ["Duplicate", "Lock in place", "Deselect"]) {
      if (!hasButton(host, label)) out.errors.push(`"${label}" is missing for a group`)
    }

    // ── The product-slot control ─────────────────────────────────────
    // The dropdown that turns a box into a product slot. Checked here rather
    // than only in productSlotsSelfTest because that one proves the RULES;
    // this proves the control exists, offers the right options for the kind
    // of box selected, and reports what was chosen.
    let chosenField: string | null | undefined
    root.render(createElement(PdfEditorToolbar, baseToolbar({
      selectionCount: 1,
      slotFieldOptions: [
        { id: "sku", labelKey: "pdfTemplates.productFieldSku", labelFallback: "SKU" },
        { id: "name", labelKey: "pdfTemplates.productFieldName", labelFallback: "Product name" },
      ],
      selectionSlotField: null,
    selectionSlotProduct: 0,
    slotProductChoices: 1,
      onSetSlotField: (id: string | null) => { chosenField = id },
    })))
    await new Promise((r) => setTimeout(r, 60))
    const slotSelect = host.querySelector<HTMLSelectElement>("[data-pdf-slot-field]")
    out.slotControlPresent = slotSelect !== null
    if (!slotSelect) {
      out.errors.push("there is no control for marking a box as a product slot")
    } else {
      out.slotOptions = Array.from(slotSelect.options).map((o) => o.value)
      // "Fixed text" first, then the fields. Without the empty option a box
      // could be marked but never un-marked.
      if (out.slotOptions[0] !== "") {
        out.errors.push("the slot control has no way back to plain fixed text")
      }
      slotSelect.value = "sku"
      slotSelect.dispatchEvent(new Event("change", { bubbles: true }))
      await new Promise((r) => setTimeout(r, 30))
      out.slotChoiceReported = chosenField ?? null
      if (out.slotChoiceReported !== "sku") {
        out.errors.push(`choosing SKU reported ${JSON.stringify(out.slotChoiceReported)}`)
      }
    }

    // ── The neutral option is named for what is selected ─────────────
    // Reported from a screen recording: selecting a photograph offered
    // "Fixed text", which describes something the user is not looking at.
    const fixedLabelWith = async (kind: "text" | "image" | "vector") => {
      root!.render(createElement(PdfEditorToolbar, baseToolbar({
        selection: { pageIndex: 0, kind, index: 0 },
        selectionCount: 1,
        slotFieldOptions: [
          { id: "sku", labelKey: "pdfTemplates.productFieldSku", labelFallback: "SKU" },
        ],
        selectionSlotField: null,
    selectionSlotProduct: 0,
    slotProductChoices: 1,
      })))
      await new Promise((r) => setTimeout(r, 60))
      const select = host.querySelector<HTMLSelectElement>("[data-pdf-slot-field]")
      return select?.options[0]?.textContent?.trim() ?? null
    }

    out.fixedLabelForText = await fixedLabelWith("text")
    out.fixedLabelForImage = await fixedLabelWith("image")
    out.fixedLabelForVector = await fixedLabelWith("vector")

    if (out.fixedLabelForText !== "Fixed text") {
      out.errors.push(`a text box's neutral option reads "${out.fixedLabelForText}"`)
    }
    // THE one that was reported. A picture is not text.
    if (/text/i.test(out.fixedLabelForImage ?? "")) {
      out.errors.push(
        `selecting a picture offers "${out.fixedLabelForImage}" — it calls a`
        + " photograph text")
    }
    if (/text/i.test(out.fixedLabelForVector ?? "")) {
      out.errors.push(`selecting artwork offers "${out.fixedLabelForVector}"`)
    }
    // And the three must differ, or naming them per kind achieved nothing.
    if (out.fixedLabelForImage === out.fixedLabelForText) {
      out.errors.push("a picture and a line of text share the same neutral label")
    }

    // ── The control must stay readable once a field is chosen ────────
    // Reported from a screenshot: picking SKU turned the dropdown list white
    // and its other options vanished. The marked state had set a translucent
    // background, and a native select builds its popup from that colour.
    const backgroundWith = async (field: string | null) => {
      root!.render(createElement(PdfEditorToolbar, baseToolbar({
        selectionCount: 1,
        slotFieldOptions: [
          { id: "sku", labelKey: "pdfTemplates.productFieldSku", labelFallback: "SKU" },
        ],
        selectionSlotField: field,
      })))
      await new Promise((r) => setTimeout(r, 60))
      const select = host.querySelector<HTMLSelectElement>("[data-pdf-slot-field]")
      return select ? getComputedStyle(select).backgroundColor : ""
    }

    const unmarked = await backgroundWith(null)
    const marked = await backgroundWith("sku")
    out.slotSelectBackgrounds = [unmarked, marked]

    // Opaque means no alpha, or an alpha of exactly 1.
    //
    // Both spellings have to be understood. A first version of this check
    // looked only for rgba(), and the very colour that caused the bug
    // computes to "oklab(0.87 0 0 / 0.1)" — so it would have reported the
    // broken control as perfectly opaque and caught nothing at all.
    const alphaOf = (colour: string): number => {
      const inside = /\(([^)]*)\)/.exec(colour)?.[1]
      if (!inside) return 1
      // Modern syntax: "oklab(L a b / alpha)", "color(srgb r g b / alpha)".
      const slash = inside.split("/")[1]
      if (slash !== undefined) return Number(slash.trim())
      // Legacy syntax: "rgba(r, g, b, alpha)".
      const parts = inside.split(",")
      return parts.length >= 4 ? Number(parts[3].trim()) : 1
    }
    const isOpaque = (colour: string) => alphaOf(colour) === 1

    // The control for the check itself. If this ever stops detecting a
    // see-through colour, every result above becomes meaningless — which is
    // exactly what happened the first time this was written.
    if (isOpaque("oklab(0.87 0 0 / 0.1)") || isOpaque("rgba(0, 0, 0, 0.1)")) {
      out.errors.push(
        "CONTROL FAILED: a translucent colour is being read as opaque, so this"
        + " check cannot detect the fault it exists for")
    }

    out.slotSelectOpaqueInBothStates = isOpaque(unmarked) && isOpaque(marked)
    if (!out.slotSelectOpaqueInBothStates) {
      out.errors.push(
        `the slot control is see-through (${unmarked} unmarked, ${marked} marked)`
        + " — the browser will draw its option list against whatever is behind"
        + " it, and the options become unreadable")
    }
    // And the two states must still LOOK different, or the fix removed the
    // signal that this box is a product slot.
    if (unmarked === marked) {
      const select = host.querySelector<HTMLSelectElement>("[data-pdf-slot-field]")
      const marksItself = (select?.className ?? "").includes("border-primary")
      if (!marksItself) {
        out.errors.push("a marked slot control looks identical to an unmarked one")
      }
    }

    // With several things selected it must NOT be offered: they would all be
    // given the same field, and a page cannot have four SKU slots.
    root.render(createElement(PdfEditorToolbar, baseToolbar({ selectionCount: 3 })))
    await new Promise((r) => setTimeout(r, 60))
    out.slotControlHiddenForGroup = host.querySelector("[data-pdf-slot-field]") === null
    if (!out.slotControlHiddenForGroup) {
      out.errors.push("the product-slot control is offered for a whole group")
    }

    // ── The page-thumbnail toggle ────────────────────────────────────
    let toggles = 0
    root.render(createElement(PdfEditorToolbar, baseToolbar({
      thumbnailRailOpen: true,
      onToggleThumbnailRail: () => { toggles++ },
    })))
    await new Promise((r) => setTimeout(r, 60))
    const railButton = findButton(host, "page thumbnails")
    out.railButtonLabel = railButton?.getAttribute("aria-label") ?? null
    if (!railButton) {
      out.errors.push("there is no button for showing or hiding the page thumbnails")
    } else {
      if (!/hide/i.test(out.railButtonLabel ?? "")) {
        out.errors.push(
          `with the rail open the button says "${out.railButtonLabel}" — it should offer to HIDE it`)
      }
      railButton.click()
      await new Promise((r) => setTimeout(r, 30))
      out.railToggled = toggles
      if (toggles !== 1) out.errors.push(`clicking the rail button fired ${toggles} times, expected 1`)
    }

    // And it says the opposite when the rail is already closed — a toggle
    // that reads the same in both states tells you nothing.
    root.render(createElement(PdfEditorToolbar, baseToolbar({ thumbnailRailOpen: false })))
    await new Promise((r) => setTimeout(r, 60))
    const closedLabel = findButton(host, "page thumbnails")?.getAttribute("aria-label") ?? ""
    if (!/show/i.test(closedLabel)) {
      out.errors.push(`with the rail closed the button says "${closedLabel}" — it should offer to SHOW it`)
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    root?.unmount()
    host.remove()
  }

  return out
}

/**
 * Puts the toolbar on screen for looking at, in one of its two states.
 *
 * Bare `react` cannot be imported from an inline snippet in the browser — only
 * from a module Vite resolves — so the mounting lives here beside the checks
 * rather than in the script that takes the picture.
 */
export async function showGroupToolbar(
  selectionCount: number, language: "en" | "he",
): Promise<void> {
  const i18n = (await import("@/i18n")).default
  await i18n.changeLanguage(language)

  document.getElementById("toolbar-inspect")?.remove()
  const host = document.createElement("div")
  host.id = "toolbar-inspect"
  host.style.cssText = "position:fixed;inset:0;background:var(--background,#fff)"
  document.body.appendChild(host)

  createRoot(host).render(createElement(PdfEditorToolbar, baseToolbar({
    documentName: "REFIN_CATALOGO_MOLD",
    selectionCount,
    canUndo: true,
    textStyle: { bold: false, italic: false, color: { r: 0, g: 0, b: 0 } },
  })))
  await new Promise((r) => setTimeout(r, 350))
}

/**
 * Does the rail actually appear and disappear?
 *
 * Separate from the button test above on purpose. That one proves the BUTTON
 * works — it is labelled correctly and calls back once. This proves the
 * consequence: that the strip of page thumbnails is really gone from the
 * document when it is closed, and that the page area takes the width back.
 *
 * Those are two different claims and only one of them was tested before.
 */
export interface RailVisibilityResult {
  errors: string[]
  railWhenOpen: number
  railWhenClosed: number
  /** The page area should be WIDER with the rail away — that is the point of
   * hiding it. */
  pageAreaOpen: number
  pageAreaClosed: number
}

export async function runRailVisibilityTest(): Promise<RailVisibilityResult> {
  const [{ PdfEngineWorkspace }, { QueryClient, QueryClientProvider }] = await Promise.all([
    import("./PdfEngineWorkspace"),
    import("@tanstack/react-query"),
  ])

  const out: RailVisibilityResult = {
    errors: [], railWhenOpen: -1, railWhenClosed: -1, pageAreaOpen: 0, pageAreaClosed: 0,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  let root: Root | null = null

  // A two-page document that renders nothing. What is being measured is the
  // LAYOUT — whether the rail is in it and how much room the pages get — and
  // real page rendering would only add time and noise to that.
  const page = { index: 0, widthPts: 595, heightPts: 842, rotation: 0 }
  const noop = async () => {}
  const doc = {
    phase: "ready", error: null, downloadPercent: null,
    pages: [page, { ...page, index: 1 }],
    docId: "rail-test", revision: 0, busy: false,
    pageText: { 0: { loaded: true, lines: [] }, 1: { loaded: true, lines: [] } },
    pageImages: { 0: { loaded: true, images: [] }, 1: { loaded: true, images: [] } },
    pageVectors: { 0: { loaded: true, groups: [] }, 1: { loaded: true, groups: [] } },
    loadPageText: noop, loadPageImages: noop, loadPageVectors: noop,
    renderPage: async () => null, renderPageRegion: async () => null,
    lastChange: null, renderCleanPatch: async () => null, renderImagePreview: async () => null,
  } as never

  const column = {
    contentMode: "text" as const, selection: null, onSelect: () => {},
    drag: null, onMoveStart: () => {}, originPatch: null, imagePreview: null,
    onEditLine: () => {}, onReplaceImage: () => {}, onReplaceVector: () => {},
    onDropOnImage: () => {}, onDropOnPage: () => {}, onDropAssetOnPage: () => {},
    productSlots: new Map(),
    onDropProductOnPage: () => {}, onDropProductOnImage: () => {},
    locks: new Set<string>(), alsoSelected: [], cropping: null,
    onCropCancel: () => {}, onCropCommit: () => {},
    onTransformImage: () => {}, onTransformVector: () => {}, onResizeText: () => {},
  } as never

  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root = createRoot(host)

    const mount = async (railOpen: boolean) => {
      root!.render(createElement(QueryClientProvider, { client },
        createElement(PdfEngineWorkspace, {
          doc,
          documentName: "rail test",
          onExit: () => {},
          onDisplayWidthChange: () => {},
          thumbnailRailOpen: railOpen,
          selection: null,
          column,
          toolbar: baseToolbar({ selection: null, selectionCount: 0 }) as never,
        } as never)))
      await new Promise((r) => setTimeout(r, 250))
      return {
        rail: document.querySelectorAll("[data-pdf-thumbnail-rail]").length,
        width: document.querySelector<HTMLElement>("[data-pdf-page-area]")
          ?.getBoundingClientRect().width ?? 0,
      }
    }

    const open = await mount(true)
    out.railWhenOpen = open.rail
    out.pageAreaOpen = Math.round(open.width)

    const closed = await mount(false)
    out.railWhenClosed = closed.rail
    out.pageAreaClosed = Math.round(closed.width)

    if (out.railWhenOpen !== 1) {
      out.errors.push(`the rail rendered ${out.railWhenOpen} times when open, expected 1`)
    }
    if (out.railWhenClosed !== 0) {
      out.errors.push(`the rail is still in the document when closed (${out.railWhenClosed} found)`)
    }
    // The control: hiding it has to give the width to the pages. If both
    // measure the same, the rail was taken out of sight without being taken
    // out of the layout, and nothing was actually gained.
    if (out.pageAreaClosed <= out.pageAreaOpen) {
      out.errors.push(
        `the page area was ${out.pageAreaOpen}px with the rail and ${out.pageAreaClosed}px`
        + " without it — hiding the rail gave the document no more room")
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    root?.unmount()
    host.remove()
  }

  return out
}

/** The toolbar with a box marked as a product slot, for looking at. */
export async function showSlotToolbar(language: "en" | "he"): Promise<void> {
  const i18n = (await import("@/i18n")).default
  await i18n.changeLanguage(language)

  document.getElementById("toolbar-inspect")?.remove()
  const host = document.createElement("div")
  host.id = "toolbar-inspect"
  host.style.cssText = "position:fixed;inset:0;background:var(--background,#fff)"
  document.body.appendChild(host)

  const { fieldsForKind } = await import("./productSlots")
  createRoot(host).render(createElement(PdfEditorToolbar, baseToolbar({
    documentName: "REFIN_CATALOGO_MOLD",
    selectionCount: 1,
    canUndo: true,
    textStyle: { bold: false, italic: false, color: { r: 0, g: 0, b: 0 } },
    slotFieldOptions: fieldsForKind("text"),
    selectionSlotField: "sku",
  })))
  await new Promise((r) => setTimeout(r, 350))
}
