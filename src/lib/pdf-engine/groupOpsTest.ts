/**
 * Do the group operations act on the things that were actually selected?
 *
 * This is the one question worth real effort here, because the failure is
 * SILENT and it damages the user's document. A slot index is a POSITION, so
 * removing or moving one object renumbers the others. Deleting three
 * selected things by the numbers read beforehand deletes the first, and then
 * whatever has since inherited the second's number — a different object,
 * removed with no error, on a page the user is looking at.
 *
 * So each test below is paired with the number a NAIVE implementation would
 * have hit, and asserts that object is still there. Without that pairing,
 * "the two I asked for are gone" passes for both the correct code and the
 * broken code, since the broken one also removes two things.
 *
 * Run against the real sample catalogue through the real worker: this is
 * PDFium's behaviour being tested, and a mock of it would be a mock of my own
 * assumptions.
 */
import { PdfEngineClient } from "./client"

const SAMPLE_PDF_URL = "/dev-fixtures/Carnaby.pdf"

export interface GroupOpsTestResult {
  ok: boolean
  errors: string[]
  before: string[]
  afterDelete: string[]
  /** The two the test asked to remove. */
  requested: string[]
  /** What a naive one-at-a-time delete would have destroyed instead. This
   * must SURVIVE. */
  naiveVictim: string | null
  naiveVictimSurvived: boolean
  /** Group rotate: does the selection turn as one shape? */
  groupCentreBefore: string | null
  groupCentreAfter: string | null
  groupBoxSwapped: boolean
  aMemberSwungRoundTheGroup: boolean
}

const centre = (b: { left: number; bottom: number; right: number; top: number }) =>
  ({ x: (b.left + b.right) / 2, y: (b.bottom + b.top) / 2 })

const union = (boxes: { left: number; bottom: number; right: number; top: number }[]) => ({
  left: Math.min(...boxes.map((b) => b.left)),
  bottom: Math.min(...boxes.map((b) => b.bottom)),
  right: Math.max(...boxes.map((b) => b.right)),
  top: Math.max(...boxes.map((b) => b.top)),
})

export async function runGroupOpsTest(pdfUrl = SAMPLE_PDF_URL): Promise<GroupOpsTestResult> {
  const out: GroupOpsTestResult = {
    ok: false, errors: [], before: [], afterDelete: [], requested: [],
    naiveVictim: null, naiveVictimSurvived: false,
    groupCentreBefore: null, groupCentreAfter: null,
    groupBoxSwapped: false, aMemberSwungRoundTheGroup: false,
  }
  const engine = new PdfEngineClient()
  let docId: string | null = null

  try {
    const res = await fetch(pdfUrl)
    if (!res.ok) throw new Error(`sample PDF not found at ${pdfUrl} (${res.status})`)
    const opened = await engine.open(await res.arrayBuffer())
    docId = opened.docId

    // ── Group delete ─────────────────────────────────────────────────
    // A page with enough text that the naive bug has somewhere to land.
    let pageIndex = -1
    let lines: { text: string }[] = []
    for (let i = 0; i < opened.pages.length; i++) {
      const listed = await engine.listTextLines(docId, i)
      if (listed.lines.length >= 4) { pageIndex = i; lines = listed.lines; break }
    }
    if (pageIndex < 0) throw new Error("no page in the sample has 4+ text lines to test with")

    out.before = lines.map((l) => l.text)

    // Two NON-ADJACENT lines. Adjacent ones would not distinguish the correct
    // code from the broken code — the off-by-one only shows up with a gap.
    const targets = [0, 2]
    out.requested = targets.map((i) => lines[i].text)
    // After removing 0, everything shifts down one, so a naive second call
    // using index 2 would hit what is currently index 3.
    out.naiveVictim = lines[3]?.text ?? null

    await engine.removeSlots(docId, pageIndex, targets.map((index) => ({ kind: "text" as const, index })))

    const after = await engine.listTextLines(docId, pageIndex)
    out.afterDelete = after.lines.map((l) => l.text)

    for (const text of out.requested) {
      if (out.afterDelete.includes(text)) {
        out.errors.push(`"${text}" was selected for deletion but is still on the page`)
      }
    }
    // THE control. If this fails, the batch call is behaving like the naive
    // loop and is destroying objects nobody selected.
    out.naiveVictimSurvived = out.naiveVictim !== null && out.afterDelete.includes(out.naiveVictim)
    if (!out.naiveVictimSurvived) {
      out.errors.push(
        `"${out.naiveVictim}" was NOT selected but is gone — the delete is using`
        + " stale indices and removing the wrong objects")
    }
    if (out.afterDelete.length !== out.before.length - 2) {
      out.errors.push(
        `the page had ${out.before.length} lines and now has ${out.afterDelete.length};`
        + " expected exactly two fewer")
    }

    // ── Group rotate ─────────────────────────────────────────────────
    // Two lines again, on whatever survived.
    const fresh = await engine.listTextLines(docId, pageIndex)
    if (fresh.lines.length < 2) throw new Error("not enough text left to test rotating a group")
    const rotateTargets = [0, 1]
    const boxesBefore = rotateTargets.map((i) => fresh.lines[i].bbox)
    const groupBefore = union(boxesBefore)
    const memberCentreBefore = centre(boxesBefore[0])
    out.groupCentreBefore = `${centre(groupBefore).x.toFixed(1)},${centre(groupBefore).y.toFixed(1)}`

    await engine.transformSlots(
      docId, pageIndex,
      rotateTargets.map((index) => ({ kind: "text" as const, index })),
      "rotate-left",
    )

    const rotated = await engine.listTextLines(docId, pageIndex)
    // The lines have been renumbered by the turn, so they are found by their
    // words rather than by the numbers they used to have.
    const boxesAfter = rotateTargets
      .map((i) => rotated.lines.find((l) => l.text === fresh.lines[i].text)?.bbox)
      .filter((b): b is NonNullable<typeof b> => !!b)
    if (boxesAfter.length !== rotateTargets.length) {
      out.errors.push("a rotated line could not be found again by its text")
    } else {
      const groupAfter = union(boxesAfter)
      out.groupCentreAfter = `${centre(groupAfter).x.toFixed(1)},${centre(groupAfter).y.toFixed(1)}`

      // Turned as ONE shape: the selection's overall centre stays put, and
      // its overall box swaps width for height.
      const movedCentre = Math.hypot(
        centre(groupAfter).x - centre(groupBefore).x,
        centre(groupAfter).y - centre(groupBefore).y)
      if (movedCentre > 2) {
        out.errors.push(
          `the group's centre moved ${movedCentre.toFixed(1)}pt — a rotation should turn it in place`)
      }
      const wBefore = groupBefore.right - groupBefore.left
      const hBefore = groupBefore.top - groupBefore.bottom
      const wAfter = groupAfter.right - groupAfter.left
      const hAfter = groupAfter.top - groupAfter.bottom
      out.groupBoxSwapped = Math.abs(wAfter - hBefore) < 2 && Math.abs(hAfter - wBefore) < 2
      if (!out.groupBoxSwapped) {
        out.errors.push(
          `the group's box went ${wBefore.toFixed(0)}x${hBefore.toFixed(0)} ->`
          + ` ${wAfter.toFixed(0)}x${hAfter.toFixed(0)}; a quarter turn should swap them`)
      }

      // The control that separates "the group turned as one" from "each item
      // spun on its own centre": if each spun in place, every member's own
      // centre would be unchanged. At least one must have MOVED.
      const memberMoved = Math.hypot(
        centre(boxesAfter[0]).x - memberCentreBefore.x,
        centre(boxesAfter[0]).y - memberCentreBefore.y)
      out.aMemberSwungRoundTheGroup = memberMoved > 2
      if (!out.aMemberSwungRoundTheGroup) {
        out.errors.push(
          "no member moved relative to the others — each item turned on its own"
          + " centre instead of the group turning as one shape")
      }
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    if (docId) { try { await engine.close(docId) } catch { /* closing is best effort */ } }
    engine.terminate?.()
  }

  out.ok = out.errors.length === 0
  return out
}

/**
 * Demonstrates the bug the batch call exists to prevent.
 *
 * The test above asserts that an unselected line SURVIVES. That assertion is
 * only worth something if the naive approach would really have destroyed it,
 * so this does the naive thing — remove index 0, then index 2, one call at a
 * time, exactly as a loop in the editor would — and reports what actually
 * disappeared. If this does NOT destroy the wrong line, the control above is
 * proving nothing and should be rewritten.
 */
export async function runNaiveDeleteDemo(pdfUrl = SAMPLE_PDF_URL): Promise<{
  before: string[]; after: string[]; requested: string[]; destroyedUnselected: string[]
}> {
  const engine = new PdfEngineClient()
  let docId: string | null = null
  try {
    const res = await fetch(pdfUrl)
    const opened = await engine.open(await res.arrayBuffer())
    docId = opened.docId

    let pageIndex = -1
    let lines: { text: string }[] = []
    for (let i = 0; i < opened.pages.length; i++) {
      const listed = await engine.listTextLines(docId, i)
      if (listed.lines.length >= 4) { pageIndex = i; lines = listed.lines; break }
    }
    const before = lines.map((l) => l.text)
    const requested = [before[0], before[2]]

    // The naive loop: the same two indices, one call after the other.
    await engine.removeTextLine(docId, pageIndex, 0)
    await engine.removeTextLine(docId, pageIndex, 2)

    const after = (await engine.listTextLines(docId, pageIndex)).lines.map((l) => l.text)
    const destroyedUnselected = before.filter((t) => !requested.includes(t) && !after.includes(t))
    return { before, after, requested, destroyedUnselected }
  } finally {
    if (docId) { try { await engine.close(docId) } catch { /* best effort */ } }
    engine.terminate?.()
  }
}

/**
 * Does a group survive being operated on?
 *
 * The complaint this answers: after rotating a group it deselected itself, so
 * rotating twice meant re-selecting everything in between. The fix is that
 * the engine reports where the objects ended up.
 *
 * The check that actually matters is not "something is still selected" — it
 * is that the reported slots are THE SAME OBJECTS. A stale or invented index
 * would also be "still selected", and would then apply the next operation to
 * whatever had taken that number, which is worse than deselecting.
 *
 * So the objects are identified by their TEXT across the operation, and the
 * indices that come back are looked up to confirm they name those same words.
 */
export interface SelectionSurvivalResult {
  ok: boolean
  errors: string[]
  selectedBefore: string[]
  reportedAfterRotate: string[]
  reportedAfterMove: string[]
  /** Rotating twice in a row without re-selecting — the actual complaint. */
  rotatedTwice: boolean
  /** Copying keeps the ORIGINALS selected, so the group can be copied again. */
  reportedAfterDuplicate: string[]
  lineCountAfterDuplicate: number
  boxAfterTwoTurns: string | null
  boxAfterOneTurn: string | null
}

export async function runSelectionSurvivalTest(
  pdfUrl = SAMPLE_PDF_URL,
): Promise<SelectionSurvivalResult> {
  const out: SelectionSurvivalResult = {
    ok: false, errors: [], selectedBefore: [], reportedAfterRotate: [],
    reportedAfterMove: [], rotatedTwice: false,
    reportedAfterDuplicate: [], lineCountAfterDuplicate: 0,
    boxAfterTwoTurns: null, boxAfterOneTurn: null,
  }
  const engine = new PdfEngineClient()
  let docId: string | null = null

  try {
    const res = await fetch(pdfUrl)
    const opened = await engine.open(await res.arrayBuffer())
    docId = opened.docId

    let pageIndex = -1
    let lines: { text: string }[] = []
    for (let i = 0; i < opened.pages.length; i++) {
      const listed = await engine.listTextLines(docId, i)
      if (listed.lines.length >= 3) { pageIndex = i; lines = listed.lines; break }
    }
    if (pageIndex < 0) throw new Error("no page with 3+ text lines")

    const chosen = [0, 1]
    out.selectedBefore = chosen.map((i) => lines[i].text)

    // ── Rotate, and see what comes back ──────────────────────────────
    const turned = await engine.transformSlots(
      docId, pageIndex, chosen.map((index) => ({ kind: "text" as const, index })), "rotate-left")

    if ((turned.slots ?? []).length !== chosen.length) {
      out.errors.push(
        `rotating ${chosen.length} things reported ${(turned.slots ?? []).length} back —`
        + " the selection cannot follow them and will be cleared")
    }

    const afterRotate = await engine.listTextLines(docId, pageIndex)
    out.reportedAfterRotate = (turned.slots ?? [])
      .map((s) => afterRotate.lines[s.index]?.text ?? `<no line at ${s.index}>`)

    // THE check. The reported numbers must name the same words. If they name
    // something else, the selection is now pointing at objects the user never
    // chose — and the next rotate would turn those instead.
    for (const text of out.selectedBefore) {
      if (!out.reportedAfterRotate.includes(text)) {
        out.errors.push(
          `"${text}" was selected and rotated, but the selection now points at`
          + ` ${JSON.stringify(out.reportedAfterRotate)}`)
      }
    }

    const boxOnce = afterRotate.lines[turned.slots[0].index]?.bbox
    out.boxAfterOneTurn = boxOnce ? `${boxOnce.left.toFixed(0)},${boxOnce.bottom.toFixed(0)}` : null

    // ── Rotate AGAIN using only what came back ───────────────────────
    // No re-selecting in between: this is exactly what the user could not do.
    const twice = await engine.transformSlots(docId, pageIndex, turned.slots, "rotate-left")
    const afterTwice = await engine.listTextLines(docId, pageIndex)
    const namesAfterTwice = (twice.slots ?? [])
      .map((s) => afterTwice.lines[s.index]?.text ?? "<missing>")
    out.rotatedTwice = out.selectedBefore.every((t) => namesAfterTwice.includes(t))
    if (!out.rotatedTwice) {
      out.errors.push(
        `after a second rotate the selection names ${JSON.stringify(namesAfterTwice)},`
        + ` expected ${JSON.stringify(out.selectedBefore)}`)
    }

    const boxTwice = afterTwice.lines[twice.slots[0]?.index]?.bbox
    out.boxAfterTwoTurns = boxTwice ? `${boxTwice.left.toFixed(0)},${boxTwice.bottom.toFixed(0)}` : null
    // Two quarter-turns is a half-turn, so it must have actually moved again
    // rather than the second call quietly doing nothing.
    if (out.boxAfterOneTurn === out.boxAfterTwoTurns) {
      out.errors.push("the second rotate changed nothing — it did not act on the reported slots")
    }

    // ── And the same for moving ──────────────────────────────────────
    const moved = await engine.translateSlots(docId, pageIndex, twice.slots, 10, -10)
    const afterMove = await engine.listTextLines(docId, pageIndex)
    out.reportedAfterMove = (moved.slots ?? [])
      .map((s) => afterMove.lines[s.index]?.text ?? `<no line at ${s.index}>`)
    for (const text of out.selectedBefore) {
      if (!out.reportedAfterMove.includes(text)) {
        out.errors.push(
          `after moving the group, the selection points at`
          + ` ${JSON.stringify(out.reportedAfterMove)} instead of the things that moved`)
      }
    }
    // ── And for copying ─────────────────────────────────────────────
    // The originals must stay selected: that is what lets a group be copied
    // twice, or dragged away leaving the copies behind.
    const before = (await engine.listTextLines(docId, pageIndex)).lines.length
    const duplicated = await engine.duplicateSlots(docId, pageIndex, moved.slots)
    const afterDup = await engine.listTextLines(docId, pageIndex)
    out.lineCountAfterDuplicate = afterDup.lines.length
    out.reportedAfterDuplicate = (duplicated.slots ?? [])
      .map((s) => afterDup.lines[s.index]?.text ?? `<no line at ${s.index}>`)

    if (out.lineCountAfterDuplicate !== before + moved.slots.length) {
      out.errors.push(
        `copying ${moved.slots.length} lines took the page from ${before} to`
        + ` ${out.lineCountAfterDuplicate}; expected ${before + moved.slots.length}`)
    }
    for (const text of out.selectedBefore) {
      if (!out.reportedAfterDuplicate.includes(text)) {
        out.errors.push(
          `after copying, the selection points at ${JSON.stringify(out.reportedAfterDuplicate)}`
          + ` instead of the originals ${JSON.stringify(out.selectedBefore)}`)
      }
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    if (docId) { try { await engine.close(docId) } catch { /* best effort */ } }
    engine.terminate?.()
  }

  out.ok = out.errors.length === 0
  return out
}
