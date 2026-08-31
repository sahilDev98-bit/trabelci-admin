import type { PdfRect } from "@/lib/pdf-engine"

/**
 * Which things on the page are locked against being moved.
 *
 * Locking exists for one situation: a full-bleed background photo that you
 * keep nudging while trying to grab the small logo sitting on top of it. Lock
 * the background and it stops being in the way.
 *
 * ── How a lock knows what it is attached to ──
 *
 * Not by index, which is the obvious choice and the wrong one. Every slot in
 * this editor is numbered by POSITION — the fifth text line, the second image
 * — and those numbers change constantly: adding a caption renumbers the lines
 * after it, deleting one renumbers the rest, reordering a layer renumbers
 * everything it passed. A lock keyed by index would silently transfer itself
 * to whatever object inherited the number, and the first sign of it would be
 * a background that moves and a logo that will not.
 *
 * So a lock is keyed by WHERE THE OBJECT IS. That is stable for exactly the
 * reason that matters: a locked object cannot be moved or resized, so its
 * rectangle cannot change while the lock is on it. Other objects moving
 * around it changes nothing.
 *
 * Two consequences, both acceptable and both better than the alternative:
 * deleting a locked object leaves a lock that matches nothing (harmless, and
 * it never matches anything else because the object is gone), and two objects
 * of the same kind sharing an identical rectangle would lock together — which
 * on a real page means two things drawn exactly on top of each other, where
 * treating them as one is arguably right anyway.
 *
 * ── What a lock is not ──
 *
 * It is not stored in the PDF. The format has nowhere to put it. Locks last
 * as long as the editing session and are forgotten when the file is closed,
 * and the interface says so rather than letting it be discovered later.
 */

export type LockKind = "text" | "image" | "vector"

/**
 * The identity of one lockable thing.
 *
 * Rounded to whole points because a rectangle read back from PDFium can
 * differ in the last decimal between calls, and a key that changes when
 * nothing changed would drop the lock at random.
 */
export function lockKeyFor(pageIndex: number, kind: LockKind, bbox: PdfRect | null): string | null {
  if (!bbox) return null
  const r = (n: number) => Math.round(n)
  return `${pageIndex}:${kind}:${r(bbox.left)},${r(bbox.bottom)},${r(bbox.right)},${r(bbox.top)}`
}

export type LockSet = ReadonlySet<string>

export function isLocked(locks: LockSet, key: string | null): boolean {
  return key !== null && locks.has(key)
}

/** Returns a NEW set — the caller holds this in React state, where mutating
 * the existing one would not re-render. */
export function toggleLock(locks: LockSet, key: string): Set<string> {
  const next = new Set(locks)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
