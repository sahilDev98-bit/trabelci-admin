import { useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { AgGridReact } from "ag-grid-react"
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type GridReadyEvent,
  type CellValueChangedEvent,
  type GetRowIdParams,
} from "ag-grid-community"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import type { SkuMetadataRow, SkuDropdownMap, SkuValidationStatus } from "@/features/skuManagement/types"
import { DropdownCellEditor } from "./DropdownCellEditor"
import { RowStatusCellRenderer } from "./RowStatusCellRenderer"
import { SkuFillHandle, type FillUpdate } from "./SkuFillHandle"

ModuleRegistry.registerModules([AllCommunityModule])

interface SkuGridProps {
  rows: SkuMetadataRow[]
  onRowsChange: (rows: SkuMetadataRow[]) => void
  dropdowns: SkuDropdownMap
  mode: "creation" | "cleanup"
  onSelectionChanged?: (selected: SkuMetadataRow[]) => void
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
    // which has overflow:hidden + 42px height — the list is invisible.
    // Click events work correctly because DropdownCellEditor uses onMouseDown
    // (fires before blur) and a ref for the value (synchronous getValue).
    cellEditorPopup: true,
  }
}

function buildColumnDefs(
  mode: "creation" | "cleanup",
  dropdowns: SkuDropdownMap,
  t: TFunction
): ColDef<SkuMetadataRow>[] {
  const isCleanup = mode === "cleanup"

  return [
    {
      field: "_validationStatus" as keyof SkuMetadataRow,
      headerName: "",
      width: 40,
      pinned: "left" as const,
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
      cellRenderer: RowStatusCellRenderer,
    },
    {
      field: "sku",
      headerName: t("sku.fields.sku"),
      width: 140,
      pinned: "left" as const,
      editable: !isCleanup,
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
    { field: "company",           headerName: t("sku.fields.company"),           width: 150, editable: true },
    { field: "series",            headerName: t("sku.fields.series"),            width: 130, editable: true },
    { field: "color",             headerName: t("sku.fields.color"),             width: 120, editable: true },
    { field: "size",              headerName: t("sku.fields.size"),              width: 100, editable: true, ...makeDropdownCellEditor("size", dropdowns) },
    { field: "finish",            headerName: t("sku.fields.finish"),            width: 110, editable: true, ...makeDropdownCellEditor("finish", dropdowns) },
    { field: "country_of_origin", headerName: t("sku.fields.country_of_origin"), width: 110, editable: true, ...makeDropdownCellEditor("country_of_origin", dropdowns) },
    { field: "thickness",         headerName: t("sku.fields.thickness"),         width: 100, editable: true, ...makeDropdownCellEditor("thickness", dropdowns) },
    { field: "surface_type",      headerName: t("sku.fields.surface_type"),      width: 110, editable: true, ...makeDropdownCellEditor("surface_type", dropdowns) },
    { field: "r_rating",          headerName: t("sku.fields.r_rating"),          width: 90,  editable: true, ...makeDropdownCellEditor("r_rating", dropdowns) },
    { field: "product_type",      headerName: t("sku.fields.product_type"),      width: 110, editable: true, ...makeDropdownCellEditor("product_type", dropdowns) },
    { field: "supplier",          headerName: t("sku.fields.supplier"),          width: 130, editable: true },
    { field: "model",             headerName: t("sku.fields.model"),             width: 110, editable: true },
    { field: "sap_item_name",     headerName: t("sku.fields.sap_item_name"),     width: 200, editable: true },
    { field: "display_name_en",   headerName: t("sku.fields.display_name_en"),   width: 200, editable: true },
    { field: "display_name_he",   headerName: t("sku.fields.display_name_he"),   width: 180, editable: true },
    { field: "category",          headerName: t("sku.fields.category"),          width: 130, editable: true },
    { field: "subcategory",       headerName: t("sku.fields.subcategory"),       width: 130, editable: true },
    { field: "internal_notes",    headerName: t("sku.fields.internal_notes"),    width: 160, editable: true },
    {
      field: "status",
      headerName: t("sku.fields.status"),
      width: 130,
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
  onSelectionChanged,
}: SkuGridProps) {
  const { t } = useTranslation()
  const gridRef = useRef<AgGridReact<SkuMetadataRow>>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const columnDefs = buildColumnDefs(mode, dropdowns, t)

  const defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    editable: true,
  }

  const getRowId = useCallback(
    (params: GetRowIdParams<SkuMetadataRow>) => params.data.sku || String(Math.random()),
    []
  )

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent<SkuMetadataRow>) => {
      const updatedRows = rows.map((r) =>
        r.sku === event.data.sku
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

        // Find the matching element in the rows array by reference or SKU
        const idx = newRows.findIndex(
          (r) => r === node.data || (r.sku && r.sku === node.data!.sku)
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

  const onGridReady = useCallback((_params: GridReadyEvent) => {
    // Grid ready
  }, [])

  const rowClassRules = {
    "sku-row-red":    (p: { data?: SkuMetadataRow }) => p.data?._validationStatus === "red",
    "sku-row-yellow": (p: { data?: SkuMetadataRow }) => p.data?._validationStatus === "yellow",
    "sku-row-green":  (p: { data?: SkuMetadataRow }) => p.data?._validationStatus === "green",
  }

  return (
    <div
      ref={containerRef}
      className="ag-theme-alpine w-full"
      style={{ height: "calc(100vh - 220px)", minHeight: 400, position: "relative" }}
    >
      <style>{`
        .sku-row-red    { background-color: #fef2f2 !important; }
        .sku-row-yellow { background-color: #fffbeb !important; }
        .sku-row-green  { background-color: #f0fdf4 !important; }
        .ag-theme-alpine .ag-header { background-color: #f9fafb; }
        .ag-theme-alpine .ag-cell   { font-size: 13px; }
        .ag-theme-alpine .ag-row:hover { background-color: #f3f4f6; }
      `}</style>

      <AgGridReact<SkuMetadataRow>
        ref={gridRef}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={getRowId}
        rowSelection={{ mode: "multiRow" }}
        suppressRowClickSelection
        rowClassRules={rowClassRules}
        onCellValueChanged={onCellValueChanged}
        onGridReady={onGridReady}
        onSelectionChanged={() => {
          const selected = gridRef.current?.api.getSelectedRows() ?? []
          onSelectionChanged?.(selected)
        }}
        animateRows
        stopEditingWhenCellsLoseFocus
        enterNavigatesVertically
        enterNavigatesVerticallyAfterEdit
      />

      {/* Custom fill handle — rendered as an absolute overlay inside the grid container */}
      <SkuFillHandle
        containerRef={containerRef}
        gridRef={gridRef}
        rows={rows}
        onFill={handleFill}
      />
    </div>
  )
}
