import { useTranslation } from "react-i18next"
import { GlobeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LANGUAGES, LANGUAGE_LABELS, persistLanguage } from "@/i18n"
import type { Language } from "@/i18n"

export function LanguageSwitcher() {
  const { i18n } = useTranslation()

  const changeLanguage = (lang: Language) => {
    i18n.changeLanguage(lang)
    persistLanguage(lang)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <GlobeIcon className="size-4" />
          <span className="sr-only">{LANGUAGE_LABELS[i18n.language as Language]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {Object.entries(LANGUAGES).map(([, lang]) => (
          <DropdownMenuItem
            key={lang}
            onClick={() => changeLanguage(lang)}
            className={i18n.language === lang ? "bg-accent" : ""}
          >
            {LANGUAGE_LABELS[lang]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
