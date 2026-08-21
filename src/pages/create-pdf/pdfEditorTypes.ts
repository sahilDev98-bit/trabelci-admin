// The two vocabularies the PDF editor and the page organiser share.
//
// They lived in PdfEditorRail.tsx while that floating tool rail existed. The
// rail is gone — the editor now fills the page and its tools sit in a real
// toolbar — but these types were never about the rail, and burying shared
// vocabulary inside a component is what made deleting that component harder
// than it should have been.

/**
 * The one job the page organiser dialog is opened to do. Each is a separate
 * entry point on purpose: opening the dialog for "delete" means deleting is
 * the ONLY thing it does there. A single panel that could delete, rotate,
 * copy and move all at once is exactly where a mis-click turns into an
 * accidental edit, so the tool you picked is the tool you get.
 */
export type PdfOrganizerMode = "copy" | "move" | "rotate" | "delete"

/**
 * What clicking on the page itself does.
 *
 * The editor stacks text above images, so a photo sitting under a caption is
 * only reachable once the text layer is switched off — which is what this
 * chooses between. Page arranging is not one of the options: that happens
 * entirely inside the organiser dialog, so the main view never goes
 * half-disabled.
 */
export type PdfContentMode = "text" | "images"
