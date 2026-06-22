import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Save,
  Loader2,
  Search,
  Maximize2,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
import {
  useSkuMetadataListQuery,
  useSkuDropdownsQuery,
  useSkuBulkUpsertMutation,
  useSkuValidateMutation,
  useSkuCheckDuplicatesMutation,
  useCleanupStatsQuery,
  useSkuBulkDeleteMutation,
  useSkuAutocompleteHintsQuery,
} from "@/features/skuManagement/api"
import { useSkuAutocomplete } from "@/hooks/useSkuAutocomplete"
import { skuQueryKeys } from "@/features/skuManagement/queryKeys"
import type { SkuCleanupStatusTab, SkuMetadataRow } from "@/features/skuManagement/types"
import { cn } from "@/lib/utils"
import { SkuSheetCeramic } from "./components/SkuSheetCeramic"
import { SkuFullPageModal } from "./components/SkuFullPageModal"
import { SkuSapImportModal } from "./components/SkuSapImportModal"

const PAGE_SIZE = 100

function statusFilterForTab(tab: SkuCleanupStatusTab): SkuMetadataRow["status"] | undefined {
  if (tab === "pending") return "cleanup_only"
  if (tab === "cleaned") return "approved"
  return undefined
}

function toGridRow(row: SkuMetadataRow): SkuMetadataRow {
  return {
    ...row,
    _isDirty: false,
    _validationStatus: row._validationStatus ?? "unchecked",
    _savedSku: row.sku,
  }
}

function errorMessage(err: unknown): string | null {
  return err instanceof Error && err.message ? err.message : null
}

const getRowKey = (row: SkuMetadataRow) => row._clientId ?? row.sku ?? ""

// ─── Skeleton ─────────────────────────────────────────────────────────────────
// Column template mirrors buildColumns("cleanup", showCheckbox=true) exactly:
// checkbox(36) + index(44) + 19 data columns with their minWidths
// (includes the cleanup-only "Original SAP Name" column right after SKU)
const SKELETON_GRID_COLS =
  "36px 44px minmax(140px,1fr) minmax(180px,1fr) minmax(130px,1fr) minmax(120px,1fr) minmax(110px,1fr) " +
  "minmax(130px,1fr) minmax(125px,1fr) minmax(170px,1fr) minmax(170px,1fr) minmax(130px,1fr) " +
  "minmax(110px,1fr) minmax(110px,1fr) minmax(110px,1fr) minmax(110px,1fr) minmax(180px,1fr) " +
  "minmax(120px,1fr) minmax(110px,1fr) minmax(130px,1fr) minmax(110px,1fr)"
const SKELETON_MIN_W = 2735 // sum of all minWidths + (21-1)*8px gaps
const SKELETON_COLS = 21
const SKELETON_ROWS = 15

function colStickyStyle(ci: number): React.CSSProperties {
  const base: React.CSSProperties = { background: "var(--background)" }
  if (ci === 0) return { ...base, position: "sticky", insetInlineStart: 0, zIndex: 3 }
  if (ci === 1) return { ...base, position: "sticky", insetInlineStart: 44, zIndex: 3 }
  if (ci === 2) return { ...base, position: "sticky", insetInlineStart: 96, zIndex: 3 }
  return {}
}

function SkuCleanupSkeleton() {
  return (
    <div style={{ height: "100%", overflow: "auto", padding: "4px 4px 16px" }}>
      <div
        style={{
          display: "grid",
          gap: "10px 8px",
          gridTemplateColumns: SKELETON_GRID_COLS,
          minWidth: SKELETON_MIN_W,
        }}
      >
        {/* Header row */}
        {Array.from({ length: SKELETON_COLS }).map((_, ci) => (
          <div
            key={`sh-${ci}`}
            style={{
              ...colStickyStyle(ci),
              zIndex: ci < 3 ? 6 : 5,
              position: "sticky",
              top: 0,
              padding: "14px 6px 12px",
              borderBottom: "1px solid rgba(30,36,60,.10)",
              background: "var(--background)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              // Matches ceramic-head box-shadow to cover the panel gap
              boxShadow: "0 -4px 0 0 var(--background), 0 10px 0 0 var(--background)",
            }}
          >
            {ci > 0 && (
              <div
                className="animate-pulse"
                style={{
                  height: 9,
                  width: "55%",
                  borderRadius: 5,
                  background: "color-mix(in srgb, currentColor 12%, transparent)",
                }}
              />
            )}
          </div>
        ))}

        {/* Data rows */}
        {Array.from({ length: SKELETON_ROWS }).map((_, ri) =>
          Array.from({ length: SKELETON_COLS }).map((_, ci) => (
            <div
              key={`sr-${ri}-${ci}`}
              style={{
                ...colStickyStyle(ci),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "5px 4px",
              }}
            >
              {ci === 0 ? (
                // Matches ceramic-checkbox: 16×16, 3px radius
                <div
                  className="animate-pulse"
                  style={{
                    width: 16, height: 16, borderRadius: 3,
                    background: "color-mix(in srgb, currentColor 10%, transparent)",
                  }}
                />
              ) : ci === 1 ? (
                // Matches ceramic-idx chip: 44×44, 12px radius
                <div
                  className="animate-pulse"
                  style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: "color-mix(in srgb, currentColor 8%, transparent)",
                  }}
                />
              ) : (
                // Matches ceramic-rect: 86% width, 44px height, 14px radius
                <div
                  className="animate-pulse"
                  style={{
                    width: "86%", height: 44, borderRadius: 14,
                    background: "color-mix(in srgb, currentColor 6%, transparent)",
                  }}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function SkuCleanupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusTab, setStatusTab] = useState<SkuCleanupStatusTab>("pending")
  const [page, setPage] = useState(1)
  const [showSapImportModal, setShowSapImportModal] = useState(false)
  const [fullPageOpen, setFullPageOpen] = useState(false)
  const [localRows, setLocalRows] = useState<SkuMetadataRow[]>([])
  const [isSaving, setIsSaving] = useState(false)

  // ── Selection state (mirrors ProductGroups two-set pattern) ────────────────
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set())
  const [isSelectAllMode, setIsSelectAllMode] = useState(false)
  const [showBulkDeleteAllConfirm, setShowBulkDeleteAllConfirm] = useState(false)
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  // Reset selection only when the dataset changes (tab or search), NOT on page change —
  // selection must persist as the user paginates through the same result set
  useEffect(() => {
    setIsSelectAllMode(false)
    setSelectedKeys(new Set())
    setExcludedKeys(new Set())
  }, [statusTab, debouncedSearch])

  const listFilters = useMemo(
    () => ({
      workflowType: "cleanup" as const,
      status: statusFilterForTab(statusTab),
      search: debouncedSearch || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [statusTab, debouncedSearch, page],
  )

  const { data: listData, isLoading, isFetching } = useSkuMetadataListQuery(listFilters)
  const { data: dropdowns = {} } = useSkuDropdownsQuery()
  const { data: stats } = useCleanupStatsQuery()
  const bulkUpsert = useSkuBulkUpsertMutation()

  const validate = useSkuValidateMutation()
  const checkDuplicates = useSkuCheckDuplicatesMutation()
  const bulkDelete = useSkuBulkDeleteMutation()

  const localBySku = useMemo(
    () => new Map(localRows.map((r) => [r.sku, r])),
    [localRows],
  )

  const serverRows = useMemo(
    () => (listData?.rows ?? []).map(toGridRow),
    [listData?.rows],
  )

  const mergedRows = useMemo(() => {
    const serverSkus = new Set(serverRows.map((sr) => sr.sku))
    // Row CONTENT always comes from the local cache when present (it may
    // carry unsaved edits). Row ORDER prefers the local cache too — that's
    // what lets in-grid sorting (which reorders localRows) actually stick —
    // falling back to the server's own order for rows not cached yet (e.g.
    // a page visited for the first time this session).
    const ordered = localRows.filter((r) => r.sku && serverSkus.has(r.sku))
    const seen = new Set(ordered.map((r) => r.sku))
    for (const sr of serverRows) {
      if (!seen.has(sr.sku)) ordered.push(localBySku.get(sr.sku) ?? sr)
    }
    return ordered
  }, [serverRows, localBySku, localRows])

  const dirtyCount = localRows.filter((r) => r._isDirty).length
  const totalItems = listData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
  const tabCounts = {
    pending: stats?.pending ?? 0,
    cleaned: stats?.cleaned ?? 0,
    all: stats?.total ?? 0,
  }

  // ── Controlled selection helpers (mirrors ProductGroups pattern exactly) ───

  // Mirrors isProductSelected — single source of truth for "is this row checked?"
  const isRowSelected = useCallback((row: SkuMetadataRow): boolean => {
    const key = getRowKey(row)
    return isSelectAllMode ? !excludedKeys.has(key) : selectedKeys.has(key)
  }, [isSelectAllMode, excludedKeys, selectedKeys])

  // Mirrors allPageSelected — true only when every row on current page is checked
  const allPageSelected = useMemo(
    () => mergedRows.length > 0 && mergedRows.every((r) => isRowSelected(r)),
    [mergedRows, isRowSelected],
  )
  const showSelectionBanner = (allPageSelected || isSelectAllMode) && !isLoading && mergedRows.length > 0


  // What the user sees as the count to act on
  const selectedCount = isSelectAllMode
    ? totalItems - excludedKeys.size
    : selectedKeys.size
  const hasSelection = selectedCount > 0 || isSelectAllMode

  // Mirrors toggleProduct — toggle a single row's checked state
  const onRowToggle = useCallback((key: string) => {
    if (isSelectAllMode) {
      setExcludedKeys((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    } else {
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }
  }, [isSelectAllMode])

  // Mirrors toggleSelectAllPage — header checkbox toggles the entire current page
  const onHeaderToggle = useCallback(() => {
    if (isSelectAllMode) {
      if (allPageSelected) {
        // Deselect this page by adding its keys to the exclusion set
        setExcludedKeys((prev) => {
          const next = new Set(prev)
          for (const r of mergedRows) next.add(getRowKey(r))
          return next
        })
      } else {
        // Re-select this page by removing its keys from the exclusion set
        setExcludedKeys((prev) => {
          const next = new Set(prev)
          for (const r of mergedRows) next.delete(getRowKey(r))
          return next
        })
      }
    } else {
      if (allPageSelected) {
        setSelectedKeys((prev) => {
          const next = new Set(prev)
          for (const r of mergedRows) next.delete(getRowKey(r))
          return next
        })
      } else {
        setSelectedKeys((prev) => {
          const next = new Set(prev)
          for (const r of mergedRows) next.add(getRowKey(r))
          return next
        })
      }
    }
  }, [isSelectAllMode, allPageSelected, mergedRows])

  // Mirrors handleSelectAllProducts — enter select-all mode
  const handleSelectAll = useCallback(() => {
    setIsSelectAllMode(true)
    setExcludedKeys(new Set())
    setSelectedKeys(new Set())
  }, [])

  // Mirrors handleClearSelection — exit select-all mode
  const handleClearSelection = useCallback(() => {
    setIsSelectAllMode(false)
    setExcludedKeys(new Set())
    setSelectedKeys(new Set())
  }, [])

  // Delete explicitly selected rows (normal mode)
  const confirmDeleteSelected = useCallback(async () => {
    const skus = Array.from(selectedKeys).filter(Boolean)
    if (!skus.length) return
    try {
      const result = await bulkDelete.mutateAsync({ skus })
      toast.success(`Deleted ${result.deleted} item${result.deleted !== 1 ? "s" : ""}`)
      setLocalRows((prev) => prev.filter((r) => !selectedKeys.has(getRowKey(r))))
      handleClearSelection()
      setShowDeleteSelectedConfirm(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete items")
    }
  }, [bulkDelete, selectedKeys, handleClearSelection])

  // Delete all matching items server-side, minus any exclusions (select-all mode)
  const confirmBulkDeleteAll = useCallback(async () => {
    try {
      const result = await bulkDelete.mutateAsync({
        workflowType: "cleanup",
        status: listFilters.status,
        search: listFilters.search,
        excludedSkus: excludedKeys.size > 0 ? Array.from(excludedKeys) : undefined,
      })
      toast.success(`Deleted ${result.deleted} item${result.deleted !== 1 ? "s" : ""}`)
      handleClearSelection()
      setShowBulkDeleteAllConfirm(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete items")
    }
  }, [bulkDelete, listFilters, excludedKeys, handleClearSelection])

  // ── Data handlers ──────────────────────────────────────────────────────────

  const handleRowsChange = useCallback((updated: SkuMetadataRow[]) => {
    setLocalRows((prev) => {
      // `updated` is always the full current page, in whatever order the
      // grid wants displayed (sorting reorders it; every other edit keeps
      // the existing order) — that order wins. Rows cached from other
      // pages/tabs are carried over unchanged, after this page's rows.
      const updatedSkus = new Set(updated.filter((r) => r.sku).map((r) => r.sku))
      const carryOver = prev.filter((r) => r.sku && !updatedSkus.has(r.sku))
      return [...updated.filter((r) => r.sku), ...carryOver]
    })
  }, [])

  const { data: dbHints } = useSkuAutocompleteHintsQuery()
  const autocomplete = useSkuAutocomplete(dbHints, mergedRows)

  const handleSave = useCallback(async () => {
    const dirty = localRows.filter((r) => r._isDirty && r.sku?.trim())
    if (!dirty.length) {
      toast.info(t("sku.grid.noChanges"))
      return
    }

    setIsSaving(true)
    try {
      const [valResults, dupResults] = await Promise.all([
        validate.mutateAsync({ rows: dirty }),
        checkDuplicates.mutateAsync(dirty),
      ])
      const valBySku = new Map(valResults.map((r) => [r.sku, r]))
      const dupBySku = new Map(dupResults.map((r) => [r.sku, r]))
      const dirtySkus = new Set(dirty.map((r) => r.sku))

      const withValidation = localRows.map((row) => {
        if (!dirtySkus.has(row.sku)) return row
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
      setLocalRows(withValidation)

      const toSave = dirty.map((row) => {
        const validated = withValidation.find((r) => r.sku === row.sku) ?? row
        const valStatus = valBySku.get(row.sku)?.status
        const status = valStatus === "red" ? ("cleanup_only" as const) : ("approved" as const)
        return { ...validated, status }
      })

      const approvedCount = toSave.filter((r) => r.status === "approved").length
      const blockedCount = toSave.length - approvedCount

      await bulkUpsert.mutateAsync(toSave)

      const savedBySku = new Map(toSave.map((r) => [r.sku, r]))
      const afterSave = withValidation.map((row) => {
        const saved = savedBySku.get(row.sku)
        if (!saved) return row
        return {
          ...row,
          status: saved.status,
          _isDirty: false,
          _savedSku: row.sku,
        }
      })
      setLocalRows(afterSave)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: skuQueryKeys.cleanupStats }),
        queryClient.invalidateQueries({ queryKey: skuQueryKeys.metadata.all }),
      ])

      if (blockedCount > 0) {
        const blockedSkus = toSave
          .filter((r) => r.status === "cleanup_only")
          .map((r) => r.sku)
        toast.warning(
          t("sku.grid.saveSummary", {
            saved: toSave.length,
            approved: approvedCount,
            blocked: blockedCount,
          }),
          {
            duration: 8000,
            description:
              blockedSkus.slice(0, 5).join(", ") +
              (blockedSkus.length > 5 ? ` +${blockedSkus.length - 5}` : ""),
          },
        )
      } else {
        toast.success(
          t("sku.grid.saveSummaryPlain", {
            saved: toSave.length,
            approved: approvedCount,
          }),
        )
      }
    } catch (err) {
      toast.error(errorMessage(err) ?? t("sku.grid.failedToSave"))
    } finally {
      setIsSaving(false)
    }
  }, [localRows, validate, checkDuplicates, bulkUpsert, queryClient, t])

  const cleanedPct =
    stats && stats.total > 0 ? Math.round((stats.cleaned / stats.total) * 100) : 0

  // Shared between the xl+ inline placement (same row as the tabs) and the
  // <xl placement (its own row below the tabs) — same content, two spots.
  const selectionBannerContent = !showSelectionBanner ? null : isSelectAllMode ? (
    <>
      All {selectedCount} item{selectedCount !== 1 ? "s" : ""} are selected.{" "}
      <button
        type="button"
        className="cursor-pointer font-semibold underline underline-offset-2"
        onClick={handleClearSelection}
      >
        Clear selection
      </button>
    </>
  ) : (
    <>
      All {selectedCount} item{selectedCount !== 1 ? "s" : ""} on this page are selected.
      {totalItems > selectedCount && (
        <>
          {" "}
          <button
            type="button"
            className="cursor-pointer font-semibold underline underline-offset-2"
            onClick={handleSelectAll}
          >
            Select all {totalItems} available item{totalItems !== 1 ? "s" : ""}
          </button>
        </>
      )}
    </>
  )

  const statusTabs: { key: SkuCleanupStatusTab; label: string; count: number }[] = [
    { key: "pending", label: t("sku.cleanup.tabs.pending"), count: tabCounts.pending },
    { key: "cleaned", label: t("sku.cleanup.tabs.cleaned"), count: tabCounts.cleaned },
    { key: "all", label: t("sku.cleanup.tabs.all"), count: tabCounts.all },
  ]

  return (
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
          <h1 className="text-base font-semibold">{t("sku.workflowB")}</h1>
          <p className="text-xs text-muted-foreground">{t("sku.cleanup.subtitle")}</p>
        </div>

        {stats && (
          <div className="ml-4 hidden items-center gap-3 md:flex">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${cleanedPct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {stats.cleaned}/{stats.total} {t("sku.cleaned")}
              </span>
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-52">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-sm"
              placeholder={t("sku.grid.searchSkus")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowSapImportModal(true)}>
            <Download className="mr-1 h-4 w-4" />
            {t("sku.grid.importSapItems")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFullPageOpen(true)}
            title="Open grid in full page"
          >
            <Maximize2 className="mr-1 h-4 w-4" />
            View in Full Page
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || bulkUpsert.isPending}
          >
            {isSaving || bulkUpsert.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {t("sku.grid.saveCount", { count: dirtyCount })}
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center justify-between border-b bg-background/80 px-4 py-2 backdrop-blur-sm">
        <div className="inline-flex gap-1 rounded-lg bg-muted/80 p-1">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                statusTab === tab.key
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setStatusTab(tab.key)
                setPage(1)
              }}
            >
              {tab.label}
              <Badge
                variant={statusTab === tab.key ? "secondary" : "outline"}
                className="h-5 min-w-5 justify-center px-1.5 text-[10px] tabular-nums"
              >
                {tab.count}
              </Badge>
            </button>
          ))}
        </div>

        {/* xl+ only: selection text lives in the leftover space of this same
            row, so it never adds height. Below xl there isn't enough room
            for tabs + text + button on one line, so it moves to its own
            row instead (rendered right after this one). */}
        <div
          className="hidden flex-1 truncate px-4 text-center text-xs text-blue-700 xl:block dark:text-blue-300"
          aria-hidden={!showSelectionBanner}
        >
          {selectionBannerContent}
        </div>

        {/* Always mounted so its slot is reserved — toggling visibility (not
            presence) keeps the tabs from jumping when a selection starts or ends. */}
        <Button
          variant="destructive"
          size="sm"
          className={cn(!hasSelection && "invisible")}
          tabIndex={hasSelection ? 0 : -1}
          aria-hidden={!hasSelection}
          onClick={
            isSelectAllMode
              ? () => setShowBulkDeleteAllConfirm(true)
              : () => setShowDeleteSelectedConfirm(true)
          }
        >
          <Trash2 className="mr-1 h-4 w-4" />
          {isSelectAllMode
            ? `Delete All (${selectedCount})`
            : `Delete Selected (${selectedCount})`}
        </Button>
      </div>

      {/* <xl: selection banner gets its own reserved-height row below the
          tabs (the original placement) since the tabs row is too narrow to
          fit tabs + text + button together at smaller widths. */}
      <div
        className={cn(
          "flex h-9 shrink-0 items-center justify-center gap-1 border-b px-4 text-xs transition-colors xl:hidden",
          showSelectionBanner
            ? "border-border bg-blue-50 text-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
            : "border-transparent bg-transparent text-transparent",
        )}
        aria-hidden={!showSelectionBanner}
      >
        {selectionBannerContent}
      </div>

      {/* Grid + detail panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden p-4 pb-2">
          {(isLoading || (isFetching && mergedRows.length === 0)) ? (
            <div className="flex-1 overflow-hidden">
              <SkuCleanupSkeleton />
            </div>
          ) : mergedRows.length === 0 ? (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <p className="text-sm">{t("sku.cleanup.noItems")}</p>
              <Button variant="outline" size="sm" onClick={() => setShowSapImportModal(true)}>
                <Download className="mr-1 h-4 w-4" />
                {t("sku.grid.importSapItems")}
              </Button>
            </div>
          ) : (
            <div className="relative flex-1 overflow-hidden">
              <SkuSheetCeramic
                rows={mergedRows}
                onRowsChange={handleRowsChange}
                dropdowns={dropdowns}
                mode="cleanup"
                showCheckbox
                isRowSelected={isRowSelected}
                onRowToggle={onRowToggle}
                headerChecked={allPageSelected}
                headerIndeterminate={false}
                onHeaderToggle={onHeaderToggle}
                autocomplete={autocomplete}
              />
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalItems > 0 && (
          <div className="flex items-center justify-center gap-3 border-t bg-background/80 px-4 py-2 text-sm">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t("sku.cleanup.pagination.prev")}
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("sku.cleanup.pagination.pageOf", {
                page,
                pages: totalPages,
                total: totalItems,
              })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t("sku.cleanup.pagination.next")}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Delete Selected confirmation */}
      <AlertDialog open={showDeleteSelectedConfirm} onOpenChange={setShowDeleteSelectedConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} selected item{selectedCount !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedCount} selected item{selectedCount !== 1 ? "s" : ""}.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDelete.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={bulkDelete.isPending}
              onClick={(e) => {
                e.preventDefault()
                void confirmDeleteSelected()
              }}
            >
              {bulkDelete.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Delete {selectedCount} item{selectedCount !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All confirmation (select-all mode) */}
      <AlertDialog open={showBulkDeleteAllConfirm} onOpenChange={setShowBulkDeleteAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete all {selectedCount} item{selectedCount !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {selectedCount} matching item{selectedCount !== 1 ? "s" : ""}
              {listFilters.search ? ` matching "${listFilters.search}"` : ""}
              {listFilters.status ? ` with status "${listFilters.status}"` : ""}
              {excludedKeys.size > 0 ? ` (${excludedKeys.size} item${excludedKeys.size !== 1 ? "s" : ""} excluded)` : ""}.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDelete.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={bulkDelete.isPending}
              onClick={(e) => {
                e.preventDefault()
                void confirmBulkDeleteAll()
              }}
            >
              {bulkDelete.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Delete {selectedCount} item{selectedCount !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SkuSapImportModal
        open={showSapImportModal}
        onClose={() => setShowSapImportModal(false)}
      />

      <SkuFullPageModal
        open={fullPageOpen}
        onClose={() => setFullPageOpen(false)}
        title={t("sku.workflowB")}
        subtitle={t("sku.cleanup.subtitle")}
        mode="cleanup"
        rows={mergedRows}
        onRowsChange={handleRowsChange}
        dropdowns={dropdowns}
        autocomplete={autocomplete}
        actions={
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || bulkUpsert.isPending}
          >
            {isSaving || bulkUpsert.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {t("sku.grid.saveCount", { count: dirtyCount })}
          </Button>
        }
      />
    </div>
  )
}
