import { useCallback, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Plus, Save, CheckCircle2, AlertTriangle, Send, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  useSkuDropdownsQuery,
  useSkuBulkUpsertMutation,
  useSkuValidateMutation,
  useSkuCheckDuplicatesMutation,
  useSkuSubmitToSapMutation,
} from "@/features/skuManagement/api"
import type { SkuMetadataRow } from "@/features/skuManagement/types"
import { SkuGrid } from "./components/SkuGrid"
import { SkuDetailPanel } from "./components/SkuDetailPanel"

function makeEmptyRow(): SkuMetadataRow {
  return {
    sku: "",
    workflow_type: "new_creation",
    status: "draft",
    _validationStatus: "unchecked",
    _isDirty: true,
  }
}

export function SkuNewCreationPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rows, setRows] = useState<SkuMetadataRow[]>([makeEmptyRow()])
  const [selectedRows, setSelectedRows] = useState<SkuMetadataRow[]>([])
  const [activeRow, setActiveRow] = useState<SkuMetadataRow | null>(null)

  const { data: dropdowns = {} } = useSkuDropdownsQuery()
  const bulkUpsert = useSkuBulkUpsertMutation()
  const validate = useSkuValidateMutation()
  const checkDuplicates = useSkuCheckDuplicatesMutation()
  const submitToSap = useSkuSubmitToSapMutation()

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, makeEmptyRow()])
  }, [])

  const handleSaveDraft = useCallback(async () => {
    const dirtyRows = rows.filter((r) => r._isDirty && r.sku?.trim())
    if (!dirtyRows.length) {
      toast.info(t("sku.grid.noChanges"))
      return
    }
    try {
      await bulkUpsert.mutateAsync(dirtyRows)
      setRows((prev) => prev.map((r) => ({ ...r, _isDirty: false })))
      toast.success(t("sku.grid.saved", { count: dirtyRows.length }))
    } catch {
      toast.error(t("sku.grid.failedToSave"))
    }
  }, [rows, bulkUpsert, t])

  const handleValidateAll = useCallback(async () => {
    const toValidate = rows.filter((r) => r.sku?.trim())
    if (!toValidate.length) {
      toast.info(t("sku.grid.noRowsToValidate"))
      return
    }
    try {
      const results = await validate.mutateAsync({ rows: toValidate })
      setRows((prev) =>
        prev.map((row) => {
          const result = results.find((r) => r.sku === row.sku)
          if (!result) return row
          return {
            ...row,
            _validationStatus: result.status,
            _validationErrors: result.errors,
            _validationWarnings: result.warnings,
          }
        })
      )
      const redCount = results.filter((r) => r.status === "red").length
      const yellowCount = results.filter((r) => r.status === "yellow").length
      const greenCount = results.filter((r) => r.status === "green").length
      toast.info(
        t("sku.grid.validationSummary", {
          green: greenCount,
          yellow: yellowCount,
          red: redCount,
        })
      )
    } catch {
      toast.error(t("sku.grid.validationFailed"))
    }
  }, [rows, validate, t])

  const handleCheckDuplicates = useCallback(async () => {
    const toCheck = rows.filter((r) => r.sku?.trim())
    if (!toCheck.length) return
    try {
      const results = await checkDuplicates.mutateAsync(toCheck)
      setRows((prev) =>
        prev.map((row) => {
          const result = results.find((r) => r.sku === row.sku)
          return { ...row, _duplicates: result?.duplicates ?? [] }
        })
      )
      const dupCount = results.filter((r) => r.duplicates.length > 0).length
      if (dupCount > 0) {
        toast.warning(t("sku.grid.duplicatesFound", { count: dupCount }))
      } else {
        toast.success(t("sku.grid.noDuplicates"))
      }
    } catch {
      toast.error(t("sku.grid.duplicatesFailed"))
    }
  }, [rows, checkDuplicates, t])

  const handleSubmitToSap = useCallback(async () => {
    const approvedSkus = selectedRows
      .filter((r) => r.status === "approved" && r.sku?.trim())
      .map((r) => r.sku)

    if (!approvedSkus.length) {
      toast.info(t("sku.grid.selectApproved"))
      return
    }
    try {
      const result = await submitToSap.mutateAsync(approvedSkus)
      toast.success(t("sku.grid.sapCreated", { count: result.created.length }))
      if (result.failed.length > 0) {
        toast.error(t("sku.grid.sapItemsFailed", { count: result.failed.length }))
      }
      setRows((prev) =>
        prev.map((r) => {
          const created = result.created.find((c) => c.sku === r.sku)
          if (created) return { ...r, status: "created_in_sap" }
          return r
        })
      )
    } catch {
      toast.error(t("sku.grid.sapFailed"))
    }
  }, [selectedRows, submitToSap, t])

  const redCount = rows.filter((r) => r._validationStatus === "red").length
  const yellowCount = rows.filter((r) => r._validationStatus === "yellow").length
  const greenCount = rows.filter((r) => r._validationStatus === "green").length
  const approvedCount = rows.filter((r) => r.status === "approved").length
  const unsavedCount = rows.filter((r) => r._isDirty).length

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
          <h1 className="text-base font-semibold">{t("sku.workflowA")}</h1>
          <p className="text-xs text-muted-foreground">
            {t("sku.grid.rowsStatus", { total: rows.length, unsaved: unsavedCount })}
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
          <Button variant="ghost" size="sm" onClick={addRow}>
            <Plus className="mr-1 h-4 w-4" />
            {t("sku.grid.addRow")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveDraft}
            disabled={bulkUpsert.isPending}
          >
            {bulkUpsert.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {t("sku.grid.saveDraft")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleValidateAll}
            disabled={validate.isPending}
          >
            {validate.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-4 w-4" />
            )}
            {t("sku.grid.validateAll")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckDuplicates}
            disabled={checkDuplicates.isPending}
          >
            {checkDuplicates.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <AlertTriangle className="mr-1 h-4 w-4" />
            )}
            {t("sku.grid.checkDuplicates")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmitToSap}
            disabled={submitToSap.isPending || approvedCount === 0}
          >
            {submitToSap.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            {t("sku.grid.submitToSapCount", { count: approvedCount })}
          </Button>
        </div>
      </div>

      {/* Grid + detail panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden p-4">
          <SkuGrid
            rows={rows}
            onRowsChange={setRows}
            dropdowns={dropdowns}
            mode="creation"
            onSelectionChanged={(sel) => {
              setSelectedRows(sel)
              setActiveRow(sel[0] ?? null)
            }}
          />
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
