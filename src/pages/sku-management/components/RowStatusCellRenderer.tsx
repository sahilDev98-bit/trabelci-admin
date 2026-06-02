import { useTranslation } from "react-i18next"
import type { ICellRendererParams } from "ag-grid-community"
import type { SkuMetadataRow, SkuValidationStatus } from "@/features/skuManagement/types"

const STATUS_COLORS: Record<SkuValidationStatus, string> = {
  red: "#ef4444",
  yellow: "#f59e0b",
  green: "#22c55e",
  unchecked: "#d1d5db",
}

export function RowStatusCellRenderer(params: ICellRendererParams<SkuMetadataRow>) {
  const { t } = useTranslation()
  const status = (params.value as SkuValidationStatus) ?? "unchecked"
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.unchecked

  const errors = params.data?._validationErrors ?? []
  const warnings = params.data?._validationWarnings ?? []
  const all = [...errors, ...warnings]

  const tooltip =
    all.length > 0
      ? all.map((e) => e.message).join("\n")
      : t(`sku.status.${status}`)

  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}
      title={tooltip}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
    </div>
  )
}
