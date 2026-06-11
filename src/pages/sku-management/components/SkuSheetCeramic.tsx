import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { toast } from "sonner"
import "@fontsource/dm-sans/500.css"
import "@fontsource/dm-sans/700.css"
import "@fontsource/dm-sans/800.css"
import "@fontsource/heebo/400.css"
import "@fontsource/heebo/500.css"
import "@fontsource/heebo/700.css"
import "@fontsource/heebo/800.css"
import type {
  SkuMetadataRow,
  SkuDropdownMap,
  SkuDropdownValue,
  SkuValidationStatus,
} from "@/features/skuManagement/types"
import { CeramicDropdown } from "./CeramicDropdown"
import { CeramicImageCell } from "./CeramicImageCell"

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SkuSheetCeramicProps {
  rows: SkuMetadataRow[]
  onRowsChange: (rows: SkuMetadataRow[]) => void
  dropdowns: SkuDropdownMap
  createEmptyRow: () => SkuMetadataRow
  onUndo: () => void
  onRedo: () => void
}

// ─── Column definitions ───────────────────────────────────────────────────────

type ColType = "index" | "text" | "dropdown" | "image-multi" | "image-single" | "readonly"

interface CeramicColumn {
  field: string
  type: ColType
  minWidth: number
  /** For dropdown columns — the key into SkuDropdownMap */
  dropdownKey?: string
  /** For image columns */
  imageType?: "product" | "cover" | "ambience"
}

const COLUMNS: CeramicColumn[] = [
  { field: "rowNumber",          type: "index",        minWidth: 44  },
  { field: "sku",                type: "text",         minWidth: 140 },
  { field: "product_image_urls", type: "image-multi",  minWidth: 170, imageType: "product"  },
  { field: "cover_image_url",    type: "image-single", minWidth: 150, imageType: "cover"    },
  { field: "ambience_image_url", type: "image-single", minWidth: 150, imageType: "ambience" },
  { field: "company",            type: "text",         minWidth: 140 },
  { field: "series",             type: "text",         minWidth: 120 },
  { field: "color",              type: "text",         minWidth: 110 },
  // Dropdown widths leave room for the longest vocabulary label on ONE line
  // (e.g. "120×240 cm", "Floor + Wall", "Natural Stone") — no wrapping,
  // no ellipsis, per design decision
  { field: "size",               type: "dropdown",     minWidth: 130, dropdownKey: "size"              },
  { field: "finish",             type: "dropdown",     minWidth: 125, dropdownKey: "finish"            },
  { field: "country_of_origin",  type: "dropdown",     minWidth: 130, dropdownKey: "country_of_origin" },
  { field: "thickness",          type: "dropdown",     minWidth: 115, dropdownKey: "thickness"         },
  { field: "surface_type",       type: "dropdown",     minWidth: 140, dropdownKey: "surface_type"      },
  { field: "r_rating",           type: "dropdown",     minWidth: 100, dropdownKey: "r_rating"          },
  { field: "product_type",       type: "dropdown",     minWidth: 150, dropdownKey: "product_type"      },
  { field: "supplier",           type: "text",         minWidth: 120 },
  { field: "supplier_code",      type: "text",         minWidth: 110 },
  { field: "model",              type: "text",         minWidth: 100 },
  { field: "sap_item_name",      type: "text",         minWidth: 180 },
  { field: "display_name_en",    type: "text",         minWidth: 180 },
  { field: "display_name_he",    type: "text",         minWidth: 160 },
  { field: "category",           type: "text",         minWidth: 120 },
  { field: "subcategory",        type: "text",         minWidth: 120 },
  { field: "internal_notes",     type: "text",         minWidth: 140 },
  { field: "status",             type: "readonly",     minWidth: 110 },
]

const WRITABLE_FIELDS = new Set(
  COLUMNS.filter((c) => c.type === "text" || c.type === "dropdown").map((c) => c.field),
)
function getHeaderKey(field: string): string {
  if (field === "rowNumber") return "#"
  return `sku.fields.${field}`
}

// Readable on both light and dark app backgrounds
function getStatusColor(status: string | undefined): string {
  if (status === "approved" || status === "created_in_sap") return "#10b981"
  if (status === "pending_approval") return "#d97706"
  return "#8a90a8"
}

function getValidationTint(vs: SkuValidationStatus | undefined): string | undefined {
  switch (vs) {
    case "red":    return "rgba(239,68,68,0.08)"
    case "yellow": return "rgba(245,158,11,0.08)"
    case "green":  return "rgba(34,197,94,0.06)"
    default:       return undefined
  }
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CERAMIC_CSS = `
  .ceramic-sheet-root {
    /* Card boxes keep the approved "ceramic" look (ivory pills); accents use
       the admin theme's neutral ink/zinc palette — no copper/gold. Surface
       colors follow the app theme via .dark below. */
    --ceramic-cell: #fdfdfd;
    --ceramic-cell-soft: #f3efe9;
    --ceramic-ink: #23263a;
    --ceramic-accent: #23263a;
    --ceramic-accent-soft: rgba(35,38,58,.22);
    --ceramic-radius: 14px;
    --ceramic-rect-h: 44px;
    --ceramic-rect-w: 86%;

    /* light theme surfaces */
    --ceramic-head-text: #1f2433;
    --ceramic-head-border: rgba(30, 36, 60, 0.12);
    --ceramic-muted-text: #8a90a8;
    /* warm ivory-family chip with neutral ink digits */
    --ceramic-idx-bg: linear-gradient(150deg, #f1ece3, #e3dccd);
    --ceramic-idx-text: #52525b;
    --ceramic-idx-shadow: inset 0 1px 2px rgba(70,55,40,.14), 0 1px 0 rgba(255,255,255,.7);
    --ceramic-scrollbar-thumb: rgba(30,36,60,.25);
    --ceramic-scrollbar-thumb-hover: rgba(30,36,60,.45);
    /* buttons/chips that sit on the page background (admin-primary style) */
    --ceramic-btn-bg: linear-gradient(150deg, #34363e, #16171c);
    --ceramic-btn-fg: #fafafa;
    --ceramic-btn-shadow: 0 6px 14px -4px rgba(20,22,30,.45), inset 0 1px 0 rgba(255,255,255,.18);
    --ceramic-chip-border: rgba(24,26,34,.45);
    --ceramic-chip-bg: rgba(24,26,34,.06);
    --ceramic-chip-text: #3f414d;
    --ceramic-shadow-rest: 0 1px 1px rgba(20,24,48,.10), 0 8px 18px -10px rgba(20,24,48,.25), inset 0 1px 0 rgba(255,255,255,.85);
    --ceramic-shadow-hover: 0 2px 4px rgba(20,24,48,.12), 0 14px 26px -12px rgba(20,24,48,.30), inset 0 1px 0 rgba(255,255,255,.95);
    --ceramic-rect-border: 1px solid rgba(30,36,60,.10);

    height: 100%;
    display: flex;
    flex-direction: column;
    font-family: 'Heebo', sans-serif;
    color: inherit;
  }

  /* dark theme surfaces (follows the app's .dark class) */
  .dark .ceramic-sheet-root {
    --ceramic-head-text: #eef0fa;
    --ceramic-head-border: rgba(255,255,255,.08);
    --ceramic-muted-text: #9aa0bd;
    /* neutral dark chip with light digits — no blue cast */
    --ceramic-idx-bg: linear-gradient(150deg, #2b2b2f, #1c1c20);
    --ceramic-idx-text: #d4d4d8;
    --ceramic-idx-shadow: inset 0 2px 4px rgba(0,0,0,.55), inset 0 -1px 0 rgba(255,255,255,.05), 0 1px 0 rgba(255,255,255,.04);
    --ceramic-scrollbar-thumb: rgba(255,255,255,.18);
    --ceramic-scrollbar-thumb-hover: rgba(255,255,255,.32);
    /* on dark the primary action style is light-on-dark (like Approve) */
    --ceramic-btn-bg: linear-gradient(150deg, #fafafa, #d9d9de);
    --ceramic-btn-fg: #18181b;
    --ceramic-btn-shadow: 0 6px 14px -4px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.7);
    --ceramic-chip-border: rgba(255,255,255,.45);
    --ceramic-chip-bg: rgba(255,255,255,.07);
    --ceramic-chip-text: #e4e4e7;
    --ceramic-shadow-rest: 0 1px 1px rgba(0,0,0,.45), 0 10px 22px -10px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.85);
    --ceramic-shadow-hover: 0 2px 4px rgba(0,0,0,.5), 0 18px 34px -12px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.95);
    --ceramic-rect-border: none;
  }

  .ceramic-panel {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 4px 16px;
    /* slim, unobtrusive scrollbars (Firefox) */
    scrollbar-width: thin;
    scrollbar-color: var(--ceramic-scrollbar-thumb) transparent;
  }
  /* slim, unobtrusive scrollbars (Chromium/WebKit) */
  .ceramic-panel::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .ceramic-panel::-webkit-scrollbar-track {
    background: transparent;
  }
  .ceramic-panel::-webkit-scrollbar-thumb {
    background: var(--ceramic-scrollbar-thumb);
    border-radius: 8px;
  }
  .ceramic-panel::-webkit-scrollbar-thumb:hover {
    background: var(--ceramic-scrollbar-thumb-hover);
  }
  .ceramic-panel::-webkit-scrollbar-corner {
    background: transparent;
  }

  .ceramic-grid {
    display: grid;
    gap: 10px 8px;
  }

  .ceramic-head {
    font-weight: 700;
    font-size: 13.5px;
    letter-spacing: .01em;
    text-align: center;
    color: var(--ceramic-head-text);
    padding: 14px 6px 12px;
    border-bottom: 1px solid var(--ceramic-head-border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ceramic-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px 4px;
  }

  .ceramic-rect {
    width: var(--ceramic-rect-w);
    height: var(--ceramic-rect-h);
    border-radius: var(--ceramic-radius);
    background: linear-gradient(180deg, #ffffff, var(--ceramic-cell-soft));
    border: var(--ceramic-rect-border);
    box-shadow: var(--ceramic-shadow-rest);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform .22s cubic-bezier(.22,.8,.32,1), box-shadow .22s ease;
    cursor: text;
    position: relative;
  }
  .ceramic-rect:hover,
  .ceramic-rect:focus-within {
    transform: translateY(-3px);
    box-shadow: var(--ceramic-shadow-hover);
  }

  .ceramic-rect[data-validation-tint] {
    background: linear-gradient(180deg, #ffffff, var(--ceramic-cell-soft));
  }

  .ceramic-field {
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    text-align: center;
    color: var(--ceramic-ink);
    border-radius: var(--ceramic-radius);
    font: 600 14px/1 'DM Sans', 'Heebo', sans-serif;
    padding: 0 8px;
    outline: none;
  }
  .ceramic-field:focus {
    box-shadow: 0 0 0 3px var(--ceramic-accent-soft), var(--ceramic-shadow-hover);
  }
  .ceramic-field::placeholder {
    color: #c7cbdc;
    font-weight: 500;
  }

  /* Dropdown trigger — grows with its label (single line, never clipped) */
  .ceramic-dropdown-trigger {
    width: auto;
    min-width: var(--ceramic-rect-w);
    max-width: 100%;
    height: var(--ceramic-rect-h);
    border-radius: var(--ceramic-radius);
    background: linear-gradient(180deg, #ffffff, var(--ceramic-cell-soft));
    border: var(--ceramic-rect-border);
    box-shadow: var(--ceramic-shadow-rest);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform .22s cubic-bezier(.22,.8,.32,1), box-shadow .22s ease;
    cursor: pointer;
    position: relative;
    font: 600 14px/1 'DM Sans', 'Heebo', sans-serif;
    color: var(--ceramic-ink);
    padding: 0 22px 0 10px;
    text-align: center;
    outline: none;
    white-space: nowrap;
  }
  .ceramic-dropdown-trigger:hover,
  .ceramic-dropdown-trigger:focus {
    transform: translateY(-3px);
    box-shadow: var(--ceramic-shadow-hover);
  }
  .ceramic-dropdown-trigger:focus {
    box-shadow: 0 0 0 3px var(--ceramic-accent-soft), var(--ceramic-shadow-hover);
  }
  .ceramic-dropdown-trigger::after {
    content: "";
    position: absolute;
    inset-inline-end: 10px;
    top: 50%;
    margin-top: -2px;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid #9ca3af;
    pointer-events: none;
  }
  .ceramic-dropdown-trigger:hover::after,
  .ceramic-dropdown-trigger:focus::after {
    border-top-color: var(--ceramic-accent);
  }
  .ceramic-dropdown-trigger[data-empty="true"] {
    color: #c7cbdc;
    font-weight: 500;
  }

  /* Index chip */
  .ceramic-idx {
    width: var(--ceramic-rect-h);
    height: var(--ceramic-rect-h);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 800 14px/1 'DM Sans', sans-serif;
    color: var(--ceramic-idx-text);
    background: var(--ceramic-idx-bg);
    box-shadow: var(--ceramic-idx-shadow);
  }

  /* Image group */
  .ceramic-img-group {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    position: relative;
  }
  .ceramic-img-group:hover .ceramic-fill-handle {
    opacity: 1;
  }
  /* Fill preview on image cells: dashed outline (the group has no card bg) */
  .ceramic-img-group.ceramic-fill-target {
    outline: 2px dashed rgba(24,24,27,.5);
    outline-offset: 3px;
    border-radius: var(--ceramic-radius);
    box-shadow: none !important;
  }
  .dark .ceramic-img-group.ceramic-fill-target {
    outline: 2px dashed rgba(255,255,255,.6);
  }

  .ceramic-thumb-wrap {
    position: relative;
  }
  .ceramic-thumb-remove {
    display: none;
    position: absolute;
    top: -4px;
    inset-inline-end: -4px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(239,68,68,.9);
    color: #fff;
    border: none;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    z-index: 2;
    padding: 0;
  }
  .ceramic-thumb-wrap:hover .ceramic-thumb-remove {
    display: flex;
  }

  .ceramic-thumb {
    width: var(--ceramic-rect-h);
    height: var(--ceramic-rect-h);
    border-radius: var(--ceramic-radius);
    position: relative;
    overflow: hidden;
    box-shadow: var(--ceramic-shadow-rest);
    transition: transform .22s ease, box-shadow .22s ease;
  }
  .ceramic-thumb:hover {
    transform: translateY(-3px) scale(1.04);
    box-shadow: var(--ceramic-shadow-hover);
  }
  .ceramic-thumb::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,.5) 50%, transparent 65%);
    mix-blend-mode: overlay;
    pointer-events: none;
  }

  /* Upload label sits on the (always ivory) card — fixed colors, not theme
     vars: clearly readable at rest, near-black ink on hover */
  .ceramic-upload {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    color: #6f7076;
    font-size: 11.5px;
    font-weight: 700;
    transition: color .2s;
  }
  .ceramic-upload svg {
    stroke: currentColor;
  }
  .ceramic-rect:hover .ceramic-upload,
  .ceramic-rect:focus-within .ceramic-upload {
    color: var(--ceramic-ink);
  }

  /* "+N more images" chip — opens the gallery popover (theme-aware: sits on
     the page background, not on an ivory card) */
  .ceramic-thumb-more {
    width: var(--ceramic-rect-h);
    height: var(--ceramic-rect-h);
    border-radius: var(--ceramic-radius);
    border: 1.5px dashed var(--ceramic-chip-border);
    background: var(--ceramic-chip-bg);
    color: var(--ceramic-chip-text);
    font: 700 13px/1 'DM Sans', sans-serif;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform .2s ease, background .2s ease;
    padding: 0;
  }
  .ceramic-thumb-more:hover {
    transform: translateY(-2px);
    background: var(--ceramic-accent-soft);
  }

  /* round "+" button — admin-primary style (dark on light theme, light on dark) */
  .ceramic-add-btn {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    background: var(--ceramic-btn-bg);
    color: var(--ceramic-btn-fg);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--ceramic-btn-shadow);
    transition: transform .2s ease, box-shadow .2s ease;
    padding: 0;
  }
  .ceramic-add-btn:hover {
    transform: translateY(-2px) scale(1.07);
  }

  /* Status cell */
  .ceramic-status {
    font: 600 13px/1 'DM Sans', 'Heebo', sans-serif;
    text-align: center;
    padding: 0 4px;
    white-space: nowrap;
  }

  /* Duplicate SKU */
  .ceramic-rect[data-duplicate="true"] {
    background: linear-gradient(180deg, #fee2e2, #fecaca) !important;
  }
  .ceramic-rect[data-duplicate="true"] .ceramic-field {
    color: #b91c1c;
    font-weight: 700;
  }

  /* Field-level validation (spec point 17): the exact failing cell gets a
     colored ring + tinted card; message shows as a tooltip on hover */
  .ceramic-rect[data-issue="error"],
  .ceramic-dropdown-trigger[data-issue="error"] {
    background: linear-gradient(180deg, #fff3f3, #fbdcdc);
    box-shadow: 0 0 0 2px rgba(239,68,68,.55), var(--ceramic-shadow-rest);
  }
  .ceramic-rect[data-issue="warning"],
  .ceramic-dropdown-trigger[data-issue="warning"] {
    background: linear-gradient(180deg, #fffaf0, #fbeed3);
    box-shadow: 0 0 0 2px rgba(217,119,6,.45), var(--ceramic-shadow-rest);
  }

  /* Fill handle — small round grip on the cell corner; drag down to fill */
  .ceramic-fill-handle {
    position: absolute;
    bottom: -5px;
    inset-inline-end: -5px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--ceramic-ink);
    border: 2px solid #ffffff;
    box-shadow: 0 1px 3px rgba(0,0,0,.35);
    cursor: grab;
    opacity: 0;
    transition: opacity .15s ease;
    z-index: 3;
  }
  .ceramic-rect:hover .ceramic-fill-handle,
  .ceramic-rect:focus-within .ceramic-fill-handle,
  .ceramic-dropdown-trigger:hover .ceramic-fill-handle,
  .ceramic-dropdown-trigger:focus .ceramic-fill-handle {
    opacity: 1;
  }

  /* While a fill drag is active: "copy" cursor everywhere (like dragging a
     file), switching to "not-allowed" over a different column */
  body.ceramic-fill-dragging,
  body.ceramic-fill-dragging * {
    cursor: copy !important;
  }
  body.ceramic-fill-dragging.ceramic-fill-invalid,
  body.ceramic-fill-dragging.ceramic-fill-invalid * {
    cursor: not-allowed !important;
  }

  /* OS-style drag image: a mini cell box that travels with the cursor while
     filling, showing the value that will land at the hovered row */
  .ceramic-drag-chip {
    position: fixed;
    z-index: 100000;
    pointer-events: none;
    height: 36px;
    padding: 0 14px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: linear-gradient(180deg, #ffffff, #f3efe9);
    color: #23263a;
    font: 600 13px/1 'DM Sans', 'Heebo', sans-serif;
    box-shadow: 0 10px 24px -8px rgba(20,24,48,.45), 0 2px 6px rgba(20,24,48,.25);
    white-space: nowrap;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ceramic-drag-chip[data-invalid="true"] {
    background: linear-gradient(180deg, #fff1f1, #fcdada);
    color: #b91c1c;
    box-shadow: 0 10px 24px -8px rgba(185,28,28,.45), 0 2px 6px rgba(185,28,28,.25);
  }

  /* Cells covered by an in-progress fill drag: soft ring + the incoming
     value shown as a faded "ghost" inside the box (Excel-style preview) */
  .ceramic-fill-target {
    box-shadow: inset 0 0 0 1.5px rgba(24,24,27,.4), var(--ceramic-shadow-rest) !important;
  }
  .dark .ceramic-fill-target {
    box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.5), var(--ceramic-shadow-rest) !important;
  }
  .ceramic-fill-ghost {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 600 14px/1 'DM Sans', 'Heebo', sans-serif;
    color: var(--ceramic-ink);
    opacity: .38;
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    padding: 0 8px;
    z-index: 2;
  }
  .ceramic-fill-ghost img {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    object-fit: cover;
  }
  .ceramic-fill-ghost .ceramic-fill-ghost-count {
    font-size: 11px;
    font-weight: 700;
    margin-inline-start: 4px;
  }
  /* While a ghost occupies an empty upload card, mute the Upload label */
  .ceramic-fill-target .ceramic-upload {
    opacity: .15;
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .ceramic-rect,
    .ceramic-thumb,
    .ceramic-add-btn,
    .ceramic-dropdown-trigger {
      transition: none !important;
    }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFieldValue(row: SkuMetadataRow, field: string): string {
  if (field === "rowNumber") return ""
  const val = row[field as keyof SkuMetadataRow]
  if (val == null) return ""
  if (Array.isArray(val)) return val.join(",")
  return String(val)
}

// Fill series value at a signed row offset from the source cell. Only the
// SKU column auto-increments (Excel style) — downward +1 per row, upward -1
// per row; every other column copies the exact value.
//   "1"       → 2, 3, 4 … (and 0 going up; never below 0)
//   "150"     → 151, 152 …
//   "SKU-001" → SKU-002, SKU-003 … (zero padding preserved)
//   no trailing number → plain copy
function fillValueAt(value: string, offset: number, increment: boolean): string {
  if (!increment || offset === 0) return value
  const str = value.trim()
  const match = str.match(/^(.*?)(\d+)$/)
  if (!match) return value
  const [, prefix, numStr] = match
  const n = parseInt(numStr, 10) + offset
  if (n < 0) return value // series can't go negative — fall back to copy
  const s = String(n)
  return prefix + (numStr.length > s.length ? s.padStart(numStr.length, "0") : s)
}

function getDropdownLabel(
  value: string,
  options: SkuDropdownValue[],
  isHe: boolean,
): string {
  if (!value) return ""
  const opt = options.find((o) => o.value === value)
  if (!opt) return value
  return (isHe ? opt.label_he : opt.label_en) ?? opt.value
}

// ─── Row component (memo'd) ──────────────────────────────────────────────────

interface CeramicRowProps {
  row: SkuMetadataRow
  rowIndex: number
  columns: CeramicColumn[]
  dropdowns: SkuDropdownMap
  isDuplicate: boolean
  t: TFunction
  isHe: boolean
  onCellCommit: (clientId: string, field: string, value: unknown) => void
  onRowChange: (updatedRow: SkuMetadataRow) => void
  onNavigate: (rowIndex: number, colIndex: number, direction: "down" | "up") => void
  onFillStart: (startRow: number, field: string, value: string | string[], e: React.MouseEvent) => void
}

type CellIssue = { kind: "error" | "warning"; message: string } | undefined

const CeramicRow = memo(function CeramicRow({
  row,
  rowIndex,
  columns,
  dropdowns,
  isDuplicate,
  t,
  isHe,
  onCellCommit,
  onRowChange,
  onNavigate,
  onFillStart,
}: CeramicRowProps) {
  const validationTint = getValidationTint(row._validationStatus)
  const validationErrors = row._validationErrors ?? []
  const validationWarnings = row._validationWarnings ?? []

  // Field-level issue (errors win over warnings) — drives the cell ring +
  // tooltip, the "same as the spreadsheet" treatment after Approve
  const getFieldIssue = (field: string): CellIssue => {
    const err = validationErrors.find((e) => e.field === field)
    if (err) return { kind: "error", message: err.message }
    const warn = validationWarnings.find((w) => w.field === field)
    if (warn) return { kind: "warning", message: warn.message }
    return undefined
  }

  return (
    <>
      {columns.map((col, colIndex) => {
        const issue = getFieldIssue(col.field)

        if (col.type === "index") {
          return (
            <div key={col.field} className="ceramic-cell">
              <div className="ceramic-idx">{rowIndex + 1}</div>
            </div>
          )
        }

        if (col.type === "readonly") {
          const status = row.status ?? ""
          const label = t(`sku.status.${status}`, { defaultValue: status })
          return (
            <div key={col.field} className="ceramic-cell">
              <span
                className="ceramic-status"
                style={{ color: getStatusColor(status) }}
              >
                {label}
              </span>
            </div>
          )
        }

        if (col.type === "image-multi" || col.type === "image-single") {
          return (
            <div key={col.field} className="ceramic-cell">
              <CeramicImageCell
                row={row}
                field={col.field as "product_image_urls" | "cover_image_url" | "ambience_image_url"}
                imageType={col.imageType!}
                multiple={col.type === "image-multi"}
                rowIndex={rowIndex}
                onRowChange={onRowChange}
                onFillStart={onFillStart}
              />
            </div>
          )
        }

        if (col.type === "dropdown") {
          const options = dropdowns[col.dropdownKey!] ?? []
          const value = getFieldValue(row, col.field)
          const label = getDropdownLabel(value, options, isHe)
          return (
            <div key={col.field} className="ceramic-cell" title={issue?.message}>
              <DropdownCellWrapper
                value={value}
                label={label}
                options={options}
                clientId={row._clientId ?? ""}
                field={col.field}
                rowIndex={rowIndex}
                issue={issue?.kind}
                validationTint={col.field !== "rowNumber" ? validationTint : undefined}
                onCommit={onCellCommit}
                onFillStart={onFillStart}
              />
            </div>
          )
        }

        // text cell
        return (
          <div key={col.field} className="ceramic-cell" title={issue?.message}>
            <TextCellWrapper
              initialValue={getFieldValue(row, col.field)}
              clientId={row._clientId ?? ""}
              field={col.field}
              rowIndex={rowIndex}
              colIndex={colIndex}
              isDuplicate={col.field === "sku" && isDuplicate}
              duplicateTooltip={
                col.field === "sku" && isDuplicate
                  ? t("sku.grid.duplicateSkuTooltip")
                  : undefined
              }
              issue={issue?.kind}
              validationTint={validationTint}
              onCommit={onCellCommit}
              onNavigate={onNavigate}
              onFillStart={onFillStart}
            />
          </div>
        )
      })}
    </>
  )
})

// ─── TextCell with local state ────────────────────────────────────────────────

interface TextCellWrapperProps {
  initialValue: string
  clientId: string
  field: string
  rowIndex: number
  colIndex: number
  isDuplicate: boolean
  duplicateTooltip?: string
  issue?: "error" | "warning"
  validationTint?: string
  onCommit: (clientId: string, field: string, value: unknown) => void
  onNavigate: (rowIndex: number, colIndex: number, direction: "down" | "up") => void
  onFillStart: (startRow: number, field: string, value: string | string[], e: React.MouseEvent) => void
}

function TextCellWrapper({
  initialValue,
  clientId,
  field,
  rowIndex,
  colIndex,
  isDuplicate,
  duplicateTooltip,
  issue,
  validationTint,
  onCommit,
  onNavigate,
  onFillStart,
}: TextCellWrapperProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(initialValue)

  // Sync when the external value changes (e.g. after undo, paste, save).
  // Setting the DOM input value is exactly what effects are for —
  // syncing React state with an external system (the DOM).
  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== initialValue) {
      inputRef.current.value = initialValue
    }
    committedRef.current = initialValue
  }, [initialValue])

  const commit = useCallback(() => {
    const current = inputRef.current?.value ?? ""
    if (current !== committedRef.current) {
      committedRef.current = current
      onCommit(clientId, field, current)
    }
  }, [clientId, field, onCommit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        commit()
        onNavigate(rowIndex, colIndex, "down")
      } else if (e.key === "ArrowDown" && e.altKey) {
        e.preventDefault()
        commit()
        onNavigate(rowIndex, colIndex, "down")
      } else if (e.key === "ArrowUp" && e.altKey) {
        e.preventDefault()
        commit()
        onNavigate(rowIndex, colIndex, "up")
      }
    },
    [commit, onNavigate, rowIndex, colIndex],
  )

  const rectStyle: React.CSSProperties = validationTint
    ? { background: `linear-gradient(180deg, ${validationTint}, ${validationTint}), linear-gradient(180deg, #ffffff, var(--ceramic-cell-soft))` }
    : {}

  return (
    <div
      className="ceramic-rect"
      data-duplicate={isDuplicate || undefined}
      data-issue={issue}
      data-fill-cell
      title={duplicateTooltip}
      style={rectStyle}
      data-row={rowIndex}
      data-col={colIndex}
      data-field={field}
    >
      <input
        ref={inputRef}
        className="ceramic-field"
        type="text"
        dir="auto"
        defaultValue={initialValue}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        data-row={rowIndex}
        data-col={colIndex}
        data-field={field}
      />
      <span
        className="ceramic-fill-handle"
        title="Drag to fill (same column)"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          // Commit what's being typed first, then fill with that value
          commit()
          onFillStart(rowIndex, field, inputRef.current?.value ?? "", e)
        }}
      />
    </div>
  )
}

// ─── DropdownCell wrapper ─────────────────────────────────────────────────────

interface DropdownCellWrapperProps {
  value: string
  label: string
  options: SkuDropdownValue[]
  clientId: string
  field: string
  rowIndex: number
  issue?: "error" | "warning"
  validationTint?: string
  onCommit: (clientId: string, field: string, value: unknown) => void
  onFillStart: (startRow: number, field: string, value: string | string[], e: React.MouseEvent) => void
}

function DropdownCellWrapper({
  value,
  label,
  options,
  clientId,
  field,
  rowIndex,
  issue,
  validationTint,
  onCommit,
  onFillStart,
}: DropdownCellWrapperProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null)

  const handleOpen = useCallback(() => {
    if (triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect())
      setOpen(true)
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        handleOpen()
      }
    },
    [handleOpen],
  )

  const handleSelect = useCallback(
    (val: string) => {
      onCommit(clientId, field, val)
      setOpen(false)
      // Return focus to the trigger
      requestAnimationFrame(() => triggerRef.current?.focus())
    },
    [clientId, field, onCommit],
  )

  const handleClose = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const triggerStyle: React.CSSProperties = validationTint
    ? { background: `linear-gradient(180deg, ${validationTint}, ${validationTint}), linear-gradient(180deg, #ffffff, var(--ceramic-cell-soft))` }
    : {}

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ceramic-dropdown-trigger"
        data-empty={!value || undefined}
        data-issue={issue}
        data-fill-cell
        data-row={rowIndex}
        data-field={field}
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={triggerStyle}
      >
        {label || "\u00A0"}
        <span
          className="ceramic-fill-handle"
          title="Drag to fill (same column)"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => onFillStart(rowIndex, field, value, e)}
        />
      </button>
      {open && triggerRect && (
        <CeramicDropdown
          options={options}
          value={value}
          onSelect={handleSelect}
          onClose={handleClose}
          triggerRect={triggerRect}
        />
      )}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SkuSheetCeramic({
  rows,
  onRowsChange,
  dropdowns,
  createEmptyRow,
  onUndo,
  onRedo,
}: SkuSheetCeramicProps) {
  const { t, i18n } = useTranslation()
  const isHe = i18n.language === "he"
  const containerRef = useRef<HTMLDivElement>(null)

  // Fresh references for document-level drag listeners (avoid stale closures)
  const rowsRef = useRef(rows)
  const onRowsChangeRef = useRef(onRowsChange)
  useEffect(() => {
    rowsRef.current = rows
    onRowsChangeRef.current = onRowsChange
  })

  // ── Fill-down drag (the corner handle) ────────────────────────────────
  const fillPreviewEls = useRef<HTMLElement[]>([])

  const clearFillPreview = useCallback(() => {
    for (const el of fillPreviewEls.current) {
      el.classList.remove("ceramic-fill-target")
      el.querySelectorAll(".ceramic-fill-ghost").forEach((g) => g.remove())
    }
    fillPreviewEls.current = []
  }, [])

  const handleFillStart = useCallback(
    (startRow: number, field: string, value: string | string[], e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const container = containerRef.current
      if (!container) return

      const isSku = field === "sku"
      let endRow = startRow
      let overWrongColumn = false

      // Dropdown values travel as their display label, like a committed cell
      const colDef = COLUMNS.find((c) => c.field === field)
      const isImage = colDef?.type === "image-multi" || colDef?.type === "image-single"
      const toDisplay = (raw: string) =>
        colDef?.dropdownKey
          ? getDropdownLabel(raw, dropdowns[colDef.dropdownKey] ?? [], isHe)
          : raw

      // OS-style drag image following the cursor — text for regular cells,
      // a thumbnail (+count) for image cells
      const chip = document.createElement("div")
      chip.className = "ceramic-drag-chip"
      const renderChip = (state: "valid" | "invalid", offset = 0) => {
        chip.innerHTML = ""
        if (state === "invalid") {
          chip.dataset.invalid = "true"
          chip.textContent = `⊘ ${t("sku.grid.fillColumnMismatch")}`
          return
        }
        delete chip.dataset.invalid
        if (isImage) {
          const urls = Array.isArray(value) ? value : value ? [value] : []
          const img = document.createElement("img")
          img.src = urls[0] ?? ""
          img.alt = ""
          img.style.cssText =
            "width:24px;height:24px;border-radius:7px;object-fit:cover;box-shadow:0 1px 3px rgba(0,0,0,.3);"
          chip.appendChild(img)
          if (urls.length > 1) {
            const count = document.createElement("span")
            count.textContent = `+${urls.length - 1}`
            chip.appendChild(count)
          }
        } else {
          chip.textContent = toDisplay(fillValueAt(value as string, offset, isSku))
        }
      }
      renderChip("valid", 0)
      document.body.appendChild(chip)
      const moveChip = (x: number, y: number) => {
        chip.style.left = `${x + 14}px`
        chip.style.top = `${y + 16}px`
      }
      moveChip(e.clientX, e.clientY)

      document.body.classList.add("ceramic-fill-dragging")

      // Cells that already hold a value are never overwritten by a fill
      const isOccupied = (rowIdx: number) => {
        const row = rowsRef.current[rowIdx]
        return Boolean(row && getFieldValue(row, field).trim())
      }

      // Ghost preview: every covered cell already shows (faded) exactly what
      // will land in it on release — text, dropdown label, or thumbnail
      const makeGhost = (rowOffset: number): HTMLElement => {
        const ghost = document.createElement("span")
        ghost.className = "ceramic-fill-ghost"
        if (isImage) {
          const urls = Array.isArray(value) ? value : value ? [value] : []
          if (urls[0]) {
            const img = document.createElement("img")
            img.src = urls[0]
            img.alt = ""
            ghost.appendChild(img)
            if (urls.length > 1) {
              const count = document.createElement("span")
              count.className = "ceramic-fill-ghost-count"
              count.textContent = `+${urls.length - 1}`
              ghost.appendChild(count)
            }
          }
        } else {
          ghost.textContent = toDisplay(fillValueAt(value as string, rowOffset, isSku))
        }
        return ghost
      }

      const updatePreview = () => {
        clearFillPreview()
        if (overWrongColumn || endRow === startRow) return
        const lo = Math.min(startRow, endRow)
        const hi = Math.max(startRow, endRow)
        for (let r = lo; r <= hi; r++) {
          if (r === startRow || isOccupied(r)) continue
          const el = container.querySelector<HTMLElement>(
            `[data-fill-cell][data-row="${r}"][data-field="${field}"]`,
          )
          if (el) {
            el.classList.add("ceramic-fill-target")
            el.appendChild(makeGhost(r - startRow))
            fillPreviewEls.current.push(el)
          }
        }
      }

      const onMove = (me: MouseEvent) => {
        moveChip(me.clientX, me.clientY)

        // Which cell is under the cursor?
        let hovered: { row: number; field: string } | null = null
        for (const el of document.elementsFromPoint(me.clientX, me.clientY)) {
          const cellEl = (el as HTMLElement).closest?.("[data-fill-cell]") as HTMLElement | null
          if (cellEl) {
            const rowAttr = cellEl.getAttribute("data-row")
            const cellField = cellEl.getAttribute("data-field")
            if (rowAttr != null && cellField) {
              hovered = { row: parseInt(rowAttr, 10), field: cellField }
            }
            break
          }
        }
        if (!hovered) return

        if (hovered.field !== field) {
          // Different column — filling is same-column only
          overWrongColumn = true
          renderChip("invalid")
          document.body.classList.add("ceramic-fill-invalid")
          updatePreview()
          return
        }

        overWrongColumn = false
        document.body.classList.remove("ceramic-fill-invalid")
        endRow = Math.max(0, Math.min(hovered.row, rowsRef.current.length - 1))
        // Chip shows exactly what will land at the hovered row
        renderChip("valid", endRow - startRow)
        updatePreview()
      }

      const cleanup = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        document.removeEventListener("keydown", onKey, true)
        document.body.classList.remove("ceramic-fill-dragging", "ceramic-fill-invalid")
        chip.remove()
        clearFillPreview()
      }

      // Esc cancels the drag — nothing is filled, cursor returns to normal
      const onKey = (ke: KeyboardEvent) => {
        if (ke.key === "Escape") {
          ke.preventDefault()
          ke.stopPropagation()
          cleanup()
        }
      }

      const onUp = () => {
        cleanup()

        if (overWrongColumn) {
          toast.error(t("sku.grid.fillColumnMismatch"))
          return
        }
        if (endRow === startRow) return

        const lo = Math.min(startRow, endRow)
        const hi = Math.max(startRow, endRow)
        const newRows = rowsRef.current.map((r, i) => {
          if (i < lo || i > hi || i === startRow) return r
          // Skip cells that already have a value
          if (getFieldValue(r, field).trim()) return r
          return {
            ...r,
            // Image cells copy the URL reference(s); SKU increments; rest copy
            [field]: Array.isArray(value)
              ? [...value]
              : fillValueAt(value, i - startRow, isSku),
            _isDirty: true,
            _validationStatus: "unchecked" as SkuValidationStatus,
          }
        })
        onRowsChangeRef.current(newRows)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
      document.addEventListener("keydown", onKey, true)
    },
    [clearFillPreview, dropdowns, isHe, t],
  )

  // ── Grid template columns ─────────────────────────────────────────────
  const gridTemplateColumns = useMemo(
    () =>
      COLUMNS.map((c) =>
        c.type === "index"
          ? `${c.minWidth}px`
          : `minmax(${c.minWidth}px, ${c.minWidth < 120 ? "1fr" : "1.2fr"})`,
      ).join(" "),
    [],
  )

  const gridMinWidth = useMemo(
    () => COLUMNS.reduce((sum, c) => sum + c.minWidth + 8, 0),
    [],
  )

  // ── Duplicate SKU detection ───────────────────────────────────────────
  const duplicateSkus = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const sku = row.sku?.trim()
      if (sku) counts.set(sku, (counts.get(sku) ?? 0) + 1)
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([sku]) => sku))
  }, [rows])

  // ── Cell commit (text fields commit on blur / Enter) ──────────────────
  const onCellCommit = useCallback(
    (clientId: string, field: string, value: unknown) => {
      const newRows = rows.map((r) =>
        (r._clientId ?? r.sku) === clientId
          ? {
              ...r,
              [field]: value,
              _isDirty: true,
              _validationStatus: "unchecked" as SkuValidationStatus,
            }
          : r,
      )
      onRowsChange(newRows)
    },
    [rows, onRowsChange],
  )

  // ── Image row change ──────────────────────────────────────────────────
  const onImageRowChange = useCallback(
    (updatedRow: SkuMetadataRow) => {
      const newRows = rows.map((r) =>
        (r._clientId ?? r.sku) === (updatedRow._clientId ?? updatedRow.sku)
          ? updatedRow
          : r,
      )
      onRowsChange(newRows)
    },
    [rows, onRowsChange],
  )

  // ── Navigation (Enter/Alt+Arrow) ──────────────────────────────────────
  const onNavigate = useCallback(
    (rowIndex: number, colIndex: number, direction: "down" | "up") => {
      const nextRow = direction === "down" ? rowIndex + 1 : rowIndex - 1
      if (nextRow < 0 || nextRow >= rows.length) return
      // Find the input in the next row at the same column
      requestAnimationFrame(() => {
        const input = containerRef.current?.querySelector<HTMLElement>(
          `[data-row="${nextRow}"][data-col="${colIndex}"].ceramic-field`,
        )
        if (input) {
          input.focus()
        } else {
          // Try finding any focusable at that position (dropdown trigger, etc.)
          const cell = containerRef.current?.querySelector<HTMLElement>(
            `.ceramic-dropdown-trigger[data-row="${nextRow}"][data-col="${colIndex}"]`,
          )
          cell?.focus()
        }
      })
    },
    [rows.length],
  )

  // ── Keyboard shortcuts (Ctrl+Z/Y on the container) ────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+Z / Ctrl+Y — always intercept
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault()
        onUndo()
      } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault()
        onRedo()
      }
    }

    container.addEventListener("keydown", handleKeyDown)
    return () => container.removeEventListener("keydown", handleKeyDown)
  }, [onUndo, onRedo])

  // ── Paste handler ─────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function handlePaste(e: ClipboardEvent) {
      const text = e.clipboardData?.getData("text/plain") ?? ""
      if (!text.includes("\t") && !text.includes("\n")) return

      // Multi-cell paste
      e.preventDefault()
      const activeEl = document.activeElement as HTMLElement | null
      const rowAttr = activeEl?.getAttribute("data-row")
      const colAttr = activeEl?.getAttribute("data-col")
      if (rowAttr == null || colAttr == null) return

      const startRow = parseInt(rowAttr, 10)
      const startCol = parseInt(colAttr, 10)

      const pasteRows = text.split(/\r?\n/).filter((line) => line.length > 0)
      const newRows = [...rows]

      // Grow if needed
      while (startRow + pasteRows.length > newRows.length) {
        newRows.push(createEmptyRow())
      }

      for (let ri = 0; ri < pasteRows.length; ri++) {
        const pasteCols = pasteRows[ri].split("\t")
        let colOffset = 0

        for (let ci = 0; ci < pasteCols.length; ci++) {
          // Walk columns from startCol, skipping readonly/image
          while (startCol + colOffset + ci < COLUMNS.length) {
            const col = COLUMNS[startCol + colOffset + ci]
            if (!col) break
            if (WRITABLE_FIELDS.has(col.field)) break
            colOffset++
          }

          const targetColIdx = startCol + colOffset + ci
          if (targetColIdx >= COLUMNS.length) break
          const col = COLUMNS[targetColIdx]
          if (!col || !WRITABLE_FIELDS.has(col.field)) continue

          const targetRowIdx = startRow + ri
          if (targetRowIdx >= newRows.length) break

          newRows[targetRowIdx] = {
            ...newRows[targetRowIdx],
            [col.field]: pasteCols[ci],
            _isDirty: true,
            _validationStatus: "unchecked" as SkuValidationStatus,
          }
        }
      }

      onRowsChange(newRows)
    }

    container.addEventListener("paste", handlePaste)
    return () => container.removeEventListener("paste", handlePaste)
  }, [rows, onRowsChange, createEmptyRow])

  return (
    <div ref={containerRef} className="ceramic-sheet-root">
      <style>{CERAMIC_CSS}</style>

      <div className="ceramic-panel">
        <div
          className="ceramic-grid"
          style={{
            gridTemplateColumns,
            minWidth: gridMinWidth,
          }}
        >
          {/* Header row */}
          {COLUMNS.map((col) => (
            <div key={`h-${col.field}`} className="ceramic-head">
              {col.field === "rowNumber" ? "#" : t(getHeaderKey(col.field))}
            </div>
          ))}

          {/* Data rows */}
          {rows.map((row, rowIndex) => (
            <CeramicRow
              key={row._clientId ?? row.sku ?? rowIndex}
              row={row}
              rowIndex={rowIndex}
              columns={COLUMNS}
              dropdowns={dropdowns}
              isDuplicate={!!row.sku?.trim() && duplicateSkus.has(row.sku.trim())}
              t={t}
              isHe={isHe}
              onCellCommit={onCellCommit}
              onRowChange={onImageRowChange}
              onNavigate={onNavigate}
              onFillStart={handleFillStart}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
