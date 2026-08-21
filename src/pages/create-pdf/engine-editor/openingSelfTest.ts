// What you see between clicking "Use template" and the editor appearing.
//
// It used to be three different things in a row: a spinner framed by the
// admin shell, sidebar and breadcrumbs and all; then the editor's own
// full-page wait; then the document. Two of those were the app apologising
// for not having decided anything yet, and the flicker between them made
// opening a template feel broken even though nothing was wrong.
//
// So there is one rule, and it is what this checks: every wait on the way to
// this editor covers the whole window. A wait that leaves the sidebar
// showing is the fault, and it is caught here by MEASURING the box rather
// than by reading the markup — a class name can be right while the element
// it lands on is nested inside something that constrains it.
import { Suspense, createElement } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter,
} from "@tanstack/react-router"

import { pdfTemplatesQueryKeys } from "@/features/pdfTemplates/queryKeys"
import type { PdfTemplate } from "@/features/pdfTemplates/types"
import { PdfCustomizerPage } from "../PdfCustomizerPage"
import { PdfEditorLoadingScreen } from "../PdfEditorLoadingScreen"

export interface OpeningTestResult {
  errors: string[]
  /** Share of the window the editor's own wait covers, 0-1. */
  editorWaitCoverage: number
  /** The same for a wait framed by the app — the shape being ruled out. */
  framedWaitCoverage: number
  /** Opening a known template must go straight to the editor. */
  reachedEditorImmediately: boolean
  /** ...without rendering any app-framed wait on the way. */
  framedWaitAppeared: boolean
  /** Control: the detector must be able to see one when there IS one. */
  detectorSeesAFramedWait: boolean
  /** The wait shown while the editor's own code is still downloading — the
   * first-visit case, which used to be framed by the app. */
  coldChunkWaitCoverage: number
  coldChunkWaitWasFramed: boolean
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** How much of the window an element covers. */
function coverage(el: Element): number {
  const r = el.getBoundingClientRect()
  const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0))
  const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
  return (w * h) / (window.innerWidth * window.innerHeight)
}

/** The shape being ruled out: a wait that sits INSIDE the page rather than
 * replacing it, which is what leaves the sidebar and breadcrumbs on screen. */
function framedWait(root: ParentNode): Element | null {
  for (const el of root.querySelectorAll("*")) {
    const cls = el.getAttribute("class") ?? ""
    if (!/\bmin-h-96\b/.test(cls)) continue
    if (el.querySelector(".animate-spin") || /animate-spin/.test(cls)) return el
  }
  return null
}

const TEMPLATE: PdfTemplate = {
  id: "opening-test",
  name: "opening.pdf",
  template_type: "pdf_master",
} as unknown as PdfTemplate

export async function runOpeningSelfTest(): Promise<OpeningTestResult> {
  const out: OpeningTestResult = {
    errors: [], editorWaitCoverage: 0, framedWaitCoverage: 0,
    reachedEditorImmediately: false, framedWaitAppeared: false,
    detectorSeesAFramedWait: false,
    coldChunkWaitCoverage: 0, coldChunkWaitWasFramed: false,
  }

  // ── 1. the editor's own wait must fill the window ──
  const shellHost = document.createElement("div")
  document.body.appendChild(shellHost)
  const shellRoot = createRoot(shellHost)
  try {
    shellRoot.render(createElement(PdfEditorLoadingScreen, {
      documentName: "opening.pdf",
      phase: "downloading" as const,
      downloadPercent: 12,
      error: null,
      onBack: () => {},
    }))
    await wait(300)
    const shell = shellHost.querySelector("[data-pdf-loading-shell]")
    out.editorWaitCoverage = shell ? Number(coverage(shell).toFixed(3)) : 0
  } finally {
    shellRoot.unmount()
    shellHost.remove()
  }

  // ── the control: what a framed wait measures, so 1 means something ──
  const control = document.createElement("div")
  control.innerHTML = '<div class="flex min-h-96 items-center justify-center">'
    + '<span class="animate-spin"></span></div>'
  document.body.appendChild(control)
  const framed = framedWait(control)
  out.detectorSeesAFramedWait = framed !== null
  out.framedWaitCoverage = framed ? Number(coverage(framed).toFixed(3)) : 0
  control.remove()

  // ── 2. the FIRST visit, when the editor's code is still downloading ──
  //
  // AdminLayout wraps its Outlet in a Suspense of its own, inside the padded,
  // width-capped <main>. React uses the NEAREST boundary, so a route that
  // suspends without one of its own gets that framed spinner — which is what
  // a first visit showed, and only a first visit, because afterwards the
  // chunk is cached and nothing suspends at all.
  //
  // Reproduced here as the nesting rather than by mounting the real layout,
  // which would need the whole provider stack: an outer boundary shaped like
  // AdminLayout's, an inner one shaped like the route's, and a child that
  // suspends. The control below removes the inner boundary and must then
  // land on the framed fallback — if it does not, this proves nothing.
  const suspendForever = createElement(
    () => { throw new Promise(() => {}) },
  )
  const framedFallback = createElement(
    "div", { className: "flex min-h-96 items-center justify-center" },
    createElement("span", { className: "animate-spin" }),
  )
  const fullPageFallback = createElement(
    "div",
    {
      "data-full-page-wait": "",
      className: "fixed inset-0 z-50 flex items-center justify-center bg-background",
    },
    createElement("span", { className: "animate-spin" }),
  )

  for (const withOwnBoundary of [true, false]) {
    const h = document.createElement("div")
    document.body.appendChild(h)
    const r = createRoot(h)
    try {
      r.render(createElement(
        Suspense, { fallback: framedFallback },
        withOwnBoundary
          ? createElement(Suspense, { fallback: fullPageFallback }, suspendForever)
          : suspendForever,
      ))
      await wait(250)
      const full = h.querySelector("[data-full-page-wait]")
      if (withOwnBoundary) {
        out.coldChunkWaitCoverage = full ? Number(coverage(full).toFixed(3)) : 0
        out.coldChunkWaitWasFramed = !full && !!framedWait(h)
      } else if (!framedWait(h)) {
        out.errors.push(
          "without its own boundary the wait was NOT framed, so this check"
          + " cannot tell whether the boundary is doing anything")
      }
    } finally {
      r.unmount()
      h.remove()
    }
  }

  // ── 3. opening a template the app already knows must not wait at all ──
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false, staleTime: Infinity,
          refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
        },
      },
    })
    // Exactly what the template list does before it navigates.
    queryClient.setQueryData(pdfTemplatesQueryKeys.byId(TEMPLATE.id), TEMPLATE)

    const rootRoute = createRootRoute({ component: () => createElement(Outlet) })
    const pageRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/create-pdf/customize/$templateId",
      component: PdfCustomizerPage,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([pageRoute]),
      history: createMemoryHistory({
        initialEntries: [`/create-pdf/customize/${TEMPLATE.id}`],
      }),
    })

    root.render(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RouterProvider, { router } as never),
    ))

    // Sampled repeatedly from the very first frame: the fault being ruled
    // out is a wait that FLASHES, so checking only the settled state would
    // miss exactly the thing complained about.
    for (let i = 0; i < 40; i++) {
      if (framedWait(host)) out.framedWaitAppeared = true
      await wait(25)
    }
    out.reachedEditorImmediately = !!host.querySelector('[data-pdf-editor="engine"]')

    // ---- verdicts ----
    if (out.editorWaitCoverage < 0.9) {
      out.errors.push(
        `the editor's wait covers only ${(out.editorWaitCoverage * 100).toFixed(0)}%`
        + " of the window — the app is still showing around it")
    }
    if (!out.detectorSeesAFramedWait || out.framedWaitCoverage >= 0.9) {
      out.errors.push(
        "the framed-wait detector is not working, so the check below proves nothing")
    }
    if (out.framedWaitAppeared) {
      out.errors.push(
        "opening a template flashed a wait framed by the app before the editor")
    }
    if (!out.reachedEditorImmediately) {
      out.errors.push("opening a known template did not reach the engine editor")
    }
    if (out.coldChunkWaitWasFramed || out.coldChunkWaitCoverage < 0.9) {
      out.errors.push(
        "while the editor's code downloads the wait is framed by the app"
        + ` (covers ${(out.coldChunkWaitCoverage * 100).toFixed(0)}% of the window)`)
    }
    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
