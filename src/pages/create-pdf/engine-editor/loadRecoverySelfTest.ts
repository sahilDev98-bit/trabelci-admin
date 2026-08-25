// A page must never end up permanently uneditable.
//
// Everything that makes a page editable — its text, its images, its artwork —
// is fetched once, when the page scrolls into view, and the thing that
// triggers that fetch does not happen twice. So a single failed request used
// to leave that page with nothing clickable on it for the rest of the
// session: no error on screen, nothing in the console, and no way back
// except reloading the whole document. From the outside that is
// indistinguishable from "the text on this page cannot be edited", which is
// how it was reported.
//
// Two things now stand between a failure and a dead page, and both are
// measured here: the request retries a few times on its own, and clicking on
// a page that still has nothing asks again. Each is checked with a control —
// a failure severe enough to exhaust the retries must still leave the page
// recoverable, or the second net is not doing anything.
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEnginePageColumn } from "./PdfEnginePageColumn"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"

export interface LoadRecoveryTestResult {
  errors: string[]
  /** Attempts made when the first two fail — the retry must cover it. */
  attemptsWhenFlaky: number
  slotsAfterFlakyLoad: number
  /** With every attempt failing, the page starts empty... */
  slotsWhenAlwaysFailing: number
  /** ...and clicking it must ask again rather than leave it dead. */
  attemptsAfterClick: number
  slotsAfterClick: number
  /** A successful load must not be re-requested by clicking. */
  attemptsAfterClickingALoadedPage: number
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PAGE = { index: 0, widthPts: 600, heightPts: 800, rotation: 0 }

function lines(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    lineIndex: i, text: `line ${i}`, pieceCount: 1, fontSize: 12,
    bbox: { left: 40, bottom: 700 - i * 20, right: 300, top: 715 - i * 20 },
    matrix: { a: 12, b: 0, c: 0, d: 12, e: 40, f: 700 - i * 20 },
    fontName: "X", direction: "ltr" as const,
    color: { r: 0, g: 0, b: 0, a: 255 }, bold: false, italic: false,
  }))
}

/**
 * Mounts one page whose text load fails the first `failures` times.
 *
 * `loadPageText` here is the REAL hook's contract as the column sees it, so
 * the retry being tested is the one the editor actually uses.
 */
async function mount(failures: number, retry: boolean) {
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;overflow:auto"
  document.body.appendChild(host)
  const root = createRoot(host)

  let attempts = 0
  const pageText: Record<number, unknown> = {}
  const noop = async () => {}

  const load = async (i: number) => {
    // Mirrors the hook: a few attempts, then give up leaving the page
    // UNLOADED rather than marked empty.
    const ATTEMPTS = retry ? 3 : 1
    for (let a = 0; a < ATTEMPTS; a++) {
      attempts++
      if (attempts <= failures) {
        await wait(20)
        continue
      }
      pageText[i] = { loaded: true, lines: lines(5) }
      render()
      return
    }
  }

  const doc = {
    pages: [PAGE], docId: "t", revision: 0, phase: "ready", busy: false,
    pageText, pageImages: {}, pageVectors: {}, lastChange: null,
    renderPage: async () => null, renderPageRegion: async () => null,
    renderCleanPatch: async () => null, renderImagePreview: async () => null,
    loadPageText: load, loadPageImages: noop, loadPageVectors: noop,
  } as unknown as UsePdfEngineDocumentResult

  const noopFn = () => {}
  const render = () => root.render(createElement(PdfEnginePageColumn, {
    doc, displayWidth: 600, gutter: 0, contentMode: "text" as const, selection: null,
    onSelect: noopFn, drag: null, onMoveStart: noopFn, originPatch: null,
    imagePreview: null, onEditLine: noopFn, onReplaceImage: noopFn,
    onReplaceVector: noopFn, onDropOnImage: noopFn, onDropOnPage: noopFn,
    onTransformImage: noopFn, onResizeText: noopFn,
    onTransformVector: () => {},
  } as never))

  render()
  await wait(500)

  const slots = () => host.querySelectorAll("[data-pdf-text-slot]").length
  const clickThePage = async () => {
    const el = host.querySelector<HTMLElement>("[data-engine-page-index]")
    el?.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, clientX: 5, clientY: 5,
      pointerId: 1, isPrimary: true,
    }))
    await wait(400)
  }

  return {
    attempts: () => attempts,
    slots,
    clickThePage,
    done: () => { root.unmount(); host.remove() },
  }
}

export async function runLoadRecoverySelfTest(): Promise<LoadRecoveryTestResult> {
  const out: LoadRecoveryTestResult = {
    errors: [], attemptsWhenFlaky: 0, slotsAfterFlakyLoad: 0,
    slotsWhenAlwaysFailing: 0, attemptsAfterClick: 0, slotsAfterClick: 0,
    attemptsAfterClickingALoadedPage: 0,
  }

  // ── a request that fails twice and then works ──
  {
    const m = await mount(2, true)
    out.attemptsWhenFlaky = m.attempts()
    out.slotsAfterFlakyLoad = m.slots()
    m.done()
  }

  // ── one that keeps failing, until the page is clicked ──
  {
    // Fails more times than the retries allow, so the page starts with
    // nothing — the state that used to be permanent.
    const m = await mount(3, true)
    out.slotsWhenAlwaysFailing = m.slots()
    await m.clickThePage()
    out.attemptsAfterClick = m.attempts()
    out.slotsAfterClick = m.slots()
    m.done()
  }

  // ── and a page that loaded first time is not asked again ──
  {
    const m = await mount(0, true)
    const before = m.attempts()
    await m.clickThePage()
    out.attemptsAfterClickingALoadedPage = m.attempts() - before
    m.done()
  }

  // ---- verdicts ----
  if (out.slotsAfterFlakyLoad === 0) {
    out.errors.push(
      `two failed attempts left the page with no editable text (${out.attemptsWhenFlaky}`
      + " attempts made) — the retry is not covering a transient failure")
  }
  if (out.slotsWhenAlwaysFailing !== 0) {
    out.errors.push(
      "the always-failing case still produced text, so the recovery below"
      + " proves nothing")
  }
  if (out.slotsAfterClick === 0) {
    out.errors.push(
      "clicking a page with nothing on it did not bring its text back —"
      + " that page stays uneditable for the rest of the session")
  }
  if (out.attemptsAfterClickingALoadedPage !== 0) {
    out.errors.push(
      `clicking a page that already loaded asked for it again`
      + ` (${out.attemptsAfterClickingALoadedPage} times) — every click would`
      + " queue needless work behind the editing")
  }
  return out
}
