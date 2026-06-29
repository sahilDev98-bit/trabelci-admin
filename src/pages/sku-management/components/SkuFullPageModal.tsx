import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Minimize2 } from "lucide-react"
import { SkuSheetCeramic } from "./SkuSheetCeramic"
import type { SkuMetadataRow, SkuDropdownMap } from "@/features/skuManagement/types"
import type { SkuAutocompleteAPI } from "@/hooks/useSkuAutocomplete"

interface SkuFullPageModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  mode?: "creation" | "cleanup"
  rows: SkuMetadataRow[]
  onRowsChange: (rows: SkuMetadataRow[]) => void
  dropdowns: SkuDropdownMap
  createEmptyRow?: () => SkuMetadataRow
  onUndo?: () => void
  onRedo?: () => void
  /** Toolbar action buttons rendered in the modal header (Save, Approve, etc.) */
  actions?: React.ReactNode
  /** Status line shown below the title (e.g. "12 rows · 3 unsaved") */
  statusLine?: React.ReactNode
  autocomplete?: SkuAutocompleteAPI
  /** Infinite scroll — forwarded straight through to the inner grid */
  onNearEnd?: () => void
}

export function SkuFullPageModal({
  open,
  onClose,
  title,
  subtitle,
  mode = "creation",
  rows,
  onRowsChange,
  dropdowns,
  createEmptyRow,
  onUndo,
  onRedo,
  actions,
  statusLine,
  autocomplete,
  onNearEnd,
}: SkuFullPageModalProps) {
  const { t } = useTranslation()
  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      <div
        className="sku-fullpage-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sku-fullpage-panel"
      >
        <style>{`
          /* ── Backdrop ─────────────────────────────────────────────────── */
          .sku-fullpage-backdrop {
            position: fixed;
            inset: 0;
            z-index: 9998;
            background: rgba(15, 20, 40, 0.55);
            backdrop-filter: blur(3px);
            -webkit-backdrop-filter: blur(3px);
            animation: sku-fp-fade-in 180ms ease forwards;
          }

          /* ── Panel ────────────────────────────────────────────────────── */
          .sku-fullpage-panel {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            background: var(--background);
            overflow: hidden;
            animation: sku-fp-scale-in 200ms cubic-bezier(.22,.8,.32,1) forwards;
          }

          /* ── Entry animations ─────────────────────────────────────────── */
          @keyframes sku-fp-fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes sku-fp-scale-in {
            from { opacity: 0; transform: scale(0.985); }
            to   { opacity: 1; transform: scale(1); }
          }

          /* ── Header ───────────────────────────────────────────────────── */
          .sku-fullpage-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 16px;
            border-bottom: 1px solid var(--border);
            background: var(--background);
            flex-shrink: 0;
          }

          .sku-fullpage-title-block {
            display: flex;
            flex-direction: column;
            gap: 1px;
          }

          .sku-fullpage-title {
            font-size: 14px;
            font-weight: 600;
            line-height: 1.3;
            color: var(--foreground);
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .sku-fullpage-title-badge {
            display: inline-flex;
            align-items: center;
            padding: 1px 7px;
            border-radius: 99px;
            font-size: 10px;
            font-weight: 600;
            letter-spacing: .04em;
            text-transform: uppercase;
            background: var(--muted);
            color: var(--muted-foreground);
            border: 1px solid var(--border);
          }

          .sku-fullpage-subtitle {
            font-size: 11.5px;
            color: var(--muted-foreground);
            line-height: 1.3;
          }

          .sku-fullpage-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: auto;
          }

          .sku-fullpage-close {
            display: flex;
            align-items: center;
            gap: 5px;
            height: 32px;
            padding: 0 10px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 500;
            color: var(--muted-foreground);
            background: transparent;
            border: 1px solid transparent;
            cursor: pointer;
            transition: background 140ms, color 140ms, border-color 140ms;
            flex-shrink: 0;
          }
          .sku-fullpage-close:hover {
            background: var(--muted);
            color: var(--foreground);
            border-color: var(--border);
          }
          .sku-fullpage-close:focus-visible {
            outline: 2px solid var(--ring);
            outline-offset: 2px;
          }

          /* ── Grid area ────────────────────────────────────────────────── */
          .sku-fullpage-grid {
            flex: 1;
            min-height: 0;
            overflow: hidden;
            padding: 12px 12px 12px;
          }
        `}</style>

        {/* Header */}
        <div className="sku-fullpage-header">
          <div className="sku-fullpage-title-block">
            <span className="sku-fullpage-title">
              {title}
              <span className="sku-fullpage-title-badge">
                {mode === "cleanup" ? "Cleanup" : "New Creation"}
              </span>
            </span>
            {(subtitle || statusLine) && (
              <span className="sku-fullpage-subtitle">
                {statusLine ?? subtitle}
              </span>
            )}
          </div>

          {/* Action buttons slot */}
          {actions && (
            <div className="sku-fullpage-actions">{actions}</div>
          )}

          {/* Close */}
          <button
            type="button"
            className="sku-fullpage-close"
            onClick={onClose}
            aria-label="Exit full page"
          >
            <Minimize2 size={13} />
            {t("sku.exitFullPage")}
          </button>
        </div>

        {/* Grid */}
        <div className="sku-fullpage-grid">
          <SkuSheetCeramic
            rows={rows}
            onRowsChange={onRowsChange}
            dropdowns={dropdowns}
            mode={mode}
            createEmptyRow={createEmptyRow}
            onUndo={onUndo}
            onRedo={onRedo}
            autocomplete={autocomplete}
            onNearEnd={onNearEnd}
          />
        </div>
      </div>
    </>
  )
}
