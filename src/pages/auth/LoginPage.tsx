import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

import { ErrorMessage } from "@/components/ErrorMessage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { AuthLayout } from "@/layouts/AuthLayout"
import { useAppDispatch, useAppSelector } from "@/store"
import { AUTH_STATUS, loginWithEmailPassword, loadCurrentUser } from "@/features/auth/authSlice"
import { ROUTES } from "@/lib/routes"

interface LoginFormValues {
  email: string
  password: string
}

export function LoginPage() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { redirect: redirectTo } = useSearch({ from: "/login" })
  const { status, error, profile } = useAppSelector((state) => state.auth)

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginFormValues>({
    defaultValues: {
      email: "",
      password: "",
    },
  })

  useEffect(() => {
    if (status === AUTH_STATUS.IDLE) {
      dispatch(loadCurrentUser())
    }
  }, [dispatch, status])

  useEffect(() => {
    if (profile && status === AUTH_STATUS.AUTHENTICATED) {
      navigate({ to: (redirectTo ?? ROUTES.DASHBOARD) as string, replace: true })
    }
  }, [profile, status, redirectTo, navigate])

  const onSubmit = async (values: LoginFormValues) => {
    await dispatch(loginWithEmailPassword(values))
  }

  const isLoading = status === AUTH_STATUS.LOADING || isSubmitting

  return (
    <AuthLayout title={t("auth.adminSignIn")}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" type="email" autoComplete="email" required {...register("email")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            {...register("password")}
          />
        </div>
        {error ? (
          <ErrorMessage>{error}</ErrorMessage>
        ) : null}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? t("common.signingIn") : t("common.signIn")}
        </Button>
      </form>
    </AuthLayout>
  )
}
