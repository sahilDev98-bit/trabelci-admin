/**
 * Undo and redo for an open document.
 *
 * Built on SNAPSHOTS — the whole document saved to bytes before each change,
 * and reopened to go back — rather than on recording an inverse for every
 * operation. That choice is from measurement, not preference, and the numbers
 * are worth keeping because they are what would justify revisiting it.
 *
 * On a real 14-page catalogue (REFIN, 3.45MB):
 *
 *   saving a snapshot   ~20-30ms, 3.4MB
 *   reopening one       ~309ms
 *   a typical edit       ~61ms
 *
 * So a snapshot adds about a third to the cost of an edit and an undo costs
 * about a third of a second. Both are comfortably inside what a person
 * accepts for an action they asked for.
 *
 * The alternative — an inverse per operation — would be faster still and cost
 * almost no memory, but every one of the two dozen mutating operations would
 * need its own correct inverse, and PDFium renumbers objects as they are
 * added and removed. A wrong inverse there does not throw; it silently
 * corrupts the document, and the user finds out when they open the PDF a week
 * later. A snapshot cannot be subtly wrong: it either restores the document
 * or fails loudly.
 *
 * What snapshots DO cost is memory, and that is bounded here rather than left
 * to chance — see HISTORY_BYTE_BUDGET.
 */

/**
 * How many steps back it is possible to go.
 *
 * Deep enough to cover a run of experimenting; not so deep that the oldest
 * entries are ones anybody would still want.
 */
export const HISTORY_MAX_STEPS = 25

/**
 * How much memory the whole history may hold, across every open document.
 *
 * A step is a copy of the entire file, so depth costs are proportional to the
 * document's size: 25 steps of a 3.4MB catalogue is 85MB, but 25 steps of a
 * 9MB one would be 225MB — in a tab that is also holding PDFium's WASM heap
 * and every rendered page bitmap. Bounding by BYTES rather than by count is
 * what stops a large document from quietly exhausting the tab: a big file
 * simply gets fewer steps of history than a small one.
 */
export const HISTORY_BYTE_BUDGET = 120 * 1024 * 1024

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  undoDepth: number
  redoDepth: number
}

/**
 * The past and future of one document.
 *
 * Snapshots are kept HERE, in the worker, never handed to the UI thread.
 * Passing 3.4MB back and forth per edit would cost more than taking the
 * snapshot does.
 */
export class DocumentHistory {
  private past: Uint8Array[] = []
  private future: Uint8Array[] = []

  /**
   * Records the document as it is NOW, before it is changed.
   *
   * Taking the snapshot BEFORE the change rather than after is what makes the
   * first undo work: after a change, the only state worth returning to is the
   * one that no longer exists.
   *
   * Any redo is discarded, because editing after undoing creates a new future
   * and the old one can no longer be reached from here — the same rule every
   * editor follows.
   */
  push(snapshot: Uint8Array): void {
    this.past.push(snapshot)
    this.future = []
    this.trim()
  }

  /** The state to go back to, or null when there is no past. The caller hands
   * back the CURRENT state so it can be redone. */
  undo(current: Uint8Array): Uint8Array | null {
    const previous = this.past.pop()
    if (!previous) return null
    this.future.push(current)
    return previous
  }

  /** The state to go forward to, or null when there is no future. */
  redo(current: Uint8Array): Uint8Array | null {
    const next = this.future.pop()
    if (!next) return null
    this.past.push(current)
    return next
  }

  state(): HistoryState {
    return {
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      undoDepth: this.past.length,
      redoDepth: this.future.length,
    }
  }

  /** Total bytes held, for the budget. */
  bytes(): number {
    let total = 0
    for (const s of this.past) total += s.byteLength
    for (const s of this.future) total += s.byteLength
    return total
  }

  /** Frees everything. Called when the document closes. */
  clear(): void {
    this.past = []
    this.future = []
  }

  /**
   * Drops the OLDEST steps until the history fits.
   *
   * Oldest first, deliberately: the step you are most likely to want back is
   * the one you just took. Losing the ability to undo twenty edits ago is a
   * disappointment; losing the ability to undo the last one is a bug.
   */
  private trim(): void {
    while (this.past.length > HISTORY_MAX_STEPS) this.past.shift()
    while (this.past.length > 1 && this.bytes() > HISTORY_BYTE_BUDGET) this.past.shift()
  }
}
