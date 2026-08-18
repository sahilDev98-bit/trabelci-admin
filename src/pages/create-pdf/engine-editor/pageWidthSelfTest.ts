/**
 * Dev-only self test: the paper fills the panel it sits in.
 *
 * Pages used to render at a fixed 820px, leaving wide empty margins. They
 * now measure their column — but the first attempt at that traded one empty
 * band for another, by reserving a FIXED gutter for the floating tool rail.
 * That was wrong in both directions, and this test exists because only real
 * geometry shows it:
 *
 *   - The panel is `mx-auto max-w-6xl`, so past ~1152px of content width it
 *     stops growing and CENTRES, while the rail is fixed to the VIEWPORT.
 *     On a wide window the rail ends up hundreds of pixels clear of the
 *     panel, and any reservation is pure dead space — which is exactly what
 *     it looked like: the paper shoved left with a gap beside it.
 *   - On a narrow window the panel reaches the viewport edge and the rail
 *     really does cover its trailing edge.
 *
 * So the layout is reproduced here as the app builds it — centred capped
 * panel, viewport-fixed rail — and checked at window widths on both sides of
 * that transition.
 *
 * Driven by scripts/pdf-engine-pagewidth-test.mjs.
 */
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEnginePage } from "./PdfEnginePage"

export interface WidthCase {
  /** Simulated window width. */
  viewportWidth: number
  /** Width of the column the pages are laid out in. */
  columnWidth: number
  /** Rendered width of the page surface. */
  pageWidth: number
  /** Share of the column the page occupies, 0-1. */
  fillRatio: number
  /** Gap between the page's trailing edge and the rail's leading edge.
   * Negative means the rail is sitting on top of the paper. */
  clearanceToRail: number
  pageHeight: number
}

export interface PageWidthTestResult {
  errors: string[]
  cases: WidthCase[]
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Mirrors PdfEngineEditorPage. */
const RAIL_CLEARANCE_PX = 12
const MIN_PAGE_DISPLAY_WIDTH = 320

/** Mirrors AdminLayout and PdfEditorRail. */
const SIDEBAR_PX = 260
const PANEL_MAX_PX = 1152      // max-w-6xl
const PANEL_PAD_PX = 24        // p-6
const RAIL_WIDTH_PX = 60
const RAIL_INSET_PX = 20

const PAGE = { index: 0, widthPts: 595, heightPts: 842, rotation: 0 }

export async function runPageWidthSelfTest(): Promise<PageWidthTestResult> {
  const out: PageWidthTestResult = { errors: [], cases: [] }

  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;z-index:9999;background:#fff;overflow:hidden"
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    // Both sides of the point where the panel stops growing and starts
    // centring — the transition the fixed-gutter version got wrong.
    for (const viewportWidth of [1100, 1440, 1920, 2560]) {
      // ── the app's shell, reproduced ──
      const shell = document.createElement("div")
      shell.style.cssText =
        `position:absolute;inset:0;width:${viewportWidth}px;display:flex;overflow:hidden`

      const sidebar = document.createElement("div")
      sidebar.style.cssText = `width:${SIDEBAR_PX}px;flex:none`

      const main = document.createElement("div")
      main.style.cssText =
        `margin-inline:auto;width:100%;max-width:${PANEL_MAX_PX}px;`
        + `padding:${PANEL_PAD_PX}px;box-sizing:border-box`

      const panel = document.createElement("div")
      panel.style.cssText = `padding:${PANEL_PAD_PX}px;box-sizing:border-box`

      const column = document.createElement("div")
      column.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:24px"

      // The rail: fixed to the VIEWPORT, not to the panel. This is the whole
      // reason a constant gutter cannot be right.
      const rail = document.createElement("div")
      rail.setAttribute("data-pdf-tool-rail", "")
      rail.style.cssText =
        `position:absolute;top:146px;width:${RAIL_WIDTH_PX}px;height:280px;`
        + `left:${viewportWidth - RAIL_INSET_PX - RAIL_WIDTH_PX}px;background:#fff`

      panel.appendChild(column)
      main.appendChild(panel)
      shell.append(sidebar, main, rail)
      host.replaceChildren(shell)
      await wait(50)

      // ── the editor's own measuring logic ──
      const columnRect = column.getBoundingClientRect()
      const railRect = rail.getBoundingClientRect()
      const overlap = columnRect.right - railRect.left
      const gutter = overlap > 0 ? Math.ceil(overlap) + RAIL_CLEARANCE_PX : 0
      column.style.paddingInlineEnd = `${gutter}px`
      await wait(20)

      const displayWidth = Math.max(
        MIN_PAGE_DISPLAY_WIDTH,
        Math.floor(column.clientWidth - gutter),
      )

      const inner = createRoot(column)
      inner.render(createElement(PdfEnginePage, {
        page: PAGE,
        pageIndex: 0,
        displayWidth,
        text: { loaded: true, lines: [] },
        images: { loaded: true, images: [] },
        contentMode: "text" as const,
        revision: 0,
        renderPage: async () => null,
        loadPageText: async () => {},
        loadPageImages: async () => {},
        loadPageVectors: async () => {},
        vectors: { loaded: true, groups: [] },
        onReplaceVector: () => {},
        onSelectLine: () => {},
        onReplaceImage: () => {},
        onDropOnImage: () => {},
        onDropOnPage: () => {},
        onTransformImage: () => {},
        onResizeText: () => {},
        selection: null,
        onSelect: () => {},
        onMoveStart: () => {},
        draggingSlot: null,
        dropTargetPage: false,
        imagePreviewUrl: null,
        originPatchUrl: null,
      }))
      await wait(400)

      const surface = column.querySelector<HTMLElement>("[data-engine-page-index]")
      if (!surface) {
        out.errors.push(`no page surface rendered at viewport ${viewportWidth}`)
        inner.unmount()
        continue
      }
      const pageRect = surface.getBoundingClientRect()
      const colRect = column.getBoundingClientRect()
      const columnWidth = Math.round(colRect.width)

      const result: WidthCase = {
        viewportWidth,
        columnWidth,
        pageWidth: Math.round(pageRect.width),
        fillRatio: Number((pageRect.width / colRect.width).toFixed(3)),
        clearanceToRail: Math.round(rail.getBoundingClientRect().left - pageRect.right),
        pageHeight: Math.round(pageRect.height),
      }
      out.cases.push(result)

      // 1. The paper must actually FILL its column. This is the check that
      //    fails on the "shoved to the left with a gap beside it" layout.
      if (result.fillRatio < 0.98 && result.clearanceToRail > RAIL_CLEARANCE_PX + 2) {
        out.errors.push(
          `at viewport ${viewportWidth}: page fills only ${(result.fillRatio * 100).toFixed(1)}% `
          + `of its ${columnWidth}px column while sitting ${result.clearanceToRail}px clear of the `
          + `rail — that space is reserved against nothing`,
        )
      }

      // 2. And must never end up underneath the rail.
      if (result.clearanceToRail < 0) {
        out.errors.push(
          `at viewport ${viewportWidth}: page overlaps the tool rail by ${-result.clearanceToRail}px`,
        )
      }

      // 3. Full width must not mean stretched.
      const expectedHeight = Math.round((displayWidth * PAGE.heightPts) / PAGE.widthPts)
      if (Math.abs(result.pageHeight - expectedHeight) > 2) {
        out.errors.push(
          `at viewport ${viewportWidth}: height ${result.pageHeight}px, expected ${expectedHeight}px`,
        )
      }

      inner.unmount()
    }

    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
