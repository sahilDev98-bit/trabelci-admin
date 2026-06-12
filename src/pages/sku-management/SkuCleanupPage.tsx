import { useCallback, useEffect, useMemo, useState } from "react"
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
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  useImportSapItemsMutation,
  useImportAllSapItemsMutation,
  useCleanupStatsQuery,
} from "@/features/skuManagement/api"
import { skuQueryKeys } from "@/features/skuManagement/queryKeys"
import type { SkuCleanupStatusTab, SkuMetadataRow } from "@/features/skuManagement/types"
import { cn } from "@/lib/utils"
import { SkuSheetCeramic } from "./components/SkuSheetCeramic"
// Rollback to the AG Grid sheet: import { SkuGrid } from "./components/SkuGrid"
// Right-side details panel — temporarily hidden (same convention as SkuNewCreationPage).
// import { SkuDetailPanel } from "./components/SkuDetailPanel"

const PAGE_SIZE = 100

function statusFilterForTab(tab: SkuCleanupStatusTab): SkuMetadataRow["status"] | undefined {
  if (tab === "pending") return "cleanup_only"
  if (tab === "cleaned") return "approved"
  return undefined
}

// No _clientId here on purpose: cleanup SKUs are unique and immutable, so the
// grid keys fall back to the stable `sku` — regenerating ids per refetch would
// remount rows and could discard in-progress (uncommitted) typing.
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

export function SkuCleanupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusTab, setStatusTab] = useState<SkuCleanupStatusTab>("pending")
  const [page, setPage] = useState(1)
  const [importInput, setImportInput] = useState("")
  const [showImport, setShowImport] = useState(false)
  const [showImportAllConfirm, setShowImportAllConfirm] = useState(false)
  const [localRows, setLocalRows] = useState<SkuMetadataRow[]>([])
  const [isSaving, setIsSaving] = useState(false)
  // Details panel state — temporarily hidden
  // const [activeRow, setActiveRow] = useState<SkuMetadataRow | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

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
  const importItems = useImportSapItemsMutation()
  const importAllItems = useImportAllSapItemsMutation()

  const localBySku = useMemo(
    () => new Map(localRows.map((r) => [r.sku, r])),
    [localRows],
  )

  const serverRows = useMemo(
    () => (listData?.rows ?? []).map(toGridRow),
    [listData?.rows],
  )

  const mergedRows = useMemo(
    () => serverRows.map((sr) => localBySku.get(sr.sku) ?? sr),
    [serverRows, localBySku],
  )

  const dirtyCount = localRows.filter((r) => r._isDirty).length
  const totalItems = listData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
  const importableCount = stats?.importable ?? stats?.productTotal ?? 0

  const tabCounts = {
    pending: stats?.pending ?? 0,
    cleaned: stats?.cleaned ?? 0,
    all: stats?.total ?? 0,
  }

  const handleRowsChange = useCallback((updated: SkuMetadataRow[]) => {
    setLocalRows((prev) => {
      const map = new Map(prev.map((r) => [r.sku, r]))
      for (const r of updated) {
        if (r.sku) map.set(r.sku, r)
      }
      return Array.from(map.values())
    })
  }, [])

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
        // Amber warning, not green success — rows with red fields were saved
        // but NOT approved, and the user must see that distinction clearly
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

  const handleImport = useCallback(async () => {
    const codes = importInput
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!codes.length) return
    try {
      const result = await importItems.mutateAsync(codes)
      toast.success(
        t("sku.import.result", {
          imported: result.imported.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        }),
      )
      setImportInput("")
      setShowImport(false)
    } catch {
      toast.error(t("sku.import.failed"))
    }
  }, [importInput, importItems, t])

  const handleImportAll = useCallback(async () => {
    try {
      const result = await importAllItems.mutateAsync()
      toast.success(
        t("sku.import.resultAll", {
          imported: result.imported,
          skipped: result.skipped,
          failed: result.failed,
        }),
      )
      setShowImportAllConfirm(false)
      setShowImport(false)
    } catch {
      toast.error(t("sku.import.failed"))
    }
  }, [importAllItems, t])

  const cleanedPct =
    stats && stats.total > 0 ? Math.round((stats.cleaned / stats.total) * 100) : 0

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
          <Button variant="outline" size="sm" onClick={() => setShowImport(!showImport)}>
            <Download className="mr-1 h-4 w-4" />
            {t("sku.grid.importSapItems")}
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

      {/* Import panel */}
      {showImport && (
        <div className="border-b bg-muted/30 px-4 py-3">
          <Card className="max-w-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("sku.import.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{t("sku.import.description")}</p>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                rows={4}
                placeholder={t("sku.import.placeholder")}
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleImport} disabled={importItems.isPending}>
                  {importItems.isPending && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  {t("sku.grid.importSapItems")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowImportAllConfirm(true)}
                  disabled={importAllItems.isPending || importableCount === 0}
                >
                  {importAllItems.isPending && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  {t("sku.import.importAll", { count: importableCount })}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowImport(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Status tabs */}
      <div className="border-b bg-background/80 px-4 py-2 backdrop-blur-sm">
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
      </div>

      {/* Grid + detail panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden p-4 pb-2">
          {isLoading ? (
            <div className="flex h-32 w-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : mergedRows.length === 0 ? (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <p className="text-sm">{t("sku.cleanup.noItems")}</p>
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                <Download className="mr-1 h-4 w-4" />
                {t("sku.grid.importSapItems")}
              </Button>
            </div>
          ) : (
            <div className="relative flex-1 overflow-hidden">
              {isFetching && !isLoading && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              <SkuSheetCeramic
                rows={mergedRows}
                onRowsChange={handleRowsChange}
                dropdowns={dropdowns}
                mode="cleanup"
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
        {/* Right-side details panel — temporarily hidden
        {activeRow && (
          <div className="w-80 shrink-0 overflow-y-auto border-l bg-background">
            <SkuDetailPanel row={activeRow} />
          </div>
        )}
        */}
      </div>

      <AlertDialog open={showImportAllConfirm} onOpenChange={setShowImportAllConfirm}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sku.import.importAllTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sku.import.importAllDescription", { count: importableCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importAllItems.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={importAllItems.isPending}
              onClick={(e) => {
                e.preventDefault()
                void handleImportAll()
              }}
            >
              {importAllItems.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              {t("sku.import.importAllConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
