import { useTranslation } from "react-i18next"
import { useNavigate } from "@tanstack/react-router"
import { ImageIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useSimilarProductsQuery } from "@/features/similarity/api"

interface SimilarProductsSectionProps {
  productId: string
}

export function SimilarProductsSection({ productId }: SimilarProductsSectionProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: similarProducts, isLoading } = useSimilarProductsQuery(productId)

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("productDetail.similarProducts")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
        </CardContent>
      </Card>
    )
  }

  if (!similarProducts || similarProducts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("productDetail.similarProducts")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-sm text-muted-foreground">
            {t("productDetail.noSimilarProducts")}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CardTitle>{t("productDetail.similarProducts")}</CardTitle>
          <Badge variant="secondary">{similarProducts.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">{t("productDetail.coverImage")}</TableHead>
              <TableHead>{t("products.sku")}</TableHead>
              <TableHead>{t("common.name")}</TableHead>
              <TableHead>{t("products.unitPrice")}</TableHead>
              <TableHead>{t("products.dealerPrice")}</TableHead>
              <TableHead className="w-[80px]">{t("productDetail.matchScore")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {similarProducts.map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer"
                onClick={() => navigate({ to: "/products/$id", params: { id: p.id } })}
              >
                <TableCell>
                  {p.coverUrl ? (
                    <img
                      src={p.coverUrl}
                      alt={p.name}
                      className="size-10 rounded-md border object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid size-10 place-items-center rounded-md border border-dashed text-muted-foreground">
                      <ImageIcon className="size-4" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs sm:text-sm">{p.sku}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.unitPrice != null ? p.unitPrice.toFixed(2) : "—"}</TableCell>
                <TableCell>{p.dealerPrice != null ? p.dealerPrice.toFixed(2) : "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{Math.round(p.score * 100)}%</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
