import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ImagePlusIcon, Loader2Icon, LibraryIcon, Trash2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
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
 *
 * The ONE exception is the supplier chooser, and it follows the same rule: an
 * asset can be filed under the supplier it belongs to ("Varmora Assets",
 * "Supplier B Assets", as the brief puts it), but the chooser only appears
 * once there is genuinely something to choose between. With every asset
 * unfiled, or all from one supplier, it stays out of the way.
 */

/** Stands for "assets that belong to no supplier in particular" — an R11
 * icon or a Made in Italy badge is not any one brand's. Not a supplier name,
 * so it cannot collide with one. */
const UNFILED = "__unfiled__"

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
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null)
  /** Files chosen but not yet stored: the supplier is asked for first. */
  const [pendingUpload, setPendingUpload] = useState<File[] | null>(null)
  const [uploadSupplier, setUploadSupplier] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const query = usePdfAssetsQuery()
  const createAsset = useCreatePdfAssetMutation()
  const deleteAsset = useDeletePdfAssetMutation()

  const all = useMemo(() => query.data ?? [], [query.data])

  /** Every supplier that actually has something on the shelf, in alphabetical
   * order. Derived rather than fetched: the whole library is already here, so
   * a second request would only tell us what we can see. */
  const suppliers = useMemo(() => {
    const names = new Set<string>()
    for (const asset of all) if (asset.supplier) names.add(asset.supplier)
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [all])

  const hasUnfiled = useMemo(() => all.some((a) => !a.supplier), [all])

  /**
   * Whether choosing a supplier is worth showing at all.
   *
   * One drawer is not a filing system. The chooser earns its place only when
   * there is more than one thing to choose between — two suppliers, or one
   * supplier alongside assets belonging to nobody.
   */
  const showSupplierChooser = suppliers.length + (hasUnfiled ? 1 : 0) > 1

  const assets = useMemo(() => {
    if (!supplierFilter) return all
    if (supplierFilter === UNFILED) return all.filter((a) => !a.supplier)
    return all.filter((a) => a.supplier === supplierFilter)
  }, [all, supplierFilter])

  /**
   * Take files from the picker or from a drop onto the panel and store them.
   *
   * Converted to PNG or JPEG here, in the browser, before they are sent. That
   * is what makes an SVG logo work: the library only ever holds formats PDFium
   * can embed directly, so placing an asset later needs no conversion and
   * cannot fail on a format. It reuses the same converter the editor uses for
   * files dragged off the desktop, so the two cannot disagree.
   */
  const uploadFiles = async (files: File[], supplier: string | null) => {
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
            // No category is chosen in the panel; only the supplier is. The
            // column stays because the API and the schema both carry it.
            category: "other",
            supplier,
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
        // Jump to where they landed, so a batch filed under a supplier does
        // not appear to have vanished behind whatever filter was in force.
        setSupplierFilter(supplier ? supplier : (showSupplierChooser ? UNFILED : null))
      }
    } finally {
      setUploading(false)
    }
  }

  /**
   * Files have been chosen; ask whose they are before storing them.
   *
   * A step in the way of an upload has to earn itself. This one does: the
   * supplier is knowable only at this moment, by the person doing it, and
   * filing it later means opening every asset one at a time. It is one field,
   * it can be skipped with Enter, and it applies to the whole batch — the
   * usual case being a folder of one supplier's logos dropped at once.
   */
  const askSupplierFor = (files: File[]) => {
    if (files.length === 0) return
    setPendingUpload(files)
    // Pre-filled with whichever drawer is open, since dropping files while
    // looking at Varmora's assets almost always means "these are Varmora's".
    setUploadSupplier(supplierFilter && supplierFilter !== UNFILED ? supplierFilter : "")
  }

  const confirmUpload = () => {
    const files = pendingUpload
    setPendingUpload(null)
    if (!files) return
    const supplier = uploadSupplier.trim()
    void uploadFiles(files, supplier === "" ? null : supplier)
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

      {/* ── Whose assets ───────────────────────────────────────────────
          Only rendered once there is more than one drawer to choose between.
          One supplier is not a filing system, and an empty chooser is chrome
          charged against every session to serve none of them. */}
      {showSupplierChooser && (
        <div className="shrink-0 border-b p-3">
          <select
            data-pdf-asset-supplier
            value={supplierFilter ?? ""}
            onChange={(e) => setSupplierFilter(e.target.value === "" ? null : e.target.value)}
            aria-label={t("pdfTemplates.assetSupplierLabel", "Show assets for")}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{t("pdfTemplates.assetSupplierAll", "All suppliers")}</option>
            {suppliers.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
            {hasUnfiled && (
              <option value={UNFILED}>{t("pdfTemplates.assetSupplierUnfiled", "No supplier")}</option>
            )}
          </select>
        </div>
      )}

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
          askSupplierFor(Array.from(e.dataTransfer.files ?? []))
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
            {all.length > 0
              ? t("pdfTemplates.assetNoneForSupplier", "Nothing filed here yet.")
              : t("pdfTemplates.assetEmpty", "The library is empty. Add logos, icons and badges here once and use them in every catalogue.")}
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
            askSupplierFor(files)
          }}
        />
      </div>

      {/* Whose are these? Asked once per batch, before anything is stored. */}
      <Dialog
        open={pendingUpload !== null}
        onOpenChange={(open) => { if (!open) setPendingUpload(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("pdfTemplates.assetUploadTitle", "Add {{count}} asset", { count: pendingUpload?.length ?? 0 })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="asset-supplier">
              {t("pdfTemplates.assetSupplierField", "Supplier or brand")}
            </Label>
            <Input
              id="asset-supplier"
              value={uploadSupplier}
              onChange={(e) => setUploadSupplier(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmUpload() } }}
              // Offers the suppliers already in use without forcing a choice
              // from them: a new supplier must not require a settings screen.
              list="asset-supplier-options"
              placeholder={t("pdfTemplates.assetSupplierPlaceholder", "e.g. Varmora")}
              autoFocus
              dir="auto"
            />
            <datalist id="asset-supplier-options">
              {suppliers.map((name) => <option key={name} value={name} />)}
            </datalist>
            <p className="text-xs text-muted-foreground">
              {t(
                "pdfTemplates.assetSupplierHint",
                "Leave empty for artwork that belongs to no one supplier, like an R11 icon or a NEW badge.",
              )}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingUpload(null)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={confirmUpload}>{t("common.add", "Add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
