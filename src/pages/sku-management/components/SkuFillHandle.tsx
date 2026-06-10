import { useCallback, useEffect, useRef, useState } from "react"
import type { AgGridReact } from "ag-grid-react"
import type { CellFocusedEvent } from "ag-grid-community"
import type { SkuMetadataRow } from "@/features/skuManagement/types"

// ─── Smart fill value logic ──────────────────────────────────────────────────
//
// Rules (same as Excel):
//   "3"          → 4, 5, 6  …   (pure integer)
//   "Series 3"   → Series 4, Series 5 … (text + trailing integer)
//   "La Fabbrica"→ La Fabbrica, La Fabbrica … (no number → repeat)
//
// repeatOnly: dropdown-controlled fields must hold exact vocabulary values,
// so incrementing (e.g. "60x120" → "60x121") would produce invalid options —
// those fields always copy the value down unchanged.

function smartFillValues(source: unknown, count: number, repeatOnly = false): unknown[] {
  if (count <= 0) return []
  const str = String(source ?? "")

  if (repeatOnly) return Array(count).fill(str)

  // Pure integer
  if (/^\d+$/.test(str)) {
    const base = Number(str)
    return Array.from({ length: count }, (_, i) => String(base + i + 1))
  }

  // Ends with integer, e.g. "Serie 1", "Item-03"
  const m = str.match(/^([\s\S]*?)(\d+)$/)
  if (m) {
    const [, prefix, numStr] = m
    const base = Number(numStr)
    const pad = numStr.length > 1 && numStr.startsWith("0") ? numStr.length : 0
    return Array.from({ length: count }, (_, i) => {
      const n = String(base + i + 1)
      return `${prefix}${pad ? n.padStart(pad, "0") : n}`
    })
  }

  // Repeat same value
  return Array(count).fill(str)
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function getCellEl(
  container: HTMLElement,
  rowIndex: number,
  colId: string
): HTMLElement | null {
  return container.querySelector(
    `.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`
  ) as HTMLElement | null
}

function getRowIndexAtClientY(container: HTMLElement, clientY: number): number | null {
  const rows = container.querySelectorAll(".ag-row[row-index]")
  for (const row of Array.from(rows)) {
    const r = row.getBoundingClientRect()
    if (clientY >= r.top && clientY <= r.bottom) {
      const idx = Number(row.getAttribute("row-index"))
      if (!isNaN(idx)) return idx
    }
  }
  return null
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FillUpdate {
  rowIndex: number
  field: string
  value: unknown
}

interface SkuFillHandleProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  gridRef: React.RefObject<AgGridReact<SkuMetadataRow> | null>
  rows: SkuMetadataRow[]
  onFill: (updates: FillUpdate[]) => void
  /** Fields whose values are copied down as-is (no numeric increment) — dropdown-controlled columns */
  repeatOnlyFields?: string[]
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SkuFillHandle({
  containerRef,
  gridRef,
  rows,
  onFill,
  repeatOnlyFields,
}: SkuFillHandleProps) {
  const [handlePos, setHandlePos] = useState<{ left: number; top: number } | null>(null)
  const focusedCell = useRef<{ rowIndex: number; colId: string } | null>(null)

  // Drag state lives in refs to avoid re-renders during mousemove
  const isDragging = useRef(false)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const dragTargetRow = useRef<number | null>(null)

  // ── Subscribe to AG Grid cell-focus events ────────────────────────────────
  useEffect(() => {
    const api = gridRef.current?.api
    if (!api) return

    const onFocus = (e: CellFocusedEvent) => {
      if (e.rowIndex == null || !e.column || typeof e.column === "string") {
        focusedCell.current = null
        setHandlePos(null)
        return
      }
      focusedCell.current = { rowIndex: e.rowIndex, colId: e.column.getColId() }
      positionHandle()
    }

    api.addEventListener("cellFocused", onFocus)
    return () => {
      try {
        api.removeEventListener("cellFocused", onFocus)
      } catch {
        // grid may already be destroyed during unmount
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridRef.current?.api])

  // Re-position handle when rows change (e.g. fill applied)
  useEffect(() => {
    positionHandle()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const positionHandle = useCallback(() => {
    const fc = focusedCell.current
    const container = containerRef.current
    if (!fc || !container) { setHandlePos(null); return }

    // Small delay to let AG Grid paint the focused cell
    setTimeout(() => {
      const cell = getCellEl(container, fc.rowIndex, fc.colId)
      if (!cell) { setHandlePos(null); return }

      const cellRect = cell.getBoundingClientRect()
      const contRect = container.getBoundingClientRect()
      setHandlePos({
        left: cellRect.right - contRect.left - 5,
        top: cellRect.bottom - contRect.top - 5,
      })
    }, 40)
  }, [containerRef])

  // ── Ctrl+D keyboard fill ──────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== "d") return
      const fc = focusedCell.current
      const api = gridRef.current?.api
      if (!fc || !api) return

      const sourceNode = api.getDisplayedRowAtIndex(fc.rowIndex)
      if (!sourceNode?.data) return
      const sourceValue = sourceNode.data[fc.colId as keyof SkuMetadataRow]

      const selectedNodes = api.getSelectedNodes().filter(
        (n) => (n.rowIndex ?? -1) > fc.rowIndex
      )
      if (selectedNodes.length === 0) return

      e.preventDefault()
      const repeatOnly = repeatOnlyFields?.includes(fc.colId) ?? false
      const fillVals = smartFillValues(sourceValue, selectedNodes.length, repeatOnly)
      const updates: FillUpdate[] = selectedNodes
        .sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0))
        .map((n, i) => ({
          rowIndex: n.rowIndex ?? 0,
          field: fc.colId,
          value: fillVals[i],
        }))

      onFill(updates)
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [gridRef, onFill, repeatOnlyFields])

  // ── Mouse drag ────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const fc = focusedCell.current
      const container = containerRef.current
      const api = gridRef.current?.api
      if (!fc || !container || !api) return

      e.preventDefault()
      e.stopPropagation()

      const sourceNode = api.getDisplayedRowAtIndex(fc.rowIndex)
      if (!sourceNode?.data) return
      const sourceValue = sourceNode.data[fc.colId as keyof SkuMetadataRow]

      isDragging.current = true
      dragTargetRow.current = null

      // Create (or reuse) the blue fill-range overlay
      if (!overlayRef.current) {
        const div = document.createElement("div")
        div.style.cssText = `
          position:absolute;
          background:rgba(21,101,192,0.12);
          border:2px dashed #1565c0;
          pointer-events:none;
          z-index:150;
          display:none;
          box-sizing:border-box;
        `
        container.appendChild(div)
        overlayRef.current = div
      }

      const onMouseMove = (me: MouseEvent) => {
        if (!isDragging.current) return
        const target = getRowIndexAtClientY(container, me.clientY)
        if (target == null || target <= fc.rowIndex) {
          if (overlayRef.current) overlayRef.current.style.display = "none"
          dragTargetRow.current = null
          return
        }
        dragTargetRow.current = target

        // Draw overlay from bottom of source cell to bottom of target cell
        const srcCell = getCellEl(container, fc.rowIndex, fc.colId)
        const tgtCell = getCellEl(container, target, fc.colId)
        if (!srcCell || !tgtCell || !overlayRef.current) return

        const gr = container.getBoundingClientRect()
        const sr = srcCell.getBoundingClientRect()
        const tr = tgtCell.getBoundingClientRect()

        const ov = overlayRef.current
        ov.style.display = "block"
        ov.style.left = `${sr.left - gr.left}px`
        ov.style.top = `${sr.bottom - gr.top}px`
        ov.style.width = `${sr.width}px`
        ov.style.height = `${tr.bottom - sr.bottom}px`
      }

      const onMouseUp = () => {
        isDragging.current = false
        if (overlayRef.current) overlayRef.current.style.display = "none"

        const endRow = dragTargetRow.current
        dragTargetRow.current = null

        document.removeEventListener("mousemove", onMouseMove)
        document.removeEventListener("mouseup", onMouseUp)

        if (endRow == null || endRow <= fc.rowIndex) return

        const count = endRow - fc.rowIndex
        const repeatOnly = repeatOnlyFields?.includes(fc.colId) ?? false
        const fillVals = smartFillValues(sourceValue, count, repeatOnly)

        const updates: FillUpdate[] = []
        for (let i = 0; i < count; i++) {
          const rowIdx = fc.rowIndex + 1 + i
          const node = api.getDisplayedRowAtIndex(rowIdx)
          if (node) {
            updates.push({ rowIndex: rowIdx, field: fc.colId, value: fillVals[i] })
          }
        }

        if (updates.length > 0) onFill(updates)
      }

      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    },
    [containerRef, gridRef, onFill, repeatOnlyFields]
  )

  // Cleanup overlay on unmount
  useEffect(() => {
    return () => {
      if (overlayRef.current?.parentNode) {
        overlayRef.current.parentNode.removeChild(overlayRef.current)
      }
    }
  }, [])

  if (!handlePos) return null

  return (
    <div
      title="Drag to fill down · Ctrl+D to fill selected rows"
      style={{
        position: "absolute",
        left: handlePos.left,
        top: handlePos.top,
        width: 8,
        height: 8,
        backgroundColor: "#1565c0",
        border: "1.5px solid #fff",
        borderRadius: 1,
        cursor: "crosshair",
        zIndex: 200,
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        userSelect: "none",
      }}
      onMouseDown={handleMouseDown}
    />
  )
}
