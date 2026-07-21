import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2Icon, RefreshCwIcon, UnplugIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAppSelector } from "@/store"

// The PDF product-image extractor is the standalone app in
// python-works/extract (server.py), served the same way the Room Visualizer
// (AiImagesPage) is: a self-contained web UI embedded whole via iframe rather
// than ported into React, since it keeps its own upload/parse/download job
// state.
//
// VITE_EXTRACT_PDF_URL overrides this when set, but otherwise the fallback is
// environment-aware rather than one fixed value: import.meta.env is baked in
// at build time, so `npm run dev` (PROD=false) falls back to the local
// server.py, while a production build (`vite build`, PROD=true) falls back
// to the live proxy - instead of one .env value winning for both, which
// would make local dev call the live API too.
const EXTRACT_PDF_URL =
  (import.meta.env.VITE_EXTRACT_PDF_URL as string | undefined)?.trim().replace(/\/+$/, "") ||
  (import.meta.env.PROD ? "https://api.trabelcigroup.com/extract-product-pdf" : "http://localhost:5058")

type ExtractorStatus = "checking" | "up" | "down"

export function ExtractProductPdfPage() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<ExtractorStatus>("checking")
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
    target?.postMessage({ type: "set-theme", theme }, EXTRACT_PDF_URL)
    target?.postMessage({ type: "set-lang", lang }, EXTRACT_PDF_URL)
  }, [theme, lang])

  useEffect(() => {
    postThemeAndLang()
  }, [postThemeAndLang])

  const checkHealth = useCallback(async () => {
    setStatus("checking")
    try {
      const res = await fetch(`${EXTRACT_PDF_URL}/health`)
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
            <p className="text-sm font-medium">{t("extractProductPdf.unavailableTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("extractProductPdf.unavailableDesc")}</p>
            <code className="mt-2 inline-block rounded bg-muted px-2 py-1 text-xs" dir="ltr">
              python-works/extract → python server.py
            </code>
          </div>
          <Button size="sm" variant="outline" onClick={() => void checkHealth()}>
            <RefreshCwIcon className="size-3.5" />
            {t("extractProductPdf.retry")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <iframe
      ref={iframeRef}
      src={`${EXTRACT_PDF_URL}/?theme=${initialTheme.current}&lang=${initialLang.current}`}
      onLoad={postThemeAndLang}
      title={t("extractProductPdf.title")}
      className="h-[calc(100vh-8.5rem)] w-full rounded-lg border bg-background"
    />
  )
}
