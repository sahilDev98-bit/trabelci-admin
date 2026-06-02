import { useCallback, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Download, Save, Loader2, Search, CheckSquare } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  useSkuMetadataListQuery,
  useSkuDropdownsQuery,
  useSkuBulkUpsertMutation,
  useImportSapItemsMutation,
  useCleanupStatsQuery,
} from "@/features/skuManagement/api"
import type { SkuMetadataRow } from "@/features/skuManagement/types"
import { SkuGrid } from "./components/SkuGrid"
import { SkuDetailPanel } from "./components/SkuDetailPanel"

export function SkuCleanupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [importInput, setImportInput] = useState("")
  const [showImport, setShowImport] = useState(false)
  const [localRows, setLocalRows] = useState<SkuMetadataRow[]>([])
  const [selectedRows, setSelectedRows] = useState<SkuMetadataRow[]>([])
  const [activeRow, setActiveRow] = useState<SkuMetadataRow | null>(null)

  const { data: listData, isLoading } = useSkuMetadataListQuery({
    workflowType: "cleanup",
    search: search || undefined,
    pageSize: 500,
  })
  const { data: dropdowns = {} } = useSkuDropdownsQuery()
  const { data: stats } = useCleanupStatsQuery()
  const bulkUpsert = useSkuBulkUpsertMutation()
  const importItems = useImportSapItemsMutation()

  const serverRows = listData?.rows ?? []
  const mergedRows = serverRows.map((sr) => {
    const local = localRows.find((l) => l.sku === sr.sku)
    return local ?? sr
  })

  const dirtyCount = localRows.filter((r) => r._isDirty).length

  const handleSave = useCallback(async () => {
    const dirty = localRows.filter((r) => r._isDirty && r.sku?.trim())
    if (!dirty.length) {
      toast.info(t("sku.grid.noChanges"))
      return
    }
    try {
      await bulkUpsert.mutateAsync(dirty)
      setLocalRows((prev) => prev.map((r) => ({ ...r, _isDirty: false })))
      toast.success(t("sku.grid.saved", { count: dirty.length }))
    } catch {
      toast.error(t("sku.grid.failedToSave"))
    }
  }, [localRows, bulkUpsert, t])

  const handleBulkApprove = useCallback(async () => {
    if (!selectedRows.length) {
      toast.info(t("sku.grid.selectApproved"))
      return
    }
    const toApprove = selectedRows.map((r) => ({
      ...r,
      status: "approved" as const,
      _isDirty: true,
    }))
    try {
      await bulkUpsert.mutateAsync(toApprove)
      toast.success(t("sku.grid.approvedSuccess", { count: toApprove.length }))
    } catch {
      toast.error(t("sku.grid.approvalFailed"))
    }
  }, [selectedRows, bulkUpsert, t])

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
        })
      )
      setImportInput("")
      setShowImport(false)
    } catch {
      toast.error(t("sku.import.failed"))
    }
  }, [importInput, importItems, t])

  const cleanedPct =
    stats && stats.total > 0
      ? Math.round((stats.cleaned / stats.total) * 100)
      : 0

  return (
    <div className="flex h-screen flex-col overflow-hidden">
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
                  className="h-1.5 rounded-full bg-amber-500"
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
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowImport(!showImport)}>
            <Download className="mr-1 h-4 w-4" />
            {t("sku.grid.importSapItems")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkApprove}
            disabled={!selectedRows.length || bulkUpsert.isPending}
          >
            <CheckSquare className="mr-1 h-4 w-4" />
            {t("sku.grid.approveSelectedCount", { count: selectedRows.length })}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirtyCount || bulkUpsert.isPending}
          >
            {bulkUpsert.isPending ? (
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
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("sku.import.description")}</p>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                rows={4}
                placeholder={t("sku.import.placeholder")}
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleImport} disabled={importItems.isPending}>
                  {importItems.isPending && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  {t("sku.grid.importSapItems")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowImport(false)}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Grid + detail panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden p-4">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : mergedRows.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
              <p className="text-sm">{t("sku.cleanup.noItems")}</p>
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                <Download className="mr-1 h-4 w-4" />
                {t("sku.grid.importSapItems")}
              </Button>
            </div>
          ) : (
            <SkuGrid
              rows={mergedRows}
              onRowsChange={(updated) =>
                setLocalRows((prev) => {
                  const map = new Map(prev.map((r) => [r.sku, r]))
                  for (const r of updated) map.set(r.sku, r)
                  return Array.from(map.values())
                })
              }
              dropdowns={dropdowns}
              mode="cleanup"
              onSelectionChanged={(sel) => {
                setSelectedRows(sel)
                setActiveRow(sel[0] ?? null)
              }}
            />
          )}
        </div>
        {activeRow && (
          <div className="w-80 shrink-0 overflow-y-auto border-l bg-background">
            <SkuDetailPanel row={activeRow} />
          </div>
        )}
      </div>
    </div>
  )
}
