/**
 * Where "expanded" lives as a URL, not a boolean.
 *
 * Full screen used to be a `useState` flag inside the editor: an overlay
 * toggled in place, with no URL of its own, gone on refresh and invisible
 * to the browser's Back button. It is now a real route — entering full
 * screen navigates to a distinct page, so Back, refresh and bookmarking all
 * behave the way they do everywhere else in the app.
 *
 * That does mean a remount. The open document — every unsaved edit — lives
 * only in the Web Worker the previous page held, so crossing between the
 * windowed and full-screen URLs reloads the template from scratch. Chosen
 * deliberately in exchange for a real page instead of a modal-shaped
 * overlay, rather than something overlooked.
 *
 * Kept as three pure functions, apart from the component, so the one thing
 * worth getting exactly right — which URL means which mode — can be checked
 * against exact strings rather than by driving a whole authenticated page
 * through the router.
 */

/** Segment appended to the windowed editor's URL to mean "full screen". */
const FULLSCREEN_SEGMENT = "/fullscreen"

export function windowedPath(templateId: string): string {
  return `/create-pdf/customize-v2/${templateId}`
}

export function fullscreenPath(templateId: string): string {
  return `${windowedPath(templateId)}${FULLSCREEN_SEGMENT}`
}

/** Whether a location means "show the full-screen shell". */
export function isFullscreenPath(pathname: string): boolean {
  return pathname.endsWith(FULLSCREEN_SEGMENT)
}
