/**
 * Dev-only self test for which editor actually opens.
 *
 * Uploaded PDFs are edited by the PDFium engine editor and HTML templates
 * by the iframe customizer, and that one routing decision is the kind of
 * thing that is easy to believe you made and easy to get subtly wrong —
 * dispatching on the wrong field, or breaking HTML templates as collateral
 * while changing the PDF path. Reading the code cannot distinguish those
 * from success; mounting it can.
 *
 * Uses a REAL TanStack memory router and the REAL dispatcher, with the
 * template seeded into a real React Query cache. Nothing about the decision
 * under test is stubbed — only the network beneath it.
 *
 * Driven by scripts/pdf-switchover-test.mjs.
 */
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider, createRouter, createRootRoute, createRoute,
  createMemoryHistory, Outlet,
} from "@tanstack/react-router"

import { PdfCustomizerPage } from "./PdfCustomizerPage"
import { PdfEngineEditorPage } from "./engine-editor/PdfEngineEditorPage"
import { pdfTemplatesQueryKeys } from "@/features/pdfTemplates/queryKeys"
import type { PdfTemplate } from "@/features/pdfTemplates/types"

export interface SwitchoverCase {
  /** Value of data-pdf-editor on the mounted editor, or null if absent. */
  editor: string | null
  /** True if the HTML (iframe) customizer mounted instead. */
  htmlCustomizer: boolean
  /** What actually rendered, for diagnosing a failure without re-running
   * with guesses. The dispatcher's ERROR page is also a DIV with no marker
   * and no iframe, so "neither editor mounted" and "the error page mounted"
   * are indistinguishable without this. */
  domSize: number
  firstTags: string
}

export interface SwitchoverTestResult {
  errors: string[]
  /** An uploaded PDF opened at the normal editing URL. */
  masterAtMainRoute: SwitchoverCase | null
  /** An uploaded PDF at the development-era alias. */
  masterAtV2Route: SwitchoverCase | null
  /** An HTML template at the normal editing URL — must be unaffected. */
  htmlAtMainRoute: SwitchoverCase | null
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Enough of a template for the dispatcher; the rest is never read by it.
 *
 * The HTML one carries a full document with a real </body>. That is what
 * the customizer's srcDoc builder expects — given a fragment it appends its
 * injected script with nothing to anchor it, the script lands in <head>,
 * and `document.body` is still null when it runs. A realistic fixture
 * matters here for the same reason it does anywhere: an unrealistic one
 * reports a fault that only the fixture has.
 */
function template(id: string, type: "pdf_master" | "html"): PdfTemplate {
  return {
    id,
    name: `fixture-${type}`,
    template_type: type,
    html_content: type === "html"
      ? "<html><body><div data-pdf-slot=\"text\">hello</div></body></html>"
      : "",
  } as unknown as PdfTemplate
}

/**
 * Mount one route with one template already in cache, and report which
 * editor came up.
 *
 * `component` mirrors exactly how router.tsx mounts each route, including
 * the legacy route's `legacyMaster` prop — the point is to test the real
 * wiring, so a divergence here would make the whole test meaningless.
 */
async function mountCase(
  path: string,
  routePath: string,
  tpl: PdfTemplate,
  /** How router.tsx mounts this route: through the dispatcher, or straight
   * to the engine editor as the v2 alias does. */
  mount: "dispatcher" | "engine-direct",
): Promise<SwitchoverCase> {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        // The seeded template is treated as permanently fresh. Without
        // this, React Query refetches it in the background on mount, that
        // request 401s (this harness has no auth), and the dispatcher flips
        // to its error page — which looks exactly like "the wrong editor
        // opened" while actually saying nothing about the routing at all.
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnReconnect: false,
      },
    },
  })
  // Seeded rather than fetched: the network is not what is being tested,
  // and a real request would need auth this harness does not have.
  queryClient.setQueryData(pdfTemplatesQueryKeys.byId(tpl.id), tpl)

  const rootRoute = createRootRoute({ component: () => createElement(Outlet) })
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: routePath,
    component: () => (
      mount === "engine-direct"
        ? createElement(PdfEngineEditorPage)
        : createElement(PdfCustomizerPage)
    ),
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  root.render(createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(RouterProvider, { router } as never),
  ))

  // Generous: the engine editor spins up a Web Worker and starts fetching
  // its WASM on mount. That fetch failing is fine — the question is only
  // which editor mounted — but the element has to exist before it is read.
  await wait(1200)

  const marked = host.querySelector("[data-pdf-editor]")
  const result: SwitchoverCase = {
    editor: marked?.getAttribute("data-pdf-editor") ?? null,
    // The iframe customizer is the one that renders an <iframe>.
    htmlCustomizer: !!host.querySelector("iframe"),
    domSize: host.innerHTML.length,
    firstTags: Array.from(host.querySelectorAll("*")).slice(0, 8).map((e) => e.tagName).join(","),
  }

  root.unmount()
  host.remove()
  queryClient.clear()
  return result
}

export async function runSwitchoverSelfTest(): Promise<SwitchoverTestResult> {
  const out: SwitchoverTestResult = {
    errors: [],
    masterAtMainRoute: null, masterAtV2Route: null, htmlAtMainRoute: null,
  }

  try {
    const master = template("tpl-master", "pdf_master")
    const html = template("tpl-html", "html")

    // 1. The normal editing URL opens the engine editor.
    out.masterAtMainRoute = await mountCase(
      "/create-pdf/customize/tpl-master", "/create-pdf/customize/$templateId", master, "dispatcher",
    )
    if (out.masterAtMainRoute.editor !== "engine") {
      out.errors.push(
        `the normal editing URL opened "${out.masterAtMainRoute.editor}", expected the engine editor`,
      )
    }

    // 2. Links shared during development must still resolve. Mounted the
    //    way router.tsx mounts that alias — straight to the engine editor,
    //    not through the dispatcher.
    out.masterAtV2Route = await mountCase(
      "/create-pdf/customize-v2/tpl-master", "/create-pdf/customize-v2/$templateId",
      master, "engine-direct",
    )
    if (out.masterAtV2Route.editor !== "engine") {
      out.errors.push("the development-era alias no longer reaches the engine editor")
    }

    // 3. HTML templates are not part of this change and must be untouched.
    out.htmlAtMainRoute = await mountCase(
      "/create-pdf/customize/tpl-html", "/create-pdf/customize/$templateId", html, "dispatcher",
    )
    if (out.htmlAtMainRoute.editor !== null) {
      out.errors.push(
        `an HTML template opened the "${out.htmlAtMainRoute.editor}" PDF editor; it should use the iframe customizer`,
      )
    }
    if (!out.htmlAtMainRoute.htmlCustomizer) {
      out.errors.push("an HTML template did not open the iframe customizer")
    }

    return out
  } catch (err) {
    out.errors.push(`harness threw: ${String(err)}`)
    return out
  }
}
