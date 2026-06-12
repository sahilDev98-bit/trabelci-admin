import { useCallback, useEffect, useRef } from "react"
import type { AgGridReact } from "ag-grid-react"
import type {
  CellFocusedEvent,
  CellMouseDownEvent,
  CellMouseOverEvent,
} from "ag-grid-community"
import type { SkuMetadataRow } from "@/features/skuManagement/types"
import type { FillUpdate } from "./SkuFillHandle"

// ─── Excel-style range selection + clipboard for AG Grid Community ──────────
//
// Community edition has no cell-range selection (Enterprise feature), so this
// hook implements the everyday spreadsheet interactions on top of it:
//   mouse drag / Shift+Click / Shift+Arrows  → rectangular range selection
//   Ctrl+C / Ctrl+X                          → copy/cut range as TSV
//   Ctrl+V                                   → paste TSV from Excel, growing
//                                              the sheet when rows overflow
//   Delete / Backspace                       → clear the selected cells
//   Ctrl+A                                   → select the whole sheet
//   Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z)           → undo / redo (page-level stacks)
//   Ctrl+Home / Ctrl+End                     → jump to first / last cell
//   Escape                                   → collapse to a single cell
// (Ctrl+D fill-down lives in SkuFillHandle.)
//
// Clipboard uses the native copy/cut/paste DOM events — no permission
// prompts, and key handling runs in the CAPTURE phase so AG Grid's own
// keyboard behavior (e.g. Backspace starting an edit) can't swallow it.

interface CellPos {
  rowIndex: number
  colId: string
}

interface CellRange {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

interface UseSpreadsheetInteractionsArgs {
  gridRef: React.RefObject<AgGridReact<SkuMetadataRow> | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  rowCount: number
  /** Ordered, displayed data column ids (row-number column excluded) */
  getDataColIds: () => string[]
  /** Cell value as clipboard text */
  getCellText: (rowIndex: number, colId: string) => string
  /** Whether paste/clear may write into this column */
  isWritable: (colId: string) => boolean
  /** Clipboard text → cell value for this column */
  parseCellValue: (colId: string, text: string) => unknown
  /** Empty value for this column (Delete/Backspace) */
  clearValue: (colId: string) => unknown
  /** Apply value updates; appendCount = blank rows to add first (paste overflow) */
  applyUpdates: (updates: FillUpdate[], appendCount: number) => void
  /** Whether paste may grow the sheet (creation mode) */
  canAppendRows: boolean
  onUndo?: () => void
  onRedo?: () => void
}

export function useSpreadsheetInteractions({
  gridRef,
  containerRef,
  rowCount,
  getDataColIds,
  getCellText,
  isWritable,
  parseCellValue,
  clearValue,
  applyUpdates,
  canAppendRows,
  onUndo,
  onRedo,
}: UseSpreadsheetInteractionsArgs) {
  const anchorRef = useRef<CellPos | null>(null)
  const rangeRef = useRef<CellRange | null>(null)
  const draggingRef = useRef(false)
  const shiftDownRef = useRef(false)

  const rowCountRef = useRef(rowCount)
  useEffect(() => {
    rowCountRef.current = rowCount
  }, [rowCount])

  const colIndex = useCallback(
    (colId: string) => getDataColIds().indexOf(colId),
    [getDataColIds]
  )

  const repaint = useCallback(() => {
    gridRef.current?.api?.refreshCells({ force: true })
  }, [gridRef])

  const setRange = useCallback(
    (a: CellPos, b: CellPos) => {
      const aCol = colIndex(a.colId)
      const bCol = colIndex(b.colId)
      if (aCol < 0 || bCol < 0) return
      rangeRef.current = {
        startRow: Math.min(a.rowIndex, b.rowIndex),
        endRow: Math.max(a.rowIndex, b.rowIndex),
        startCol: Math.min(aCol, bCol),
        endCol: Math.max(aCol, bCol),
      }
      repaint()
    },
    [colIndex, repaint]
  )

  const collapseTo = useCallback(
    (pos: CellPos) => {
      anchorRef.current = pos
      setRange(pos, pos)
    },
    [setRange]
  )

  // Used by cellClassRules to paint the selection
  const isCellInRange = useCallback(
    (rowIndex: number | null | undefined, colId: string) => {
      const range = rangeRef.current
      if (!range || rowIndex == null || colId === "rowNumber") return false
      if (rowIndex < range.startRow || rowIndex > range.endRow) return false
      const c = colIndex(colId)
      return c >= range.startCol && c <= range.endCol
    },
    [colIndex]
  )

  // ── Mouse: drag to select, shift+click to extend ──────────────────────────
  const handleCellMouseDown = useCallback(
    (event: CellMouseDownEvent<SkuMetadataRow>) => {
      if (event.rowIndex == null) return
      const pos = { rowIndex: event.rowIndex, colId: event.column.getColId() }
      const mouse = event.event as MouseEvent | null
      if (mouse?.shiftKey && anchorRef.current) {
        setRange(anchorRef.current, pos)
      } else {
        collapseTo(pos)
      }
      draggingRef.current = true
    },
    [setRange, collapseTo]
  )

  const handleCellMouseOver = useCallback(
    (event: CellMouseOverEvent<SkuMetadataRow>) => {
      if (!draggingRef.current || event.rowIndex == null || !anchorRef.current) return
      setRange(anchorRef.current, {
        rowIndex: event.rowIndex,
        colId: event.column.getColId(),
      })
    },
    [setRange]
  )

  useEffect(() => {
    const stopDragging = () => {
      draggingRef.current = false
    }
    document.addEventListener("mouseup", stopDragging)
    return () => document.removeEventListener("mouseup", stopDragging)
  }, [])

  // ── Keyboard focus: plain move collapses, shift+move extends ──────────────
  useEffect(() => {
    const api = gridRef.current?.api
    if (!api) return

    const onFocus = (e: CellFocusedEvent) => {
      if (e.rowIndex == null || !e.column || typeof e.column === "string") return
      const pos = { rowIndex: e.rowIndex, colId: e.column.getColId() }
      if (shiftDownRef.current && anchorRef.current) {
        setRange(anchorRef.current, pos)
      } else if (!draggingRef.current) {
        collapseTo(pos)
      }
    }

    api.addEventListener("cellFocused", onFocus)
    return () => {
      try {
        api.removeEventListener("cellFocused", onFocus)
      } catch {
        // grid may already be destroyed during unmount
      }
    }
    // gridRef is a stable ref; the grid mounts before this effect runs
  }, [gridRef, setRange, collapseTo])

  // ── Shared guards ──────────────────────────────────────────────────────────
  // Active only when focus is inside the grid, no cell editor is open, and
  // the event doesn't come from a text input (dropdown search, etc.)
  const interactionsActive = useCallback(
    (target: EventTarget | null) => {
      const container = containerRef.current
      const api = gridRef.current?.api
      if (!container || !api) return false
      if (!container.contains(document.activeElement)) return false
      if (api.getEditingCells().length) return false
      const el = target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return false
      }
      return true
    },
    [containerRef, gridRef]
  )

  // ── Clipboard payload builders ─────────────────────────────────────────────
  const buildTsv = useCallback(() => {
    const range = rangeRef.current
    if (!range) return ""
    const cols = getDataColIds().slice(range.startCol, range.endCol + 1)
    const lines: string[] = []
    for (let r = range.startRow; r <= range.endRow; r++) {
      lines.push(cols.map((colId) => getCellText(r, colId)).join("\t"))
    }
    return lines.join("\n")
  }, [getDataColIds, getCellText])

  const clearRange = useCallback(() => {
    const range = rangeRef.current
    if (!range) return
    const cols = getDataColIds()
    const updates: FillUpdate[] = []
    for (let r = range.startRow; r <= range.endRow && r < rowCountRef.current; r++) {
      for (let c = range.startCol; c <= range.endCol; c++) {
        const colId = cols[c]
        if (colId && isWritable(colId)) {
          updates.push({ rowIndex: r, field: colId, value: clearValue(colId) })
        }
      }
    }
    if (updates.length) applyUpdates(updates, 0)
  }, [getDataColIds, isWritable, clearValue, applyUpdates])

  const pasteTsv = useCallback(
    (text: string) => {
      const start = anchorRef.current
      if (!start || !text) return
      const rows = text
        .replace(/\r/g, "")
        .split("\n")
        .filter((line, i, arr) => !(i === arr.length - 1 && line === ""))
        .map((line) => line.split("\t"))
      if (!rows.length) return

      const cols = getDataColIds()
      const startCol = colIndex(start.colId)
      if (startCol < 0) return

      const overflow = start.rowIndex + rows.length - rowCountRef.current
      const appendCount = canAppendRows ? Math.max(0, overflow) : 0
      const maxRows = canAppendRows
        ? rows.length
        : Math.min(rows.length, rowCountRef.current - start.rowIndex)

      const updates: FillUpdate[] = []
      let lastCol = startCol
      for (let r = 0; r < maxRows; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          const colId = cols[startCol + c]
          if (!colId) break
          lastCol = Math.max(lastCol, startCol + c)
          if (!isWritable(colId)) continue
          updates.push({
            rowIndex: start.rowIndex + r,
            field: colId,
            value: parseCellValue(colId, rows[r][c]),
          })
        }
      }
      if (!updates.length) return
      applyUpdates(updates, appendCount)

      // Show what was pasted as the new selection
      rangeRef.current = {
        startRow: start.rowIndex,
        endRow: start.rowIndex + maxRows - 1,
        startCol,
        endCol: lastCol,
      }
      repaint()
    },
    [getDataColIds, colIndex, isWritable, parseCellValue, applyUpdates, canAppendRows, repaint]
  )

  // ── Native clipboard events (no permissions needed, Excel-compatible) ─────
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (!interactionsActive(e.target)) return
      const tsv = buildTsv()
      if (!tsv) return
      e.preventDefault()
      e.clipboardData?.setData("text/plain", tsv)
    }

    const onCut = (e: ClipboardEvent) => {
      if (!interactionsActive(e.target)) return
      const tsv = buildTsv()
      if (!tsv) return
      e.preventDefault()
      e.clipboardData?.setData("text/plain", tsv)
      clearRange()
    }

    const onPaste = (e: ClipboardEvent) => {
      if (!interactionsActive(e.target)) return
      const text = e.clipboardData?.getData("text/plain")
      if (!text) return
      e.preventDefault()
      pasteTsv(text)
    }

    document.addEventListener("copy", onCopy)
    document.addEventListener("cut", onCut)
    document.addEventListener("paste", onPaste)
    return () => {
      document.removeEventListener("copy", onCopy)
      document.removeEventListener("cut", onCut)
      document.removeEventListener("paste", onPaste)
    }
  }, [interactionsActive, buildTsv, clearRange, pasteTsv])

  // ── Keyboard (capture phase — runs before AG Grid's own handlers) ─────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftDownRef.current = true
      if (!interactionsActive(e.target)) return

      const api = gridRef.current?.api
      if (!api) return
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (e.key === "Delete" || e.key === "Backspace") {
        // preventDefault stops AG Grid from starting an edit on Backspace
        e.preventDefault()
        e.stopPropagation()
        clearRange()
      } else if (ctrl && key === "a") {
        e.preventDefault()
        e.stopPropagation()
        const cols = getDataColIds()
        if (rowCountRef.current > 0 && cols.length > 0) {
          rangeRef.current = {
            startRow: 0,
            endRow: rowCountRef.current - 1,
            startCol: 0,
            endCol: cols.length - 1,
          }
          repaint()
        }
      } else if (ctrl && key === "z" && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        onUndo?.()
      } else if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault()
        e.stopPropagation()
        onRedo?.()
      } else if (ctrl && (e.key === "Home" || e.key === "End")) {
        e.preventDefault()
        e.stopPropagation()
        const cols = getDataColIds()
        if (!cols.length || rowCountRef.current === 0) return
        const pos: CellPos =
          e.key === "Home"
            ? { rowIndex: 0, colId: cols[0] }
            : { rowIndex: rowCountRef.current - 1, colId: cols[cols.length - 1] }
        api.ensureIndexVisible(pos.rowIndex)
        api.ensureColumnVisible(pos.colId)
        api.setFocusedCell(pos.rowIndex, pos.colId)
        collapseTo(pos)
      } else if (e.key === "Escape") {
        const focused = api.getFocusedCell()
        if (focused) {
          collapseTo({ rowIndex: focused.rowIndex, colId: focused.column.getColId() })
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftDownRef.current = false
    }

    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("keyup", onKeyUp, true)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("keyup", onKeyUp, true)
    }
  }, [
    interactionsActive,
    gridRef,
    clearRange,
    getDataColIds,
    collapseTo,
    repaint,
    onUndo,
    onRedo,
  ])

  return { isCellInRange, handleCellMouseDown, handleCellMouseOver }
}
