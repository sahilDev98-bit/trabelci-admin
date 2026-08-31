// Does a real DRAG snap and move a group — not just the arithmetic behind it?
//
// This file exists because of a bug the arithmetic tests could not see. Both
// features were wired into useBoxTransform, which turns out to handle only
// RESIZING; moving a slot goes through useCrossPageDrag instead. So snapRect
// was correct, its unit test passed, and nothing snapped when you dragged
// anything — which is the case anybody would try first.
//
// The lesson is in what is measured here: a real pointer gesture, from
// pointerdown to pointerup, through the components the user actually touches.
// Testing the calculation proved the calculation. It could not prove the
// calculation was ever called.
//
//   1. Dragging a box to NEARLY the same left edge as another lands it
//      EXACTLY there, and a guide line appears while the pointer is down.
//   2. Dragging far from anything leaves it where it was put — the control,
//      without which claim 1 would pass for a magnet that pulls everything.
//   3. Shift-clicking two boxes and dragging one asks the document to move
//      BOTH, by the same amount, in one call.
import { createElement, StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { PdfEnginePage } from "./PdfEnginePage"
import { CrossPageDragGhost } from "./CrossPageDragGhost"
import { useCrossPageDrag } from "./useCrossPageDrag"
import * as snapping from "./snapping"
import { applySelection, selectedSlots, EMPTY_SELECTION, type SelectionState } from "./selectionOps"

export interface MoveTestResult {
  errors: string[]
  /** Where the drag reported the box, in CSS px from the page's left. */
  droppedLeftWhenNear: number
  droppedLeftWhenFar: number
  expectedSnapLeft: number
  releasedNearLeft: number
  releasedFarLeft: number
  guidesWhileDragging: number
  guidesAfterDrop: number
  /** What a group drag asked the document to move. */
  groupMoveSlots: string[]
  groupSelectionSize: number
  /** How many boxes were visible in flight during a group drag. Before this
   * only the one under the pointer had a ghost, and the rest sat still until
   * the drop — which read as "the others are not coming". */
  ghostsWhileDraggingGroup: number
  ghostsWhileDraggingOne: number
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(what: string, check: () => boolean, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await wait(30)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const PAGE = { index: 0, widthPts: 600, heightPts: 800, rotation: 0 }
const DISPLAY = 600

/** Two pictures. The second will be dragged toward the first's left edge. */
const IMAGES = [
  {
    imageIndex: 0, bbox: { left: 100, bottom: 600, right: 260, top: 700 },
    width: 160, height: 100, pixelWidth: 320, pixelHeight: 200,
    hasClipPath: false, rotationDeg: 0, filters: [] as string[],
  },
  {
    imageIndex: 1, bbox: { left: 300, bottom: 300, right: 420, top: 380 },
    width: 120, height: 80, pixelWidth: 240, pixelHeight: 160,
    hasClipPath: false, rotationDeg: 0, filters: [] as string[],
  },
]

function pointer(type: string, x: number, y: number, shiftKey = false) {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y,
    pointerId: 1, isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1,
    shiftKey,
  })
}

export async function runMoveSelfTest(): Promise<MoveTestResult> {
  const out: MoveTestResult = {
    errors: [], droppedLeftWhenNear: 0, droppedLeftWhenFar: 0,
    expectedSnapLeft: 0, releasedNearLeft: 0, releasedFarLeft: 0,
    guidesWhileDragging: 0, guidesAfterDrop: 0,
    groupMoveSlots: [], groupSelectionSize: 0,
    ghostsWhileDraggingGroup: 0, ghostsWhileDraggingOne: 0,
  }

  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;overflow:hidden;background:#fff"
  document.body.appendChild(host)
  const root = createRoot(host)

  /** The editor's OWN selection rule, not a copy of it.
   *
   * The previous version of this test supplied its own handler, which is
   * exactly why it passed while Shift-click was broken: it proved the page
   * reported Shift correctly — which was always true — and never touched
   * what the editor did with that report. */
  let selectionState: SelectionState = EMPTY_SELECTION
  const drops: { leftPx: number; topPx: number }[] = []
  const groupMoves: string[][] = []

  /** The page, wired to a real cross-page drag with real snapping — the two
   * pieces whose CONNECTION was missing. */
  function Harness() {
    const snapGhost = (
      ghost: { left: number; top: number; width: number; height: number },
      targetPageIndex: number,
      altKey: boolean,
    ) => {
      const surface = document.querySelector<HTMLElement>("[data-engine-page-index]")
      const layer = surface?.querySelector<HTMLElement>("[data-pdf-guide-layer]") ?? null
      if (altKey || targetPageIndex < 0 || !surface) {
        snapping.paintGuides(layer, [])
        return null
      }
      return snapSync(ghost, surface, layer)
    }

    const { drag, start } = useCrossPageDrag((drop) => {
      drops.push({ leftPx: drop.leftPx, topPx: drop.topPx })
      // A group drag reports every member, in one call — the thing that was
      // only wired into the resize path before.
      if (selectionState.also.length > 0) {
        groupMoves.push(selectedSlots(selectionState).map((s) => `${s.kind}#${s.index}`))
      }
    }, snapGhost)

    // The ghost lives outside the page in the real editor too — it is fixed
    // to the viewport so it can be seen crossing a page break.
    return createElement("div", null,
      createElement(CrossPageDragGhost, { drag }),
      createElement(PdfEnginePage, {
      page: PAGE, pageIndex: 0, displayWidth: DISPLAY,
      text: { loaded: true, lines: [] },
      images: { loaded: true, images: IMAGES },
      vectors: { loaded: true, groups: [] },
      contentMode: "images", revision: 0, lastChange: null,
      renderPage: async () => null, renderPageRegion: async () => null,
      loadPageText: async () => {}, loadPageImages: async () => {}, loadPageVectors: async () => {},
      onReplaceVector: () => {}, onSelectLine: () => {}, onReplaceImage: () => {},
      onDropOnImage: () => {}, onDropOnPage: () => {}, onDropAssetOnPage: () => {},
      locks: new Set<string>(),
      alsoSelected: selectionState.also,
      cropping: null, onCropCancel: () => {}, onCropCommit: () => {},
      onTransformImage: () => {}, onTransformVector: () => {},
      selection: selectionState.primary,
      onSelect: (next, additive) => {
        selectionState = applySelection(selectionState, next, additive)
        render()
      },
      // Mirrors the editor: the rest of the group travels along, measured
      // from the DOM. Passing nothing here would leave the companions
      // invisible and this test would report the very bug it exists to catch.
      onMoveStart: ((e, item, rect) => {
        const companions = selectedSlots(selectionState)
          .filter((slot) => !(slot.kind === item.kind && slot.index === item.index))
          .map((slot) => document.querySelector<HTMLElement>(
            `[data-pdf-image-slot="${slot.index}"]`))
          .filter((el): el is HTMLElement => el !== null)
          .map((el) => {
            const r = el.getBoundingClientRect()
            return { left: r.left, top: r.top, width: r.width, height: r.height }
          })
        start(e, item, rect, companions)
      }) as typeof start,
      draggingSlot: drag ? { ...drag.item } : null,
      dropTargetPage: false, imagePreviewUrl: null, originPatchUrl: null,
      onResizeText: () => {},
    }))
  }

  // StrictMode on purpose: the app runs inside it, and its double-invocation
  // of state updaters is precisely what broke Shift-click before. A test that
  // rendered without it could not have reproduced the fault.
  const render = () => root.render(createElement(StrictMode, null, createElement(Harness)))

  try {
    render()
    await until("the page", () => !!document.querySelector("[data-engine-page-index]"))
    const surface = document.querySelector<HTMLElement>("[data-engine-page-index]")!
    const box = surface.getBoundingClientRect()
    const slots = () => Array.from(document.querySelectorAll<HTMLElement>("[data-pdf-image-slot]"))

    // Image 0's left edge in CSS px is what image 1 should snap to.
    const scale = box.width / PAGE.widthPts
    out.expectedSnapLeft = Math.round(IMAGES[0].bbox.left * scale)

    // ── 1. Drag image 1 to NEARLY image 0's left edge ──────────────────
    const target = slots()[1]
    const start = target.getBoundingClientRect()
    // Grab the middle, then release so the box's LEFT lands 3px off the line.
    const grabOffsetX = start.width / 2
    target.dispatchEvent(pointer("pointerdown", start.left + grabOffsetX, start.top + 10))
    await wait(30)
    target.dispatchEvent(pointer("pointerdown", start.left + grabOffsetX, start.top + 10))
    await wait(30)

    const releaseNear = box.left + out.expectedSnapLeft + 3 + grabOffsetX
    out.releasedNearLeft = out.expectedSnapLeft + 3
    window.dispatchEvent(pointer("pointermove", releaseNear, box.top + 200))
    await wait(80)
    out.guidesWhileDragging = document.querySelectorAll("[data-pdf-snap-guide]").length
    // One box in flight when only one is selected: the carried one, and no
    // companions. The control for the group count below.
    out.ghostsWhileDraggingOne = document.querySelectorAll(
      "[data-engine-drag-ghost], [data-engine-drag-companion]").length
    window.dispatchEvent(pointer("pointerup", releaseNear, box.top + 200))
    await wait(80)
    out.guidesAfterDrop = document.querySelectorAll("[data-pdf-snap-guide]").length
    out.droppedLeftWhenNear = Math.round(drops[drops.length - 1]?.leftPx ?? -1)

    if (Math.abs(out.droppedLeftWhenNear - out.expectedSnapLeft) > 1) {
      out.errors.push(
        `released 3px from an edge at ${out.expectedSnapLeft} and landed at`
        + ` ${out.droppedLeftWhenNear} — the drag did not snap`)
    }
    if (out.guidesWhileDragging === 0) {
      out.errors.push("no guide line appeared while dragging, so nothing shows what it lined up with")
    }
    if (out.guidesAfterDrop !== 0) {
      out.errors.push("the guide lines stayed on the page after the drop")
    }

    // ── 2. The control: released far from anything ─────────────────────
    selectionState = EMPTY_SELECTION; render()
    await wait(50)
    const far = slots()[1]
    const farStart = far.getBoundingClientRect()
    far.dispatchEvent(pointer("pointerdown", farStart.left + 10, farStart.top + 10))
    await wait(30)
    far.dispatchEvent(pointer("pointerdown", farStart.left + 10, farStart.top + 10))
    await wait(30)
    const releaseFar = box.left + 420 + 10
    out.releasedFarLeft = 420
    window.dispatchEvent(pointer("pointermove", releaseFar, box.top + 500))
    await wait(60)
    window.dispatchEvent(pointer("pointerup", releaseFar, box.top + 500))
    await wait(80)
    out.droppedLeftWhenFar = Math.round(drops[drops.length - 1]?.leftPx ?? -1)
    if (Math.abs(out.droppedLeftWhenFar - out.releasedFarLeft) > 2) {
      out.errors.push(
        `released at ${out.releasedFarLeft}, far from anything, but landed at`
        + ` ${out.droppedLeftWhenFar} — snapping is pulling everything`)
    }

    // ── 3. Shift-click two, drag one, both move ────────────────────────
    selectionState = EMPTY_SELECTION; render()
    await wait(50)
    const [first, second] = slots()
    const a = first.getBoundingClientRect()
    first.dispatchEvent(pointer("pointerdown", a.left + 10, a.top + 10))
    await wait(40)
    const b = second.getBoundingClientRect()
    second.dispatchEvent(pointer("pointerdown", b.left + 10, b.top + 10, true))
    await wait(60)
    out.groupSelectionSize = selectedSlots(selectionState).length
    if (out.groupSelectionSize !== 2) {
      out.errors.push(`Shift-click gave a selection of ${out.groupSelectionSize}, expected 2`)
    }

    const held = slots()[0]
    const h = held.getBoundingClientRect()
    held.dispatchEvent(pointer("pointerdown", h.left + 10, h.top + 10))
    await wait(40)
    window.dispatchEvent(pointer("pointermove", h.left + 90, h.top + 60))
    await wait(60)
    // Both members visible in flight — the whole point of a group preview.
    out.ghostsWhileDraggingGroup = document.querySelectorAll(
      "[data-engine-drag-ghost], [data-engine-drag-companion]").length
    window.dispatchEvent(pointer("pointerup", h.left + 90, h.top + 60))
    await wait(80)
    out.groupMoveSlots = groupMoves[groupMoves.length - 1] ?? []
    if (out.ghostsWhileDraggingOne !== 1) {
      out.errors.push(
        `dragging ONE slot showed ${out.ghostsWhileDraggingOne} boxes in flight, expected 1`)
    }
    if (out.ghostsWhileDraggingGroup !== 2) {
      out.errors.push(
        `dragging a group of two showed ${out.ghostsWhileDraggingGroup} boxes in flight,`
        + " expected 2 — the others are invisible until the drop")
    }
    if (out.groupMoveSlots.length !== 2) {
      out.errors.push(
        `dragging one of two selected asked to move ${out.groupMoveSlots.length}`
        + " — the others were left behind")
    }

    return out
  } catch (err) {
    out.errors.push(err instanceof Error ? err.message : String(err))
    return out
  } finally {
    root.unmount()
    host.remove()
  }
}

/** The same snapping the editor does, inlined so this test exercises the real
 * module rather than a copy of its rules. */
function snapSync(
  ghost: { left: number; top: number; width: number; height: number },
  surface: HTMLElement,
  layer: HTMLElement | null,
) {
  const box = surface.getBoundingClientRect()
  const scale = box.width / PAGE.widthPts
  const others = IMAGES.map((im) => ({
    left: im.bbox.left * scale,
    right: im.bbox.right * scale,
    top: (PAGE.heightPts - im.bbox.top) * scale,
    bottom: (PAGE.heightPts - im.bbox.bottom) * scale,
  }))
  // Only the FIRST picture is a target; the second is the one being dragged.
  const targets = snapping.buildSnapTargets(box.width, box.height, [others[0]])
  const local = {
    left: ghost.left - box.left, top: ghost.top - box.top,
    width: ghost.width, height: ghost.height,
  }
  const result = snapping.snapRect(local, targets, snapping.MOVE_EDGES)
  snapping.paintGuides(layer, result.guides)
  return { left: result.rect.left + box.left, top: result.rect.top + box.top }
}
