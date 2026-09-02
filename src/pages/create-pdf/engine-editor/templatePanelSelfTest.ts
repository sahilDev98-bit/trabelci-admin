// Does the template library say what it is offering?
//
// The panel is the only way anyone will ever use a saved template, and its
// two states both matter. Empty is the state EVERY user sees first, and a
// panel that just sits blank teaches nobody how to fill it. Populated has to
// show what each template can hold, because "Product page 3" is not a reason
// to choose one template over another — its slots are.
import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { PdfTemplatePanel } from "./PdfTemplatePanel"
import type { PdfPageTemplate } from "@/features/pdfPageTemplates/types"

export interface TemplatePanelTestResult {
  errors: string[]
  emptyStateExplains: boolean
  saysWhereItLands: boolean
  templatesListed: number
  slotChipsShown: string[]
  /** A template with no slots must say so rather than show nothing. */
  noSlotsStated: boolean
  appliedId: string | null
  /** While one is being applied, the rest must not be clickable. */
  disabledWhileApplying: boolean
}

const box = { left: 10, bottom: 20, right: 110, top: 40 }
const TEMPLATES: PdfPageTemplate[] = [
  {
    id: "1", name: "One product, large photo", description: null,
    category: "product", supplier: "Varmora", previewUrl: null,
    widthPts: 595, heightPts: 842, productCount: 1, createdAt: null,
    slots: [
      { fieldId: "photo", kind: "image", productIndex: 0, bbox: box },
      { fieldId: "sku", kind: "text", productIndex: 0, bbox: box },
      { fieldId: "name", kind: "text", productIndex: 0, bbox: box },
    ],
  },
  {
    id: "2", name: "Plain cover", description: null,
    category: "cover", supplier: null, previewUrl: null,
    widthPts: 595, heightPts: 842, productCount: 0, createdAt: null,
    slots: [],
  },
]

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms))

/**
 * Mount the panel over a seeded cache, in a FRESH root each time.
 *
 * The panel fetches through React Query, and seeding the cache is what lets
 * this test the PANEL rather than the network — which would need a signed-in
 * session this has no business depending on.
 *
 * A new root per mount, and not by preference: re-rendering one root with a
 * different QueryClient underneath it left the panel still reading the
 * previous client, so a seeded library rendered as empty. That is a fault in
 * the test rather than the panel, and it cost a real debugging detour.
 */
async function mount(
  host: HTMLElement, templates: PdfPageTemplate[], props: Record<string, unknown> = {},
): Promise<Root> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["pdfPageTemplates", "list", {}], templates)
  const root = createRoot(host)
  root.render(createElement(QueryClientProvider, { client },
    createElement(PdfTemplatePanel, {
      onApplyTemplate: () => {},
      afterPageNumber: 3,
      applyingId: null,
      onClose: () => {},
      ...props,
    } as never)))
  await wait(200)
  return root
}

export async function runTemplatePanelSelfTest(): Promise<TemplatePanelTestResult> {
  const out: TemplatePanelTestResult = {
    errors: [], emptyStateExplains: false, saysWhereItLands: false,
    templatesListed: 0, slotChipsShown: [], noSlotsStated: false,
    appliedId: null, disabledWhileApplying: false,
  }

  // Held on an object rather than in a plain `let`: assigning inside the
  // closure below is invisible to the compiler's narrowing, which then
  // decides the variable is still null by the time it is torn down.
  const live: { host: HTMLElement; root: Root | null } = {
    host: document.createElement("div"), root: null,
  }
  document.body.appendChild(live.host)

  const remount = async (templates: PdfPageTemplate[], props: Record<string, unknown> = {}) => {
    live.root?.unmount()
    live.host.remove()
    live.host = document.createElement("div")
    document.body.appendChild(live.host)
    live.root = await mount(live.host, templates, props)
  }

  try {
    // ── Empty: the state everyone sees first ─────────────────────────
    await remount([])
    const emptyText = live.host.textContent ?? ""
    out.emptyStateExplains = /save page as template/i.test(emptyText)
    if (!out.emptyStateExplains) {
      out.errors.push(
        "the empty library does not say how to fill it — the first thing every"
        + " user sees teaches them nothing")
    }
    out.saysWhereItLands = /after page 3/i.test(emptyText)
    if (!out.saysWhereItLands) {
      out.errors.push("the panel does not say where a template will be inserted")
    }
    if (live.host.querySelectorAll("[data-pdf-template-item]").length !== 0) {
      out.errors.push("an empty library still listed templates")
    }

    // ── Populated ────────────────────────────────────────────────────
    let applied: string | null = null
    await remount(TEMPLATES, {
      onApplyTemplate: (t: PdfPageTemplate) => { applied = t.id },
    })
    const items = live.host.querySelectorAll<HTMLButtonElement>("[data-pdf-template-item]")
    out.templatesListed = items.length
    if (out.templatesListed !== TEMPLATES.length) {
      out.errors.push(`listed ${out.templatesListed} templates, expected ${TEMPLATES.length}`)
    }

    // What each template can HOLD, which is the reason to pick one.
    const first = items[0]
    out.slotChipsShown = Array.from(first?.querySelectorAll("span") ?? [])
      .map((s) => s.textContent?.trim() ?? "")
      .filter(Boolean)
    for (const expected of ["Product photo", "SKU"]) {
      if (!out.slotChipsShown.some((c) => c.includes(expected))) {
        out.errors.push(`the template's ${expected} slot is not shown`)
      }
    }
    // The control: a template with NO slots must say so, not show an empty
    // gap that reads the same as "not loaded yet".
    out.noSlotsStated = /no product slots/i.test(items[1]?.textContent ?? "")
    if (!out.noSlotsStated) {
      out.errors.push("a template with no product slots does not say so")
    }

    first?.click()
    await wait(40)
    out.appliedId = applied
    if (applied !== "1") {
      out.errors.push(`clicking the first template reported ${JSON.stringify(applied)}`)
    }

    // ── While one is being applied ───────────────────────────────────
    // Inserting a page renumbers everything; a second click landing mid-way
    // through the first would insert against numbers that no longer mean
    // what they did.
    await remount(TEMPLATES, { applyingId: "1" })
    const busyItems = live.host.querySelectorAll<HTMLButtonElement>("[data-pdf-template-item]")
    // Requires items to EXIST as well as be disabled. `every` on an empty
    // list is true, so without this the check passed on a panel that had
    // rendered nothing at all — which is exactly what happened.
    out.disabledWhileApplying = busyItems.length > 0
      && Array.from(busyItems).every((b) => b.disabled)
    if (!out.disabledWhileApplying) {
      out.errors.push("templates stay clickable while one is already being applied")
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    live.root?.unmount()
    live.host.remove()
  }

  return out
}

/** Leaves the panel on screen to be looked at. */
export async function showTemplatePanel(
  language: "en" | "he", empty = false,
): Promise<void> {
  const i18n = (await import("@/i18n")).default
  await i18n.changeLanguage(language)
  document.getElementById("template-panel-inspect")?.remove()
  const host = document.createElement("div")
  host.id = "template-panel-inspect"
  host.style.cssText = "position:fixed;inset:0;display:flex;background:#f4f4f5"
  document.body.appendChild(host)
  await mount(host, empty ? [] : TEMPLATES)
  await new Promise((r) => setTimeout(r, 400))
}
