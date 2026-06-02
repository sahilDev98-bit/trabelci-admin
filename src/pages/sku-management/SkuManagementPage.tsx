import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { PlusCircle, RefreshCw, ChevronRight, Settings, List } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCleanupStatsQuery } from "@/features/skuManagement/api"

export function SkuManagementPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: stats } = useCleanupStatsQuery()

  const cleanedPct =
    stats && stats.total > 0
      ? Math.round((stats.cleaned / stats.total) * 100)
      : 0

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("sku.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("sku.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Workflow A */}
        <Card
          className="cursor-pointer border-2 transition-all hover:border-primary hover:shadow-md"
          onClick={() => navigate({ to: "/sku-management/new" })}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <PlusCircle className="h-5 w-5 text-primary" />
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardTitle className="mt-3">{t("sku.workflowA")}</CardTitle>
            <CardDescription>{t("sku.workflowADesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate({ to: "/sku-management/new" })}>
              {t("sku.openCreationGrid")}
            </Button>
          </CardContent>
        </Card>

        {/* Workflow B */}
        <Card
          className="cursor-pointer border-2 transition-all hover:border-primary hover:shadow-md"
          onClick={() => navigate({ to: "/sku-management/cleanup" })}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                <RefreshCw className="h-5 w-5 text-amber-600" />
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardTitle className="mt-3">{t("sku.workflowB")}</CardTitle>
            <CardDescription>{t("sku.workflowBDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {stats ? (
              <div className="mb-3 space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{stats.cleaned} {t("sku.cleaned")}</span>
                  <span>{stats.total} {t("sku.total")}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-amber-500 transition-all"
                    style={{ width: `${cleanedPct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("sku.percentComplete", { pct: cleanedPct })}
                </p>
              </div>
            ) : null}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate({ to: "/sku-management/cleanup" })}
            >
              {t("sku.openCleanupGrid")}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Config links */}
      <div className="flex gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => navigate({ to: "/sku-management/dropdowns" })}
        >
          <List className="mr-2 h-4 w-4" />
          {t("sku.manageDropdowns")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => navigate({ to: "/sku-management/templates" })}
        >
          <Settings className="mr-2 h-4 w-4" />
          {t("sku.manageTemplates")}
        </Button>
      </div>
    </div>
  )
}
