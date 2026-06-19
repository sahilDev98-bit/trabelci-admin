import { useState } from "react"
import { useTranslation } from "react-i18next"

import { ErrorMessage } from "@/components/ErrorMessage"
import { useCheckboxDragSelect } from "@/lib/useCheckboxDragSelect"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useCreateProductFromSapMutation, useSapProductsSearchQuery } from "@/features/products/api"
import type { SapProductPreview } from "@/features/products/types"

type SapProductSearchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SapProductSearchDialog({ open, onOpenChange }: SapProductSearchDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Record<string, SapProductPreview>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { data: results, isLoading } = useSapProductsSearchQuery(query)
  const createMutation = useCreateProductFromSapMutation()

  const toggleSelection = (product: SapProductPreview) => {
    setSelected((prev) => {
      if (prev[product.sku]) {
        const next = { ...prev }
        delete next[product.sku]
        return next
      }
      return { ...prev, [product.sku]: product }
    })
  }

  const handleAddSelected = async () => {
    const items = Object.values(selected)
    if (items.length === 0) return
    setSubmitError(null)
    try {
      for (const item of items) {
        // eslint-disable-next-line no-await-in-loop
        await createMutation.mutateAsync({ sku: item.sku })
      }
      setSelected({})
      setQuery("")
      onOpenChange(false)
    } catch (error) {
      if (error instanceof Error) {
        setSubmitError(error.message)
      } else {
        setSubmitError(t("products.failedToAddSelected"))
      }
    }
  }

  const isSelected = (sku: string) => Boolean(selected[sku])

  const searchResults = results ?? []

  // Click-and-drag multi-select across the checkbox column (Excel/Gmail
  // style) — mousedown on one checkbox, drag over others, they all flip to
  // the same checked state as the first click.
  const { startDrag: startCheckboxDrag, handleNativeChange: handleCheckboxChange } = useCheckboxDragSelect({
    items: searchResults,
    getKey: (p) => p.sku,
    isSelected: (p) => isSelected(p.sku),
    toggle: (key) => {
      const product = searchResults.find((p) => p.sku === key)
      if (product) toggleSelection(product)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("")
          setSelected({})
          setSubmitError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="inset-0 top-0 left-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0">

        <DialogHeader className="shrink-0 gap-1 border-b px-6 py-4">
          <DialogTitle>{t("products.searchProductsInSap")}</DialogTitle>
          <DialogDescription>
            {t("products.searchProductsInSapDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-2 border-b px-6 py-3">
          <Input
            className="max-w-md"
            placeholder={t("products.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
          >
            {isLoading ? t("products.searching") : t("common.search")}
          </Button>
        </div>

        {submitError ? (
          <div className="shrink-0 px-6 pt-3">
            <ErrorMessage>{submitError}</ErrorMessage>
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-hidden px-6 py-4">
          <Table containerClassName="h-full">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky top-0 z-10 w-[40px] bg-background"></TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("products.sku")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("common.name")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("products.size")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("products.unitPrice")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("products.dealerPrice")}</TableHead>
                <TableHead className="sticky top-0 z-10 bg-background">{t("products.stock")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {searchResults.map((p, idx) => (
                <TableRow
                  key={p.sku}
                  data-row-index={idx}
                  onClick={() => toggleSelection(p)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isSelected(p.sku)}
                      onChange={() => handleCheckboxChange(p.sku)}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        startCheckboxDrag(idx, e)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs sm:text-sm">{p.sku}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.size ?? "—"}</TableCell>
                  <TableCell>{p.unitPrice != null ? p.unitPrice.toFixed(2) : "—"}</TableCell>
                  <TableCell>{p.dealerPrice != null ? p.dealerPrice.toFixed(2) : "—"}</TableCell>
                  <TableCell>{p.stockQuantity != null ? p.stockQuantity : "—"}</TableCell>
                </TableRow>
              ))}
              {!isLoading && (!results || results.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-4 text-center text-sm text-muted-foreground">
                    {t("products.noSapProductsFound")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="mt-0 shrink-0 border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </Button>
          <Button
            type="button"
            disabled={Object.keys(selected).length === 0 || createMutation.isPending}
            onClick={handleAddSelected}
          >
            {createMutation.isPending ? t("products.adding") : t("products.addSelected", { count: Object.keys(selected).length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

