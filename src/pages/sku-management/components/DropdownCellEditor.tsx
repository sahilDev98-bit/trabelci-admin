import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ICellEditorParams } from "ag-grid-community"

interface DropdownOption {
  value: string
  label: string
}

interface DropdownCellEditorParams extends ICellEditorParams {
  options: DropdownOption[]
}

export const DropdownCellEditor = forwardRef<unknown, DropdownCellEditorParams>(
  (params, ref) => {
    const { t } = useTranslation()

    // Use a ref so getValue() always reads the latest value synchronously.
    // React state updates are async — if we only used useState, AG Grid would
    // call getValue() before the re-render and get the old value.
    const valueRef = useRef<string>(params.value ?? "")
    const [displayValue, setDisplayValue] = useState<string>(params.value ?? "")
    const [search, setSearch] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
      // Small delay so AG Grid finishes positioning the editor before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        getValue: () => valueRef.current,
        isCancelBeforeStart: () => false,
        isCancelAfterEnd: () => false,
      }),
      [] // stable — reads from ref, no closure over state
    )

    const select = (v: string) => {
      valueRef.current = v      // synchronous — getValue() will return this immediately
      setDisplayValue(v)        // visual highlight
      params.stopEditing()      // AG Grid calls getValue() right here → gets correct value
    }

    const filtered = params.options.filter((o) =>
      o.label.toLowerCase().includes(search.toLowerCase())
    )

    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
          minWidth: 180,
          maxHeight: 260,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          // Inline (no absolute) — cellEditorPopup is off so AG Grid handles positioning
        }}
      >
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("sku.dropdowns.search")}
          style={{
            border: "none",
            borderBottom: "1px solid #e5e7eb",
            padding: "7px 10px",
            fontSize: 13,
            outline: "none",
            flexShrink: 0,
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              valueRef.current = params.value ?? ""
              params.stopEditing()
            }
            if (e.key === "Enter" && filtered.length >= 1) {
              select(filtered[0].value)
            }
            if (e.key === "Tab") {
              e.preventDefault()
              if (filtered.length >= 1) select(filtered[0].value)
            }
          }}
        />
        <div style={{ overflowY: "auto", maxHeight: 210 }}>
          {filtered.length === 0 && (
            <div style={{ padding: "8px 12px", color: "#9ca3af", fontSize: 12 }}>
              {t("sku.dropdowns.noOptions")}
            </div>
          )}
          {filtered.map((opt) => {
            const isSelected = opt.value === displayValue
            return (
              <div
                key={opt.value}
                onMouseDown={(e) => {
                  // Use mousedown instead of click so it fires before the input loses focus
                  e.preventDefault()
                  select(opt.value)
                }}
                style={{
                  padding: "8px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                  background: isSelected ? "#eff6ff" : "transparent",
                  color: isSelected ? "#1d4ed8" : "#111827",
                  fontWeight: isSelected ? 600 : 400,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLDivElement).style.background = isSelected
                    ? "#eff6ff"
                    : "transparent"
                }}
              >
                {isSelected && (
                  <span style={{ color: "#1d4ed8", fontSize: 11 }}>✓</span>
                )}
                {opt.label}
              </div>
            )
          })}
        </div>
      </div>
    )
  }
)

DropdownCellEditor.displayName = "DropdownCellEditor"
