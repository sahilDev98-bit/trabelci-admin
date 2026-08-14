/**
 * Renders the shared tool rail in BOTH editors' configurations and checks
 * they differ only in the two intended ways.
 *
 * The rail is shared between the original customizer and the PDFium editor,
 * so this is really a regression guard on the claim "the production editor
 * is untouched" — a claim that is otherwise only as good as a code reading.
 *
 *   npx vite --port 5174                                  (one terminal)
 *   node scripts/pdf-editor-rail-test.mjs [baseUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const result = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/railSelfTest.ts")
  return mod.runRailSelfTest()
})

console.log(JSON.stringify(result, null, 2))
if (pageErrors.length) console.log("\nPAGE ERRORS:", pageErrors)
await browser.close()

const { legacy, engine } = result
const checks = {
  "no page errors": pageErrors.length === 0,
  "no internal errors": result.errors.length === 0,

  // The production editor must be exactly as it was.
  "original editor still has rotate": legacy?.hasRotate === true,
  "original editor still has no text switch": legacy?.hasContentToggle === false,

  // The two requested changes.
  "PDFium editor has the text switch in the rail": engine?.hasContentToggle === true,
  "PDFium editor no longer offers rotate": engine?.hasRotate === false,

  // Nothing else moved.
  "both rails keep copy": legacy?.hasCopy === true && engine?.hasCopy === true,
  "both rails keep move": legacy?.hasMove === true && engine?.hasMove === true,
  "both rails keep delete": legacy?.hasDelete === true && engine?.hasDelete === true,
  "both rails keep add text": legacy?.hasAddText === true && engine?.hasAddText === true,
  "both rails keep add image": legacy?.hasAddImage === true && engine?.hasAddImage === true,

  // The switch is wired, not just drawn.
  "clicking the switch calls back": result.toggleFired === 1,
  "the switch reads ON when text boxes are on": result.togglePressedWhenTextOn === true,
  "the switch reads OFF when text boxes are off": result.togglePressedWhenTextOff === false,
}

console.log("\n=========== TOOL RAIL CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
