import type { ReactNode } from "react"
import { Navigate } from "@tanstack/react-router"

import { useAppSelector } from "@/store"
import { RequireAuth } from "@/routes/RequireAuth"
import type { UserRole } from "@/types/auth"

interface RequireRoleProps {
  allowedRoles: UserRole[]
  children: ReactNode
}

export function RequireRole({ allowedRoles, children }: RequireRoleProps) {
  return (
    <RequireAuth>
      <RoleGate allowedRoles={allowedRoles}>{children}</RoleGate>
    </RequireAuth>
  )
}

function RoleGate({ allowedRoles, children }: RequireRoleProps) {
  const { profile } = useAppSelector((state) => state.auth)

  if (!profile || !allowedRoles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
