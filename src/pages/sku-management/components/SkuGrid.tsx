import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { AgGridReact } from "ag-grid-react"
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  colorSchemeLight,
  colorSchemeDark,
  type ColDef,
  type CellValueChangedEvent,
  type CellClickedEvent,
  type GetRowIdParams,
} from "ag-grid-community"
import type { SkuMetadataRow, SkuDropdownMap, SkuValidationStatus } from "@/features/skuManagement/types"
import { DropdownCellEditor } from "./DropdownCellEditor"
import { ImageUploadCellRenderer } from "./ImageUploadCellRenderer"
import { SkuFillHandle, type FillUpdate } from "./SkuFillHandle"
import { useSpreadsheetInteractions } from "./useSpreadsheetInteractions"

ModuleRegistry.registerModules([AllCommunityModule])

// ─── Excel-like sheet theme ──────────────────────────────────────────────────
//
// Dense rows, full grid lines (horizontal + vertical), sharp corners and a
// bold header bar to read as a real spreadsheet rather than a generic
// SaaS data table. Light/dark variants follow the admin's `dark` class
// (see useIsDarkMode below) instead of the OS color scheme.

const sheetThemeBase = themeQuartz.withParams({
  spacing: 6,
  rowHeight: 32,
  headerHeight: 34,
  headerFontWeight: 600,
  borderRadius: 0,
  wrapperBorderRadius: 0,
  wrapperBorder: true,
  rowBorder: true,
  columnBorder: true,
  headerColumnBorder: true,
  headerRowBorder: true,
  accentColor: "#1565c0",
})

const sheetThemeLight = sheetThemeBase.withPart(colorSchemeLight).withParams({
  headerBackgroundColor: "#f8fafc",
})

const sheetThemeDark = sheetThemeBase.withPart(colorSchemeDark)

function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"))

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

interface SkuGridProps {
  rows: SkuMetadataRow[]
  onRowsChange: (rows: SkuMetadataRow[]) => void
  dropdowns: SkuDropdownMap
  mode: "creation" | "cleanup"
  /** Checkbox multi-row selection (cleanup workflow). Off = no checkbox column. */
  enableSelection?: boolean
  onSelectionChanged?: (selected: SkuMetadataRow[]) => void
  /** Fires when the user clicks into a row — used for the detail panel. */
  onActiveRowChange?: (row: SkuMetadataRow) => void
  /** Blank-row factory — lets multi-row paste grow the sheet (creation mode) */
  createEmptyRow?: () => SkuMetadataRow
  /** Ctrl+Z / Ctrl+Y handlers (page owns the history stacks) */
  onUndo?: () => void
  onRedo?: () => void
}

// Image columns hold URLs managed by the upload cells; product images are an
// array. Clipboard copy/paste round-trips them as comma-joined text.
const ARRAY_FIELDS = new Set(["product_image_urls", "gallery_image_urls"])
const READONLY_FIELDS = new Set(["rowNumber", "status", "original_sap_name"])

// Stable identity for a row: the client-side id assigned when the row was
// created (creation mode), otherwise the SKU (cleanup/imported rows, which
// come from the DB with unique SKUs). The client id takes priority — keying
// by SKU first would give two rows typed with the same SKU identical AG Grid
// row ids, making one vanish and edits clobber the other row's data.
// Duplicate SKUs must instead be surfaced by Check Duplicates / validation.
function getRowKey(row: SkuMetadataRow): string {
  return row._clientId || row.sku || ""
}

function makeDropdownCellEditor(fieldKey: string, dropdowns: SkuDropdownMap) {
  return {
    cellEditor: DropdownCellEditor,
    cellEditorParams: {
      options: (dropdowns[fieldKey] ?? []).map((d) => ({
        value: d.value,
        label: d.label_en ?? d.value,
      })),
    },
    // popup mode required: without it AG Grid renders the editor inside the cell
    // which has overflow:hidden + dense row height — the list is invisible.
    cellEditorPopup: true,
    // Marks the cell with a chevron so users can tell it's a selector field
    // (styled via the .sku-dropdown-cell::after rule in SkuGrid's style block)
    cellClass: "sku-dropdown-cell",
  }
}

function buildColumnDefs(
  mode: "creation" | "cleanup",
  dropdowns: SkuDropdownMap,
  t: TFunction,
  duplicateSkus: Set<string>
): ColDef<SkuMetadataRow>[] {
  const isCleanup = mode === "cleanup"
  const isDuplicateSku = (value: unknown) =>
    Boolean(value) && duplicateSkus.has(String(value).trim())

  return [
    {
      colId: "rowNumber",
      headerName: "#",
      width: 44,
      pinned: "left" as const,
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
      valueGetter: (params) => (params.node?.rowIndex ?? 0) + 1,
      headerClass: "sku-rownum-header",
      cellStyle: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        color: "#9ca3af",
      },
    },
    {
      field: "sku",
      headerName: t("sku.fields.sku"),
      width: 140,
      pinned: "left" as const,
      editable: !isCleanup,
      // SKU is the unique anchor — a code used on more than one row turns
      // red immediately, with the explanation as a tooltip (spec point 17:
      // field-level status + tooltip explanation)
      cellClassRules: {
        "sku-cell-duplicate": (p) => isDuplicateSku(p.value),
      },
      tooltipValueGetter: (p) =>
        isDuplicateSku(p.value) ? t("sku.grid.duplicateSkuTooltip") : null,
    },
    ...(isCleanup
      ? ([
          {
            field: "original_sap_name" as keyof SkuMetadataRow,
            headerName: t("sku.fields.original_sap_name"),
            width: 200,
            pinned: "left" as const,
            editable: false,
            cellStyle: { color: "#888", fontStyle: "italic" },
          },
        ] satisfies ColDef<SkuMetadataRow>[])
      : []),
    { field: "supplier",          headerName: t("sku.fields.supplier"),          flex: 13, minWidth: 120, editable: true },
    { field: "series",            headerName: t("sku.fields.series"),            flex: 13, minWidth: 120, editable: true },
    { field: "color",              headerName: t("sku.fields.color"),             flex: 12, minWidth: 110, editable: true },
    { field: "size",              headerName: t("sku.fields.size"),              flex: 10, minWidth: 90,  editable: true, ...makeDropdownCellEditor("size", dropdowns) },
    { field: "finish",            headerName: t("sku.fields.finish"),            flex: 11, minWidth: 100, editable: true, ...makeDropdownCellEditor("finish", dropdowns) },
    // Image fields are uploads (spec point 4) — file goes to R2, the cell
    // stores only the returned URL(s). Not text-editable, not sortable.
    { field: "product_image_urls", headerName: t("sku.fields.product_image_urls"), flex: 16, minWidth: 170, editable: false, sortable: false, filter: false, cellRenderer: ImageUploadCellRenderer, cellRendererParams: { imageType: "product", multiple: true } },
    { field: "gallery_image_urls", headerName: t("sku.fields.gallery_image_urls"), flex: 16, minWidth: 170, editable: false, sortable: false, filter: false, cellRenderer: ImageUploadCellRenderer, cellRendererParams: { imageType: "gallery", multiple: true } },
    { field: "country_of_origin", headerName: t("sku.fields.country_of_origin"), flex: 11, minWidth: 110, editable: true, ...makeDropdownCellEditor("country_of_origin", dropdowns) },
    { field: "qty_per_carton",    headerName: t("sku.fields.qty_per_carton"),    flex: 10, minWidth: 100, editable: true },
    { field: "qty_per_pallet",    headerName: t("sku.fields.qty_per_pallet"),    flex: 10, minWidth: 100, editable: true },
    { field: "shade",              headerName: t("sku.fields.shade"),            flex: 10, minWidth: 100, editable: true, ...makeDropdownCellEditor("shade", dropdowns) },
    { field: "supplier_code",     headerName: t("sku.fields.supplier_code"),     flex: 11, minWidth: 110, editable: true },
    { field: "display_name_en",   headerName: t("sku.fields.display_name_en"),   flex: 20, minWidth: 180, editable: true },
    { field: "series_en",         headerName: t("sku.fields.series_en"),         flex: 13, minWidth: 120, editable: true },
    { field: "color_en",          headerName: t("sku.fields.color_en"),          flex: 12, minWidth: 110, editable: true },
    { field: "supplier_sku",      headerName: t("sku.fields.supplier_sku"),      flex: 13, minWidth: 130, editable: true },
    {
      field: "status",
      headerName: t("sku.fields.status"),
      flex: 11,
      minWidth: 110,
      editable: false,
      cellStyle: (params) => {
        const s = params.value as string
        if (s === "approved" || s === "created_in_sap") return { color: "#16a34a", fontWeight: 600 }
        if (s === "pending_approval") return { color: "#d97706", fontWeight: 600 }
        return { color: "#6b7280", fontWeight: 400 }
      },
    },
  ]
}

export function SkuGrid({
  rows,
  onRowsChange,
  dropdowns,
  mode,
  enableSelection = true,
  onSelectionChanged,
  onActiveRowChange,
  createEmptyRow,
  onUndo,
  onRedo,
}: SkuGridProps) {
  const { t } = useTranslation()
  const gridRef = useRef<AgGridReact<SkuMetadataRow>>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Non-empty SKUs appearing on more than one row — recomputed on every
  // rows change so the red marking reacts as the user types
  const duplicateSkus = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const sku = row.sku?.trim()
      if (sku) counts.set(sku, (counts.get(sku) ?? 0) + 1)
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([sku]) => sku))
  }, [rows])

  const columnDefs = buildColumnDefs(mode, dropdowns, t, duplicateSkus)

  // Dropdown-controlled columns: drag-fill must copy the exact value down
  // (never numeric-increment, which would create values outside the vocabulary)
  const dropdownFields = columnDefs
    .filter((c) => c.cellEditor === DropdownCellEditor && c.field)
    .map((c) => c.field as string)

  const getRowId = useCallback(
    (params: GetRowIdParams<SkuMetadataRow>) => getRowKey(params.data),
    []
  )

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent<SkuMetadataRow>) => {
      const updatedRows = rows.map((r) =>
        getRowKey(r) === getRowKey(event.data)
          ? { ...event.data, _isDirty: true, _validationStatus: "unchecked" as SkuValidationStatus }
          : r
      )
      onRowsChange(updatedRows)
    },
    [rows, onRowsChange]
  )

  // Apply fill-handle updates: update rows by display index, then refresh the grid
  const handleFill = useCallback(
    (updates: FillUpdate[]) => {
      const api = gridRef.current?.api
      const newRows = [...rows]

      for (const u of updates) {
        // Resolve the actual row data from the AG Grid display index
        const node = api?.getDisplayedRowAtIndex(u.rowIndex)
        if (!node?.data) continue

        // Find the matching element in the rows array by reference or stable row key
        const idx = newRows.findIndex(
          (r) => r === node.data || getRowKey(r) === getRowKey(node.data!)
        )
        const target = idx >= 0 ? idx : u.rowIndex

        if (target < newRows.length) {
          newRows[target] = {
            ...newRows[target],
            [u.field]: u.value,
            _isDirty: true,
            _validationStatus: "unchecked" as SkuValidationStatus,
          }
        }
      }

      onRowsChange(newRows)
    },
    [rows, onRowsChange]
  )

  // Selector cells open on a single click (text cells keep the Excel behavior:
  // single click selects, double click / typing edits). Shift+click extends
  // the range instead of opening the editor.
  const onCellClicked = useCallback(
    (event: CellClickedEvent<SkuMetadataRow>) => {
      if (event.data) onActiveRowChange?.(event.data)
      if ((event.event as MouseEvent | null)?.shiftKey) return
      const isDropdown = event.colDef.cellEditor === DropdownCellEditor
      if (!isDropdown || event.rowIndex == null) return
      event.api.startEditingCell({
        rowIndex: event.rowIndex,
        colKey: event.column.getColId(),
      })
    },
    [onActiveRowChange]
  )

  // ── Spreadsheet interactions (range selection, clipboard, clear) ──────────

  const applyCellUpdates = useCallback(
    (updates: FillUpdate[], appendCount: number) => {
      let newRows = [...rows]
      if (appendCount > 0 && createEmptyRow) {
        newRows = [...newRows, ...Array.from({ length: appendCount }, createEmptyRow)]
      }
      for (const u of updates) {
        if (u.rowIndex < newRows.length) {
          newRows[u.rowIndex] = {
            ...newRows[u.rowIndex],
            [u.field]: u.value,
            _isDirty: true,
            _validationStatus: "unchecked" as SkuValidationStatus,
          }
        }
      }
      onRowsChange(newRows)
    },
    [rows, createEmptyRow, onRowsChange]
  )

  const getDataColIds = useCallback(() => {
    const api = gridRef.current?.api
    if (!api) return []
    return api
      .getAllDisplayedColumns()
      .map((c) => c.getColId())
      .filter((id) => id !== "rowNumber")
  }, [])

  const getCellText = useCallback(
    (rowIndex: number, colId: string) => {
      const row = rows[rowIndex]
      if (!row) return ""
      const value = row[colId as keyof SkuMetadataRow]
      if (Array.isArray(value)) return value.join(",")
      return String(value ?? "")
    },
    [rows]
  )

  const isWritable = useCallback(
    (colId: string) => !READONLY_FIELDS.has(colId),
    []
  )

  const parseCellValue = useCallback((colId: string, text: string) => {
    if (ARRAY_FIELDS.has(colId)) {
      return text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return text
  }, [])

  const clearValue = useCallback(
    (colId: string) => (ARRAY_FIELDS.has(colId) ? [] : ""),
    []
  )

  const { isCellInRange, handleCellMouseDown, handleCellMouseOver } =
    useSpreadsheetInteractions({
      gridRef,
      containerRef,
      rowCount: rows.length,
      getDataColIds,
      getCellText,
      isWritable,
      parseCellValue,
      clearValue,
      applyUpdates: applyCellUpdates,
      canAppendRows: Boolean(createEmptyRow),
      onUndo,
      onRedo,
    })

  const defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    editable: true,
    cellClassRules: {
      "sku-cell-range": (p) =>
        isCellInRange(p.node?.rowIndex, p.column?.getColId() ?? ""),
    },
  }

  const isDark = useIsDarkMode()

  const rowClassRules = {
    "sku-row-red":    (p: { data?: SkuMetadataRow }) => p.data?._validationStatus === "red",
    "sku-row-yellow": (p: { data?: SkuMetadataRow }) => p.data?._validationStatus === "yellow",
    "sku-row-green":  (p: { data?: SkuMetadataRow }) => p.data?._validationStatus === "green",
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ position: "relative", minHeight: 300 }}
    >
      <style>{`
        .sku-row-red    { background-color: #fef2f2 !important; }
        .sku-row-yellow { background-color: #fffbeb !important; }
        .sku-row-green  { background-color: #f0fdf4 !important; }
        .dark .sku-row-red    { background-color: rgba(239, 68, 68, 0.12) !important; }
        .dark .sku-row-yellow { background-color: rgba(245, 158, 11, 0.12) !important; }
        .dark .sku-row-green  { background-color: rgba(34, 197, 94, 0.12) !important; }

        /* Center the # header label like a real spreadsheet row header */
        .sku-rownum-header .ag-header-cell-label { justify-content: center; }

        /* One horizontal scrollbar for the whole sheet — hide the extra one
           AG Grid renders under the pinned columns */
        .ag-horizontal-left-spacer, .ag-horizontal-right-spacer { overflow-x: hidden; }

        /* Excel-style selection rectangle (drag / shift+click / shift+arrows) */
        .sku-cell-range {
          background-color: rgba(21, 101, 192, 0.14) !important;
        }
        .dark .sku-cell-range {
          background-color: rgba(96, 165, 250, 0.22) !important;
        }

        /* SKU typed on more than one row — must be unique */
        .sku-cell-duplicate {
          background-color: #fee2e2 !important;
          color: #b91c1c !important;
          font-weight: 600;
        }
        .dark .sku-cell-duplicate {
          background-color: rgba(239, 68, 68, 0.25) !important;
          color: #fca5a5 !important;
        }

        /* Selector-field affordance: small chevron on the right of dropdown cells */
        .sku-dropdown-cell { padding-right: 22px !important; }
        .sku-dropdown-cell::after {
          content: "";
          position: absolute;
          right: 8px;
          top: 50%;
          margin-top: -2px;
          width: 0;
          height: 0;
          border-left: 4px solid transparent;
          border-right: 4px solid transparent;
          border-top: 5px solid #9ca3af;
          pointer-events: none;
          opacity: 0.7;
        }
        .sku-dropdown-cell:hover::after,
        .sku-dropdown-cell.ag-cell-focus::after {
          border-top-color: #1565c0;
          opacity: 1;
        }
        .dark .sku-dropdown-cell:hover::after,
        .dark .sku-dropdown-cell.ag-cell-focus::after {
          border-top-color: #60a5fa;
        }
        /* Hide the chevron while the cell is being edited */
        .sku-dropdown-cell.ag-cell-inline-editing::after { content: none; }
      `}</style>

      <AgGridReact<SkuMetadataRow>
        ref={gridRef}
        theme={isDark ? sheetThemeDark : sheetThemeLight}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={getRowId}
        rowSelection={enableSelection ? { mode: "multiRow" } : undefined}
        suppressRowClickSelection
        rowClassRules={rowClassRules}
        onCellValueChanged={onCellValueChanged}
        onCellClicked={onCellClicked}
        onCellMouseDown={handleCellMouseDown}
        onCellMouseOver={handleCellMouseOver}
        onSelectionChanged={() => {
          const selected = gridRef.current?.api.getSelectedRows() ?? []
          onSelectionChanged?.(selected)
        }}
        animateRows
        stopEditingWhenCellsLoseFocus
        enterNavigatesVertically
        enterNavigatesVerticallyAfterEdit
        enableBrowserTooltips
      />

      {/* Custom fill handle — rendered as an absolute overlay inside the grid container */}
      <SkuFillHandle
        containerRef={containerRef}
        gridRef={gridRef}
        rows={rows}
        onFill={handleFill}
        repeatOnlyFields={dropdownFields}
      />
    </div>
  )
}
