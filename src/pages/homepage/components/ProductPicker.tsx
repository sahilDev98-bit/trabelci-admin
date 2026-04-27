import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SearchIcon, PlusIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useProductsListQuery } from "@/features/products/api"

interface ProductPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (product: { id: string; sku: string; name: string; coverUrl: string | null }) => void
  excludeIds: Set<string>
  categoryId?: string | null
}

export function ProductPicker({ open, onOpenChange, onSelect, excludeIds, categoryId }: ProductPickerProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")

  const { data, isLoading } = useProductsListQuery({
    page: 1,
    pageSize: 50,
    search,
    categoryId,
  })

  const products = (data?.items ?? []).filter((p) => !excludeIds.has(p.id))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("homepage.addProduct", "Add Product")}</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("homepage.searchProducts", "Search products by name or SKU...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9"
          />
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search
                ? t("homepage.noProductsFound", "No products found")
                : categoryId
                  ? t("homepage.noCategoryProducts", "This category doesn't have any products yet.")
                  : t("homepage.typeToSearch", "Type to search for products")}
            </p>
          ) : (
            <div className="grid gap-1">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-start hover:bg-accent transition-colors"
                  onClick={() => {
                    onSelect({
                      id: product.id,
                      sku: product.sku,
                      name: product.name,
                      coverUrl: product.coverUrl,
                    })
                  }}
                >
                  {product.coverUrl ? (
                    <img
                      src={product.coverUrl}
                      alt={product.name}
                      className="size-10 rounded border object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid size-10 place-items-center rounded border border-dashed text-xs text-muted-foreground">
                      —
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{product.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{product.sku}</p>
                  </div>
                  <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close", "Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
