import { useEffect, useRef, useState } from "react"
import type { CustomCellEditorProps } from "ag-grid-react"

// AG Grid v31+ reactive editor — same pattern as DropdownCellEditor.
// Allows free-text entry: Tab/Enter with no highlighted suggestion commits
// whatever the user typed without forcing a pick from the list.
type AutocompleteCellEditorProps = CustomCellEditorProps<unknown, string> & {
  suggestions: string[]
}

export function AutocompleteCellEditor(props: AutocompleteCellEditorProps) {
  const isDark = document.documentElement.classList.contains("dark")

  const [inputValue, setInputValue] = useState(props.value ?? "")
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 30)
    return () => clearTimeout(timer)
  }, [])

  const filtered = inputValue.trim()
    ? props.suggestions.filter(
        (s) => s.toLowerCase().includes(inputValue.toLowerCase()) && s !== inputValue,
      )
    : props.suggestions

  useEffect(() => {
    if (highlightIndex < 0) return
    const el = listRef.current?.children[highlightIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [highlightIndex])

  const commit = (value: string) => {
    props.onValueChange(value)
    props.stopEditing()
  }

  const cancel = () => props.stopEditing(true)

  const colors = isDark
    ? {
        bg: "#1f2937",
        border: "#374151",
        text: "#f3f4f6",
        inputBg: "#111827",
        selectedBg: "#1e3a5f",
        selectedText: "#93c5fd",
      }
    : {
        bg: "#ffffff",
        border: "#e5e7eb",
        text: "#111827",
        inputBg: "#ffffff",
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
        minWidth: 200,
        maxHeight: 280,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <input
        ref={inputRef}
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value)
          setHighlightIndex(-1)
        }}
        placeholder="Type or select…"
        style={{
          border: "none",
          borderBottom: filtered.length > 0 ? `1px solid ${colors.border}` : "none",
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
            setHighlightIndex((i) => Math.max(i - 1, -1))
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault()
            if (highlightIndex >= 0 && filtered[highlightIndex]) {
              commit(filtered[highlightIndex])
            } else {
              commit(inputValue)
            }
          }
        }}
      />

      {filtered.length > 0 && (
        <div ref={listRef} style={{ overflowY: "auto", maxHeight: 220 }}>
          {filtered.map((suggestion, index) => {
            const isHighlighted = index === highlightIndex
            return (
              <div
                key={suggestion}
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(suggestion)
                }}
                onMouseEnter={() => setHighlightIndex(index)}
                style={{
                  padding: "7px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                  background: isHighlighted ? colors.selectedBg : "transparent",
                  color: isHighlighted ? colors.selectedText : colors.text,
                  fontWeight: isHighlighted ? 500 : 400,
                }}
              >
                {suggestion}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
