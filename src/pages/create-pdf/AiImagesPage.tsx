import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2Icon, RefreshCwIcon, UnplugIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAppSelector } from "@/store"

// The Marble SKU Room Visualizer is the standalone app in
// python-works/modeling-automation, served by its Flask server (server.py).
// It keeps its own workflow/state, so it's embedded whole rather than ported.
const VISUALIZER_URL =
  (import.meta.env.VITE_ROOM_VISUALIZER_URL as string | undefined)?.trim().replace(/\/+$/, "") ||
  "http://localhost:5057"

type VisualizerStatus = "checking" | "up" | "down"

export function AiImagesPage() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<VisualizerStatus>("checking")
  const theme = useAppSelector((s) => s.ui.theme)
  const lang = i18n.language?.startsWith("he") ? "he" : "en"
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // Initial theme/language travel as query params (applied before first
  // paint); keeping them in refs means later toggles don't change src and
  // reload the iframe mid-workflow — those are sent via postMessage instead.
  const initialTheme = useRef(theme)
  const initialLang = useRef(lang)

  const postThemeAndLang = useCallback(() => {
    const target = iframeRef.current?.contentWindow
    target?.postMessage({ type: "set-theme", theme }, VISUALIZER_URL)
    target?.postMessage({ type: "set-lang", lang }, VISUALIZER_URL)
  }, [theme, lang])

  useEffect(() => {
    postThemeAndLang()
  }, [postThemeAndLang])

  const checkHealth = useCallback(async () => {
    setStatus("checking")
    try {
      const res = await fetch(`${VISUALIZER_URL}/health`)
      setStatus(res.ok ? "up" : "down")
    } catch {
      setStatus("down")
    }
  }, [])

  useEffect(() => {
    void checkHealth()
  }, [checkHealth])

  if (status === "checking") {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (status === "down") {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-muted">
            <UnplugIcon className="size-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">{t("aiImages.unavailableTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("aiImages.unavailableDesc")}</p>
            <code className="mt-2 inline-block rounded bg-muted px-2 py-1 text-xs" dir="ltr">
              python-works/modeling-automation → python server.py
            </code>
          </div>
          <Button size="sm" variant="outline" onClick={() => void checkHealth()}>
            <RefreshCwIcon className="size-3.5" />
            {t("aiImages.retry")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <iframe
      ref={iframeRef}
      src={`${VISUALIZER_URL}/?theme=${initialTheme.current}&lang=${initialLang.current}`}
      onLoad={postThemeAndLang}
      title={t("aiImages.title")}
      className="h-[calc(100vh-8.5rem)] w-full rounded-lg border bg-background"
    />
  )
}
