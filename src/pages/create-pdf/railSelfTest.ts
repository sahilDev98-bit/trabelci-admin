/**
 * Dev-only self test for the shared tool rail.
 *
 * The rail is used by BOTH editors — the original customizer and the PDFium
 * one — so a change made for one silently changes the other. That is the
 * whole risk this file exists to cover: the two configurations are rendered
 * side by side and asserted to differ in exactly the intended ways, and in
 * no others.
 *
 * Type-checks against the component's real props on every build, so a prop
 * rename cannot leave a stale test behind. Nothing in the app imports it.
 *
 * Driven by scripts/pdf-editor-rail-test.mjs.
 */
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEditorRail } from "./PdfEditorRail"

export interface RailConfigResult {
  /** Total tool buttons, collapse chevron included. */
  buttonCount: number
  /** The text-boxes on/off switch — the only button with aria-pressed. */
  hasContentToggle: boolean
  /** Page rotation. */
  hasRotate: boolean
  /** The tools that must be present in BOTH editors. */
  hasCopy: boolean
  hasMove: boolean
  hasDelete: boolean
  hasAddText: boolean
  hasAddImage: boolean
}

export interface RailTestResult {
  errors: string[]
  /** How the ORIGINAL customizer gets the rail: no props passed. */
  legacy: RailConfigResult | null
  /** How the PDFium editor gets it. */
  engine: RailConfigResult | null
  /** Toggling contentMode must flip the switch's pressed state. */
  togglePressedWhenTextOn: boolean
  togglePressedWhenTextOff: boolean
  toggleFired: number
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Lucide renders each icon with a `lucide-<kebab-name>` class, which is the
 * only stable way to tell one icon button from another without hovering to
 * raise its tooltip. The names come from lucide's own kebab-casing of the
 * icon, NOT from the alias imported in the rail — `TextIcon` renders as
 * `lucide-text-align-start` in this version, so guessing from the import
 * name reports a button missing that is plainly there. */
function hasIcon(host: HTMLElement, name: string): boolean {
  return !!host.querySelector(`.lucide-${name}`)
}

function inspect(host: HTMLElement): RailConfigResult {
  return {
    buttonCount: host.querySelectorAll("button").length,
    hasContentToggle: !!host.querySelector("button[aria-pressed]"),
    hasRotate: hasIcon(host, "rotate-cw"),
    hasCopy: hasIcon(host, "copy"),
    hasMove: hasIcon(host, "arrow-up-down"),
    hasDelete: hasIcon(host, "trash-2"),
    hasAddText: hasIcon(host, "text-align-start"),
    hasAddImage: hasIcon(host, "image-plus"),
  }
}

export async function runRailSelfTest(): Promise<RailTestResult> {
  const out: RailTestResult = {
    errors: [], legacy: null, engine: null,
    togglePressedWhenTextOn: false, togglePressedWhenTextOff: false, toggleFired: 0,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    // ---- 1. the ORIGINAL customizer's configuration: no new props ----
    root.render(createElement(PdfEditorRail, {
      top: 100,
      contentMode: "text" as const,
      onToggleContentMode: () => {},
      onOpenOrganizer: () => {},
      onAddText: () => {},
      onAddImage: () => {},
    }))
    await wait(250)
    out.legacy = inspect(host)

    if (out.legacy.hasContentToggle) {
      out.errors.push("the text on/off switch appeared in the original customizer, which had it hidden")
    }
    if (!out.legacy.hasRotate) out.errors.push("the original customizer lost its rotate tool")

    // ---- 2. the PDFium editor's configuration ----
    root.render(createElement(PdfEditorRail, {
      top: 100,
      contentMode: "text" as const,
      onToggleContentMode: () => { out.toggleFired++ },
      onOpenOrganizer: () => {},
      onAddText: () => {},
      onAddImage: () => {},
      showContentModeToggle: true,
      showRotate: false,
    }))
    await wait(250)
    out.engine = inspect(host)

    if (!out.engine.hasContentToggle) out.errors.push("the PDFium editor has no text on/off switch in the rail")
    if (out.engine.hasRotate) out.errors.push("rotate is still offered in the PDFium editor")

    // Everything else must be identical between the two — the two flags are
    // the ONLY intended difference, and a regression here would mean one
    // editor quietly lost a tool.
    for (const key of ["hasCopy", "hasMove", "hasDelete", "hasAddText", "hasAddImage"] as const) {
      if (out.legacy[key] !== out.engine[key]) out.errors.push(`${key} differs between the two rails`)
      if (!out.engine[key]) out.errors.push(`${key} is missing from the PDFium rail`)
    }

    // The switch must actually be wired, not merely rendered.
    const toggle = host.querySelector<HTMLButtonElement>("button[aria-pressed]")
    if (!toggle) {
      out.errors.push("no toggle button to click")
    } else {
      out.togglePressedWhenTextOn = toggle.getAttribute("aria-pressed") === "true"
      toggle.click()
      await wait(120)
      if (out.toggleFired !== 1) out.errors.push("clicking the switch did not call onToggleContentMode")
    }

    // ---- 3. the switch reflects the mode it is given ----
    root.render(createElement(PdfEditorRail, {
      top: 100,
      contentMode: "images" as const,
      onToggleContentMode: () => {},
      onOpenOrganizer: () => {},
      onAddText: () => {},
      onAddImage: () => {},
      showContentModeToggle: true,
      showRotate: false,
    }))
    await wait(250)
    const off = host.querySelector<HTMLButtonElement>("button[aria-pressed]")
    out.togglePressedWhenTextOff = off?.getAttribute("aria-pressed") === "true"
    if (!out.togglePressedWhenTextOn) out.errors.push("the switch did not read as ON while text boxes were on")
    if (out.togglePressedWhenTextOff) out.errors.push("the switch still read as ON while text boxes were off")

    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
