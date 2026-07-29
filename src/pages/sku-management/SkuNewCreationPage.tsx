import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Save, Send, Loader2, CheckSquare, Maximize2, Trash2, FileText } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  useSkuDropdownsQuery,
  useSkuMetadataInfiniteQuery,
  useSkuBulkUpsertMutation,
  useSkuValidateMutation,
  useSkuCheckDuplicatesMutation,
  useSkuSubmitToSapMutation,
  useSkuAutocompleteHintsQuery,
} from "@/features/skuManagement/api"
import { useSkuAutocomplete } from "@/hooks/useSkuAutocomplete"
import type { SkuMetadataListResponse, SkuMetadataRow } from "@/features/skuManagement/types"
import { SkuSheetCeramic, type SkuSheetCeramicHandle } from "./components/SkuSheetCeramic"
import { SkuFullPageModal } from "./components/SkuFullPageModal"
import { PdfExtractModal } from "./components/PdfExtractModal"
// Rollback to the AG Grid sheet: import { SkuGrid } from "./components/SkuGrid"
// Right-side details panel — temporarily hidden (doc point 29 lists it as
// optional). Uncomment the related blocks below to bring it back.
// import { SkuDetailPanel } from "./components/SkuDetailPanel"

function makeEmptyRow(): SkuMetadataRow {
  return {
    sku: "",
    workflow_type: "new_creation",
    status: "draft",
    tile_type: "Floor",
    _validationStatus: "unchecked",
    _isDirty: true,
    _clientId: crypto.randomUUID(),
  }
}

// ─── Endless-sheet behavior ──────────────────────────────────────────────────
// Like a real spreadsheet, the grid always offers blank rows to type into —
// no Add Row button. Blank rows are padding only: every count, save,
// validation and approval ignores them; a row starts to "exist" the moment
// the user puts something in it.

// Enough blanks to fill the tallest common viewport (32px rows) so the sheet
// never shows dead space below the last row
const MIN_TRAILING_EMPTY_ROWS = 40

// Note: tile_type is deliberately excluded — makeEmptyRow() pre-fills it
// with "Floor", so including it here would make isRowEmpty() always false
// (every row, even untouched padding, would have a truthy tile_type).
const USER_DATA_FIELDS = [
  "sku", "supplier", "series", "color", "size", "finish",
  "country_of_origin", "qty_per_carton", "qty_per_pallet", "shade", "price",
  "supplier_code", "supplier_name_en", "series_en", "color_en", "supplier_sku",
] as const

function isRowEmpty(row: SkuMetadataRow): boolean {
  if (row.product_image_urls?.length) return false
  if (row.gallery_image_urls?.length) return false
  return USER_DATA_FIELDS.every((field) => !String(row[field] ?? "").trim())
}

// Keep at least MIN_TRAILING_EMPTY_ROWS blanks at the bottom of the sheet
function padWithEmptyRows(rows: SkuMetadataRow[]): SkuMetadataRow[] {
  let trailingEmpty = 0
  for (let i = rows.length - 1; i >= 0 && isRowEmpty(rows[i]); i--) {
    trailingEmpty++
  }
  if (trailingEmpty >= MIN_TRAILING_EMPTY_ROWS) return rows
  return [
    ...rows,
    ...Array.from({ length: MIN_TRAILING_EMPTY_ROWS - trailingEmpty }, makeEmptyRow),
  ]
}

// Infinite scroll appends newly-loaded drafts into the sheet — but the
// trailing blank rows must stay LAST (that's the whole point of the
// endless-sheet behavior), so new rows are spliced in just BEFORE them,
// not tacked onto the very end.
function insertLoadedRows(current: SkuMetadataRow[], loaded: SkuMetadataRow[]): SkuMetadataRow[] {
  if (!loaded.length) return current
  let trailingEmpty = 0
  for (let i = current.length - 1; i >= 0 && isRowEmpty(current[i]); i--) {
    trailingEmpty++
  }
  const insertAt = current.length - trailingEmpty
  return padWithEmptyRows([
    ...current.slice(0, insertAt),
    ...loaded,
    ...current.slice(insertAt),
  ])
}

// Statuses still being worked on — rows already pushed to SAP
// (created_in_sap) are finished and must not reappear in the editing sheet.
const IN_PROGRESS_STATUSES = new Set<string>(["draft", "pending_approval", "approved"])

// Saved rows come back without the client-only helper fields — initialize
// them clean (not dirty, not validated yet) with a stable grid identity.
// _savedSku remembers which SKU the row is stored under, so editing the SKU
// cell later renames the record instead of creating a sibling row.
function toGridRow(row: SkuMetadataRow): SkuMetadataRow {
  return {
    ...row,
    _clientId: crypto.randomUUID(),
    _isDirty: false,
    _validationStatus: "unchecked",
    _savedSku: row.sku,
  }
}

// Attach previous_sku when the row's SKU changed since its last save —
// signals the backend to move the stored record rather than insert a new one.
function withRenameInfo(row: SkuMetadataRow): SkuMetadataRow {
  return {
    ...row,
    previous_sku:
      row._savedSku && row._savedSku !== row.sku ? row._savedSku : undefined,
  }
}

// SKU is the unique anchor — find one used on more than one row, if any
function findDuplicateSheetSku(rows: SkuMetadataRow[]): string | null {
  const seen = new Set<string>()
  for (const row of rows) {
    const sku = row.sku?.trim()
    if (!sku) continue
    if (seen.has(sku)) return sku
    seen.add(sku)
  }
  return null
}

// Surface the backend's specific error (e.g. SKU rename conflicts) when present
function errorMessage(err: unknown): string | null {
  return err instanceof Error && err.message ? err.message : null
}

export function SkuNewCreationPage() {
  // Load previously saved drafts via infinite scroll — the sheet mounts once
  // the first 100 settle, then loads more itself as the user scrolls.
  // Mounting only after the first page settles means later refetches
  // (e.g. cache invalidation after Save Draft) never clobber in-progress edits.
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSkuMetadataInfiniteQuery({ workflowType: "new_creation" })

  const handleNearEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-110px)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return <CreationSheet pages={data?.pages ?? []} onNearEnd={handleNearEnd} />
}

function CreationSheet({
  pages,
  onNearEnd,
}: {
  pages: SkuMetadataListResponse[]
  onNearEnd: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rows, setRows] = useState<SkuMetadataRow[]>(() =>
    padWithEmptyRows(
      (pages[0]?.rows ?? [])
        .filter((r) => IN_PROGRESS_STATUSES.has(r.status))
        .map(toGridRow)
    )
  )

  // Infinite scroll — splice in each newly-fetched page's rows as it
  // arrives, ahead of the trailing blank rows. consumedPagesRef tracks how
  // many pages are already reflected in `rows` so each page is only
  // inserted once even though this effect re-runs on every render.
  const consumedPagesRef = useRef(pages.length)
  useEffect(() => {
    if (pages.length <= consumedPagesRef.current) return
    const newPages = pages.slice(consumedPagesRef.current)
    consumedPagesRef.current = pages.length
    const loaded = newPages
      .flatMap((p) => p.rows)
      .filter((r) => IN_PROGRESS_STATUSES.has(r.status))
      .map(toGridRow)
    if (loaded.length) setRows((prev) => insertLoadedRows(prev, loaded))
  }, [pages])

  const { data: dbHints } = useSkuAutocompleteHintsQuery()
  const autocomplete = useSkuAutocomplete(dbHints, rows)
  // Which toolbar action is running — Save Draft and Approve share the same
  // bulk-upsert mutation, so isPending alone would put both buttons in a
  // loading state at once.
  const [activeAction, setActiveAction] = useState<"save" | "approve" | null>(null)
  const [fullPageOpen, setFullPageOpen] = useState(false)
  const [pdfExtractOpen, setPdfExtractOpen] = useState(false)
  const sheetRef = useRef<SkuSheetCeramicHandle>(null)
  const [selectedCount, setSelectedCount] = useState(0)
  const [pageFullySelected, setPageFullySelected] = useState(false)
  const [selectAllMode, setSelectAllMode] = useState(false)

  // Undo/redo history (Ctrl+Z / Ctrl+Y) — snapshots of the sheet before each
  // edit/paste/clear/fill. Server actions (save/approve/submit) are not
  // undoable; like Excel, undo only rewinds what's on the sheet.
  const historyRef = useRef<{ past: SkuMetadataRow[][]; future: SkuMetadataRow[][] }>({
    past: [],
    future: [],
  })

  // Mirror of `rows` for the history handlers. State updaters must stay PURE
  // (React StrictMode invokes them twice, which corrupted the history when
  // pops/pushes lived inside them) — so all history mutations happen out
  // here, against this ref, and setRows only receives plain values.
  const rowsSnapshotRef = useRef<SkuMetadataRow[]>(rows)
  useEffect(() => {
    rowsSnapshotRef.current = rows
  }, [rows])

  const undo = useCallback(() => {
    const prev = historyRef.current.past.pop()
    if (!prev) return
    historyRef.current.future.push(rowsSnapshotRef.current)
    setRows(prev)
  }, [])

  const redo = useCallback(() => {
    const next = historyRef.current.future.pop()
    if (!next) return
    historyRef.current.past.push(rowsSnapshotRef.current)
    setRows(next)
  }, [])
  // Details panel state — temporarily hidden
  // const [activeRow, setActiveRow] = useState<SkuMetadataRow | null>(null)

  const { data: dropdowns = {} } = useSkuDropdownsQuery()
  const bulkUpsert = useSkuBulkUpsertMutation()
  const validate = useSkuValidateMutation()
  const checkDuplicates = useSkuCheckDuplicatesMutation()
  const submitToSap = useSkuSubmitToSapMutation()

  const handleSaveDraft = useCallback(async () => {
    const dirtyRows = rows.filter((r) => r._isDirty && r.sku?.trim())
    if (!dirtyRows.length) {
      toast.info(t("sku.grid.noChanges"))
      return
    }
    const duplicateSku = findDuplicateSheetSku(rows)
    if (duplicateSku) {
      toast.error(t("sku.grid.duplicateSkuInSheet", { sku: duplicateSku }))
      return
    }
    setActiveAction("save")
    try {
      await bulkUpsert.mutateAsync(dirtyRows.map(withRenameInfo))
      const savedKeys = new Set(dirtyRows.map((r) => r._clientId ?? r.sku))
      setRows((prev) =>
        prev.map((r) =>
          savedKeys.has(r._clientId ?? r.sku)
            ? { ...r, _isDirty: false, _savedSku: r.sku }
            : r
        )
      )
      toast.success(t("sku.grid.saved", { count: dirtyRows.length }))
    } catch (err) {
      toast.error(errorMessage(err) ?? t("sku.grid.failedToSave"))
    } finally {
      setActiveAction(null)
    }
  }, [rows, bulkUpsert, t])

  // Approval gets revoked when an approved row is edited — the user must
  // re-approve what they actually changed (point 30: approval covers exactly
  // what was reviewed). The grid marks edited rows _isDirty. Padding keeps
  // blank rows available below as the user fills the sheet downward.
  const handleRowsChange = useCallback((updated: SkuMetadataRow[]) => {
    historyRef.current.past.push(rowsSnapshotRef.current)
    if (historyRef.current.past.length > 100) historyRef.current.past.shift()
    historyRef.current.future = []
    setRows(
      padWithEmptyRows(
        updated.map((r) =>
          r._isDirty && r.status === "approved" ? { ...r, status: "draft" as const } : r
        )
      )
    )
  }, [])

  // Single-flow gate (spec points 4/13/17/27/30): one click runs validation
  // AND duplicate detection on every pending row in the sheet, surfaces the
  // results, then approves the rows that passed (yellow allowed with warning,
  // red blocked). Approving saves rows with status 'approved' (audit-logged),
  // which transforms this button into Submit to SAP — the second, conscious
  // click that actually creates items. Nothing reaches SAP in one click.
  const handleApprove = useCallback(async () => {
    const candidates = rows.filter(
      (r) => r.sku?.trim() && r.status !== "approved" && r.status !== "created_in_sap"
    )
    if (!candidates.length) {
      toast.info(t("sku.grid.noRowsToApprove"))
      return
    }
    const duplicateSku = findDuplicateSheetSku(rows)
    if (duplicateSku) {
      toast.error(t("sku.grid.duplicateSkuInSheet", { sku: duplicateSku }))
      return
    }
    setActiveAction("approve")
    try {
      const [valResults, dupResults] = await Promise.all([
        validate.mutateAsync({ rows: candidates }),
        checkDuplicates.mutateAsync(candidates),
      ])
      const valBySku = new Map(valResults.map((r) => [r.sku, r]))
      const dupBySku = new Map(dupResults.map((r) => [r.sku, r]))

      // Reflect fresh validation colors + duplicate warnings in the grid
      setRows((prev) =>
        prev.map((row) => {
          const v = valBySku.get(row.sku)
          const d = dupBySku.get(row.sku)
          if (!v && !d) return row
          return {
            ...row,
            ...(v
              ? {
                _validationStatus: v.status,
                _validationErrors: v.errors,
                _validationWarnings: v.warnings,
              }
              : {}),
            ...(d ? { _duplicates: d.duplicates } : {}),
          }
        })
      )

      const dupCount = dupResults.filter((r) => r.duplicates.length > 0).length
      if (dupCount > 0) {
        toast.warning(t("sku.grid.duplicatesFound", { count: dupCount }))
      }

      const approvable = candidates.filter((r) => valBySku.get(r.sku)?.status !== "red")
      const blockedCount = candidates.length - approvable.length
      if (!approvable.length) {
        toast.error(t("sku.grid.approveBlocked", { count: blockedCount }))
        return
      }

      const toApprove = approvable.map((r) =>
        withRenameInfo({ ...r, status: "approved" as const })
      )
      await bulkUpsert.mutateAsync(toApprove)

      const approvedSkus = new Set(toApprove.map((r) => r.sku))
      setRows((prev) =>
        prev.map((r) =>
          approvedSkus.has(r.sku)
            ? { ...r, status: "approved" as const, _isDirty: false, _savedSku: r.sku }
            : r
        )
      )
      toast.success(t("sku.grid.approvedSuccess", { count: toApprove.length }))
      if (blockedCount > 0) {
        toast.warning(t("sku.grid.approveBlocked", { count: blockedCount }))
      }
    } catch (err) {
      toast.error(errorMessage(err) ?? t("sku.grid.approvalFailed"))
    } finally {
      setActiveAction(null)
    }
  }, [rows, validate, checkDuplicates, bulkUpsert, t])

  const handleSubmitToSap = useCallback(async () => {
    const approvedSkus = rows
      .filter((r) => r.status === "approved" && r.sku?.trim())
      .map((r) => r.sku)

    if (!approvedSkus.length) {
      toast.info(t("sku.grid.selectApproved"))
      return
    }
    try {
      const result = await submitToSap.mutateAsync(approvedSkus)

      if (result.created.length > 0) {
        toast.success(t("sku.grid.sapCreated", { count: result.created.length }))
      }
      if (result.failed.length > 0) {
        // Surface the actual SAP error, not just a count
        toast.error(t("sku.grid.sapItemsFailed", { count: result.failed.length }), {
          description: result.failed
            .map((f) => `${f.sku}: ${f.error}`)
            .join("\n")
            .slice(0, 500),
          duration: 10000,
        })
      }

      // Match on the SKU the sheet had before submit — SAP may have assigned
      // a different final ItemCode (NEW-… rows)
      const createdByOriginal = new Map(
        result.created.map((c) => [c.originalSku ?? c.sku, c])
      )
      setRows((prev) =>
        prev.map((r) => {
          const created = createdByOriginal.get(r.sku)
          if (!created) return r
          return {
            ...r,
            sku: created.sku,
            _savedSku: created.sku,
            status: "created_in_sap" as const,
            _isDirty: false,
          }
        })
      )
    } catch (err) {
      toast.error(errorMessage(err) ?? t("sku.grid.sapFailed"))
    }
  }, [rows, submitToSap, t])

  const handlePdfApprove = useCallback((extracted: Partial<SkuMetadataRow>[]) => {
    if (!extracted.length) return
    const newRows = extracted.map((partial) => ({
      ...makeEmptyRow(),
      ...partial,
      _isDirty: true,
    }))
    setRows((prev) => {
      const filled = prev.filter((r) => !isRowEmpty(r))
      return padWithEmptyRows([...newRows, ...filled])
    })
    toast.success(`${extracted.length} product${extracted.length !== 1 ? "s" : ""} added from PDF`)
  }, [])

  // Blank padding rows don't exist as far as counts and actions are concerned
  const filledRows = rows.filter((r) => !isRowEmpty(r))
  const redCount = filledRows.filter((r) => r._validationStatus === "red").length
  const yellowCount = filledRows.filter((r) => r._validationStatus === "yellow").length
  const greenCount = filledRows.filter((r) => r._validationStatus === "green").length
  const unsavedCount = filledRows.filter((r) => r._isDirty).length

  // One transforming button: while any pending row exists the sheet must be
  // approved first; once everything pending is approved it becomes Submit.
  const approvableCount = rows.filter(
    (r) => r.sku?.trim() && r.status !== "approved" && r.status !== "created_in_sap"
  ).length
  const submittableCount = rows.filter(
    (r) => r.status === "approved" && r.sku?.trim()
  ).length
  // Submit only when approved rows are actually waiting and nothing pending
  // remains — otherwise (including an empty sheet) the action is Approve.
  const flowMode: "approve" | "submit" =
    submittableCount > 0 && approvableCount === 0 ? "submit" : "approve"
  const saveBusy = activeAction === "save"
  const approveBusy = activeAction === "approve"

  return (
    // Fits inside the admin layout's header + padding so the page itself
    // never scrolls — the sheet's own scrollbar is the only vertical one
    <div className="flex h-[calc(100vh-110px)] flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b bg-background px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: "/sku-management" })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-base font-semibold">{t("sku.workflowA")}</h1>
          <p className="text-xs text-muted-foreground">
            {t("sku.grid.rowsStatus", { total: filledRows.length, unsaved: unsavedCount })}
          </p>
        </div>

        {/* Validation summary badges */}
        <div className="ml-4 flex items-center gap-2">
          {greenCount > 0 && (
            <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
              ✓ {greenCount} {t("sku.validation.ready")}
            </Badge>
          )}
          {yellowCount > 0 && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              ⚠ {yellowCount} {t("sku.validation.warnings")}
            </Badge>
          )}
          {redCount > 0 && (
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
              ✕ {redCount} {t("sku.validation.errors")}
            </Badge>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {(selectedCount > 0 || selectAllMode) && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => sheetRef.current?.deleteSelected()}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {selectAllMode
                ? `Delete All (${filledRows.length})`
                : `Delete Selected (${selectedCount})`}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFullPageOpen(true)}
            title="Open grid in full page"
          >
            <Maximize2 className="mr-1 h-4 w-4" />
            {t("sku.viewFullPage")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPdfExtractOpen(true)}
            disabled={activeAction !== null}
          >
            <FileText className="mr-1 h-4 w-4" />
            {t("sku.pdfExtract.extractButton")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveDraft}
            disabled={activeAction !== null}
          >
            {saveBusy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {t("sku.grid.saveDraft")}
          </Button>
          {flowMode === "approve" ? (
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={activeAction !== null || approvableCount === 0}
            >
              {approveBusy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <CheckSquare className="mr-1 h-4 w-4" />
              )}
              {t("sku.grid.approveCount", { count: approvableCount })}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmitToSap}
              disabled={submitToSap.isPending || submittableCount === 0}
            >
              {submitToSap.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              {t("sku.grid.submitToSapCount", { count: submittableCount })}
            </Button>
          )}
        </div>
      </div>

      {/* Select-all banner */}
      {(pageFullySelected || selectAllMode) && (
        <div className="flex items-center justify-center gap-1 border-b bg-blue-50 px-4 py-2 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
          {selectAllMode ? (
            <>
              All {filledRows.length} item{filledRows.length !== 1 ? "s" : ""} are selected.{" "}
              <button
                type="button"
                className="cursor-pointer font-semibold underline underline-offset-2"
                onClick={() => { setSelectAllMode(false); sheetRef.current?.clearSelection() }}
              >
                Clear selection
              </button>
            </>
          ) : (
            <>
              All {selectedCount} item{selectedCount !== 1 ? "s" : ""} on this page are selected.
              {filledRows.length > selectedCount && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="cursor-pointer font-semibold underline underline-offset-2"
                    onClick={() => setSelectAllMode(true)}
                  >
                    Select all {filledRows.length} available item{filledRows.length !== 1 ? "s" : ""}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Grid + detail panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden p-4">
          <SkuSheetCeramic
            ref={sheetRef}
            rows={rows}
            onRowsChange={handleRowsChange}
            dropdowns={dropdowns}
            createEmptyRow={makeEmptyRow}
            onUndo={undo}
            onRedo={redo}
            showCheckbox
            isMeaningfulRow={(row) => !isRowEmpty(row)}
            totalCount={filledRows.length}
            onSelectionChange={({ count, pageFullySelected: pfs }) => {
              setSelectedCount(count)
              setPageFullySelected(pfs)
              if (!pfs) setSelectAllMode(false)
            }}
            autocomplete={autocomplete}
            onNearEnd={onNearEnd}
          />
        </div>
        {/* Right-side details panel — temporarily hidden
        {activeRow && (
          <div className="w-80 shrink-0 overflow-y-auto border-l bg-background">
            <SkuDetailPanel row={activeRow} />
          </div>
        )}
        */}
      </div>

      <PdfExtractModal
        open={pdfExtractOpen}
        onClose={() => setPdfExtractOpen(false)}
        onApprove={handlePdfApprove}
      />

      <SkuFullPageModal
        open={fullPageOpen}
        onClose={() => setFullPageOpen(false)}
        title={t("sku.workflowA")}
        statusLine={t("sku.grid.rowsStatus", { total: filledRows.length, unsaved: unsavedCount })}
        mode="creation"
        rows={rows}
        onRowsChange={handleRowsChange}
        dropdowns={dropdowns}
        createEmptyRow={makeEmptyRow}
        onUndo={undo}
        onRedo={redo}
        autocomplete={autocomplete}
        onNearEnd={onNearEnd}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPdfExtractOpen(true)}
              disabled={activeAction !== null}
            >
              <FileText className="mr-1 h-4 w-4" />
              {t("sku.pdfExtract.extractButton")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
              disabled={activeAction !== null}
            >
              {activeAction === "save" ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              {t("sku.grid.saveDraft")}
            </Button>
            {flowMode === "approve" ? (
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={activeAction !== null || approvableCount === 0}
              >
                {activeAction === "approve" ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CheckSquare className="mr-1 h-4 w-4" />
                )}
                {t("sku.grid.approveCount", { count: approvableCount })}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleSubmitToSap}
                disabled={submitToSap.isPending || submittableCount === 0}
              >
                {submitToSap.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1 h-4 w-4" />
                )}
                {t("sku.grid.submitToSapCount", { count: submittableCount })}
              </Button>
            )}
          </>
        }
      />
    </div>
  )
}
