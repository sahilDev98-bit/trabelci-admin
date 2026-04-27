import { useEffect } from "react"

import { useAppSelector } from "@/store"
import { THEME } from "@/features/ui/uiSlice"

export function ThemeSync() {
  const theme = useAppSelector((s) => s.ui.theme)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === THEME.DARK)
  }, [theme])

  return null
}

