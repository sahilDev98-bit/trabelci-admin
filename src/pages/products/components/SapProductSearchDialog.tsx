import { useState } from "react"
import { useTranslation } from "react-i18next"

import { ErrorMessage } from "@/components/ErrorMessage"
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("products.searchProductsInSap")}</DialogTitle>
          <DialogDescription>
            {t("products.searchProductsInSapDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            placeholder={t("products.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
          >
            {isLoading ? t("products.searching") : t("common.search")}
          </Button>
        </div>

        {submitError ? <ErrorMessage>{submitError}</ErrorMessage> : null}

        <div className="mt-4 max-h-80 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>{t("products.sku")}</TableHead>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("products.size")}</TableHead>
                <TableHead>{t("products.unitPrice")}</TableHead>
                <TableHead>{t("products.dealerPrice")}</TableHead>
                <TableHead>{t("products.stock")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(results ?? []).map((p) => (
                <TableRow
                  key={p.sku}
                  onClick={() => toggleSelection(p)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isSelected(p.sku)}
                      onChange={() => toggleSelection(p)}
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

        <DialogFooter>
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

