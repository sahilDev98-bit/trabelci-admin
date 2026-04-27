import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { brandingQueryKeys } from "./queryKeys"
import type { BrandingConfig, IconOption } from "./types"

// ── Fetch functions ──────────────────────────────────────────────────────────

async function fetchBrandingConfig(businessPartnerId: string): Promise<BrandingConfig> {
  const res = await apiFetch<{
    success: true
    branding: BrandingConfig
  }>(`${API_ENDPOINTS.BRANDING_CONFIG}?businessPartnerId=${businessPartnerId}`, { method: "GET" })

  return res.branding ?? { appIcon: "Default" }
}

async function fetchAvailableIcons(): Promise<IconOption[]> {
  const res = await apiFetch<{
    success: true
    icons: IconOption[]
  }>(API_ENDPOINTS.BRANDING_ICONS, { method: "GET" })

  return res.icons ?? []
}

async function updateBrandingConfig(input: {
  businessPartnerId: string
  appIcon: string
}): Promise<BrandingConfig> {
  const res = await apiFetch<{
    success: true
    branding: BrandingConfig
  }>(API_ENDPOINTS.BRANDING_CONFIG, {
    method: "PUT",
    body: JSON.stringify({
      businessPartnerId: Number(input.businessPartnerId),
      appIcon: input.appIcon,
    }),
  })

  return res.branding
}

// ── Query hooks ──────────────────────────────────────────────────────────────

export function useBrandingConfigQuery(businessPartnerId: string | null) {
  return useQuery({
    queryKey: businessPartnerId ? brandingQueryKeys.config(businessPartnerId) : ["branding", "config", "null"],
    queryFn: () => fetchBrandingConfig(businessPartnerId!),
    enabled: Boolean(businessPartnerId),
  })
}

export function useAvailableIconsQuery() {
  return useQuery({
    queryKey: brandingQueryKeys.icons,
    queryFn: fetchAvailableIcons,
  })
}

// ── Mutation hooks ───────────────────────────────────────────────────────────

export function useUpdateBrandingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateBrandingConfig,
    onSuccess: async (_data, variables) => {
      await qc.invalidateQueries({ queryKey: brandingQueryKeys.config(variables.businessPartnerId) })
    },
  })
}
