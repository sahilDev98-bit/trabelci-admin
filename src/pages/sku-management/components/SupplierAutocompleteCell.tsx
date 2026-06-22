import { useCallback, useEffect, useMemo, useRef, useState } from "react"

export interface SupplierAutocompleteCellProps {
  value: string
  clientId: string
  field: string
  rowIndex: number
  colIndex: number
  issue?: "error" | "warning"
  validationTint?: string
  isExpanded?: boolean
  suggestions: string[]
  onCommit: (clientId: string, field: string, value: unknown) => void
  onNavigate: (rowIndex: number, colIndex: number, direction: "down" | "up") => void
  onFillStart: (startRow: number, field: string, value: string | string[], e: React.MouseEvent) => void
}

export function SupplierAutocompleteCell({
  value,
  clientId,
  field,
  rowIndex,
  colIndex,
  issue,
  validationTint,
  isExpanded,
  suggestions,
  onCommit,
  onNavigate,
  onFillStart,
}: SupplierAutocompleteCellProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [typedValue, setTypedValue] = useState(value)

  // Sync when value prop changes from outside (cascade fill, undo, bulk paste, etc.)
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setTypedValue(value)
  }
  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== value) {
      inputRef.current.value = value
    }
  }, [value])

  // Best prefix-matching suggestion
  const matchedSuggestion = useMemo(() => {
    const q = typedValue.trim().toLowerCase()
    if (!q) return null
    return suggestions.find((s) => s.toLowerCase().startsWith(q)) ?? null
  }, [typedValue, suggestions])

  // Ghost suffix: the part of the suggestion after what the user typed
  const ghostSuffix =
    matchedSuggestion && typedValue.trim().length > 0
      ? matchedSuggestion.slice(typedValue.length)
      : ""

  const acceptSuggestion = useCallback((): boolean => {
    if (!matchedSuggestion) return false
    if (inputRef.current) inputRef.current.value = matchedSuggestion
    setTypedValue(matchedSuggestion)
    onCommit(clientId, field, matchedSuggestion)
    return true
  }, [matchedSuggestion, clientId, field, onCommit])

  const commit = useCallback(() => {
    const val = inputRef.current?.value ?? ""
    onCommit(clientId, field, val)
  }, [clientId, field, onCommit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (ghostSuffix && (e.key === "Tab" || e.key === "ArrowRight")) {
        const atEnd =
          inputRef.current?.selectionStart === inputRef.current?.value.length
        if (e.key === "Tab" || atEnd) {
          e.preventDefault()
          acceptSuggestion()
          return
        }
      }
      if (e.key === "Enter") {
        e.preventDefault()
        if (ghostSuffix) {
          acceptSuggestion()
        } else {
          commit()
          onNavigate(rowIndex, colIndex, "down")
        }
      } else if (e.key === "Escape") {
        setTypedValue("")
        if (inputRef.current) inputRef.current.value = ""
        inputRef.current?.blur()
      } else if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault()
        onNavigate(rowIndex, colIndex, "down")
      } else if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault()
        onNavigate(rowIndex, colIndex, "up")
      }
    },
    [ghostSuffix, acceptSuggestion, commit, onNavigate, rowIndex, colIndex],
  )

  const rectStyle: React.CSSProperties = validationTint
    ? {
        background: `linear-gradient(180deg, ${validationTint}, ${validationTint}), linear-gradient(180deg, #ffffff, var(--ceramic-cell-soft))`,
      }
    : {}

  const hasValue = Boolean(typedValue.trim())

  return (
    <div
      className={`ceramic-rect${isExpanded ? " ceramic-col-expanded" : ""}`}
      data-issue={issue}
      data-fill-cell
      data-row={rowIndex}
      data-col={colIndex}
      data-field={field}
      style={rectStyle}
    >
      {/* Ghost text layer — sits behind the input, shows typed + faded suffix */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          font: "600 14px/1 'DM Sans','Heebo',sans-serif",
          padding: "0 8px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          zIndex: 0,
        }}
      >
        <span style={{ color: "var(--ceramic-rect-text)" }}>{typedValue}</span>
        {ghostSuffix && (
          <span style={{ color: "var(--ceramic-rect-text)", opacity: 0.45 }}>
            {ghostSuffix}
          </span>
        )}
      </div>

      {/* Actual input — transparent text so ghost shows through, caret stays visible */}
      <input
        ref={inputRef}
        className="ceramic-field"
        type="text"
        dir="auto"
        defaultValue={value}
        data-row={rowIndex}
        data-col={colIndex}
        data-field={field}
        style={{
          position: "relative",
          zIndex: 1,
          color: "transparent",
          caretColor: "var(--ceramic-rect-text)",
          background: "transparent",
        }}
        onInput={(e) => setTypedValue(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />

      {hasValue && (
        <span
          className="ceramic-fill-handle"
          title="Drag to fill (same column)"
          style={{ zIndex: 2 }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            commit()
            onFillStart(rowIndex, field, inputRef.current?.value ?? value, e)
          }}
        />
      )}
    </div>
  )
}
