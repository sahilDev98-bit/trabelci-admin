import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { isRtlLanguage } from "@/i18n"
import type { Language } from "@/i18n"

export function LanguageSync() {
  const { i18n } = useTranslation()

  useEffect(() => {
    const lang = i18n.language as Language
    const rtl = isRtlLanguage(lang)

    document.documentElement.lang = lang
    document.documentElement.dir = rtl ? "rtl" : "ltr"
  }, [i18n.language])

  return null
}
