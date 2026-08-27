/**
 * Dragging something out of the asset library and onto a page.
 *
 * The page already accepts images dragged in from the operating system, which
 * arrive as real files on the drag event. An asset from the library is not a
 * file — it lives on the server — so it travels as an id instead, and the
 * editor fetches the bytes once it knows where it landed.
 *
 * Both halves of that contract live here so the panel that writes the payload
 * and the page that reads it cannot drift apart.
 */

/**
 * A custom MIME type, not "text/plain".
 *
 * Two reasons. It keeps the page from mistaking a dragged word or link for an
 * asset — the payload is an id like "12", which as plain text is indis-
 * tinguishable from someone dragging a number out of a spreadsheet. And a
 * browser will not let a page READ text/plain during dragover, only on drop,
 * so the page could not decide whether to light up as a drop target until it
 * was too late to matter. Custom types ARE listed during dragover.
 */
export const ASSET_DRAG_MIME = "application/x-trabelci-pdf-asset"

/** Attach an asset to a drag that is starting. */
export function setAssetDragData(dataTransfer: DataTransfer, assetId: string): void {
  dataTransfer.setData(ASSET_DRAG_MIME, assetId)
  // A plain-text copy as well, so dragging an asset into a text field or
  // another application does something harmless and legible rather than
  // nothing at all.
  dataTransfer.setData("text/plain", assetId)
  dataTransfer.effectAllowed = "copy"
}

/**
 * Whether a drag in flight is carrying a library asset.
 *
 * Reads the TYPE LIST rather than the data, because during dragenter/dragover
 * the browser refuses to hand over drag data at all — only the list of types
 * is readable. This is what lets a page decide to show itself as a drop
 * target while the pointer is still moving.
 */
export function dragCarriesAsset(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types ?? []).includes(ASSET_DRAG_MIME)
}

/** The asset id from a completed drop, or null if it carried none. */
export function assetIdFromDrag(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return null
  const raw = dataTransfer.getData(ASSET_DRAG_MIME)
  const id = raw?.trim()
  return id ? id : null
}
