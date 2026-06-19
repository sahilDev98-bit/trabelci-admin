import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
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
import { useSkuDeleteMutation } from "@/features/skuManagement/api"
import { useCheckboxDragSelect } from "@/lib/useCheckboxDragSelect"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CeramicDropdown } from "./CeramicDropdown"
import { CeramicImageCell } from "./CeramicImageCell"

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SkuSheetCeramicHandle {
  deleteSelected: () => void
  clearSelection: () => void
}

export interface SkuSheetCeramicProps {
  rows: SkuMetadataRow[]
  onRowsChange: (rows: SkuMetadataRow[]) => void
  dropdowns: SkuDropdownMap
  /** "cleanup" adds the original SAP name column and locks the SKU column.
   *  Default: "creation". */
  mode?: "creation" | "cleanup"
  /** Lets multi-row paste grow the sheet (creation mode only) */
  createEmptyRow?: () => SkuMetadataRow
  onUndo?: () => void
  onRedo?: () => void
  /** Show per-row checkboxes for multi-select bulk delete */
  showCheckbox?: boolean
  /** A row is "meaningful" for select-all purposes (excludes blank padding rows).
   *  Defaults to every row being meaningful. */
  isMeaningfulRow?: (row: SkuMetadataRow) => boolean
  /** Total record count across all pages — used for the "Select all X" banner text */
  totalCount?: number
  /** Called whenever the selection count or page-full-selection state changes */
  onSelectionChange?: (info: { count: number; pageFullySelected: boolean }) => void

  // ── Controlled selection (cleanup page lifts state to parent) ──────────────
  /** If provided, determines whether a row is checked (bypasses internal selectedKeys) */
  isRowSelected?: (row: SkuMetadataRow) => boolean
  /** If provided, called when a row checkbox is toggled */
  onRowToggle?: (key: string) => void
  /** Controlled header checkbox checked state */
  headerChecked?: boolean
  /** Controlled header checkbox indeterminate state */
  headerIndeterminate?: boolean
  /** Controlled header checkbox onChange */
  onHeaderToggle?: () => void
}

// ─── Column definitions ───────────────────────────────────────────────────────

type ColType =
  | "index"
  | "checkbox"
  | "text"
  | "dropdown"
  | "image-multi"
  | "image-single"
  | "readonly"

interface CeramicColumn {
  field: string
  type: ColType
  minWidth: number
  /** For dropdown columns — the key into SkuDropdownMap */
  dropdownKey?: string
  /** For image columns */
  imageType?: "product" | "gallery"
  /** Text columns that can be viewed/copied but never edited */
  readOnly?: boolean
  /** Muted italic styling (original SAP values) */
  italic?: boolean
}

const COLUMNS: CeramicColumn[] = [
  { field: "rowNumber",          type: "index",        minWidth: 44  },
  { field: "sku",                type: "text",         minWidth: 140 },
  // Cleanup-only — the raw, unedited name SAP already has for this item.
  // Shown for reference (muted italic) so the user can see what they're
  // cleaning up against; filtered out for the New Creation grid in
  // buildColumns since a not-yet-created row has no SAP name at all.
  { field: "original_sap_name",  type: "text",         minWidth: 180, readOnly: true, italic: true },
  { field: "supplier",           type: "text",         minWidth: 130 },
  { field: "series",             type: "text",         minWidth: 120 },
  { field: "color",              type: "text",         minWidth: 110 },
  // Dropdown widths leave room for the longest vocabulary label on ONE line
  // (e.g. "120×240 cm", "Floor + Wall", "Natural Stone") — no wrapping,
  // no ellipsis, per design decision
  { field: "size",               type: "dropdown",     minWidth: 130, dropdownKey: "size"              },
  { field: "finish",             type: "dropdown",     minWidth: 125, dropdownKey: "finish"            },
  { field: "product_image_urls", type: "image-multi",  minWidth: 170, imageType: "product" },
  { field: "gallery_image_urls", type: "image-multi",  minWidth: 170, imageType: "gallery" },
  { field: "country_of_origin",  type: "dropdown",     minWidth: 130, dropdownKey: "country_of_origin" },
  { field: "qty_per_carton",     type: "text",         minWidth: 110 },
  { field: "qty_per_pallet",     type: "text",         minWidth: 110 },
  { field: "shade",              type: "dropdown",     minWidth: 110, dropdownKey: "shade" },
  { field: "supplier_code",      type: "text",         minWidth: 110 },
  { field: "display_name_en",    type: "text",         minWidth: 180 },
  { field: "series_en",          type: "text",         minWidth: 120 },
  { field: "color_en",           type: "text",         minWidth: 110 },
  { field: "supplier_sku",       type: "text",         minWidth: 130 },
  { field: "status",             type: "readonly",     minWidth: 110 },
]

// Cleanup mode: SKU column is readonly (cannot be renamed in cleanup workflow);
// New Creation mode never has an original SAP name, so that column is dropped.
function buildColumns(mode: "creation" | "cleanup", showCheckbox?: boolean): CeramicColumn[] {
  let cols = mode === "cleanup"
    ? COLUMNS.map((col) => col.field === "sku" ? { ...col, readOnly: true } : col)
    : COLUMNS.filter((col) => col.field !== "original_sap_name")
  if (showCheckbox) {
    cols = [{ field: "__checkbox__", type: "checkbox" as const, minWidth: 36 }, ...cols]
  }
  return cols
}

function getHeaderKey(field: string): string {
  if (field === "rowNumber") return "#"
  return `sku.fields.${field}`
}

/** May paste/clear/fill write into this column? */
function isWritableCol(col: CeramicColumn | undefined): boolean {
  if (!col || col.readOnly) return false
  return col.type === "text" || col.type === "dropdown"
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
    /* Text/dropdown box surface — light theme keeps the ivory card look */
    --ceramic-rect-bg: linear-gradient(180deg, #ffffff, var(--ceramic-cell-soft));
    --ceramic-rect-text: var(--ceramic-ink);

    /* light theme surfaces */
    --ceramic-head-text: #1f2433;
    --ceramic-head-border: rgba(30, 36, 60, 0.12);
    --ceramic-muted-text: #8a90a8;
    /* neutral zinc chip matching the admin light surfaces */
    --ceramic-idx-bg: linear-gradient(150deg, #f4f4f5, #e4e4e7);
    --ceramic-idx-text: #52525b;
    --ceramic-idx-shadow: inset 0 1px 2px rgba(24,24,27,.10), 0 1px 0 rgba(255,255,255,.8);
    --ceramic-scrollbar-thumb: rgba(30,36,60,.25);
    --ceramic-scrollbar-thumb-hover: rgba(30,36,60,.45);
    /* round "+" buttons: same white pill in BOTH themes */
    --ceramic-btn-bg: linear-gradient(150deg, #fafafa, #d9d9de);
    --ceramic-btn-fg: #18181b;
    --ceramic-btn-shadow: 0 5px 12px -4px rgba(20,22,30,.35), inset 0 1px 0 rgba(255,255,255,.8), 0 0 0 1px rgba(24,24,27,.08);
    --ceramic-chip-border: rgba(24,26,34,.45);
    --ceramic-chip-bg: rgba(24,26,34,.06);
    --ceramic-chip-text: #3f414d;
    --ceramic-shadow-rest: 0 1px 1px rgba(20,24,48,.10), 0 8px 18px -10px rgba(20,24,48,.25), inset 0 1px 0 rgba(255,255,255,.85);
    --ceramic-shadow-hover: 0 2px 4px rgba(20,24,48,.12), 0 14px 26px -12px rgba(20,24,48,.30), inset 0 1px 0 rgba(255,255,255,.95);
    --ceramic-menu-shadow: 0 2px 4px rgba(20,24,48,.12), 0 14px 26px -12px rgba(20,24,48,.30);
    --ceramic-rect-border: 1px solid rgba(30,36,60,.10);
    /* Sticky header/columns sit on the page background so scrolled content
       doesn't show through */
    --ceramic-sticky-bg: var(--background);
    --ceramic-menu-hover: rgba(15,23,42,.06);

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
    /* Text/dropdown boxes match the "#" index chip exactly in dark mode —
       same dark gradient, same light text — instead of staying ivory. */
    --ceramic-rect-bg: var(--ceramic-idx-bg);
    --ceramic-rect-text: #ffffff;
    --ceramic-scrollbar-thumb: rgba(255,255,255,.18);
    --ceramic-scrollbar-thumb-hover: rgba(255,255,255,.32);
    --ceramic-btn-shadow: 0 6px 14px -4px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.7);
    --ceramic-chip-border: rgba(255,255,255,.45);
    --ceramic-chip-bg: rgba(255,255,255,.07);
    --ceramic-chip-text: #e4e4e7;
    --ceramic-shadow-rest: 0 1px 1px rgba(0,0,0,.45), 0 10px 22px -10px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.85);
    --ceramic-shadow-hover: 0 2px 4px rgba(0,0,0,.5), 0 18px 34px -12px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.95);
    --ceramic-menu-shadow: 0 2px 4px rgba(0,0,0,.5), 0 18px 34px -12px rgba(0,0,0,.65);
    --ceramic-rect-border: 1px solid rgba(255,255,255,.10);
    --ceramic-menu-hover: rgba(255,255,255,.08);
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
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--ceramic-sticky-bg);
    /* Extend the header's background over the panel's 4px top padding and
       the 10px grid row-gap below it, so a vertically-scrolling row can't
       peek through either gap */
    box-shadow: 0 -4px 0 0 var(--ceramic-sticky-bg), 0 10px 0 0 var(--ceramic-sticky-bg);
  }

  .ceramic-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px 4px;
  }

  /* Frozen "#" and "sku" columns (always columns 0 and 1) — pinned to the
     left edge of .ceramic-panel while the sheet scrolls horizontally */
  .ceramic-cell-sticky {
    position: sticky;
    z-index: 3;
    background: var(--ceramic-sticky-bg);
    /* outline: none suppresses the browser's native focus ring (black border)
       that appears on Windows when pressing ALT or navigating with keyboard */
    outline: none;
    /* 8px fills the grid column-gap; the faint separator shadow makes the
       frozen edge crisp so any minor card-shadow bleed is imperceptible */
    box-shadow:
      8px 0 0 0 var(--ceramic-sticky-bg),
      2px 0 6px -1px rgba(20, 24, 48, 0.07);
  }
  .ceramic-cell-sticky-0 {
    /* inset-inline-start: left edge in LTR (English), right edge in RTL
       (Hebrew) — keeps "#" pinned to the leading edge in both directions */
    inset-inline-start: 0;
    /* Also cover the panel's leading-edge padding next to "#" */
    box-shadow:
      -4px 0 0 0 var(--ceramic-sticky-bg),
      8px 0 0 0 var(--ceramic-sticky-bg);
  }
  /* 44px "#" column + 8px grid column-gap, so column 1 sticks at the same
     spot it occupies unscrolled (no jump when it engages) */
  .ceramic-cell-sticky-1 {
    inset-inline-start: 52px;
  }
  /* Corner cells (frozen header × frozen column) sit above everything.
     Re-declare the combined horizontal + vertical box-shadow coverage here —
     a single box-shadow declaration on .ceramic-head or .ceramic-cell-sticky
     alone would otherwise be fully overridden (box-shadow doesn't merge
     across rules of equal specificity). */
  .ceramic-head.ceramic-cell-sticky {
    z-index: 6;
    box-shadow:
      8px 0 0 0 var(--ceramic-sticky-bg),
      2px 0 6px -1px rgba(20, 24, 48, 0.07),
      0 -4px 0 0 var(--ceramic-sticky-bg),
      0 10px 0 0 var(--ceramic-sticky-bg);
  }
  .ceramic-head.ceramic-cell-sticky-0 {
    box-shadow:
      -4px 0 0 0 var(--ceramic-sticky-bg),
      8px 0 0 0 var(--ceramic-sticky-bg),
      0 -4px 0 0 var(--ceramic-sticky-bg),
      0 10px 0 0 var(--ceramic-sticky-bg);
  }

  /* RTL (Hebrew): columns 0/1 are pinned to the right edge instead of the
     left, so the horizontal box-shadow coverage must flip direction —
     extend toward the left (column-gap / rest of the grid) instead of
     the right, and cover the panel's right padding instead of its left */
  html[dir="rtl"] .ceramic-cell-sticky {
    box-shadow:
      -8px 0 0 0 var(--ceramic-sticky-bg),
      -2px 0 6px -1px rgba(20, 24, 48, 0.07);
  }
  html[dir="rtl"] .ceramic-cell-sticky-0 {
    box-shadow: 4px 0 0 0 var(--ceramic-sticky-bg), -8px 0 0 0 var(--ceramic-sticky-bg);
  }
  html[dir="rtl"] .ceramic-head.ceramic-cell-sticky {
    box-shadow:
      -8px 0 0 0 var(--ceramic-sticky-bg),
      -2px 0 6px -1px rgba(20, 24, 48, 0.07),
      0 -4px 0 0 var(--ceramic-sticky-bg),
      0 10px 0 0 var(--ceramic-sticky-bg);
  }
  html[dir="rtl"] .ceramic-head.ceramic-cell-sticky-0 {
    box-shadow:
      4px 0 0 0 var(--ceramic-sticky-bg),
      -8px 0 0 0 var(--ceramic-sticky-bg),
      0 -4px 0 0 var(--ceramic-sticky-bg),
      0 10px 0 0 var(--ceramic-sticky-bg);
  }

  .ceramic-rect {
    width: var(--ceramic-rect-w);
    height: var(--ceramic-rect-h);
    border-radius: var(--ceramic-radius);
    background: var(--ceramic-rect-bg);
    border: var(--ceramic-rect-border);
    box-shadow: none;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform .22s cubic-bezier(.22,.8,.32,1);
    cursor: text;
    position: relative;
  }
  .ceramic-rect:hover,
  .ceramic-rect:focus-within {
    transform: translateY(-3px);
  }

  .ceramic-rect[data-validation-tint] {
    background: var(--ceramic-rect-bg);
  }

  .ceramic-field {
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    text-align: center;
    color: var(--ceramic-rect-text);
    border-radius: var(--ceramic-radius);
    font: 600 14px/1 'DM Sans', 'Heebo', sans-serif;
    padding: 0 8px;
    outline: none;
  }
  .ceramic-field:focus {
    box-shadow: 0 0 0 3px var(--ceramic-accent-soft);
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
    background: var(--ceramic-rect-bg);
    border: var(--ceramic-rect-border);
    box-shadow: none;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform .22s cubic-bezier(.22,.8,.32,1);
    cursor: pointer;
    position: relative;
    font: 600 14px/1 'DM Sans', 'Heebo', sans-serif;
    color: var(--ceramic-rect-text);
    padding: 0 22px 0 10px;
    text-align: center;
    outline: none;
    white-space: nowrap;
  }
  .ceramic-dropdown-trigger:hover,
  .ceramic-dropdown-trigger:focus {
    transform: translateY(-3px);
  }
  .ceramic-dropdown-trigger:focus {
    box-shadow: 0 0 0 3px var(--ceramic-accent-soft);
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
    box-shadow: none;
    transition: transform .22s ease;
  }
  .ceramic-thumb:hover {
    transform: translateY(-3px) scale(1.04);
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
    color: var(--ceramic-rect-text);
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
    box-shadow: 0 0 0 2px rgba(239,68,68,.55);
  }
  .ceramic-rect[data-issue="warning"],
  .ceramic-dropdown-trigger[data-issue="warning"] {
    background: linear-gradient(180deg, #fffaf0, #fbeed3);
    box-shadow: 0 0 0 2px rgba(217,119,6,.45);
  }

  /* Fill handle — a bare "v" chevron on the cell corner (no background,
     like the approved reference); drag to fill */
  .ceramic-fill-handle {
    position: absolute;
    bottom: -9px;
    inset-inline-end: -11px;
    width: 16px;
    height: 14px;
    background: none;
    border: none;
    box-shadow: none;
    cursor: grab;
    opacity: 0;
    transition: opacity .15s ease;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ceramic-fill-handle::after {
    content: "";
    width: 7px;
    height: 7px;
    border-right: 2.5px solid var(--ceramic-chip-text);
    border-bottom: 2.5px solid var(--ceramic-chip-text);
    border-radius: 1px;
    transform: rotate(45deg);
    margin-top: -4px;
  }
  .ceramic-fill-handle:hover::after {
    border-color: var(--ceramic-ink);
  }
  .dark .ceramic-fill-handle:hover::after {
    border-color: #ffffff;
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
    box-shadow: inset 0 0 0 1.5px rgba(24,24,27,.4) !important;
  }
  .dark .ceramic-fill-target {
    box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.5) !important;
  }
  .ceramic-fill-ghost {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 600 14px/1 'DM Sans', 'Heebo', sans-serif;
    color: var(--ceramic-rect-text);
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

  /* Multi-cell range selection (Shift+Click / Shift+↑↓ / Ctrl+A) */
  .ceramic-sel-cell {
    box-shadow: inset 0 0 0 2px rgba(24,26,34,.45) !important;
    background-image: linear-gradient(rgba(24,26,34,.07), rgba(24,26,34,.07)),
      linear-gradient(180deg, #ffffff, var(--ceramic-cell-soft)) !important;
  }
  .dark .ceramic-sel-cell {
    box-shadow: inset 0 0 0 2px rgba(255,255,255,.55) !important;
  }
  .ceramic-img-group.ceramic-sel-cell {
    box-shadow: none !important;
    background-image: none !important;
    outline: 2px dashed rgba(24,26,34,.45);
    outline-offset: 3px;
    border-radius: var(--ceramic-radius);
  }
  .dark .ceramic-img-group.ceramic-sel-cell {
    outline-color: rgba(255,255,255,.55);
  }

  /* Right-click row menu (Delete row) */
  .ceramic-context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 170px;
    background: var(--background);
    border: 1px solid var(--ceramic-head-border);
    border-radius: 10px;
    box-shadow: var(--ceramic-menu-shadow);
    padding: 4px;
  }
  .ceramic-context-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 9px 12px;
    border: none;
    background: none;
    border-radius: 7px;
    cursor: pointer;
    text-align: start;
    color: var(--ceramic-head-text);
    font: 600 13.5px/1.2 'DM Sans', 'Heebo', sans-serif;
  }
  .ceramic-context-menu-item:hover {
    background: var(--ceramic-menu-hover);
  }
  .ceramic-context-menu-item-danger {
    color: #ef4444;
  }
  .ceramic-context-menu-item-danger:hover {
    background: rgba(239,68,68,.12);
  }

  /* ── Per-column text expand / truncate ───────────────────────────────────── */

  /* Truncate when not focused (browser already clips inputs, this adds "…") */
  .ceramic-field:not(:focus) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Dropdown trigger: clip the label with ellipsis at column boundary */
  .ceramic-dropdown-trigger {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Expanded column: column track is widened to fit — just un-clip the text */
  .ceramic-rect.ceramic-col-expanded .ceramic-field,
  .ceramic-rect.ceramic-col-expanded .ceramic-field:not(:focus) {
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
  }
  .ceramic-dropdown-trigger.ceramic-col-expanded {
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
    max-width: none;
  }

  /* Clickable column header toggle */
  .ceramic-head-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    height: 100%;
    background: none;
    border: none;
    color: var(--ceramic-head-text);
    font: 700 13.5px/1 'DM Sans', 'Heebo', sans-serif;
    letter-spacing: .01em;
    cursor: pointer;
    padding: 0 2px;
    border-radius: 3px;
    transition: background .12s, color .12s;
  }
  .ceramic-head-btn:hover {
    background: rgba(30,36,60,.06);
  }
  .dark .ceramic-head-btn:hover {
    background: rgba(255,255,255,.06);
  }
  .ceramic-head-btn-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .ceramic-head-btn-icon {
    flex-shrink: 0;
    font-size: 9px;
    opacity: 0.3;
    line-height: 1;
  }
  .ceramic-head.ceramic-head-col-expanded .ceramic-head-btn {
    color: #2563eb;
  }
  .dark .ceramic-head.ceramic-head-col-expanded .ceramic-head-btn {
    color: #60a5fa;
  }
  .ceramic-head.ceramic-head-col-expanded .ceramic-head-btn-icon {
    opacity: 0.75;
  }
  .ceramic-head.ceramic-head-col-expanded .ceramic-head-btn:hover {
    background: rgba(37,99,235,.07);
  }
  .dark .ceramic-head.ceramic-head-col-expanded .ceramic-head-btn:hover {
    background: rgba(96,165,250,.09);
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

  /* ── Checkbox column ─────────────────────────────────────────────────────── */
  .ceramic-checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--ceramic-ink);
    border-radius: 3px;
    flex-shrink: 0;
  }
  .ceramic-checkbox:focus-visible {
    outline: 2px solid var(--ceramic-accent);
    outline-offset: 2px;
  }

  /* Third sticky column (sku) when checkbox is present: position is set directly,
     only rendered when showCheckbox=true so no conflict with the non-checkbox layout */
  .ceramic-cell-sticky-2 {
    inset-inline-start: 96px; /* 36px checkbox + 8px gap + 44px # + 8px gap */
  }
  /* Shift "#" column right to make room for the checkbox column */
  .ceramic-has-checkbox .ceramic-cell-sticky-1 {
    inset-inline-start: 44px; /* 36px checkbox + 8px gap */
  }

  /* Selected-row blue tint on card elements */
  .ceramic-row-selected .ceramic-rect,
  .ceramic-row-selected .ceramic-dropdown-trigger {
    background: linear-gradient(180deg, #eff6ff, #dbeafe) !important;
    border-color: rgba(59,130,246,.25) !important;
  }
  .dark .ceramic-row-selected .ceramic-rect,
  .dark .ceramic-row-selected .ceramic-dropdown-trigger {
    background: linear-gradient(180deg, rgba(59,130,246,.12), rgba(59,130,246,.08)) !important;
    border-color: rgba(59,130,246,.35) !important;
  }
  .ceramic-row-selected .ceramic-idx {
    background: linear-gradient(150deg, #dbeafe, #bfdbfe);
    color: #1d4ed8;
    box-shadow: none;
  }
  .dark .ceramic-row-selected .ceramic-idx {
    background: linear-gradient(150deg, rgba(59,130,246,.2), rgba(59,130,246,.12));
    color: #93c5fd;
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
  sheetMode?: "creation" | "cleanup"
  showCheckbox?: boolean
  isSelected?: boolean
  onToggleSelect?: (key: string) => void
  onCheckboxDragStart?: (rowIndex: number, e: React.MouseEvent) => void
  expandedCols?: Set<string>
}

type CellIssue = { kind: "error" | "warning"; message: string } | undefined

/** Row/column coordinates of a cell (column = index into COLUMNS) */
interface CellRC {
  r: number
  c: number
}

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
  sheetMode = "creation",
  showCheckbox = false,
  isSelected = false,
  onToggleSelect,
  onCheckboxDragStart,
  expandedCols,
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

  const rowKey = row._clientId ?? row.sku ?? ""
  const sel = isSelected ? " ceramic-row-selected" : ""

  // Sticky column positions shift when the checkbox column is prepended:
  // showCheckbox=false: 0=# (sticky-0), 1=sku (sticky-1)
  // showCheckbox=true:  0=checkbox (sticky-0), 1=# (sticky-1), 2=sku (sticky-2)
  const cellClassName = (colIndex: number): string => {
    if (showCheckbox) {
      if (colIndex === 0) return `ceramic-cell ceramic-cell-sticky ceramic-cell-sticky-0${sel}`
      if (colIndex === 1) return `ceramic-cell ceramic-cell-sticky ceramic-cell-sticky-1${sel}`
      if (colIndex === 2) return `ceramic-cell ceramic-cell-sticky ceramic-cell-sticky-2${sel}`
      return `ceramic-cell${sel}`
    }
    if (colIndex === 0) return `ceramic-cell ceramic-cell-sticky ceramic-cell-sticky-0${sel}`
    if (colIndex === 1) return `ceramic-cell ceramic-cell-sticky ceramic-cell-sticky-1${sel}`
    return `ceramic-cell${sel}`
  }

  return (
    <>
      {columns.map((col, colIndex) => {
        const issue = getFieldIssue(col.field)

        if (col.type === "checkbox") {
          return (
            <div
              key="__checkbox__"
              className={`ceramic-cell ceramic-cell-sticky ceramic-cell-sticky-0${sel}`}
              data-row-index={rowIndex}
            >
              <input
                type="checkbox"
                className="ceramic-checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect?.(rowKey)}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  onCheckboxDragStart?.(rowIndex, e)
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )
        }

        if (col.type === "index") {
          return (
            <div key={col.field} className={cellClassName(colIndex)} data-row-index={rowIndex}>
              <div className="ceramic-idx">{rowIndex + 1}</div>
            </div>
          )
        }

        if (col.type === "readonly") {
          const status = row.status ?? ""
          let labelKey = `sku.status.${status}`
          if (sheetMode === "cleanup") {
            if (status === "cleanup_only") labelKey = "sku.cleanup.status.pending"
            else if (status === "approved") labelKey = "sku.cleanup.status.cleaned"
          }
          const label = t(labelKey, { defaultValue: status })
          return (
            <div key={col.field} className={cellClassName(colIndex)} data-row-index={rowIndex}>
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
            <div key={col.field} className={cellClassName(colIndex)} data-row-index={rowIndex}>
              <CeramicImageCell
                row={row}
                field={col.field as "product_image_urls" | "gallery_image_urls"}
                imageType={col.imageType!}
                multiple={col.type === "image-multi"}
                rowIndex={rowIndex}
                colIndex={colIndex}
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
            <div key={col.field} className={cellClassName(colIndex)} data-row-index={rowIndex} title={issue?.message}>
              <DropdownCellWrapper
                value={value}
                label={label}
                options={options}
                clientId={row._clientId ?? row.sku}
                field={col.field}
                rowIndex={rowIndex}
                colIndex={colIndex}
                issue={issue?.kind}
                validationTint={col.field !== "rowNumber" ? validationTint : undefined}
                onCommit={onCellCommit}
                onFillStart={onFillStart}
                isExpanded={expandedCols?.has(col.field) ?? false}
              />
            </div>
          )
        }

        // text cell
        return (
          <div key={col.field} className={cellClassName(colIndex)} data-row-index={rowIndex} title={issue?.message}>
            <TextCellWrapper
              initialValue={getFieldValue(row, col.field)}
              clientId={row._clientId ?? row.sku}
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
              readOnly={col.readOnly}
              italic={col.italic}
              onCommit={onCellCommit}
              onNavigate={onNavigate}
              onFillStart={onFillStart}
              isExpanded={expandedCols?.has(col.field) ?? false}
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
  readOnly?: boolean
  italic?: boolean
  isExpanded?: boolean
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
  readOnly,
  italic,
  isExpanded,
  onCommit,
  onNavigate,
  onFillStart,
}: TextCellWrapperProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(initialValue)

  // The fill handle only shows on cells that have something to copy. The
  // input is uncontrolled, so typing is tracked as an override that resets
  // whenever the external value changes (React's adjust-state-during-render
  // pattern — no effect involved).
  const [prevInitial, setPrevInitial] = useState(initialValue)
  const [typedHasValue, setTypedHasValue] = useState<boolean | null>(null)
  if (prevInitial !== initialValue) {
    setPrevInitial(initialValue)
    setTypedHasValue(null)
  }
  const hasValue = typedHasValue ?? Boolean(initialValue.trim())

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
    ? { background: `linear-gradient(180deg, ${validationTint}, ${validationTint}), var(--ceramic-rect-bg)` }
    : {}

  return (
    <div
      className={`ceramic-rect${isExpanded ? " ceramic-col-expanded" : ""}`}
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
        readOnly={readOnly}
        style={italic ? { fontStyle: "italic", color: "var(--ceramic-rect-text)", fontWeight: 500 } : undefined}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onInput={(e) => setTypedHasValue(Boolean(e.currentTarget.value.trim()))}
        data-row={rowIndex}
        data-col={colIndex}
        data-field={field}
      />
      {!readOnly && hasValue && (
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
      )}
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
  colIndex: number
  issue?: "error" | "warning"
  validationTint?: string
  isExpanded?: boolean
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
  colIndex,
  issue,
  validationTint,
  isExpanded,
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
    ? { background: `linear-gradient(180deg, ${validationTint}, ${validationTint}), var(--ceramic-rect-bg)` }
    : {}

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`ceramic-dropdown-trigger${isExpanded ? " ceramic-col-expanded" : ""}`}
        data-empty={!value || undefined}
        data-issue={issue}
        data-fill-cell
        data-row={rowIndex}
        data-col={colIndex}
        data-field={field}
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={triggerStyle}
      >
        {label || "\u00A0"}
        {Boolean(value.trim()) && (
          <span
            className="ceramic-fill-handle"
            title="Drag to fill (same column)"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => onFillStart(rowIndex, field, value, e)}
          />
        )}
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

export const SkuSheetCeramic = forwardRef<SkuSheetCeramicHandle, SkuSheetCeramicProps>(
  function SkuSheetCeramic({
    rows,
    onRowsChange,
    dropdowns,
    mode = "creation",
    createEmptyRow,
    onUndo,
    onRedo,
    showCheckbox = false,
    isMeaningfulRow,
    totalCount: _totalCount,
    onSelectionChange,
    isRowSelected: isRowSelectedProp,
    onRowToggle,
    headerChecked,
    headerIndeterminate,
    onHeaderToggle,
  }, ref) {
  const { t, i18n } = useTranslation()
  const isHe = i18n.language === "he"
  const containerRef = useRef<HTMLDivElement>(null)

  const columns = useMemo(() => buildColumns(mode, showCheckbox), [mode, showCheckbox])

  // ── Per-column expand / truncate toggle ───────────────────────────────────
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set())
  // Pixel width overrides for expanded columns (measured from DOM scrollWidth)
  const [colWidthOverrides, setColWidthOverrides] = useState<Record<string, number>>({})

  // Measure the content width of all visible cells in a column so the grid
  // track can be widened to exactly fit the longest value.
  const measureColWidth = useCallback((field: string): number => {
    const container = containerRef.current
    if (!container) return 0
    const col = columnsRef.current.find((c) => c.field === field)
    const minW = col?.minWidth ?? 100
    // scrollWidth gives the full content width even when overflow:hidden clips it
    let maxCellScroll = 0
    container.querySelectorAll<HTMLElement>(`[data-field="${field}"]`).forEach((el) => {
      if (el.scrollWidth > maxCellScroll) maxCellScroll = el.scrollWidth
    })
    // Also account for the header label so the header text is never clipped
    const headerLabel = container.querySelector<HTMLElement>(
      `[data-col-field="${field}"] .ceramic-head-btn-label`,
    )
    // +28: icon (~13px) + gap (4px) + button padding (4px each side) + buffer
    const headerNeeded = headerLabel ? headerLabel.scrollWidth + 28 : 0
    // .ceramic-rect is 86% of the column track; add 40px for cell padding + room
    const cellNeeded = maxCellScroll > 0 ? Math.ceil(maxCellScroll / 0.86) + 40 : 0
    return Math.max(minW, cellNeeded, headerNeeded)
  }, [])

  const toggleColExpand = useCallback((field: string) => {
    setExpandedCols((prev) => {
      const next = new Set(prev)
      if (next.has(field)) {
        next.delete(field)
        setColWidthOverrides((w) => { const n = { ...w }; delete n[field]; return n })
      } else {
        next.add(field)
        // Measure BEFORE expanding so overflow:hidden is still in effect
        const w = measureColWidth(field)
        setColWidthOverrides((o) => ({ ...o, [field]: w }))
      }
      return next
    })
  }, [measureColWidth])

  // ── Row-checkbox selection state ──────────────────────────────────────────
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  const getRowKey = (row: SkuMetadataRow) => row._clientId ?? row.sku ?? ""

  // Meaningful rows = non-padding rows used for header checkbox / select-all.
  // Stale-key cleanup uses ALL rows to avoid keeping deleted-page keys around.
  const meaningfulKeys = useMemo(
    () => (isMeaningfulRow ? rows.filter(isMeaningfulRow) : rows)
        .map(getRowKey)
        .filter(Boolean),
    [rows, isMeaningfulRow],
  )
  const pageFullySelected =
    meaningfulKeys.length > 0 && meaningfulKeys.every((k) => selectedKeys.has(k))
  const pagePartiallySelected = meaningfulKeys.some((k) => selectedKeys.has(k))

  const toggleSelectRow = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Resolves to whichever toggle/read pair is active — the parent's
  // controlled callbacks (Cleanup/Creation lift selection state) or this
  // component's own internal selectedKeys (uncontrolled usage elsewhere).
  const getIsRowSelected = useCallback(
    (row: SkuMetadataRow) =>
      isRowSelectedProp ? isRowSelectedProp(row) : selectedKeys.has(getRowKey(row)),
    [isRowSelectedProp, selectedKeys],
  )
  const applyCheckboxToggle = onRowToggle ?? toggleSelectRow

  // Click-and-drag multi-select across the checkbox column (Excel/Gmail
  // style) — mousedown on one checkbox, drag over others, they all flip to
  // the same checked state as the first click.
  const { startDrag: startCheckboxDrag, handleNativeChange: handleCheckboxChange } = useCheckboxDragSelect({
    items: rows,
    getKey: getRowKey,
    isSelected: getIsRowSelected,
    toggle: applyCheckboxToggle,
  })

  const toggleSelectAll = useCallback(() => {
    if (pageFullySelected) setSelectedKeys(new Set())
    else setSelectedKeys(new Set(meaningfulKeys))
  }, [pageFullySelected, meaningfulKeys])

  // Remove keys that no longer exist in the current row set (page change etc.)
  useEffect(() => {
    const validKeys = new Set(rows.map(getRowKey))
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev
      const next = new Set([...prev].filter((k) => validKeys.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [rows])

  // Notify parent whenever the selection count or page-selection state changes
  useEffect(() => {
    onSelectionChange?.({ count: selectedKeys.size, pageFullySelected })
  }, [selectedKeys.size, pageFullySelected, onSelectionChange])

  // ── Bulk delete ───────────────────────────────────────────────────────────
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const handleDeleteSelected = useCallback(() => {
    if (selectedKeys.size === 0) return
    setBulkDeleteOpen(true)
  }, [selectedKeys])

  useImperativeHandle(ref, () => ({
    deleteSelected: handleDeleteSelected,
    clearSelection: () => setSelectedKeys(new Set()),
  }), [handleDeleteSelected])

  // Fresh references for document-level drag listeners (avoid stale closures)
  const rowsRef = useRef(rows)
  const onRowsChangeRef = useRef(onRowsChange)
  const columnsRef = useRef(columns)
  useEffect(() => {
    rowsRef.current = rows
    onRowsChangeRef.current = onRowsChange
    columnsRef.current = columns
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

      // Nothing to copy from a blank cell — an empty-source drag would only
      // mark untouched rows as edited without changing anything
      const isEmptySource = Array.isArray(value)
        ? value.length === 0
        : !String(value ?? "").trim()
      if (isEmptySource) return

      const isSku = field === "sku"
      let endRow = startRow
      let overWrongColumn = false

      // Dropdown values travel as their display label, like a committed cell
      const colDef = columnsRef.current.find((c) => c.field === field)
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
      columns
        .map((c) => {
          if (c.type === "index" || c.type === "checkbox") return `${c.minWidth}px`
          const override = colWidthOverrides[c.field]
          if (override) return `${override}px`
          return `minmax(${c.minWidth}px, ${c.minWidth < 120 ? "1fr" : "1.2fr"})`
        })
        .join(" "),
    [columns, colWidthOverrides],
  )

  const gridMinWidth = useMemo(
    () => columns.reduce((sum, c) => sum + (colWidthOverrides[c.field] ?? c.minWidth) + 8, 0),
    [columns, colWidthOverrides],
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
      // A commit that matches no row means the typed text would stay visible
      // in the (uncontrolled) input while never reaching the data — that must
      // never pass silently (it once made "filled" cells validate as empty).
      if (!rows.some((r) => (r._clientId ?? r.sku) === clientId)) {
        console.error(
          `[SkuSheetCeramic] dropped commit — no row matched key "${clientId}" (field: ${field})`,
        )
        return
      }
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

  // ── Multi-cell range selection (Shift+Click / Shift+↑↓ / Ctrl+A) ──────
  // Painted directly on the DOM (like the fill preview) for performance.
  const selRef = useRef<{ anchor: CellRC; focus: CellRC } | null>(null)
  const selEls = useRef<HTMLElement[]>([])
  const lastFocusRef = useRef<CellRC | null>(null)

  const clearSelectionPaint = useCallback(() => {
    for (const el of selEls.current) el.classList.remove("ceramic-sel-cell")
    selEls.current = []
  }, [])

  const clearSelection = useCallback(() => {
    selRef.current = null
    clearSelectionPaint()
  }, [clearSelectionPaint])

  const paintSelection = useCallback(() => {
    clearSelectionPaint()
    const container = containerRef.current
    const sel = selRef.current
    if (!container || !sel) return
    const r1 = Math.min(sel.anchor.r, sel.focus.r)
    const r2 = Math.max(sel.anchor.r, sel.focus.r)
    const c1 = Math.min(sel.anchor.c, sel.focus.c)
    const c2 = Math.max(sel.anchor.c, sel.focus.c)
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const el = container.querySelector<HTMLElement>(
          `[data-fill-cell][data-row="${r}"][data-col="${c}"]`,
        )
        if (el) {
          el.classList.add("ceramic-sel-cell")
          selEls.current.push(el)
        }
      }
    }
  }, [clearSelectionPaint])

  const setSelection = useCallback(
    (anchor: CellRC, focus: CellRC) => {
      selRef.current = { anchor, focus }
      paintSelection()
    },
    [paintSelection],
  )

  const selectionRect = useCallback(() => {
    const sel = selRef.current
    if (!sel) return null
    return {
      r1: Math.min(sel.anchor.r, sel.focus.r),
      r2: Math.max(sel.anchor.r, sel.focus.r),
      c1: Math.min(sel.anchor.c, sel.focus.c),
      c2: Math.max(sel.anchor.c, sel.focus.c),
    }
  }, [])

  const rcFromElement = (el: Element | null): CellRC | null => {
    const cell = (el?.closest?.("[data-fill-cell]") ?? null) as HTMLElement | null
    if (!cell) return null
    const r = cell.getAttribute("data-row")
    const c = cell.getAttribute("data-col")
    if (r == null || c == null) return null
    return { r: parseInt(r, 10), c: parseInt(c, 10) }
  }

  // ── Right-click "Delete row" menu ──────────────────────────────────────
  const rowIndexFromElement = (el: Element | null): number | null => {
    const cell = (el?.closest?.("[data-row-index]") ?? null) as HTMLElement | null
    if (!cell) return null
    const r = cell.getAttribute("data-row-index")
    return r == null ? null : parseInt(r, 10)
  }

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowIndex: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [deleteTarget, setDeleteTarget] = useState<SkuMetadataRow | null>(null)
  const deleteMutation = useSkuDeleteMutation()

  const removeRow = useCallback((row: SkuMetadataRow) => {
    const key = row._clientId ?? row.sku
    const newRows = rowsRef.current.filter((r) => (r._clientId ?? r.sku) !== key)
    onRowsChangeRef.current(newRows)
  }, [])

  const handleDeleteRow = useCallback(() => {
    setContextMenu((current) => {
      if (!current) return null
      const row = rowsRef.current[current.rowIndex]
      if (row) {
        if (row._savedSku) setDeleteTarget(row)
        else removeRow(row)
      }
      return null
    })
  }, [removeRow])

  const confirmDeleteRow = useCallback(() => {
    if (!deleteTarget) return
    const target = deleteTarget
    deleteMutation.mutate(target._savedSku!, {
      onSuccess: () => {
        toast.success(t("sku.grid.deleteRowSuccess"))
        removeRow(target)
        setDeleteTarget(null)
      },
      onError: () => {
        toast.error(t("sku.grid.deleteRowFailed"))
        setDeleteTarget(null)
      },
    })
  }, [deleteTarget, deleteMutation, removeRow, t])

  const confirmBulkDelete = useCallback(async () => {
    const toDelete = rowsRef.current.filter((r) => selectedKeys.has(getRowKey(r)))
    const saved = toDelete.filter((r) => r._savedSku)
    const unsaved = toDelete.filter((r) => !r._savedSku)

    const unsavedKeys = new Set(unsaved.map(getRowKey))
    const results = await Promise.allSettled(
      saved.map((r) => deleteMutation.mutateAsync(r._savedSku!))
    )

    const deletedSavedKeys = new Set<string>()
    results.forEach((result, i) => {
      if (result.status === "fulfilled") deletedSavedKeys.add(getRowKey(saved[i]))
    })

    const allDeletedKeys = new Set([...unsavedKeys, ...deletedSavedKeys])
    if (allDeletedKeys.size > 0) {
      const newRows = rowsRef.current.filter((r) => !allDeletedKeys.has(getRowKey(r)))
      onRowsChangeRef.current(newRows)
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        for (const k of allDeletedKeys) next.delete(k)
        return next
      })
    }

    const failedCount = results.filter((r) => r.status === "rejected").length
    if (failedCount > 0) {
      toast.error(`Failed to delete ${failedCount} saved row${failedCount !== 1 ? "s" : ""}`)
    }
    if (allDeletedKeys.size > 0) {
      toast.success(`Deleted ${allDeletedKeys.size} row${allDeletedKeys.size !== 1 ? "s" : ""}`)
    }
    setBulkDeleteOpen(false)
  }, [selectedKeys, deleteMutation])

  // Close the menu on any outside click, scroll, or Escape
  useEffect(() => {
    if (!contextMenu) return

    const close = (e: Event) => {
      if (e instanceof MouseEvent && contextMenuRef.current?.contains(e.target as Node)) return
      setContextMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null)
    }

    document.addEventListener("mousedown", close)
    document.addEventListener("scroll", close, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("scroll", close, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [contextMenu])

  // Cell-range mutations (Delete / Ctrl+X / Ctrl+D) — one undo step each
  const clearRange = useCallback(() => {
    const rect = selectionRect()
    if (!rect) return
    const newRows = rowsRef.current.map((row, i) => {
      if (i < rect.r1 || i > rect.r2) return row
      let changed = false
      const next = { ...row }
      for (let c = rect.c1; c <= rect.c2; c++) {
        const col = columnsRef.current[c]
        if (!col || col.readOnly) continue
        if (col.type === "text" || col.type === "dropdown") {
          ;(next as Record<string, unknown>)[col.field] = ""
          changed = true
        } else if (col.type === "image-multi") {
          ;(next as Record<string, unknown>)[col.field] = []
          changed = true
        } else if (col.type === "image-single") {
          ;(next as Record<string, unknown>)[col.field] = ""
          changed = true
        }
      }
      if (!changed) return row
      next._isDirty = true
      next._validationStatus = "unchecked"
      return next
    })
    onRowsChangeRef.current(newRows)
  }, [selectionRect])

  const buildRangeTsv = useCallback(() => {
    const rect = selectionRect()
    if (!rect) return ""
    const lines: string[] = []
    for (let r = rect.r1; r <= rect.r2; r++) {
      const row = rowsRef.current[r]
      if (!row) continue
      const cells: string[] = []
      for (let c = rect.c1; c <= rect.c2; c++) {
        const col = columnsRef.current[c]
        cells.push(col ? getFieldValue(row, col.field) : "")
      }
      lines.push(cells.join("\t"))
    }
    return lines.join("\n")
  }, [selectionRect])

  const fillDownRange = useCallback(() => {
    const rect = selectionRect()
    if (!rect || rect.r2 === rect.r1) return
    const sourceRow = rowsRef.current[rect.r1]
    if (!sourceRow) return
    const newRows = rowsRef.current.map((row, i) => {
      if (i <= rect.r1 || i > rect.r2) return row
      let changed = false
      const next = { ...row }
      for (let c = rect.c1; c <= rect.c2; c++) {
        const col = columnsRef.current[c]
        if (!col || col.readOnly) continue
        // Blank source cells are skipped — filling "" downward would only
        // dirty rows without changing anything
        if (!getFieldValue(sourceRow, col.field).trim()) continue
        if (col.type === "text" || col.type === "dropdown") {
          const base = getFieldValue(sourceRow, col.field)
          ;(next as Record<string, unknown>)[col.field] = fillValueAt(
            base,
            i - rect.r1,
            col.field === "sku",
          )
          changed = true
        } else if (col.type === "image-multi") {
          ;(next as Record<string, unknown>)[col.field] = [
            ...((sourceRow[col.field as keyof SkuMetadataRow] as string[] | undefined) ?? []),
          ]
          changed = true
        } else if (col.type === "image-single") {
          ;(next as Record<string, unknown>)[col.field] =
            getFieldValue(sourceRow, col.field)
          changed = true
        }
      }
      if (!changed) return row
      next._isDirty = true
      next._validationStatus = "unchecked"
      return next
    })
    onRowsChangeRef.current(newRows)
  }, [selectionRect])

  // ── Cell copy/paste (Ctrl+C / Ctrl+V, Excel-compatible) ────────────────
  // Paste spreads tab/newline-separated blocks across writable columns from
  // the focused cell, growing the sheet when needed (creation mode).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function handlePaste(e: ClipboardEvent) {
      const text = e.clipboardData?.getData("text/plain") ?? ""
      if (!text.includes("\t") && !text.includes("\n")) return

      // Multi-cell paste
      e.preventDefault()
      const activeEl = document.activeElement as HTMLElement | null
      const cellEl = (activeEl?.closest?.("[data-fill-cell]") ?? null) as HTMLElement | null
      const rowAttr = cellEl?.getAttribute("data-row")
      const colAttr = cellEl?.getAttribute("data-col")
      if (rowAttr == null || colAttr == null) return

      const cols = columnsRef.current
      const startRow = parseInt(rowAttr, 10)
      const startCol = parseInt(colAttr, 10)

      const pasteRows = text
        .replace(/\r/g, "")
        .split("\n")
        .filter((line, i, arr) => !(i === arr.length - 1 && line === ""))
      const newRows = [...rowsRef.current]

      // Grow if needed (creation mode provides the blank-row factory)
      while (createEmptyRow && startRow + pasteRows.length > newRows.length) {
        newRows.push(createEmptyRow())
      }

      for (let ri = 0; ri < pasteRows.length; ri++) {
        const pasteCols = pasteRows[ri].split("\t")
        let colOffset = 0

        for (let ci = 0; ci < pasteCols.length; ci++) {
          // Walk columns from startCol, skipping readonly/image/select
          while (startCol + colOffset + ci < cols.length) {
            if (isWritableCol(cols[startCol + colOffset + ci])) break
            colOffset++
          }

          const targetColIdx = startCol + colOffset + ci
          if (targetColIdx >= cols.length) break
          const col = cols[targetColIdx]
          if (!isWritableCol(col)) continue

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

      onRowsChangeRef.current(newRows)
    }

    container.addEventListener("paste", handlePaste)
    return () => container.removeEventListener("paste", handlePaste)
  }, [createEmptyRow])

  // ── Keyboard shortcuts + selection events ─────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const selectableCols = columns
      .map((col, i) => ({ col, i }))
      .filter(
        ({ col }) =>
          col.type !== "index" && col.type !== "readonly" && col.type !== "checkbox",
      )
      .map(({ i }) => i)
    const firstCol = selectableCols[0]
    const lastCol = selectableCols[selectableCols.length - 1]

    const focusCell = (r: number, c: number) => {
      const el = container.querySelector<HTMLElement>(
        `[data-fill-cell][data-row="${r}"][data-col="${c}"]`,
      )
      if (!el) return
      const focusable =
        el.matches("input,button,[tabindex]")
          ? el
          : el.querySelector<HTMLElement>("input,button,[tabindex]")
      ;(focusable ?? el).focus()
    }

    // Plain focus collapses any selection and records the anchor cell
    const onFocusIn = (e: FocusEvent) => {
      const rc = rcFromElement(e.target as Element)
      if (!rc) return
      lastFocusRef.current = rc
      if (selRef.current) clearSelection()
    }

    // Shift+Click extends the selection from the anchor
    const onMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey) return
      const rc = rcFromElement(e.target as Element)
      if (!rc) return
      e.preventDefault()
      const anchor = selRef.current?.anchor ?? lastFocusRef.current ?? rc
      setSelection(anchor, rc)
    }

    // Right-click anywhere in a row opens the row's "Delete row" menu at
    // the cursor, like a desktop file manager / browser context menu
    const onContextMenu = (e: MouseEvent) => {
      const rowIndex = rowIndexFromElement(e.target as Element)
      if (rowIndex == null) return
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, rowIndex })
    }

    // Undo/redo listen on the DOCUMENT in capture phase so they work no
    // matter where focus is (inside a cell, on a button, on the page body)
    // and always beat the browser's native input undo. If a cell edit is in
    // progress, it is committed first so the undo includes it.
    const onUndoRedo = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const key = e.key.toLowerCase()
      if (key !== "z" && key !== "y") return
      e.preventDefault()
      e.stopPropagation()
      const active = document.activeElement
      if (active instanceof HTMLInputElement && active.classList.contains("ceramic-field")) {
        active.blur() // commit the in-progress edit synchronously
      }
      if (key === "z") onUndo?.()
      else onRedo?.()
    }

    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      const activeRC = rcFromElement(document.activeElement)

      // Shift+↑/↓ extend the selection vertically (←/→ keep native
      // text-selection behavior inside inputs)
      if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && (activeRC || selRef.current)) {
        e.preventDefault()
        const base = selRef.current?.focus ?? activeRC!
        const anchor = selRef.current?.anchor ?? activeRC!
        const nextR = Math.max(
          0,
          Math.min(base.r + (e.key === "ArrowDown" ? 1 : -1), rowsRef.current.length - 1),
        )
        setSelection(anchor, { r: nextR, c: base.c })
        return
      }

      if (e.key === "Escape") {
        clearSelection()
        return
      }

      if (ctrl && (e.key === "Home" || e.key === "End")) {
        e.preventDefault()
        clearSelection()
        if (e.key === "Home") focusCell(0, firstCol)
        else focusCell(rowsRef.current.length - 1, lastCol)
        return
      }

      const rect = selectionRect()
      const isMulti = rect && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2)

      if ((e.key === "Delete" || e.key === "Backspace") && isMulti) {
        e.preventDefault()
        clearRange()
        return
      }

      if (ctrl && key === "c") {
        if (isMulti) {
          // Copy the selection as Excel-compatible cells (TSV)
          e.preventDefault()
          void navigator.clipboard.writeText(buildRangeTsv())
        } else if (
          document.activeElement instanceof HTMLElement &&
          !(document.activeElement instanceof HTMLInputElement)
        ) {
          // Single dropdown/image cell — copy its value (inputs copy natively)
          const cell = document.activeElement.closest("[data-fill-cell]")
          const value = cell?.getAttribute("data-value")
          if (value != null) {
            e.preventDefault()
            void navigator.clipboard.writeText(value)
          }
        }
        return
      }

      if (ctrl && key === "x" && isMulti) {
        e.preventDefault()
        void navigator.clipboard.writeText(buildRangeTsv()).then(() => clearRange())
        return
      }

      if (ctrl && key === "d" && isMulti) {
        e.preventDefault()
        fillDownRange()
        return
      }
    }

    document.addEventListener("keydown", onUndoRedo, true)
    container.addEventListener("focusin", onFocusIn)
    container.addEventListener("mousedown", onMouseDown, true)
    container.addEventListener("contextmenu", onContextMenu)
    container.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", onUndoRedo, true)
      container.removeEventListener("focusin", onFocusIn)
      container.removeEventListener("mousedown", onMouseDown, true)
      container.removeEventListener("contextmenu", onContextMenu)
      container.removeEventListener("keydown", handleKeyDown)
    }
  }, [
    onUndo,
    onRedo,
    columns,
    setSelection,
    clearSelection,
    selectionRect,
    clearRange,
    buildRangeTsv,
    fillDownRange,
  ])

  // (Custom Ctrl+C / Ctrl+V handling removed by request — text inputs keep
  // the browser's native copy/paste for plain text only.)

  return (
    <div ref={containerRef} className={`ceramic-sheet-root${showCheckbox ? " ceramic-has-checkbox" : ""}`}>
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
          {columns.map((col, colIndex) => {
            const isSticky0 = colIndex === 0
            const isSticky1 = colIndex === 1
            const isSticky2 = showCheckbox && colIndex === 2
            const headClass = isSticky0
              ? "ceramic-head ceramic-cell-sticky ceramic-cell-sticky-0"
              : isSticky1
                ? "ceramic-head ceramic-cell-sticky ceramic-cell-sticky-1"
                : isSticky2
                  ? "ceramic-head ceramic-cell-sticky ceramic-cell-sticky-2"
                  : "ceramic-head"

            if (col.type === "checkbox") {
              const checkedState = headerChecked !== undefined ? headerChecked : pageFullySelected
              const indetermState = headerIndeterminate !== undefined
                ? headerIndeterminate
                : (pagePartiallySelected && !pageFullySelected)
              return (
                <div key="h-__checkbox__" className={headClass}>
                  <input
                    type="checkbox"
                    className="ceramic-checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = indetermState
                    }}
                    checked={checkedState}
                    onChange={onHeaderToggle ?? toggleSelectAll}
                  />
                </div>
              )
            }

            const colIsExpanded = expandedCols.has(col.field)
            return (
              <div
                key={`h-${col.field}`}
                className={`${headClass}${colIsExpanded ? " ceramic-head-col-expanded" : ""}`}
                data-col-field={col.field}
              >
                {col.field === "rowNumber" ? (
                  "#"
                ) : (
                  <button
                    type="button"
                    className="ceramic-head-btn"
                    onClick={() => toggleColExpand(col.field)}
                    title={
                      colIsExpanded
                        ? t("sku.grid.clickToTruncateColumn")
                        : t("sku.grid.clickToExpandColumn")
                    }
                  >
                    <span className="ceramic-head-btn-label">{t(getHeaderKey(col.field))}</span>
                    <span className="ceramic-head-btn-icon">{colIsExpanded ? "↙" : "↔"}</span>
                  </button>
                )}
              </div>
            )
          })}

          {/* Data rows */}
          {rows.map((row, rowIndex) => (
            <CeramicRow
              key={row._clientId ?? row.sku ?? rowIndex}
              row={row}
              rowIndex={rowIndex}
              columns={columns}
              dropdowns={dropdowns}
              isDuplicate={!!row.sku?.trim() && duplicateSkus.has(row.sku.trim())}
              t={t}
              isHe={isHe}
              onCellCommit={onCellCommit}
              onRowChange={onImageRowChange}
              onNavigate={onNavigate}
              onFillStart={handleFillStart}
              sheetMode={mode}
              showCheckbox={showCheckbox}
              isSelected={getIsRowSelected(row)}
              onToggleSelect={handleCheckboxChange}
              onCheckboxDragStart={startCheckboxDrag}
              expandedCols={expandedCols}
            />
          ))}
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="ceramic-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="ceramic-context-menu-item ceramic-context-menu-item-danger"
            onClick={handleDeleteRow}
          >
            {t("sku.grid.deleteRow")}
          </button>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sku.grid.deleteRowConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sku.grid.deleteRowConfirmDescription", { sku: deleteTarget?._savedSku ?? deleteTarget?.sku })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={confirmDeleteRow}
            >
              {deleteMutation.isPending ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => !open && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedKeys.size} row{selectedKeys.size !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedKeys.size} selected row{selectedKeys.size !== 1 ? "s" : ""}. Rows already saved to the database will be deleted from the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                void confirmBulkDelete()
              }}
            >
              {deleteMutation.isPending
                ? t("common.deleting")
                : `Delete ${selectedKeys.size} row${selectedKeys.size !== 1 ? "s" : ""}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
  }
)
