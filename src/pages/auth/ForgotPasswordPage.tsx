import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { ErrorMessage } from "@/components/ErrorMessage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthLayout } from "@/layouts/AuthLayout"
import { supabaseClient } from "@/lib/supabaseClient"

interface ForgotPasswordFormValues {
  email: string
}

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    defaultValues: { email: "" },
  })

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    setMessage(null)
    setError(null)
    const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(values.email)
    if (resetError) {
      setError(t("auth.resetEmailFailed"))
      return
    }
    setMessage(t("auth.resetEmailSent"))
  }

  return (
    <AuthLayout title={t("auth.resetPassword")}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" type="email" required {...register("email")} />
        </div>
        {error ? (
          <ErrorMessage>{error}</ErrorMessage>
        ) : null}
        {message ? (
          <p className="text-sm text-foreground" role="status">
            {message}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("auth.sending") : t("auth.sendResetLink")}
        </Button>
      </form>
    </AuthLayout>
  )
}

