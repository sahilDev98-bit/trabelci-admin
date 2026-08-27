import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ImagePlusIcon, Loader2Icon, LibraryIcon, Trash2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  useCreatePdfAssetMutation, useDeletePdfAssetMutation, usePdfAssetsQuery,
} from "@/features/pdfAssets/api"
import { type PdfAsset } from "@/features/pdfAssets/types"
import { readImageSize, toEmbeddableImage } from "./imageFile"
import { setAssetDragData } from "./assetDrag"

/**
 * The asset library: the company's logos, icons and badges, kept once on the
 * server and reachable from every catalogue.
 *
 * It replaces "the logos are in a folder on whoever made the last catalogue's
 * laptop", which worked exactly as long as that was one person. What it buys
 * is that everyone reaches the same shelf and there is ONE current version of
 * each logo.
 *
 * Two ways to use an asset, on purpose. Dragging it onto the page is the
 * gesture the brief asks for and puts it exactly where you want; clicking it
 * drops it on the page in view, which is faster when the position is going to
 * be adjusted anyway and is the only route available from a keyboard.
 *
 * Everything on the shelf is shown, always. A search box and category filters
 * were built first and then taken out: a brand library is a couple of dozen
 * tiles you can see all at once, so filtering it cost two rows of chrome at
 * the top of the panel to solve a problem nobody had. The controls come back
 * when the shelf is big enough to need them, not before.
 */

/** Panel width, matching the product panel on the other side so the document
 * sits centred when both are open. */
const PANEL_WIDTH_PX = 320

interface PdfAssetPanelProps {
  /** Place an asset on the page currently in view. */
  onPlaceAsset: (asset: PdfAsset) => void
  onClose: () => void
}

export function PdfAssetPanel({ onPlaceAsset, onClose }: PdfAssetPanelProps) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const query = usePdfAssetsQuery()
  const createAsset = useCreatePdfAssetMutation()
  const deleteAsset = useDeletePdfAssetMutation()

  const assets = query.data ?? []

  /**
   * Take files from the picker or from a drop onto the panel and store them.
   *
   * Converted to PNG or JPEG here, in the browser, before they are sent. That
   * is what makes an SVG logo work: the library only ever holds formats PDFium
   * can embed directly, so placing an asset later needs no conversion and
   * cannot fail on a format. It reuses the same converter the editor uses for
   * files dragged off the desktop, so the two cannot disagree.
   */
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    let saved = 0
    try {
      for (const file of files) {
        try {
          const [{ width, height }, embeddable] = await Promise.all([
            readImageSize(file),
            toEmbeddableImage(file),
          ])
          const type = embeddable.kind === "jpeg" ? "image/jpeg" : "image/png"
          const converted = new File(
            [embeddable.bytes],
            file.name.replace(/\.[^.]+$/, "") + (embeddable.kind === "jpeg" ? ".jpg" : ".png"),
            { type },
          )
          await createAsset.mutateAsync({
            file: converted,
            name: file.name.replace(/\.[^.]+$/, ""),
            // No category is chosen in the panel any more, so everything
            // lands under "other". The column and the API filter are still
            // there for the supplier grouping that comes next.
            category: "other",
            widthPx: width,
            heightPx: height,
          })
          saved += 1
        } catch (err) {
          // Reported per file rather than abandoning the batch: dropping ten
          // logos and losing all of them because the third was a PDF would be
          // worse than being told which one failed.
          toast.error(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (saved > 0) {
        toast.success(t("pdfTemplates.assetUploaded", "{{count}} asset added", { count: saved }))
      }
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (asset: PdfAsset) => {
    // Two clicks rather than a dialog. This is a shared library, so a delete
    // affects everyone — but PDFs already made keep their copy of the picture,
    // so it cannot damage past work and does not warrant a modal.
    if (pendingDelete !== asset.id) {
      setPendingDelete(asset.id)
      window.setTimeout(() => setPendingDelete((id) => (id === asset.id ? null : id)), 4000)
      return
    }
    setPendingDelete(null)
    try {
      await deleteAsset.mutateAsync(asset.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const [dropping, setDropping] = useState(false)

  return (
    <aside
      data-pdf-asset-panel
      // border-e: this panel sits at the START of the row, so its border is on
      // its END side — and both flip under Hebrew.
      className="flex shrink-0 flex-col border-e bg-background"
      style={{ width: PANEL_WIDTH_PX }}
      aria-label={t("pdfTemplates.assetPanelTitle", "Asset library")}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <LibraryIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium">
          {t("pdfTemplates.assetPanelTitle", "Asset library")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-8 shrink-0 p-0"
          onClick={onClose}
          aria-label={t("pdfTemplates.assetPanelClose", "Close asset library")}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* ── The shelf ──────────────────────────────────────────────────── */}
      <div
        className={`themed-scrollbar min-h-0 flex-1 overflow-y-auto p-3 ${
          dropping ? "bg-muted/60 ring-2 ring-inset ring-emerald-500" : ""
        }`}
        onDragEnter={(e) => {
          if (!Array.from(e.dataTransfer.items ?? []).some((i) => i.kind === "file")) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.items ?? []).some((i) => i.kind === "file")) return
          // Both are required, or the browser refuses the drop and opens the
          // image in a new tab instead.
          e.preventDefault()
          e.dataTransfer.dropEffect = "copy"
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDropping(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDropping(false)
          void uploadFiles(Array.from(e.dataTransfer.files ?? []))
        }}
      >
        {query.isLoading && (
          <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {t("common.loading", "Loading...")}
          </p>
        )}
        {query.isError && !query.isLoading && (
          <p className="py-4 text-xs text-destructive">
            {t("pdfTemplates.assetLoadFailed", "Could not load the asset library.")}
          </p>
        )}
        {!query.isLoading && !query.isError && assets.length === 0 && (
          <p className="py-4 text-xs text-muted-foreground">
            {t("pdfTemplates.assetEmpty", "The library is empty. Add logos, icons and badges here once and use them in every catalogue.")}
          </p>
        )}

        <ul className="grid grid-cols-2 gap-2">
          {assets.map((asset) => (
            <li key={asset.id}>
              <AssetTile
                asset={asset}
                confirmingDelete={pendingDelete === asset.id}
                onPlace={() => onPlaceAsset(asset)}
                onDelete={() => void handleDelete(asset)}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* ── Add ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t p-3">
        <Button
          type="button"
          variant="secondary"
          className="w-full gap-2"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? <Loader2Icon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
          {t("pdfTemplates.assetAdd", "Add assets")}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {t("pdfTemplates.assetAddHint", "Or drop image files here. SVG is converted automatically.")}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            // Reset first, so picking the same file twice still fires.
            e.target.value = ""
            void uploadFiles(files)
          }}
        />
      </div>
    </aside>
  )
}

/**
 * One asset on the shelf.
 *
 * The thumbnail points an <img> straight at R2. That is deliberate and not a
 * shortcut: R2 serves these objects without CORS headers, which blocks fetch()
 * but not an image tag, so showing the library costs the API nothing. Only
 * PLACING an asset needs the bytes, and that goes through the API.
 */
function AssetTile({
  asset, confirmingDelete, onPlace, onDelete,
}: {
  asset: PdfAsset
  confirmingDelete: boolean
  onPlace: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="group relative">
      <button
        type="button"
        draggable
        onDragStart={(e) => setAssetDragData(e.dataTransfer, asset.id)}
        onClick={onPlace}
        data-pdf-asset-tile={asset.id}
        title={t("pdfTemplates.assetPlaceHint", "Click to place, or drag onto the page")}
        className="flex w-full flex-col items-center gap-1 rounded-md border p-2 transition hover:border-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {/* A chequerboard behind the image, so a white logo on a transparent
            background is visible rather than looking like an empty tile. */}
        <span
          className="flex h-14 w-full items-center justify-center overflow-hidden rounded"
          style={{
            backgroundImage:
              "linear-gradient(45deg,#0000000d 25%,transparent 25%,transparent 75%,#0000000d 75%),"
              + "linear-gradient(45deg,#0000000d 25%,transparent 25%,transparent 75%,#0000000d 75%)",
            backgroundSize: "12px 12px",
            backgroundPosition: "0 0, 6px 6px",
          }}
        >
          <img
            src={asset.fileUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="max-h-14 max-w-full object-contain"
          />
        </span>
        <span className="line-clamp-2 w-full text-center text-xs" dir="auto">{asset.name}</span>
      </button>

      <Button
        type="button"
        size="sm"
        variant={confirmingDelete ? "destructive" : "secondary"}
        // Always reachable by keyboard; only shown on hover or once focused,
        // so the shelf is not a wall of delete buttons.
        className={`absolute end-1 top-1 size-7 p-0 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 ${
          confirmingDelete ? "opacity-100" : ""
        }`}
        onClick={onDelete}
        aria-label={confirmingDelete
          ? t("pdfTemplates.assetDeleteConfirm", "Click again to delete")
          : t("pdfTemplates.assetDelete", "Delete asset")}
        title={confirmingDelete
          ? t("pdfTemplates.assetDeleteConfirm", "Click again to delete")
          : t("pdfTemplates.assetDelete", "Delete asset")}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  )
}
