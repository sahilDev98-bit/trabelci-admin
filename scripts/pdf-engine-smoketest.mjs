/**
 * Runs the PDF engine smoke test in a real headless Chromium against the
 * app's own Vite dev server, and exits non-zero if anything failed.
 *
 * This exists because the engine's correctness depends on things only a
 * real browser exercises — module workers, WASM instantiation, transferable
 * ArrayBuffers, canvas ImageData — none of which a type-check or a Node
 * script can vouch for.
 *
 * It drives /pdf-engine-smoketest.html rather than the app itself: loading
 * the admin SPA runs its auth guard, which redirects and tears down the
 * page context mid-test.
 *
 * Requires Playwright, which is deliberately NOT a dependency of this app —
 * it is a verification tool, not something the product ships:
 *
 *   cp <a real catalogue>.pdf dev-fixtures/Carnaby.pdf      (once)
 *   npx vite --port 5174                                    (one terminal)
 *   npx --yes playwright@1.62.1 install chromium            (once)
 *   node scripts/pdf-engine-smoketest.mjs [baseUrl] [pdfUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"
const PDF_URL = process.argv[3] ?? "/dev-fixtures/Carnaby.pdf"
const url = `${BASE.replace(/\/$/, "")}/pdf-engine-smoketest.html?pdf=${encodeURIComponent(PDF_URL)}`

const browser = await chromium.launch()
const page = await browser.newPage()

const consoleErrors = []
const pageErrors = []
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })
page.on("pageerror", (e) => pageErrors.push(String(e)))

console.log(`Opening ${url} …`)
await page.goto(url, { waitUntil: "domcontentloaded" })
await page.waitForFunction(() => window.__SMOKE_DONE__ === true, null, { timeout: 180_000 })
const result = await page.evaluate(() => window.__SMOKE_RESULT__)

console.log("\n=========== PDF ENGINE SMOKE TEST ===========")
console.log("steps:")
for (const s of result.steps) console.log(`  - ${s}`)
console.log("\ndetails:", JSON.stringify(result.details, null, 2))
if (result.errors.length) console.log("\nERRORS:", result.errors)
if (pageErrors.length) console.log("\nPAGE ERRORS:", pageErrors)
if (consoleErrors.length) console.log("\nCONSOLE ERRORS:", consoleErrors)

await browser.close()

const checks = {
  "engine reported ok": result.ok === true,
  "no page errors": pageErrors.length === 0,
  "document opened with pages": (result.details.pageCount ?? 0) > 0,
  "page rendered": !!result.details.rendered,
  "text lines found": Array.isArray(result.details.textLines) && result.details.textLines.length > 0,
  "saved a real PDF": result.details.savedHeader === "%PDF-",
  "edit present after reopen": Array.isArray(result.details.textAfterReopen)
    && result.details.textAfterReopen.join(" ").includes("Yash"),
  "overlay present after reopen": Array.isArray(result.details.textAfterReopen)
    && result.details.textAfterReopen.join(" ").includes("ENGINE OK"),
}

console.log("\n=========== CHECKS ===========")
let allPass = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) allPass = false
}
console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(allPass ? 0 : 1)
