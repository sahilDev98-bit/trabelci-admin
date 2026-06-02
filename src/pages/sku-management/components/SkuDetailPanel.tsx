import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Clock, AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useSkuAuditLogQuery, useSkuGenerateNameMutation } from "@/features/skuManagement/api"
import type { SkuMetadataRow } from "@/features/skuManagement/types"

interface SkuDetailPanelProps {
  row: SkuMetadataRow
}

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline"> = {
  draft: "secondary",
  pending_approval: "outline",
  approved: "default",
  created_in_sap: "default",
  cleanup_only: "secondary",
}

export function SkuDetailPanel({ row }: SkuDetailPanelProps) {
  const { t } = useTranslation()
  const [generatedName, setGeneratedName] = useState<string>("")
  const generateName = useSkuGenerateNameMutation()
  const { data: auditLog = [] } = useSkuAuditLogQuery(row.sku)

  useEffect(() => {
    if (!row.sku) return
    const timer = setTimeout(async () => {
      try {
        const result = await generateName.mutateAsync({ row })
        setGeneratedName(result.name)
      } catch {
        // name generation is non-critical
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [row.company, row.series, row.color, row.size, row.finish])

  const errors = row._validationErrors ?? []
  const warnings = row._validationWarnings ?? []
  const duplicates = row._duplicates ?? []

  return (
    <div className="space-y-4 p-4 text-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("sku.detail.selectedRow")}
        </p>
        <p className="mt-1 font-mono text-base font-semibold">{row.sku || "—"}</p>
        <Badge variant={STATUS_BADGE[row.status] ?? "secondary"} className="mt-1">
          {t(`sku.status.${row.status}`, row.status)}
        </Badge>
      </div>

      {/* Name builder preview */}
      {generatedName && (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("sku.detail.generatedName")}</p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-foreground">
            {generatedName}
          </p>
        </div>
      )}

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-red-600">{t("sku.detail.errors")}</p>
          {errors.map((e, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-red-600">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {e.message}
            </div>
          ))}
        </div>
      )}

      {/* Validation warnings */}
      {warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-amber-600">{t("sku.detail.warnings")}</p>
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {w.message}
            </div>
          ))}
        </div>
      )}

      {errors.length === 0 && warnings.length === 0 && row._validationStatus === "green" && (
        <div className="flex items-center gap-1.5 text-xs text-green-600">
          <CheckCircle2 className="h-3 w-3" />
          {t("sku.detail.allComplete")}
        </div>
      )}

      {/* Duplicates */}
      {duplicates.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-medium">{t("sku.detail.possibleDuplicates")}</p>
          {duplicates.map((d, i) => (
            <p key={i} className="mt-1">{d.message}</p>
          ))}
        </div>
      )}

      <Separator />

      {/* Audit log */}
      {auditLog.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("sku.audit.title")}
          </p>
          <div className="mt-2 space-y-2">
            {auditLog.slice(0, 8).map((entry) => (
              <div key={entry.id} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                <div>
                  <span className="font-medium text-foreground">{entry.field_name}</span>
                  {" "}
                  {entry.old_value ? `${entry.old_value} → ` : ""}
                  <span className="text-foreground">{entry.new_value}</span>
                  <div>{new Date(entry.changed_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
