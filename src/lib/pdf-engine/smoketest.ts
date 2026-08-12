/**
 * Engine smoke test — proves the PDF engine actually works inside THIS app
 * (its Vite build, its worker setup, its asset paths), not just in the
 * standalone prototype it was developed in.
 *
 * Not wired into any route or bundled into the app: it is invoked from the
 * browser console during development, and by the automated check in
 * scripts/pdf-engine-smoketest.mjs. Kept in source (rather than as a test
 * file) so it type-checks against the real engine types on every build.
 *
 * Run manually with:
 *   const { runPdfEngineSmokeTest } = await import("/src/lib/pdf-engine/smoketest.ts")
 *   await runPdfEngineSmokeTest()
 */
import { PdfEngineClient } from "./client"

export interface SmokeTestResult {
  ok: boolean
  steps: string[]
  errors: string[]
  timings: Record<string, number>
  details: Record<string, unknown>
}

const SAMPLE_PDF_URL = "/dev-fixtures/Carnaby.pdf"

export async function runPdfEngineSmokeTest(pdfUrl = SAMPLE_PDF_URL): Promise<SmokeTestResult> {
  const steps: string[] = []
  const errors: string[] = []
  const timings: Record<string, number> = {}
  const details: Record<string, unknown> = {}
  const engine = new PdfEngineClient()
  let docId: string | null = null

  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = performance.now()
    const value = await fn()
    timings[name] = Math.round(performance.now() - t0)
    steps.push(`${name} (${timings[name]}ms)`)
    return value
  }

  try {
    const bytes = await step("fetch sample pdf", async () => {
      const res = await fetch(pdfUrl)
      if (!res.ok) throw new Error(`sample PDF not found at ${pdfUrl} (${res.status})`)
      return res.arrayBuffer()
    })
    // Captured BEFORE open(): that call transfers the buffer to the worker,
    // which detaches it here and makes byteLength read 0 afterwards.
    const originalSize = bytes.byteLength
    details.pdfBytes = originalSize

    const opened = await step("open in worker", () => engine.open(bytes))
    docId = opened.docId
    details.pageCount = opened.pages.length
    if (opened.pages.length === 0) errors.push("document reported zero pages")

    const rendered = await step("render page 0", () => engine.renderPage(opened.docId, 0, 1))
    details.rendered = { width: rendered.width, height: rendered.height }
    if (rendered.width < 1 || rendered.rgba.byteLength === 0) errors.push("render produced no pixels")

    const { lines } = await step("list text lines", () => engine.listTextLines(opened.docId, 0))
    details.textLines = lines.map((l) => l.text)
    if (lines.length === 0) errors.push("no text lines found on page 0")

    // Edit the heading — the exact case that used to lose letters, so a
    // clean result here is the strongest single signal.
    const heading = lines.findIndex((l) => l.text.trim() === "Carnaby")
    if (heading < 0) {
      errors.push(`expected a "Carnaby" heading, got: ${JSON.stringify(details.textLines)}`)
    } else {
      const edit = await step("edit text", () => engine.editTextLine(opened.docId, 0, heading, "Yash"))
      details.edit = edit
      if (!edit.ok) errors.push("edit reported failure")
    }

    const { images } = await step("list images", () => engine.listImages(opened.docId, 0))
    details.imageCount = images.length

    await step("add text overlay", () =>
      engine.addTextOverlay(opened.docId, 0, {
        text: "ENGINE OK", x: 40, y: 40, width: 200, fontSize: 14,
        color: { r: 0, g: 160, b: 90 },
      }),
    )

    const saved = await step("save", () => engine.save(opened.docId))
    details.savedBytes = saved.bytes.byteLength
    const header = new TextDecoder().decode(new Uint8Array(saved.bytes.slice(0, 5)))
    details.savedHeader = header
    if (header !== "%PDF-") errors.push(`saved output is not a PDF (header ${JSON.stringify(header)})`)
    // The whole point of the font-cache and content-stream batching: editing
    // must not inflate the file. Before those fixes a fully-edited catalogue
    // grew 34x, so anything beyond 1.5x here means a real regression.
    details.growth = Number((saved.bytes.byteLength / originalSize).toFixed(3))
    if (saved.bytes.byteLength > originalSize * 1.5) {
      errors.push(`saved file grew unexpectedly: ${originalSize} -> ${saved.bytes.byteLength}`)
    }

    // Reopen what we just saved and confirm the edit is really in the file.
    const reopened = await step("reopen saved output", () => engine.open(saved.bytes.slice(0)))
    const after = await step("verify text after reopen", () => engine.listTextLines(reopened.docId, 0))
    details.textAfterReopen = after.lines.map((l) => l.text)
    const joined = after.lines.map((l) => l.text).join(" ")
    if (!joined.includes("Yash")) errors.push("edited text missing after reopen")
    if (!joined.includes("ENGINE OK")) errors.push("overlay text missing after reopen")
    await engine.close(reopened.docId)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  } finally {
    if (docId) {
      try { await engine.close(docId) } catch { /* closing is best-effort */ }
    }
    engine.terminate()
  }

  return { ok: errors.length === 0, steps, errors, timings, details }
}
