// Does Shift-click actually build a group?
//
// It did not, and the reason is worth keeping. The rule lived inside a
// `setSelection` updater and called `setAlsoSelected` from in there. React
// runs updaters TWICE in StrictMode to expose impure ones, so the toggle ran
// twice on every Shift-click — add, then remove — and Shift-clicking appeared
// to do nothing whatsoever.
//
// The earlier drag test did not catch it because it supplied its own
// selection handler rather than the editor's. It proved the page REPORTED
// Shift correctly, which was true the whole time; the fault was in what the
// editor did with that report.
//
// So the rule is now a pure function, and this checks it two ways:
//
//   1. What it does, click by click.
//   2. That running it the way React runs an updater — twice on the same
//      input — gives the same answer both times. That is the exact property
//      the old code broke, and the one a test of the behaviour alone would
//      have missed.
import {
  applySelection, selectedSlots, EMPTY_SELECTION,
  type SelectedSlot, type SelectionState,
} from "./selectionOps"

export interface SelectionTestResult {
  errors: string[]
  afterPlainClick: string[]
  afterShiftSecond: string[]
  afterShiftThird: string[]
  afterShiftRemove: string[]
  afterPlainClickAgain: string[]
  afterShiftOnOtherPage: string[]
  afterShiftOnAnchor: string[]
  /** Applying the same click twice from the same starting point — what
   * StrictMode does to an updater. */
  doubleInvokeStable: boolean
}

const slot = (kind: SelectedSlot["kind"], index: number, pageIndex = 0): SelectedSlot =>
  ({ pageIndex, kind, index })
const names = (s: SelectionState) => selectedSlots(s).map((x) => `${x.kind}#${x.index}@${x.pageIndex}`)

export function runSelectionSelfTest(): SelectionTestResult {
  const out: SelectionTestResult = {
    errors: [], afterPlainClick: [], afterShiftSecond: [], afterShiftThird: [],
    afterShiftRemove: [], afterPlainClickAgain: [], afterShiftOnOtherPage: [],
    afterShiftOnAnchor: [], doubleInvokeStable: false,
  }

  // ── 1. Click by click ────────────────────────────────────────────────
  let state = applySelection(EMPTY_SELECTION, slot("image", 0), false)
  out.afterPlainClick = names(state)
  if (out.afterPlainClick.length !== 1) {
    out.errors.push(`a plain click gave ${out.afterPlainClick.length} selected, expected 1`)
  }

  state = applySelection(state, slot("text", 3), true)
  out.afterShiftSecond = names(state)
  if (out.afterShiftSecond.length !== 2) {
    out.errors.push(
      `Shift-clicking a second slot gave ${out.afterShiftSecond.length} selected,`
      + " expected 2 — this is the failure that made grouping look unimplemented")
  }

  state = applySelection(state, slot("vector", 1), true)
  out.afterShiftThird = names(state)
  if (out.afterShiftThird.length !== 3) {
    out.errors.push(`a third Shift-click gave ${out.afterShiftThird.length}, expected 3`)
  }

  // Shift-clicking one already in the group takes it back out.
  state = applySelection(state, slot("text", 3), true)
  out.afterShiftRemove = names(state)
  if (out.afterShiftRemove.length !== 2) {
    out.errors.push(`Shift-clicking a member again gave ${out.afterShiftRemove.length}, expected 2`)
  }
  if (out.afterShiftRemove.includes("text#3@0")) {
    out.errors.push("Shift-clicking a member again did not remove it")
  }

  // Shift on the ANCHOR leaves the group alone: removing it would leave the
  // others with nothing to be grouped around.
  const anchorState = applySelection(state, state.primary!, true)
  out.afterShiftOnAnchor = names(anchorState)
  if (out.afterShiftOnAnchor.length !== out.afterShiftRemove.length) {
    out.errors.push("Shift-clicking the anchor changed the group")
  }

  // A plain click clears everything — the control for all of the above. If
  // this did not reset, "it added one" would be indistinguishable from
  // "it never removes anything".
  state = applySelection(state, slot("image", 9), false)
  out.afterPlainClickAgain = names(state)
  if (out.afterPlainClickAgain.length !== 1) {
    out.errors.push(
      `a plain click after a group left ${out.afterPlainClickAgain.length} selected,`
      + " expected 1 — the selection never clears")
  }

  // A group cannot span pages: one movement cannot apply to two coordinate
  // spaces, so this starts a fresh selection rather than a group that could
  // not be moved.
  const across = applySelection(
    applySelection(EMPTY_SELECTION, slot("image", 0, 0), false),
    slot("image", 1, 4), true)
  out.afterShiftOnOtherPage = names(across)
  if (out.afterShiftOnOtherPage.length !== 1) {
    out.errors.push("Shift-clicking onto another page built a group spanning two pages")
  }

  // ── 2. The property the old code broke ───────────────────────────────
  // React invokes a state updater twice in StrictMode. Applying the same
  // click to the same starting state must give the same answer both times —
  // the old version toggled, so the second run undid the first.
  const base = applySelection(EMPTY_SELECTION, slot("image", 0), false)
  const once = names(applySelection(base, slot("text", 3), true))
  const twice = names(applySelection(base, slot("text", 3), true))
  out.doubleInvokeStable = JSON.stringify(once) === JSON.stringify(twice) && once.length === 2
  if (!out.doubleInvokeStable) {
    out.errors.push(
      `applying the same click twice gave ${JSON.stringify(once)} then ${JSON.stringify(twice)}`
      + " — this is exactly what StrictMode does, and what broke it before")
  }

  return out
}
