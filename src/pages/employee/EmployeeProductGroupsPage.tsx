import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { EyeIcon } from "lucide-react"

import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useEmployeeProductGroupsQuery, useEmployeeGroupProductsQuery } from "@/features/employeeCatalog/api"
import type { ProductGroup } from "@/features/productGroups/types"

export function EmployeeProductGroupsPage() {
  const { t } = useTranslation()
  const { data, isLoading, isError, error } = useEmployeeProductGroupsQuery()

  const [query, setQuery] = useState("")
  const [viewingGroup, setViewingGroup] = useState<ProductGroup | null>(null)

  const filtered = useMemo(() => {
    const list = data ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((g) => g.name.toLowerCase().includes(q))
  }, [data, query])

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>{t("productGroups.title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("productGroups.browseReadOnly")}
            </p>
          </div>
          <div className="w-full max-w-sm">
            <Input
              placeholder={t("productGroups.searchPlaceholder")}
              aria-label={t("productGroups.searchProductGroups")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <QueryStateWrapper
            isLoading={isLoading}
            isError={isError}
            error={error}
            entityName="product groups"
            isEmpty={filtered.length === 0}
            emptyMessage={t("productGroups.noGroupsFound")}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("productGroups.productCount")}</TableHead>
                  <TableHead className="w-[80px] text-right">{t("common.view")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{g.productCount ?? 0}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("productGroups.viewProductsIn", { name: g.name })}
                        onClick={() => setViewingGroup(g)}
                      >
                        <EyeIcon className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryStateWrapper>
        </CardContent>
      </Card>

      <ViewGroupProductsDialog
        group={viewingGroup}
        open={Boolean(viewingGroup)}
        onOpenChange={(open) => {
          if (!open) setViewingGroup(null)
        }}
      />
    </>
  )
}

function ViewGroupProductsDialog({
  group,
  open,
  onOpenChange,
}: {
  group: ProductGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const groupId = group?.id ?? null
  const { data: products, isLoading } = useEmployeeGroupProductsQuery(open ? groupId : null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("productGroups.productsInGroup", { name: group?.name })}</DialogTitle>
          <DialogDescription>
            {t("productGroups.productsInGroupCount", { count: group?.productCount ?? 0 })}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">{t("productGroups.loadingProducts")}</p>
        ) : !products || products.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("productGroups.noProductsInGroupEmpty")}</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("products.sku")}</TableHead>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("products.unitPrice")}</TableHead>
                  <TableHead>{t("products.dealerPrice")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs sm:text-sm">{p.sku}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.unitPrice != null ? `${p.unitPrice.toFixed(2)}` : "—"}</TableCell>
                    <TableCell>{p.dealerPrice != null ? `${p.dealerPrice.toFixed(2)}` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
