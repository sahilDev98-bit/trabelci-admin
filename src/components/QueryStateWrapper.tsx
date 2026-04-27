import { useTranslation } from "react-i18next"
import { ErrorMessage } from "@/components/ErrorMessage"
import { Button } from "@/components/ui/button"
import { Loader2Icon, RefreshCwIcon } from "lucide-react"

interface QueryStateWrapperProps {
  isLoading: boolean
  isError: boolean
  error: unknown
  entityName: string
  isEmpty: boolean
  emptyMessage?: string
  onRetry?: () => void
  children: React.ReactNode
}

export function QueryStateWrapper({
  isLoading,
  isError,
  error,
  entityName,
  isEmpty,
  emptyMessage,
  onRetry,
  children,
}: QueryStateWrapperProps) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        <span>{t("common.loadingEntity", { entity: entityName })}</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2 py-4">
        <ErrorMessage>
          {t("common.failedToLoad", { entity: entityName })}{error instanceof Error ? `: ${error.message}` : "."}
        </ErrorMessage>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon className="size-3.5" />
            {t("common.retry")}
          </Button>
        ) : null}
      </div>
    )
  }

  if (isEmpty) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        {emptyMessage ?? t("common.noEntityFound", { entity: entityName })}
      </p>
    )
  }

  return <>{children}</>
}
