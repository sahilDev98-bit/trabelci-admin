/**
 * Verifies which editor opens: uploaded PDFs in the PDFium engine editor,
 * HTML templates in the iframe customizer.
 *
 * Mounts the REAL dispatcher on a REAL router — this is a routing decision,
 * and a routing decision is only demonstrated by routing.
 *
 *   npx vite --port 5174                          (one terminal)
 *   node scripts/pdf-switchover-test.mjs [baseUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => {
  if (m.type() !== "error") return
  const text = m.text()
  // The engine editor reaches for its PDF the moment it mounts and this
  // harness has no auth, so that failure is expected and says nothing about
  // the routing decision under test.
  if (/Missing Authorization|Failed to load resource|401|403|404|NetworkError|Failed to fetch/i.test(text)) return
  pageErrors.push(`console: ${text}`)
})

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const result = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/switchoverSelfTest.ts")
  return mod.runSwitchoverSelfTest()
})

console.log(JSON.stringify(result, null, 2))
if (pageErrors.length) console.log("\nPAGE ERRORS:", pageErrors)
await browser.close()

const checks = {
  "no unexpected page errors": pageErrors.length === 0,
  "no internal errors": result.errors.length === 0,
  "uploaded PDFs open in the engine editor": result.masterAtMainRoute?.editor === "engine",
  "development-era links still reach the engine editor": result.masterAtV2Route?.editor === "engine",
  "HTML templates do not open a PDF editor": result.htmlAtMainRoute?.editor === null,
  "HTML templates still open the iframe customizer": result.htmlAtMainRoute?.htmlCustomizer === true,
}

console.log("\n=========== EDITOR DISPATCH CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
