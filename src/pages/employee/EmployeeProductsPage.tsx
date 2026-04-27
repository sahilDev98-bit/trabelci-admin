import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useEmployeeProductsQuery } from "@/features/employeeCatalog/api"

export function EmployeeProductsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const pageSize = 10

  const [searchInput, setSearchInput] = useState("")
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(handle)
  }, [searchInput])

  const { data, isLoading, isError, error } = useEmployeeProductsQuery({
    page,
    pageSize,
    search: searchTerm,
  })

  const products = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const renderSapStatus = (status: string) => {
    if (status === "synced") {
      return <Badge variant="secondary">{t("common.synced")}</Badge>
    }
    return <Badge variant="outline">{t("common.pendingSapSync")}</Badge>
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>{t("products.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("products.browseReadOnly")}
          </p>
        </div>
        <div className="w-full max-w-sm">
          <Input
            placeholder={t("products.searchPlaceholder")}
            aria-label={t("products.searchProducts")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <QueryStateWrapper
          isLoading={isLoading}
          isError={isError}
          error={error}
          entityName="products"
          isEmpty={products.length === 0}
          emptyMessage={t("products.noProductsFound")}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("products.sku")}</TableHead>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("products.size")}</TableHead>
                <TableHead>{t("products.unitPrice")}</TableHead>
                <TableHead>{t("products.dealerPrice")}</TableHead>
                <TableHead>{t("products.stock")}</TableHead>
                <TableHead>{t("products.sapSync")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs sm:text-sm">{p.sku}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.size ?? "—"}</TableCell>
                  <TableCell>{p.unitPrice != null ? `${p.unitPrice.toFixed(2)}` : "—"}</TableCell>
                  <TableCell>{p.dealerPrice != null ? `${p.dealerPrice.toFixed(2)}` : "—"}</TableCell>
                  <TableCell>{p.stockQuantity != null ? p.stockQuantity : "—"}</TableCell>
                  <TableCell>{renderSapStatus(p.sapSyncStatus)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </QueryStateWrapper>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t("common.page", { page, pageCount })} • {t("common.totalItems", { count: total })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("common.previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              {t("common.next")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
