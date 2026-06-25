import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { LANGUAGES, persistLanguage } from "@/i18n"
import type { Language } from "@/i18n"

const NEXT_LANGUAGE: Record<Language, Language> = {
  [LANGUAGES.EN]: LANGUAGES.HE,
  [LANGUAGES.HE]: LANGUAGES.EN,
}

// Same convention as the dark/light toggle (which shows the Sun icon while
// dark, Moon while light): the label shown is the language a click will
// switch TO, not the one currently active.
const SHORT_LABEL: Record<Language, string> = {
  [LANGUAGES.EN]: "EN",
  [LANGUAGES.HE]: "עב",
}

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const current = (i18n.language as Language) in NEXT_LANGUAGE ? (i18n.language as Language) : LANGUAGES.EN
  const next = NEXT_LANGUAGE[current]

  const toggleLanguage = () => {
    i18n.changeLanguage(next)
    persistLanguage(next)
  }

  return (
    <Button variant="outline" size="icon" onClick={toggleLanguage}>
      <span className="text-xs font-bold tracking-tight">{SHORT_LABEL[next]}</span>
      <span className="sr-only">{t("common.toggleLanguage")}</span>
    </Button>
  )
}
