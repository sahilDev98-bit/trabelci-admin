import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2Icon, SaveIcon, CheckIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useBusinessPartnersQuery } from "@/features/businessPartners/api"
import { useBrandingConfigQuery, useAvailableIconsQuery, useUpdateBrandingMutation } from "@/features/branding/api"
import { cn } from "@/lib/utils"

export function BrandingPage() {
  const { t } = useTranslation()
  const [selectedBpId, setSelectedBpId] = useState<string | null>(null)
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null)

  const bpQuery = useBusinessPartnersQuery()
  const brandingQuery = useBrandingConfigQuery(selectedBpId)
  const iconsQuery = useAvailableIconsQuery()
  const updateMutation = useUpdateBrandingMutation()

  const serverIcon = brandingQuery.data?.appIcon ?? "Default"
  const currentIcon = selectedIcon ?? serverIcon
  const isDirty = selectedIcon !== null && selectedIcon !== serverIcon

  const handleBpChange = (bpId: string) => {
    setSelectedBpId(bpId || null)
    setSelectedIcon(null)
  }

  const handleIconSelect = (iconKey: string) => {
    setSelectedIcon(iconKey)
  }

  const handleSave = async () => {
    if (!selectedBpId || !selectedIcon) return
    try {
      await updateMutation.mutateAsync({
        businessPartnerId: selectedBpId,
        appIcon: selectedIcon,
      })
      setSelectedIcon(null)
      toast.success(t("branding.saved", "App icon updated successfully"))
    } catch {
      toast.error(t("branding.saveError", "Failed to update app icon"))
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("branding.title", "App Icon Branding")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("branding.description", "Select a business partner and choose which app icon their users will see on their home screen.")}
          </p>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium">
              {t("branding.selectBP", "Business Partner")}
            </label>
            <Select
              value={selectedBpId ?? ""}
              onValueChange={handleBpChange}
            >
              <SelectTrigger className="w-[320px]">
                <SelectValue placeholder={t("branding.selectBPPlaceholder", "Select a business partner...")} />
              </SelectTrigger>
              <SelectContent>
                {(bpQuery.data ?? []).map((bp) => (
                  <SelectItem key={bp.id} value={String(bp.id)}>
                    {bp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedBpId && brandingQuery.isLoading && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2Icon className="size-5 animate-spin" />
              <span>{t("common.loading")}</span>
            </div>
          )}

          {selectedBpId && !brandingQuery.isLoading && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <label className="text-sm font-medium">
                  {t("branding.chooseIcon", "Choose App Icon")}
                </label>
                <Button
                  size="sm"
                  disabled={!isDirty || updateMutation.isPending}
                  onClick={handleSave}
                >
                  {updateMutation.isPending ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <SaveIcon className="size-4" />
                  )}
                  {t("common.save")}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {(iconsQuery.data ?? []).map((icon) => (
                  <button
                    key={icon.key}
                    type="button"
                    onClick={() => handleIconSelect(icon.key)}
                    className={cn(
                      "relative flex flex-col items-center gap-3 rounded-lg border-2 p-6 transition-colors hover:bg-accent/50",
                      currentIcon === icon.key
                        ? "border-primary bg-accent/30"
                        : "border-border",
                    )}
                  >
                    {currentIcon === icon.key && (
                      <div className="absolute end-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                        <CheckIcon className="size-3" />
                      </div>
                    )}
                    {icon.imageUrl ? (
                      <img
                        src={icon.imageUrl}
                        alt={icon.label}
                        className="size-16 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="grid size-16 place-items-center rounded-2xl bg-muted text-2xl font-bold text-muted-foreground">
                        {icon.label.charAt(0)}
                      </div>
                    )}
                    <span className="text-sm font-medium">{icon.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {!selectedBpId && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("branding.selectBPPrompt", "Select a business partner above to configure their app icon.")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
