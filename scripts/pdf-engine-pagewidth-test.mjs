/**
 * Verifies pages fill the panel they sit in, at several WINDOW widths.
 *
 * The panel is centred and width-capped while the tool rail is fixed to the
 * viewport, so whether the two overlap depends on the window — which is why
 * this reproduces the real shell and checks both sides of the point where
 * the panel stops growing and starts centring.
 *
 *   npx vite --port 5174                              (one terminal)
 *   node scripts/pdf-engine-pagewidth-test.mjs [baseUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const result = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/pageWidthSelfTest.ts")
  return mod.runPageWidthSelfTest()
})

console.log(JSON.stringify(result, null, 2))
if (pageErrors.length) console.log("\nPAGE ERRORS:", pageErrors)
await browser.close()

const cases = result.cases ?? []
const at = (w) => cases.find((c) => c.viewportWidth === w)

const checks = {
  "no page errors": pageErrors.length === 0,
  "no internal errors": result.errors.length === 0,
  "measured every window width": cases.length === 4,
  // The reported setup: a 1920px window, where the panel is capped and
  // centred so the rail floats clear of it and nothing needs reserving.
  "fills the panel completely at 1920px": !!at(1920) && at(1920).fillRatio >= 0.99,
  // The narrow case, where the rail genuinely does cover the panel's edge.
  "still clears the rail at 1100px": !!at(1100) && at(1100).clearanceToRail >= 0,
  // The real invariant. 100% is not achievable when the rail genuinely
  // covers the panel's edge, so what must hold everywhere is that the paper
  // is held back ONLY by the rail — never by space reserved against nothing,
  // which is what the fixed-gutter version did.
  "no width is reserved against nothing": cases.every(
    (c) => c.fillRatio >= 0.98 || c.clearanceToRail <= 14,
  ),
  "never overlaps the tool rail": cases.every((c) => c.clearanceToRail >= 0),
  "keeps the page's aspect ratio": cases.every(
    (c) => Math.abs(c.pageHeight / c.pageWidth - 842 / 595) < 0.01,
  ),
}

console.log("\n=========== PAGE WIDTH CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
