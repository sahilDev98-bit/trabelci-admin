import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { uploadSkuImage } from "@/features/skuManagement/api"
import type { SkuImageType } from "@/features/skuManagement/api"
import type { SkuMetadataRow } from "@/features/skuManagement/types"

// In-cell cap: cells stay tidy at any count; the rest opens in the gallery
const MAX_VISIBLE_THUMBS = 1

interface CeramicImageCellProps {
  row: SkuMetadataRow
  field: "product_image_urls" | "cover_image_url" | "ambience_image_url"
  imageType: SkuImageType
  multiple: boolean
  rowIndex: number
  colIndex: number
  onRowChange: (updatedRow: SkuMetadataRow) => void
  onFillStart: (
    startRow: number,
    field: string,
    value: string | string[],
    e: React.MouseEvent,
  ) => void
}

const UPLOAD_ICON = (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

const PLUS_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export function CeramicImageCell({
  row,
  field,
  imageType,
  multiple,
  rowIndex,
  colIndex,
  onRowChange,
  onFillStart,
}: CeramicImageCellProps) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const overflowRef = useRef<HTMLButtonElement>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryRect, setGalleryRect] = useState<DOMRect | null>(null)

  const urls: string[] =
    field === "product_image_urls"
      ? (row.product_image_urls ?? [])
      : row[field]
        ? [row[field] as string]
        : []

  const hasImages = urls.length > 0

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      setUploading(true)
      try {
        // Accumulate across the loop — re-reading `row` per file would lose
        // every upload except the last when several files are selected at once
        const uploaded: string[] = []
        for (const file of Array.from(files)) {
          const { url } = await uploadSkuImage(file, imageType, row.sku || undefined)
          uploaded.push(url)
        }
        if (field === "product_image_urls") {
          onRowChange({
            ...row,
            product_image_urls: [...(row.product_image_urls ?? []), ...uploaded],
            _isDirty: true,
            _validationStatus: "unchecked",
          })
        } else {
          onRowChange({
            ...row,
            [field]: uploaded[uploaded.length - 1],
            _isDirty: true,
            _validationStatus: "unchecked",
          })
        }
      } catch {
        toast.error(t("sku.grid.imageUploadFailed"))
      } finally {
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ""
      }
    },
    [row, field, imageType, onRowChange, t],
  )

  const handleRemove = useCallback(
    (urlToRemove: string) => {
      if (field === "product_image_urls") {
        onRowChange({
          ...row,
          product_image_urls: (row.product_image_urls ?? []).filter(
            (u) => u !== urlToRemove,
          ),
          _isDirty: true,
          _validationStatus: "unchecked",
        })
      } else {
        onRowChange({
          ...row,
          [field]: "",
          _isDirty: true,
          _validationStatus: "unchecked",
        })
      }
    },
    [row, field, onRowChange],
  )

  const triggerUpload = useCallback(() => {
    fileRef.current?.click()
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        triggerUpload()
      }
    },
    [triggerUpload],
  )

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        style={{ display: "none" }}
        onChange={(e) => handleUpload(e.target.files)}
      />

      {!hasImages ? (
        /* Empty state — upload card (also a valid fill-drag target) */
        <div
          className="ceramic-rect"
          tabIndex={0}
          role="button"
          aria-label={t("sku.grid.uploadImage")}
          data-fill-cell
          data-row={rowIndex}
          data-col={colIndex}
          data-field={field}
          onClick={triggerUpload}
          onKeyDown={handleKeyDown}
        >
          {uploading ? (
            <Loader2
              size={17}
              className="ceramic-upload-spinner"
              style={{ animation: "spin 1s linear infinite", color: "#6f7076" }}
            />
          ) : (
            <div className="ceramic-upload">
              {UPLOAD_ICON}
              <span>{t("sku.grid.uploadImage")}</span>
            </div>
          )}
        </div>
      ) : (
        /* Has images — at most MAX_VISIBLE_THUMBS in the cell; the rest live
           behind a "+N" chip that opens the gallery popover. The group is a
           fill-drag source (corner handle) and target. */
        <div
          className="ceramic-img-group"
          data-fill-cell
          data-row={rowIndex}
          data-col={colIndex}
          data-field={field}
        >
          {urls.slice(0, MAX_VISIBLE_THUMBS).map((url) => (
            <div key={url} className="ceramic-thumb-wrap">
              <div className="ceramic-thumb">
                <img
                  src={url}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </div>
              <button
                type="button"
                className="ceramic-thumb-remove"
                onClick={() => handleRemove(url)}
                title={t("sku.grid.removeImage")}
                aria-label={t("sku.grid.removeImage")}
              >
                <X size={10} />
              </button>
            </div>
          ))}

          {urls.length > MAX_VISIBLE_THUMBS && (
            <button
              ref={overflowRef}
              type="button"
              className="ceramic-thumb-more"
              onClick={() => {
                if (overflowRef.current) {
                  setGalleryRect(overflowRef.current.getBoundingClientRect())
                  setGalleryOpen(true)
                }
              }}
              aria-label={`+${urls.length - MAX_VISIBLE_THUMBS}`}
            >
              +{urls.length - MAX_VISIBLE_THUMBS}
            </button>
          )}

          {galleryOpen && galleryRect && (
            <CeramicImageGallery
              urls={urls}
              anchorRect={galleryRect}
              onRemove={handleRemove}
              onAdd={triggerUpload}
              onClose={() => setGalleryOpen(false)}
              uploading={uploading}
              removeLabel={t("sku.grid.removeImage")}
              addLabel={t("sku.grid.uploadImage")}
            />
          )}

          {/* Add more button (product images) or replace (single) */}
          {multiple && (
            <button
              type="button"
              className="ceramic-add-btn"
              onClick={triggerUpload}
              tabIndex={0}
              aria-label={t("sku.grid.uploadImage")}
            >
              {uploading ? (
                <Loader2
                  size={14}
                  style={{ animation: "spin 1s linear infinite" }}
                />
              ) : (
                PLUS_ICON
              )}
            </button>
          )}

          {/* Single image: click the thumb to replace */}
          {!multiple && (
            <button
              type="button"
              className="ceramic-add-btn"
              onClick={triggerUpload}
              tabIndex={0}
              aria-label={t("sku.grid.uploadImage")}
              style={{ width: 24, height: 24 }}
            >
              {uploading ? (
                <Loader2
                  size={12}
                  style={{ animation: "spin 1s linear infinite" }}
                />
              ) : (
                PLUS_ICON
              )}
            </button>
          )}

          {/* Fill handle — drag to copy these image(s) to other rows */}
          <span
            className="ceramic-fill-handle"
            title="Drag to fill (same column)"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) =>
              onFillStart(rowIndex, field, multiple ? urls : (urls[0] ?? ""), e)
            }
          />
        </div>
      )}
    </>
  )
}

// ─── Gallery popover — full image set for a cell, in a portal ────────────────

interface CeramicImageGalleryProps {
  urls: string[]
  anchorRect: DOMRect
  onRemove: (url: string) => void
  onAdd: () => void
  onClose: () => void
  uploading: boolean
  removeLabel: string
  addLabel: string
}

function CeramicImageGallery({
  urls,
  anchorRect,
  onRemove,
  onAdd,
  onClose,
  uploading,
  removeLabel,
  addLabel,
}: CeramicImageGalleryProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Position near the anchor, clamped to the viewport
  const width = 248
  const left = Math.min(Math.max(8, anchorRect.left - width / 2), window.innerWidth - width - 8)
  const openUp = anchorRect.bottom + 240 > window.innerHeight
  const top = openUp ? undefined : anchorRect.bottom + 8
  const bottom = openUp ? window.innerHeight - anchorRect.top + 8 : undefined

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", handleClick, true)
    document.addEventListener("keydown", handleKey, true)
    window.addEventListener("resize", onClose)
    return () => {
      document.removeEventListener("mousedown", handleClick, true)
      document.removeEventListener("keydown", handleKey, true)
      window.removeEventListener("resize", onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={panelRef}
      className="ceramic-gallery"
      style={{ position: "fixed", left, top, bottom, width, zIndex: 99999 }}
    >
      <style>{`
        .ceramic-gallery {
          background: #ffffff;
          border: 1px solid rgba(30,36,60,.12);
          border-radius: 14px;
          box-shadow: 0 20px 50px -10px rgba(20,24,48,.35);
          padding: 10px;
        }
        .dark .ceramic-gallery {
          background: #1f2430;
          border: 1px solid rgba(255,255,255,.10);
          box-shadow: 0 20px 50px -10px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.06);
        }
        .ceramic-gallery-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          max-height: 200px;
          overflow-y: auto;
        }
        .ceramic-gallery-grid::-webkit-scrollbar { width: 6px; }
        .ceramic-gallery-grid::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,.12);
          border-radius: 3px;
        }
        .ceramic-gallery-item {
          position: relative;
          aspect-ratio: 1;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 4px 10px -4px rgba(0,0,0,.6);
        }
        .ceramic-gallery-item img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .ceramic-gallery-remove {
          position: absolute;
          top: 3px;
          inset-inline-end: 3px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgba(239,68,68,.92);
          color: #fff;
          border: none;
          cursor: pointer;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 0;
        }
        .ceramic-gallery-item:hover .ceramic-gallery-remove { display: flex; }
        .ceramic-gallery-add {
          aspect-ratio: 1;
          border-radius: 10px;
          border: 1.5px dashed rgba(24,24,27,.4);
          background: rgba(24,24,27,.05);
          color: #3f3f46;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ceramic-gallery-add:hover {
          background: rgba(24,24,27,.12);
          border-color: #18181b;
        }
        .dark .ceramic-gallery-add {
          border: 1.5px dashed rgba(255,255,255,.4);
          background: rgba(255,255,255,.06);
          color: #e4e4e7;
        }
        .dark .ceramic-gallery-add:hover {
          background: rgba(255,255,255,.14);
          border-color: #fafafa;
        }
      `}</style>

      <div className="ceramic-gallery-grid">
        {urls.map((url) => (
          <div key={url} className="ceramic-gallery-item">
            <a href={url} target="_blank" rel="noreferrer" title={url.split("/").pop()}>
              <img src={url} alt="" />
            </a>
            <button
              type="button"
              className="ceramic-gallery-remove"
              onClick={() => onRemove(url)}
              title={removeLabel}
              aria-label={removeLabel}
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ceramic-gallery-add"
          onClick={onAdd}
          title={addLabel}
          aria-label={addLabel}
        >
          {uploading ? (
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            PLUS_ICON
          )}
        </button>
      </div>
    </div>,
    document.body,
  )
}
