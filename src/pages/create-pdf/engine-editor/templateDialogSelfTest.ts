// Does the save-template dialog say what is actually about to be saved?
//
// The dialog's real job is not collecting a name. A template is only useful
// because of its product slots, and a page saved with none can be inserted
// but never filled — so the dialog has to state that BEFORE the save, not
// leave it to be discovered by whoever tries to use the template later.
//
// It also must not accept a nameless template: a template nobody can find in
// the library is the same as one that was never saved.
import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"

import { PdfSaveTemplateDialog } from "./PdfSaveTemplateDialog"

export interface TemplateDialogTestResult {
  errors: string[]
  /** Field names shown for a page that has slots. */
  slotsListed: string[]
  warnsWhenNoSlots: boolean
  /** The control: a page WITH slots must not show the warning. */
  warnsWhenSlotsExist: boolean
  saveDisabledWithoutName: boolean
  saveEnabledWithName: boolean
  savedDetails: string | null
  sizeShown: string | null
}

const mount = (root: Root, props: Record<string, unknown>) => {
  root.render(createElement(PdfSaveTemplateDialog, {
    open: true,
    pageNumber: 3,
    pageSize: { widthPts: 680, heightPts: 822 },
    slotFieldIds: [],
    saving: false,
    onCancel: () => {},
    onSave: () => {},
    ...props,
  } as never))
}

const wait = () => new Promise((r) => setTimeout(r, 80))
const saveButton = () =>
  document.querySelector<HTMLButtonElement>("[data-pdf-template-save]")
const slotsBox = () =>
  document.querySelector<HTMLElement>("[data-pdf-template-slots]")

export async function runTemplateDialogSelfTest(): Promise<TemplateDialogTestResult> {
  const out: TemplateDialogTestResult = {
    errors: [], slotsListed: [], warnsWhenNoSlots: false,
    warnsWhenSlotsExist: false, saveDisabledWithoutName: false,
    saveEnabledWithName: false, savedDetails: null, sizeShown: null,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  let root: Root | null = null

  try {
    root = createRoot(host)

    // ── A page with no slots ─────────────────────────────────────────
    mount(root, { slotFieldIds: [] })
    await wait()
    const emptyText = slotsBox()?.textContent ?? ""
    out.warnsWhenNoSlots = /nothing will fill it/i.test(emptyText)
    if (!out.warnsWhenNoSlots) {
      out.errors.push(
        "a page with no product slots can be saved with no warning — the"
        + " template would be uninsertable-but-unfillable and nobody would know")
    }
    out.saveDisabledWithoutName = saveButton()?.disabled === true
    if (!out.saveDisabledWithoutName) {
      out.errors.push("a template with no name can be saved, and could never be found again")
    }

    // ── A page with slots ────────────────────────────────────────────
    let saved: string | null = null
    mount(root, {
      slotFieldIds: ["photo", "sku", "unitPrice"],
      onSave: (d: { name: string; category: string }) => {
        saved = `${d.name}/${d.category}`
      },
    })
    await wait()
    const filledText = slotsBox()?.textContent ?? ""
    // The control for the warning above: with slots present it must NOT
    // appear, or the message means nothing.
    out.warnsWhenSlotsExist = /nothing will fill it/i.test(filledText)
    if (out.warnsWhenSlotsExist) {
      out.errors.push("the 'no slots' warning shows even when the page HAS slots")
    }

    out.slotsListed = Array.from(
      slotsBox()?.querySelectorAll("span") ?? [])
      .map((s) => s.textContent?.trim() ?? "")
      .filter(Boolean)
    for (const expected of ["Product photo", "SKU"]) {
      if (!out.slotsListed.some((s) => s.includes(expected))) {
        out.errors.push(`the dialog does not name the ${expected} slot it is about to save`)
      }
    }

    // The page's size, in millimetres — this page is deliberately NOT a
    // standard size, so it has to be reported rather than named.
    out.sizeShown = /(\d+)\s*×\s*(\d+)\s*mm/.exec(filledText)?.[0] ?? null
    if (!out.sizeShown) {
      out.errors.push("the dialog does not say what size page is being saved")
    }

    // ── Naming it, and saving ────────────────────────────────────────
    const nameInput = document.querySelector<HTMLInputElement>("[data-pdf-template-name]")
    if (!nameInput) {
      out.errors.push("there is no name field")
    } else {
      // React tracks the value on the DOM node, so setting .value alone is
      // ignored — the native setter has to be used for the change to reach it.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value")?.set
      setter?.call(nameInput, "One product, large photo")
      nameInput.dispatchEvent(new Event("input", { bubbles: true }))
      await wait()

      out.saveEnabledWithName = saveButton()?.disabled === false
      if (!out.saveEnabledWithName) {
        out.errors.push("the save button stays disabled even with a name typed")
      }
      saveButton()?.click()
      await wait()
      out.savedDetails = saved
      if (saved !== "One product, large photo/product") {
        out.errors.push(`saving reported ${JSON.stringify(saved)}`)
      }
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    root?.unmount()
    host.remove()
  }

  return out
}

/** Leaves the dialog on screen to be looked at. */
export async function showTemplateDialog(language: "en" | "he"): Promise<void> {
  const i18n = (await import("@/i18n")).default
  await i18n.changeLanguage(language)
  document.getElementById("template-dialog-inspect")?.remove()
  const host = document.createElement("div")
  host.id = "template-dialog-inspect"
  document.body.appendChild(host)
  mount(createRoot(host), { slotFieldIds: ["photo", "sku", "size", "unitPrice"] })
  await new Promise((r) => setTimeout(r, 400))
}
