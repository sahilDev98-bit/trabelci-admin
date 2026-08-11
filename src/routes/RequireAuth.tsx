import type { ReactNode } from "react"
import { Navigate, useLocation } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

import { useAppSelector } from "@/store"
import { AUTH_STATUS } from "@/features/auth/authSlice"

interface RequireAuthProps {
  children: ReactNode
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const { status, profile } = useAppSelector((state) => state.auth)

  if (status === AUTH_STATUS.IDLE || status === AUTH_STATUS.LOADING) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("common.checkingSession")}</p>
      </div>
    )
  }

  if (!profile || status !== AUTH_STATUS.AUTHENTICATED) {
    // Guard against a self-referential redirect (redirect=/login). Seen in practice
    // right after sign-out: this guard can re-render once more during the route
    // transition, after the URL has already changed to /login, which would otherwise
    // produce `/login?redirect=%2Flogin` and re-trigger on every subsequent render —
    // hitting React's nested-update limit ("Maximum update depth exceeded").
    const isAlreadyOnLogin = location.pathname === "/login"
    return (
      <Navigate
        to="/login"
        replace
        search={{ redirect: isAlreadyOnLogin ? undefined : location.pathname }}
      />
    )
  }

  return <>{children}</>
}
