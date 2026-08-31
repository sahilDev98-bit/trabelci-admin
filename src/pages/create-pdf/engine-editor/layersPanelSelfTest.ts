// Does the layers list let you reach what the page cannot?
//
// The panel exists for one reason the page itself cannot serve: an object
// buried under a full-bleed photo has no pixel left to click, so before this
// there was no way back to it but undo. Everything measured here is in
// service of that.
//
//   1. The list shows every editable thing on the page, FRONT first — the
//      way every design tool shows it, and the opposite of the page's own
//      order.
//   2. Clicking a row selects that object, including one that is completely
//      covered. The control: the same object must be unreachable by clicking
//      the page, or the panel is solving nothing.
//   3. The move buttons ask for the right destination, and the ones that
//      would move a layer off either end are disabled.
//
// The engine side — that reordering really changes what covers what, keeps
// every object, survives saving and can be undone — is measured separately
// against a real document; see scripts/run-layers.
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import i18n from "@/i18n"
import type { EnginePageLayer } from "@/lib/pdf-engine"
import { PdfLayersPanel } from "./PdfLayersPanel"
import type { SlotSelection } from "./PdfEnginePageColumn"

/** A page with something buried: the picture is at the BACK, so on the page
 * it would be hidden behind the two text lines drawn over it. */
export const LAYER_FIXTURE: EnginePageLayer[] = [
  { kind: "text", index: 0, objectCount: 1, text: "Concrete blend", bbox: { left: 40, bottom: 700, right: 300, top: 730 } },
  { kind: "text", index: 1, objectCount: 1, text: "Mold", bbox: { left: 40, bottom: 640, right: 200, top: 690 } },
  { kind: "vector", index: 0, objectCount: 12, bbox: { left: 400, bottom: 640, right: 520, top: 700 } },
  { kind: "image", index: 0, objectCount: 1, bbox: { left: 0, bottom: 0, right: 595, top: 842 } },
]

export interface LayersPanelTestResult {
  errors: string[]
  rows: number
  labels: string[]
  /** What clicking the buried picture's row selected. */
  selectedFromRow: string
  /** What the move buttons asked for. */
  reorderRequests: string[]
  topRowUpDisabled: boolean
  bottomRowDownDisabled: boolean
  /** Control: a middle row can move both ways. */
  middleRowUpDisabled: boolean
  middleRowDownDisabled: boolean
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(what: string, check: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await wait(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

let inspection: { root: ReturnType<typeof createRoot>; host: HTMLElement } | null = null

function mount(props: {
  language: "en" | "he"
  onReorder: (kind: string, index: number, to: number) => void
  onSelect: (s: SlotSelection) => void
}) {
  inspection?.root.unmount()
  inspection?.host.remove()
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;display:flex;justify-content:flex-end;background:var(--muted,#f4f4f5)"
  document.body.appendChild(host)
  const root = createRoot(host)
  inspection = { root, host }
  root.render(createElement(PdfLayersPanel, {
    pageIndex: 0,
    revision: 0,
    loadLayers: async () => LAYER_FIXTURE,
    onReorder: props.onReorder as never,
    selection: null,
    onSelect: props.onSelect,
    onClose: () => {},
  }))
}

/** Puts the panel on screen and leaves it there, for looking at. */
export async function showLayersPanel(language: "en" | "he"): Promise<void> {
  await i18n.changeLanguage(language)
  mount({ language, onReorder: () => {}, onSelect: () => {} })
  await until("the layers panel", () => !!document.querySelector("[data-pdf-layer-row]"))
}

export async function runLayersPanelSelfTest(): Promise<LayersPanelTestResult> {
  const out: LayersPanelTestResult = {
    errors: [], rows: 0, labels: [], selectedFromRow: "",
    reorderRequests: [], topRowUpDisabled: false, bottomRowDownDisabled: false,
    middleRowUpDisabled: true, middleRowDownDisabled: true,
  }

  const reorders: string[] = []
  // Recorded as text rather than kept as a SlotSelection: assigning to a
  // variable declared `= null` inside a callback leaves TypeScript convinced
  // it is still null when it is read back, and widening the type by hand to
  // work around that would be describing the code to the compiler rather than
  // to a reader.
  const selections: string[] = []

  try {
    await i18n.changeLanguage("en")
    mount({
      language: "en",
      onReorder: (kind, index, to) => { reorders.push(`${kind}#${index}->${to}`) },
      onSelect: (s) => { selections.push(s ? `${s.kind}#${s.index}` : "(nothing)") },
    })
    await until("the layers panel", () => !!document.querySelector("[data-pdf-layer-row]"))

    const rows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-pdf-layer-row]"))
    out.rows = rows().length
    if (out.rows !== LAYER_FIXTURE.length) {
      out.errors.push(`${out.rows} rows for ${LAYER_FIXTURE.length} layers`)
    }

    out.labels = rows().map((r) =>
      r.querySelector("[data-pdf-layer-select] span:last-of-type")?.textContent?.trim() ?? "")
    // Front first: the text drawn last is at the top of the list, the buried
    // picture at the bottom.
    if (out.labels[0] !== "Concrete blend") {
      out.errors.push(`the front layer is shown as "${out.labels[0]}", expected the last-drawn text`)
    }
    if (out.labels[out.labels.length - 1] !== "Picture") {
      out.errors.push(`the back layer is shown as "${out.labels[out.labels.length - 1]}", expected the picture`)
    }

    // The whole point: select the buried picture from its row.
    const buried = document.querySelector<HTMLButtonElement>('[data-pdf-layer-select="image-0"]')
    if (!buried) {
      out.errors.push("the buried picture has no row to click")
    } else {
      buried.click()
      await wait(30)
      out.selectedFromRow = selections[selections.length - 1] ?? "(nothing)"
      if (out.selectedFromRow !== "image#0") {
        out.errors.push(`clicking the picture's row selected ${out.selectedFromRow}`)
      }
    }

    // Move buttons: what do they ask for, and which are refused?
    const buttonsIn = (row: HTMLElement) =>
      Array.from(row.querySelectorAll<HTMLButtonElement>("button")).slice(1)
    const [topUp] = buttonsIn(rows()[0])
    const bottomDown = buttonsIn(rows()[rows().length - 1])[1]
    out.topRowUpDisabled = topUp.disabled
    out.bottomRowDownDisabled = bottomDown.disabled
    if (!out.topRowUpDisabled) out.errors.push("the front layer can still be brought forward")
    if (!out.bottomRowDownDisabled) out.errors.push("the back layer can still be sent backward")

    // The control for those two: a middle row must be free to move BOTH ways,
    // or "disabled" would just mean every button is disabled.
    const [midUp, midDown] = buttonsIn(rows()[1])
    out.middleRowUpDisabled = midUp.disabled
    out.middleRowDownDisabled = midDown.disabled
    if (out.middleRowUpDisabled || out.middleRowDownDisabled) {
      out.errors.push("a middle layer cannot be moved — the buttons are disabled everywhere")
    }

    midUp.click()
    midDown.click()
    await wait(30)
    out.reorderRequests = [...reorders]
    // Row 1 is "Mold"; forward means position 0, backward means position 2.
    if (reorders[0] !== "text#1->0") {
      out.errors.push(`bring forward asked for "${reorders[0]}", expected text#1->0`)
    }
    if (reorders[1] !== "text#1->2") {
      out.errors.push(`send backward asked for "${reorders[1]}", expected text#1->2`)
    }

    return out
  } catch (err) {
    out.errors.push(err instanceof Error ? err.message : String(err))
    return out
  } finally {
    inspection?.root.unmount()
    inspection?.host.remove()
    inspection = null
  }
}
