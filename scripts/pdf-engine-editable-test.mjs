/**
 * Can every piece of text on a page actually be edited, and can it stay that
 * way?
 *
 * Reported as "some text is not in the edit form": on one catalogue, text
 * that looked identical to its neighbours had no edit box at all. Two
 * properties are checked here, because between them they cover the ways a
 * page can end up with nothing clickable on it.
 *
 * ── The order things are asked for ──
 * The engine is one worker serving one request at a time in arrival order.
 * Drawing a page costs 252-590ms on the catalogue in question; listing
 * everything editable on it costs 0-8ms. Whichever is asked for first
 * decides whether a page is clickable the moment it appears or a second
 * later, and a second of a finished-looking page that ignores clicks is
 * indistinguishable from broken text.
 *
 * ── What happens when a request fails ──
 * Each of those lists is fetched once, when the page scrolls into view, and
 * nothing asks again. So a single failure used to leave that page with
 * nothing editable for the rest of the session — silently, with no error and
 * no way back but a reload. That is exactly the shape of the report.
 *
 *   npx vite --port 5174                             (one terminal)
 *   node scripts/pdf-engine-editable-test.mjs [baseUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const order = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/hotspotReadySelfTest.ts")
  return mod.runHotspotReadySelfTest()
})
const recovery = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/loadRecoverySelfTest.ts")
  return mod.runLoadRecoverySelfTest()
})
const visible = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/slotVisibilitySelfTest.ts")
  return mod.runSlotVisibilitySelfTest()
})
await browser.close()

const checks = {
  "no page errors": pageErrors.length === 0,
  "no internal errors":
    order.errors.length === 0 && recovery.errors.length === 0 && visible.errors.length === 0,

  // ---- and you can SEE what is editable ----
  "editable text is outlined strongly enough to see":
    visible.textAlpha > visible.previousAlpha,
  "so are editable images": visible.imageAlpha > visible.previousAlpha,
  "...and the reader returns nothing for something with no outline":
    visible.readsZeroForNoRing === true,
  "...and does read a ring it is given": visible.readsAlphaForAKnownRing >= 0.6,

  // ---- the small requests go first ----
  "enough pages came into view to build a queue": order.pagesMounted >= 3,
  "no page picture is asked for before a page's text":
    order.picturesAheadOfFirstText === 0 && order.picturesAheadOfLastText === 0,
  "every visible page is clickable almost immediately": order.msUntilAllClickable <= 200,
  "...and the old order really was slower, so this measures something":
    order.msUntilAllClickableOldOrder > order.msUntilAllClickable * 4,

  // ---- and a failure cannot leave a page dead ----
  "a request that fails twice still ends up loaded": recovery.slotsAfterFlakyLoad > 0,
  "a page whose request keeps failing starts empty": recovery.slotsWhenAlwaysFailing === 0,
  "...but clicking it brings its text back": recovery.slotsAfterClick > 0,
  "and a page that loaded is not re-requested on every click":
    recovery.attemptsAfterClickingALoadedPage === 0,
}

console.log("\n=========== EDITABLE-TEXT CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
if (!ok) {
  console.log("\norder:", JSON.stringify(order, null, 2))
  console.log("recovery:", JSON.stringify(recovery, null, 2))
  console.log("visibility:", JSON.stringify(visible, null, 2))
  if (pageErrors.length) console.log("page errors:", pageErrors.slice(0, 5))
} else {
  console.log(
    `\nclickable after ${order.msUntilAllClickable}ms of engine work`
    + ` against ${order.msUntilAllClickableOldOrder}ms if the picture went first`
    + `  |  outline ${visible.textAlpha} against ${visible.previousAlpha} before`,
  )
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
