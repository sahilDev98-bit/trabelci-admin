/**
 * Full screen: does the page fit, and does the toolbar follow the selection?
 *
 * Also checks the arithmetic the feature rests on — that filling the screen
 * with the whole page makes small text SMALLER than the windowed view, and
 * that zoom is what fixes it. Get that backwards and the feature is pointed
 * the wrong way.
 *
 *   npx vite --port 5174                              (one terminal)
 *   node scripts/pdf-engine-fullscreen-test.mjs [baseUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"

const browser = await chromium.launch()
// A laptop screen, which is what this was designed against.
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const result = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/workspaceSelfTest.ts")
  return mod.runWorkspaceSelfTest()
})

console.log(JSON.stringify(result, null, 2))
if (pageErrors.length) console.log("\nPAGE ERRORS:", pageErrors)

// Errors are counted up to HERE. Everything below either mounts the real
// editor without auth — which fails to fetch its PDF, exactly as the
// switchover test also tolerates — or deliberately imports modules that no
// longer exist. Counting those would make this check fail for doing its job.
const errorsBeforeProbe = pageErrors.length

// ---- opening a template goes straight to the editor's own full page ----
const opening = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/openingSelfTest.ts")
  return mod.runOpeningSelfTest()
})

// ---- and the ROUTER really is the thing that puts it there ----
// The check above proves React picks the nearest boundary; this proves the
// editor's routes actually declare one. Read off the real route tree rather
// than mounting it, because once the chunk is cached nothing suspends and
// there is nothing left to observe.
const routeBoundary = await page.evaluate(async () => {
  const { router } = await import("/src/router.tsx")
  // React tags a <Suspense> element with this well-known symbol, which is
  // reachable without importing react into this page.
  const SUSPENSE = Symbol.for("react.suspense")
  const opening = await import("/src/pages/create-pdf/PdfEditorOpening.tsx")
  const ids = Object.keys(router.routesById)
    .filter((id) => id.includes("/create-pdf/customize"))
  const checked = ids.map((id) => {
    const component = router.routesById[id].options?.component
    if (typeof component !== "function") return { id, ok: false, why: "no component" }
    let el
    try { el = component() } catch (e) { return { id, ok: false, why: String(e) } }
    if (!el || el.type !== SUSPENSE) return { id, ok: false, why: "not wrapped in Suspense" }
    // The fallback must be the editor's OWN loading screen, not a bare
    // spinner — that is what makes the bundle wait and the PDF wait read as
    // one screen instead of two.
    const ok = el.props?.fallback?.type === opening.PdfEditorOpening
    return { id, ok, why: String(el.props?.fallback?.type?.name ?? el.props?.fallback?.type) }
  })
  return { count: checked.length, allFullPage: checked.every((c) => c.ok), checked }
})

// ---- the windowed editor is genuinely gone, not merely unreachable ----
// The ask was to remove it "from the UI, from the code, from everywhere", so
// this checks the code: the modules must fail to load because they no longer
// exist. A module that still resolves is a module someone can still import
// by accident. The third entry is the control — if THAT also came back
// "gone", the check would be measuring a broken dev server instead.
const removed = await page.evaluate(async () => {
  const gone = async (path) => {
    try { await import(/* @vite-ignore */ path); return false } catch { return true }
  }
  return {
    tooRail: await gone("/src/pages/create-pdf/PdfEditorRail.tsx"),
    fullscreenRoute: await gone("/src/pages/create-pdf/engine-editor/fullscreenRoute.ts"),
    workspaceStillLoads: !(await gone(
      "/src/pages/create-pdf/engine-editor/PdfEngineWorkspace.tsx")),
    railInDom: !!document.querySelector("[data-pdf-tool-rail]"),
  }
})

await browser.close()

const m = result.maths ?? {}
const checks = {
  "no page errors": errorsBeforeProbe === 0,
  "no internal errors": result.errors.length === 0,

  // ---- the premise ----
  "fit-page really is smaller than the windowed view": m.fitPageZoom < m.windowedZoom,
  "fit-width really is bigger than the windowed view": m.fitWidthZoom > m.windowedZoom,
  "zooming to a 3pt line makes it readable": m.threePtZoomed >= 16,

  // ---- the shell ----
  "the shell fills the screen": result.overlayCoversViewport === true,
  "there is a toolbar": result.hasToolbar === true,
  "zoom is reachable from the floating bar": result.hasZoomControl === true,
  "and is no longer duplicated in the toolbar": result.toolbarHasNoZoomSelect === true,
  "fit-width fills the width": result.pageFitsWidth === true,
  "fit-page shows the whole page": result.wholePageVisible === true,
  "selecting adds tools rather than replacing them": result.toolbarChangedWithSelection === true,
  "Add text / Add image are there with nothing selected": result.addToolsPresentWhenNothingSelected === true,
  "and they survive selecting text": result.addToolsPresentWhenTextSelected === true,
  "and survive selecting an image": result.addToolsPresentWhenImageSelected === true,
  "the selection gets its own tools alongside": result.selectionToolsAppear === true,

  // ---- and picking something up must not move the page ----
  "the toolbar is one row": result.toolbarRowCount === 1,
  "its height does not change on selection":
    result.toolbarHeightBefore === result.toolbarHeightAfter,
  "so the document stays put": result.pageShiftOnSelect <= 2,
  "exactly one element per page": result.maxElementsPerPage === 1,
  "and that check really detects duplicates": result.maxElementsPerPageWithDuplicate > result.maxElementsPerPage,

  // ---- one wait, and it fills the window ----
  "no internal errors while opening": opening.errors.length === 0,
  "the editor's wait fills the window": opening.editorWaitCoverage >= 0.9,
  "...and a wait framed by the app would not":
    opening.detectorSeesAFramedWait && opening.framedWaitCoverage < 0.9,
  "opening a known template never flashes a framed wait":
    opening.framedWaitAppeared === false,
  "and it lands on the engine editor": opening.reachedEditorImmediately === true,
  "the first visit's code-download wait also fills the window":
    opening.coldChunkWaitWasFramed === false && opening.coldChunkWaitCoverage >= 0.9,
  "and every editor route declares that full-page boundary":
    routeBoundary.count > 0 && routeBoundary.allFullPage === true,

  // ---- the windowed editor is gone ----
  "the floating tool rail no longer exists": removed.tooRail === true,
  "nor does the windowed/full-screen route split": removed.fullscreenRoute === true,
  "...and the check is not just failing to load anything":
    removed.workspaceStillLoads === true,
  "no tool rail is rendered": removed.railInDom === false,

}

console.log("\n=========== FULL SCREEN CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
if (!ok) {
  if (errorsBeforeProbe) console.log("page errors:", pageErrors.slice(0, errorsBeforeProbe))
  console.log("removed:", JSON.stringify(removed, null, 2))
  console.log("opening:", JSON.stringify(opening, null, 2))
  console.log("routeBoundary:", JSON.stringify(routeBoundary, null, 2))
} else {
  console.log(
    `\nsize of a 6pt caption:  windowed ${m.sixPtWindowed}px`
    + `  |  fit-page ${m.sixPtFitPage}px  |  fit-width ${m.sixPtFitWidth}px`
    + `  |  3pt zoomed to ${m.threePtZoomed}px`,
  )
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
