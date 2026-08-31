import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ChevronDownIcon, ChevronUpIcon, ImageIcon, Loader2Icon,
  LayersIcon, ShapesIcon, TypeIcon, XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { EnginePageLayer } from "@/lib/pdf-engine"
import type { SlotSelection } from "./PdfEnginePageColumn"

/**
 * Everything on the page, in the order it is painted.
 *
 * A PDF has exactly one notion of layer: the list of drawing instructions,
 * carried out in order, so the last thing drawn is the thing on top. This
 * panel is a view of that list and nothing more — there are no layer groups
 * or hidden layers to offer, because a PDF cannot hold them.
 *
 * It earns its place by doing the one thing the page itself cannot: reaching
 * something that is buried. A logo dragged behind a full-bleed photo is
 * unclickable on the page — there is no pixel of it left to click — and
 * before this panel the only way back was undo. Here it is still a row, with
 * its name, and selecting the row selects the object.
 *
 * Top of the list is top of the page, which is the way every design tool
 * shows it. The engine works bottom-first because that is the page's own
 * order; the reversal happens once, in the worker.
 */

const PANEL_WIDTH_PX = 320

interface PdfLayersPanelProps {
  pageIndex: number
  /** Bumped by the document whenever anything changes, so the list reloads
   * after an edit made anywhere else. */
  revision: number
  loadLayers: (pageIndex: number) => Promise<EnginePageLayer[]>
  onReorder: (kind: "text" | "image" | "vector", index: number, toPosition: number) => void
  selection: SlotSelection
  onSelect: (selection: SlotSelection) => void
  onClose: () => void
}

export function PdfLayersPanel({
  pageIndex, revision, loadLayers, onReorder, selection, onSelect, onClose,
}: PdfLayersPanelProps) {
  const { t } = useTranslation()
  const [layers, setLayers] = useState<EnginePageLayer[] | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const refresh = useCallback(() => {
    let cancelled = false
    void loadLayers(pageIndex)
      .then((next) => { if (!cancelled) setLayers(next) })
      .catch(() => { if (!cancelled) setLayers([]) })
    return () => { cancelled = true }
  }, [loadLayers, pageIndex])

  // Reloaded on every document change, not just on open: an edit made on the
  // page adds, removes and renumbers layers, and a list showing the state
  // before that is worse than no list — it would select the wrong object.
  useEffect(() => refresh(), [refresh, revision])

  const move = (layer: EnginePageLayer, at: number, to: number) => {
    if (!layers || to < 0 || to >= layers.length || to === at) return
    onReorder(layer.kind, layer.index, to)
  }

  return (
    <aside
      data-pdf-layers-panel
      className="flex shrink-0 flex-col border-s bg-background"
      style={{ width: PANEL_WIDTH_PX }}
      aria-label={t("pdfTemplates.layersPanelTitle", "Layers")}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <LayersIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium">
          {t("pdfTemplates.layersPanelTitle", "Layers")}
        </span>
        <Button
          type="button" size="sm" variant="ghost"
          className="size-8 shrink-0 p-0"
          onClick={onClose}
          aria-label={t("pdfTemplates.layersPanelClose", "Close layers")}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <p className="shrink-0 border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {t("pdfTemplates.layersHint", "Page {{n}}. The top of this list is the front of the page.", { n: pageIndex + 1 })}
      </p>

      <div className="themed-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {layers === null && (
          <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {t("common.loading", "Loading...")}
          </p>
        )}
        {layers?.length === 0 && (
          <p className="py-4 text-xs text-muted-foreground">
            {t("pdfTemplates.layersEmpty", "Nothing editable on this page.")}
          </p>
        )}

        <ul>
          {layers?.map((layer, position) => {
            const selected = selection?.kind === layer.kind
              && selection.index === layer.index
              && selection.pageIndex === pageIndex
            return (
              <li
                key={`${layer.kind}-${layer.index}`}
                data-pdf-layer-row={position}
                draggable
                onDragStart={(e) => {
                  setDragFrom(position)
                  // A payload is required or Firefox refuses to start a drag,
                  // even though the position is tracked in state.
                  e.dataTransfer.setData("text/plain", String(position))
                  e.dataTransfer.effectAllowed = "move"
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  setDragOver(position)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragFrom
                  setDragFrom(null)
                  setDragOver(null)
                  if (from === null || from === position || !layers) return
                  onReorder(layers[from].kind, layers[from].index, position)
                }}
                onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
                className={`group flex items-center gap-1 rounded-md px-1 ${
                  dragOver === position && dragFrom !== position ? "bg-primary/10" : ""
                } ${dragFrom === position ? "opacity-50" : ""}`}
              >
                <button
                  type="button"
                  data-pdf-layer-select={`${layer.kind}-${layer.index}`}
                  onClick={() => onSelect({ pageIndex, kind: layer.kind, index: layer.index })}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${
                    selected ? "bg-muted font-medium" : ""
                  }`}
                >
                  <LayerIcon kind={layer.kind} />
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {layer.kind === "text"
                      ? (layer.text?.trim() || t("pdfTemplates.layerTextEmpty", "Text"))
                      : layer.kind === "image"
                        ? t("pdfTemplates.layerImage", "Picture")
                        : t("pdfTemplates.layerVector", "Artwork")}
                  </span>
                </button>
                {/* Buttons as well as dragging, and not only for tidiness:
                    dragging a row is unreachable from a keyboard, and moving
                    something one step is fiddly to do by drag in a long
                    list. */}
                <span className="flex shrink-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    type="button" size="sm" variant="ghost"
                    className="size-7 p-0"
                    disabled={position === 0}
                    onClick={() => move(layer, position, position - 1)}
                    aria-label={t("pdfTemplates.layerBringForward", "Bring forward")}
                    title={t("pdfTemplates.layerBringForward", "Bring forward")}
                  >
                    <ChevronUpIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button" size="sm" variant="ghost"
                    className="size-7 p-0"
                    disabled={position === (layers?.length ?? 1) - 1}
                    onClick={() => move(layer, position, position + 1)}
                    aria-label={t("pdfTemplates.layerSendBackward", "Send backward")}
                    title={t("pdfTemplates.layerSendBackward", "Send backward")}
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}

function LayerIcon({ kind }: { kind: EnginePageLayer["kind"] }) {
  const className = "size-3.5 shrink-0 text-muted-foreground"
  if (kind === "text") return <TypeIcon className={className} />
  if (kind === "image") return <ImageIcon className={className} />
  return <ShapesIcon className={className} />
}
