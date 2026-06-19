import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Loader2, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  useImportableSapItemsQuery,
  useImportSapItemsMutation,
  useImportAllSapItemsMutation,
} from "@/features/skuManagement/api"
import type { SkuImportableSapItem } from "@/features/skuManagement/types"
import { useCheckboxDragSelect } from "@/lib/useCheckboxDragSelect"
import { cn } from "@/lib/utils"

interface SkuSapImportModalProps {
  open: boolean
  onClose: () => void
}

const PAGE_SIZE = 50
const SKELETON_ROWS = 14

const getRowKey = (item: SkuImportableSapItem) => item.sku

function ImportModalSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-1">
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border px-4 py-3">
          <div className="h-4 w-4 shrink-0 animate-pulse rounded-sm bg-muted" />
          <div className="h-3.5 w-28 shrink-0 animate-pulse rounded bg-muted" />
          <div className="h-3.5 flex-1 animate-pulse rounded bg-muted" style={{ maxWidth: `${50 + (i * 7) % 35}%` }} />
        </div>
      ))}
    </div>
  )
}

export function SkuSapImportModal({ open, onClose }: SkuSapImportModalProps) {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [page, setPage] = useState(1)

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set())
  const [isSelectAllMode, setIsSelectAllMode] = useState(false)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // New search term → back to page 1, selection no longer makes sense to keep
  useEffect(() => {
    setPage(1)
    setIsSelectAllMode(false)
    setSelectedKeys(new Set())
    setExcludedKeys(new Set())
  }, [debouncedSearch])

  // Fresh state every time the modal is opened
  useEffect(() => {
    if (!open) return
    setSearch("")
    setDebouncedSearch("")
    setPage(1)
    setIsSelectAllMode(false)
    setSelectedKeys(new Set())
    setExcludedKeys(new Set())
  }, [open])

  const { data, isLoading, isFetching } = useImportableSapItemsQuery(
    { search: debouncedSearch, page, pageSize: PAGE_SIZE },
    open,
  )

  const items = data?.items ?? []
  const totalItems = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))

  const isRowSelected = useCallback(
    (item: SkuImportableSapItem): boolean =>
      isSelectAllMode ? !excludedKeys.has(getRowKey(item)) : selectedKeys.has(getRowKey(item)),
    [isSelectAllMode, excludedKeys, selectedKeys],
  )

  const allPageSelected = useMemo(
    () => items.length > 0 && items.every((it) => isRowSelected(it)),
    [items, isRowSelected],
  )

  const selectedCount = isSelectAllMode ? totalItems - excludedKeys.size : selectedKeys.size

  const onRowToggle = useCallback(
    (key: string) => {
      if (isSelectAllMode) {
        setExcludedKeys((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      } else {
        setSelectedKeys((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }
    },
    [isSelectAllMode],
  )

  const onHeaderToggle = useCallback(() => {
    if (isSelectAllMode) {
      setExcludedKeys((prev) => {
        const next = new Set(prev)
        for (const it of items) {
          if (allPageSelected) next.add(getRowKey(it))
          else next.delete(getRowKey(it))
        }
        return next
      })
    } else {
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        for (const it of items) {
          if (allPageSelected) next.delete(getRowKey(it))
          else next.add(getRowKey(it))
        }
        return next
      })
    }
  }, [isSelectAllMode, allPageSelected, items])

  const handleSelectAll = useCallback(() => {
    setIsSelectAllMode(true)
    setExcludedKeys(new Set())
    setSelectedKeys(new Set())
  }, [])

  const handleClearSelection = useCallback(() => {
    setIsSelectAllMode(false)
    setExcludedKeys(new Set())
    setSelectedKeys(new Set())
  }, [])

  // Click-and-drag multi-select across the checkbox column — same behavior
  // as the Cleanup/Creation grids.
  const { startDrag: startCheckboxDrag, handleNativeChange: handleCheckboxChange } = useCheckboxDragSelect({
    items,
    getKey: getRowKey,
    isSelected: isRowSelected,
    toggle: onRowToggle,
  })

  const importSelected = useImportSapItemsMutation()
  const importAll = useImportAllSapItemsMutation()
  const isImporting = importSelected.isPending || importAll.isPending

  const handleImport = async () => {
    if (selectedCount === 0) return
    try {
      if (isSelectAllMode) {
        const result = await importAll.mutateAsync({
          search: debouncedSearch || undefined,
          excludedSkus: excludedKeys.size > 0 ? Array.from(excludedKeys) : undefined,
        })
        toast.success(`Imported ${result.imported} item${result.imported !== 1 ? "s" : ""}`)
      } else {
        const result = await importSelected.mutateAsync(Array.from(selectedKeys))
        toast.success(`Imported ${result.imported.length} item${result.imported.length !== 1 ? "s" : ""}`)
      }
      onClose()
    } catch {
      toast.error("Import failed")
    }
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const showSkeleton = isLoading || (isFetching && items.length === 0)
  const showBanner = (allPageSelected || isSelectAllMode) && !showSkeleton && items.length > 0

  return (
    <>
      <div className="sku-import-backdrop" aria-hidden="true" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Import products from SAP" className="sku-import-panel">
        <style>{`
          .sku-import-backdrop {
            position: fixed;
            inset: 0;
            z-index: 9998;
            background: rgba(15, 20, 40, 0.55);
            backdrop-filter: blur(3px);
            -webkit-backdrop-filter: blur(3px);
            animation: sku-import-fade-in 180ms ease forwards;
          }
          .sku-import-panel {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            background: var(--background);
            overflow: hidden;
            animation: sku-import-scale-in 200ms cubic-bezier(.22,.8,.32,1) forwards;
          }
          @keyframes sku-import-fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes sku-import-scale-in {
            from { opacity: 0; transform: scale(0.985); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>

        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-3">
          <div>
            <h1 className="text-base font-semibold">Import products from SAP</h1>
            <p className="text-xs text-muted-foreground">
              Search or browse SAP products and pick which ones to bring into Cleanup.
            </p>
          </div>

          <div className="relative ml-4 w-72">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-9 pl-8 text-sm"
              placeholder="Search by SKU or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="mr-1 h-4 w-4" />
            Close
          </Button>
        </div>

        {/* Selection toolbar */}
        <div className="flex shrink-0 items-center justify-between border-b bg-background/80 px-4 py-2 backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            {showSkeleton ? "Loading…" : `${totalItems.toLocaleString()} importable item${totalItems !== 1 ? "s" : ""}`}
          </span>

          <div
            className="flex-1 truncate px-4 text-center text-xs text-blue-700 dark:text-blue-300"
            aria-hidden={!showBanner}
          >
            {showBanner &&
              (isSelectAllMode ? (
                <>
                  All {selectedCount} item{selectedCount !== 1 ? "s" : ""} are selected.{" "}
                  <button
                    type="button"
                    className="cursor-pointer font-semibold underline underline-offset-2"
                    onClick={handleClearSelection}
                  >
                    Clear selection
                  </button>
                </>
              ) : (
                <>
                  All {selectedCount} item{selectedCount !== 1 ? "s" : ""} on this page are selected.
                  {totalItems > selectedCount && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="cursor-pointer font-semibold underline underline-offset-2"
                        onClick={handleSelectAll}
                      >
                        Select all {totalItems.toLocaleString()} available item{totalItems !== 1 ? "s" : ""}
                      </button>
                    </>
                  )}
                </>
              ))}
          </div>

          <Button
            size="sm"
            className={cn(selectedCount === 0 && "invisible")}
            tabIndex={selectedCount === 0 ? -1 : 0}
            aria-hidden={selectedCount === 0}
            disabled={isImporting}
            onClick={handleImport}
          >
            {isImporting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            Import Selected ({selectedCount})
          </Button>
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-hidden p-4">
          {showSkeleton ? (
            <ImportModalSkeleton />
          ) : items.length === 0 ? (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <p className="text-sm">
                {debouncedSearch ? "No SAP products match this search." : "No importable SAP products found."}
              </p>
            </div>
          ) : (
            <Table containerClassName="h-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 z-10 w-[40px] bg-background">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={allPageSelected}
                      onChange={onHeaderToggle}
                    />
                  </TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">SKU</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">Name</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">Size</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">Unit price</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">Dealer price</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => {
                  const selected = isRowSelected(item)
                  return (
                    <TableRow
                      key={item.sku}
                      data-row-index={idx}
                      className={cn("cursor-pointer", selected && "bg-blue-50 dark:bg-blue-950/20")}
                      onClick={() => onRowToggle(getRowKey(item))}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selected}
                          onChange={() => handleCheckboxChange(getRowKey(item))}
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            startCheckboxDrag(idx, e)
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{item.sku}</TableCell>
                      <TableCell>{item.name ?? "—"}</TableCell>
                      <TableCell>{item.size ?? "—"}</TableCell>
                      <TableCell>{item.unitPrice != null ? item.unitPrice.toFixed(2) : "—"}</TableCell>
                      <TableCell>{item.dealerPrice != null ? item.dealerPrice.toFixed(2) : "—"}</TableCell>
                      <TableCell>{item.stockQuantity != null ? item.stockQuantity : "—"}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination footer */}
        <div className="flex shrink-0 items-center justify-between border-t bg-background px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
