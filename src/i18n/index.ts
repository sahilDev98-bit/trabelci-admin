import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import en from "./locales/en"
import he from "./locales/he"

export const LANGUAGES = {
  EN: "en",
  HE: "he",
} as const

export type Language = (typeof LANGUAGES)[keyof typeof LANGUAGES]

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  he: "עברית",
}

export const RTL_LANGUAGES: Language[] = [LANGUAGES.HE]

export function isRtlLanguage(lang: Language): boolean {
  return RTL_LANGUAGES.includes(lang)
}

const LANG_STORAGE_KEY = "app-language"

function loadLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY)
    if (stored === LANGUAGES.EN || stored === LANGUAGES.HE) return stored
  } catch {
    // ignore
  }
  return LANGUAGES.EN
}

export function persistLanguage(lang: Language) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // ignore
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
  },
  lng: loadLanguage(),
  fallbackLng: LANGUAGES.EN,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
