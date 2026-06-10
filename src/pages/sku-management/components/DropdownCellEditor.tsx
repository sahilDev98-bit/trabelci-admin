import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { CustomCellEditorProps } from "ag-grid-react"

interface DropdownOption {
  value: string
  label: string
}

// AG Grid v31+ reactive custom-editor contract: the grid passes `value` /
// `onValueChange` props and reads the value from there — the legacy
// forwardRef + useImperativeHandle({ getValue }) pattern is silently ignored,
// so selections made that way never reach the cell.
type DropdownCellEditorProps = CustomCellEditorProps<unknown, string> & {
  options: DropdownOption[]
}

export function DropdownCellEditor(props: DropdownCellEditorProps) {
  const { t } = useTranslation()
  const isDark = document.documentElement.classList.contains("dark")

  const [search, setSearch] = useState("")
  const [highlightIndex, setHighlightIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Small delay so AG Grid finishes positioning the popup before focusing
    const timer = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(timer)
  }, [])

  const filtered = props.options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    const el = listRef.current?.children[highlightIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [highlightIndex])

  const select = (v: string) => {
    props.onValueChange(v)
    props.stopEditing()
  }

  const cancel = () => {
    // Leave the value untouched (onValueChange never called) and close
    props.stopEditing(true)
  }

  const colors = isDark
    ? {
        bg: "#1f2937",
        border: "#374151",
        text: "#f3f4f6",
        muted: "#9ca3af",
        inputBg: "#111827",
        hover: "#374151",
        selectedBg: "#1e3a5f",
        selectedText: "#93c5fd",
      }
    : {
        bg: "#ffffff",
        border: "#e5e7eb",
        text: "#111827",
        muted: "#9ca3af",
        inputBg: "#ffffff",
        hover: "#f9fafb",
        selectedBg: "#eff6ff",
        selectedText: "#1d4ed8",
      }

  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        minWidth: 180,
        maxHeight: 260,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <input
        ref={inputRef}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          // Reset the highlight as the search narrows the list
          setHighlightIndex(0)
        }}
        placeholder={t("sku.dropdowns.search")}
        style={{
          border: "none",
          borderBottom: `1px solid ${colors.border}`,
          background: colors.inputBg,
          color: colors.text,
          padding: "7px 10px",
          fontSize: 13,
          outline: "none",
          flexShrink: 0,
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1))
          }
          if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlightIndex((i) => Math.max(i - 1, 0))
          }
          if ((e.key === "Enter" || e.key === "Tab") && filtered.length >= 1) {
            e.preventDefault()
            select(filtered[Math.min(highlightIndex, filtered.length - 1)].value)
          }
        }}
      />
      <div ref={listRef} style={{ overflowY: "auto", maxHeight: 210 }}>
        {filtered.length === 0 && (
          <div style={{ padding: "8px 12px", color: colors.muted, fontSize: 12 }}>
            {t("sku.dropdowns.noOptions")}
          </div>
        )}
        {filtered.map((opt, index) => {
          const isSelected = opt.value === props.value
          const isHighlighted = index === highlightIndex
          const background = isSelected
            ? colors.selectedBg
            : isHighlighted
              ? colors.hover
              : "transparent"
          return (
            <div
              key={opt.value}
              onMouseDown={(e) => {
                // Use mousedown instead of click so it fires before the input loses focus
                e.preventDefault()
                select(opt.value)
              }}
              onMouseEnter={() => setHighlightIndex(index)}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                cursor: "pointer",
                background,
                color: isSelected ? colors.selectedText : colors.text,
                fontWeight: isSelected ? 600 : 400,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {isSelected && (
                <span style={{ color: colors.selectedText, fontSize: 11 }}>✓</span>
              )}
              {opt.label}
            </div>
          )
        })}
      </div>
    </div>
  )
}
