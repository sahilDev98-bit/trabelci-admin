/**
 * What clicking a slot does to the selection.
 *
 * A pure function, and that is the whole point of it existing. The first
 * version of this rule lived inside a `setSelection` updater and called
 * `setAlsoSelected` from in there. React runs updaters TWICE in StrictMode
 * precisely to expose that — an updater must be pure — so the toggle ran
 * twice on every Shift-click: the slot was added and then removed again, and
 * Shift-clicking appeared to do nothing at all.
 *
 * Nothing here touches React. It takes the selection as it is, returns the
 * selection as it should be, and the component sets both pieces of state from
 * the result in one go.
 */

export interface SelectedSlot {
  pageIndex: number
  kind: "text" | "image" | "vector"
  index: number
}

export interface SelectionState {
  /** The one the toolbar acts on, and the anchor of a group. */
  primary: SelectedSlot | null
  /** Everything Shift-clicked alongside it. */
  also: SelectedSlot[]
}

export const EMPTY_SELECTION: SelectionState = { primary: null, also: [] }

export function sameSlot(a: SelectedSlot, b: SelectedSlot): boolean {
  return a.pageIndex === b.pageIndex && a.kind === b.kind && a.index === b.index
}

/**
 * Apply one click.
 *
 * Plain click replaces everything. Shift adds — or removes, if that slot was
 * already in the group, which is the only way to correct a mis-click without
 * starting again.
 *
 * A group is confined to ONE page. Two pages have their own coordinate
 * spaces, so a single movement cannot be applied to slots on both; a
 * Shift-click onto another page therefore starts a fresh selection there
 * rather than silently building a group that could not be moved.
 */
export function applySelection(
  current: SelectionState,
  next: SelectedSlot | null,
  additive: boolean,
): SelectionState {
  if (!next) return EMPTY_SELECTION
  if (!additive) return { primary: next, also: [] }
  if (!current.primary) return { primary: next, also: [] }
  if (current.primary.pageIndex !== next.pageIndex) return { primary: next, also: [] }

  // Shift-clicking the anchor itself: leave the group alone. Removing the
  // anchor would leave the others with nothing to be grouped around.
  if (sameSlot(current.primary, next)) return current

  const already = current.also.some((s) => sameSlot(s, next))
  return {
    primary: current.primary,
    also: already
      ? current.also.filter((s) => !sameSlot(s, next))
      : [...current.also, next],
  }
}

/** Everything being acted on, anchor first. */
export function selectedSlots(state: SelectionState): SelectedSlot[] {
  return state.primary ? [state.primary, ...state.also] : []
}
