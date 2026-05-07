import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  useSimilarityGlobalStatusQuery,
  useAnalyzeAllProductsMutation,
} from "@/features/similarity/api"
import { formatDate } from "@/lib/formatDate"

export function SimilarityStatusBar() {
  const { t } = useTranslation()
  const analyzeAllMutation = useAnalyzeAllProductsMutation()
  const [isPolling, setIsPolling] = useState(false)

  const { data: status, isError } = useSimilarityGlobalStatusQuery({
    refetchInterval: isPolling ? 15000 : false,
  })

  const wasRunningRef = useRef(false)

  useEffect(() => {
    if (!status?.recompute) return

    const isRunning = status.recompute.isRunning
    setIsPolling(isRunning)

    if (wasRunningRef.current && !isRunning) {
      toast.success(t("similarity.recomputeCompleted"))
    }

    wasRunningRef.current = isRunning
  }, [status, t])

  const handleRecomputeAll = async () => {
    try {
      const result = await analyzeAllMutation.mutateAsync()
      toast.success(t("similarity.recomputeStarted"), {
        description: t("similarity.recomputeStartedDesc", {
          total: result.totalProducts,
          chunks: result.totalChunks,
        }),
      })
    } catch {
      toast.error(t("similarity.recomputeAlreadyRunning"))
    }
  }

  // Show recompute button even when API fails — just without stats
  if (isError || !status?.recompute || !status?.catalog) {
    return (
      <div className="px-6 py-2 border-b border-border/60 flex items-center justify-end text-xs text-muted-foreground">
        <Button
          variant="outline"
          size="sm"
          disabled={analyzeAllMutation.isPending}
          onClick={handleRecomputeAll}
        >
          {analyzeAllMutation.isPending
            ? t("similarity.recomputing")
            : t("similarity.recomputeAll")}
        </Button>
      </div>
    )
  }

  const { recompute, catalog } = status
  const isRunning = recompute.isRunning

  if (isRunning && recompute.total > 0) {
    const { completed, total } = recompute
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0

    return (
      <div className="px-6 py-2 border-b border-border/60 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex-1">
          <span>{t("similarity.recomputeProgress", { completed, total, percent })}</span>
          <div className="mt-1 h-1.5 w-full max-w-xs rounded bg-muted">
            <div
              className="h-1.5 rounded bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <Button variant="outline" size="sm" disabled>
          {t("similarity.recomputing")}
        </Button>
      </div>
    )
  }

  const coverageText = t("similarity.embeddingCoverage", {
    count: catalog.withEmbeddings,
    total: catalog.totalProducts,
  })

  const lastRecomputeText = catalog.lastFullRecompute
    ? t("similarity.lastRecompute", { date: formatDate(catalog.lastFullRecompute) })
    : t("similarity.neverRecomputed")

  return (
    <div className="px-6 py-2 border-b border-border/60 flex items-center justify-between text-xs text-muted-foreground">
      <span>
        {coverageText} | {lastRecomputeText}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={analyzeAllMutation.isPending}
        onClick={handleRecomputeAll}
      >
        {analyzeAllMutation.isPending
          ? t("similarity.recomputing")
          : t("similarity.recomputeAll")}
      </Button>
    </div>
  )
}
