import type { EngineTextLine } from "@/lib/pdf-engine"
import type { PdfContentMode } from "../PdfEditorRail"
import { PdfEnginePage } from "./PdfEnginePage"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"
import type { CrossPageDragState } from "./useCrossPageDrag"

export type SlotSelection =
  { pageIndex: number; kind: "text" | "image" | "vector"; index: number } | null

/**
 * The column of pages, and everything that hangs off them.
 *
 * Extracted so the normal view and the full-screen view can show the SAME
 * pages without either owning a copy of this wiring. There are two dozen
 * props between the editor and a page; duplicating them for a second view
 * would guarantee the two drift apart, and a slot that behaved differently
 * depending on which view you happened to be in is exactly the kind of bug
 * nobody finds until a customer does.
 */
interface PdfEnginePageColumnProps {
  doc: UsePdfEngineDocumentResult
  /** CSS width every page is drawn at. The two views decide this
   * differently — one measures its panel, the other follows the zoom. */
  displayWidth: number
  /** Space held clear on the trailing edge, for a floating tool rail that
   * overlaps the column. Zero in full screen, which has no rail. */
  gutter: number
  columnRef?: React.Ref<HTMLDivElement>
  contentMode: PdfContentMode
  selection: SlotSelection
  onSelect: (selection: SlotSelection) => void
  drag: CrossPageDragState | null
  onMoveStart: React.ComponentProps<typeof PdfEnginePage>["onMoveStart"]
  originPatch: { pageIndex: number; kind: "text" | "image"; index: number; url: string } | null
  imagePreview: { pageIndex: number; index: number; url: string } | null
  onEditLine: (pageIndex: number, line: EngineTextLine) => void
  onReplaceImage: (pageIndex: number, imageIndex: number) => void
  onReplaceVector: (pageIndex: number, vectorIndex: number) => void
  onDropOnImage: (pageIndex: number, imageIndex: number, file: File) => void
  onDropOnPage: (pageIndex: number, file: File, xPts: number, yFromTopPts: number) => void
  onTransformImage: (
    pageIndex: number, imageIndex: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => void
  onResizeText: (pageIndex: number, lineIndex: number, fontSize: number, maxWidth: number) => void
}

export function PdfEnginePageColumn({
  doc, displayWidth, gutter, columnRef, contentMode, selection, onSelect,
  drag, onMoveStart, originPatch, imagePreview,
  onEditLine, onReplaceImage, onReplaceVector,
  onDropOnImage, onDropOnPage, onTransformImage, onResizeText,
}: PdfEnginePageColumnProps) {
  return (
    <div
      ref={columnRef}
      className="flex flex-col items-center gap-6"
      // Applied as padding rather than subtracted from the page width alone:
      // this column centres its pages, so a subtracted gutter gets split in
      // half and only half lands on the side the rail is on.
      style={{ paddingInlineEnd: gutter }}
    >
      {/* data-engine-page-index lives on the page SURFACE inside
          PdfEnginePage, not on these wrappers: a drop is converted using the
          target's rect, and a wrapper can be wider than the page it holds,
          which would offset every landing position. */}
      {doc.pages.map((page, index) => (
        <div key={`${index}-${page.rotation}`}>
          <PdfEnginePage
            page={page}
            pageIndex={index}
            displayWidth={displayWidth}
            text={doc.pageText[index]}
            images={doc.pageImages[index]}
            vectors={doc.pageVectors[index]}
            contentMode={contentMode}
            revision={doc.revision}
            renderPage={doc.renderPage}
            loadPageText={doc.loadPageText}
            loadPageImages={doc.loadPageImages}
            loadPageVectors={doc.loadPageVectors}
            onSelectLine={onEditLine}
            onReplaceImage={onReplaceImage}
            onReplaceVector={onReplaceVector}
            onDropOnImage={onDropOnImage}
            onDropOnPage={onDropOnPage}
            onTransformImage={onTransformImage}
            onResizeText={onResizeText}
            onMoveStart={onMoveStart}
            draggingSlot={drag ? { ...drag.item } : null}
            dropTargetPage={drag !== null && drag.targetPageIndex === index}
            imagePreviewUrl={imagePreview && imagePreview.pageIndex === index ? imagePreview : null}
            originPatchUrl={
              drag && originPatch
                && originPatch.pageIndex === drag.item.pageIndex
                && originPatch.kind === drag.item.kind
                && originPatch.index === drag.item.index
                ? originPatch.url
                : null
            }
            selection={selection}
            onSelect={onSelect}
          />
        </div>
      ))}
    </div>
  )
}
