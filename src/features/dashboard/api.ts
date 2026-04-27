import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MerchantDashboardStats {
  totalEmployees: number
  totalProducts: number
  totalProductGroups: number
  employees: {
    user_id: string
    role: string
    metadata: { lastLogin?: string | null; loginCount?: number } | null
  }[]
}

export interface EmployeeDashboardStats {
  totalProducts: number
  totalProductGroups: number
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

async function fetchMerchantDashboardStats(): Promise<MerchantDashboardStats> {
  const res = await apiFetch<{ success: true; stats: MerchantDashboardStats }>(
    API_ENDPOINTS.MERCHANT_DASHBOARD_STATS,
    { method: "GET" },
  )
  return res.stats
}

async function fetchEmployeeDashboardStats(): Promise<EmployeeDashboardStats> {
  const res = await apiFetch<{ success: true; stats: EmployeeDashboardStats }>(
    API_ENDPOINTS.EMPLOYEE_DASHBOARD_STATS,
    { method: "GET" },
  )
  return res.stats
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useMerchantDashboardStatsQuery() {
  return useQuery({
    queryKey: ["dashboard", "merchant-stats"],
    queryFn: fetchMerchantDashboardStats,
  })
}

export function useEmployeeDashboardStatsQuery() {
  return useQuery({
    queryKey: ["dashboard", "employee-stats"],
    queryFn: fetchEmployeeDashboardStats,
  })
}

// ---------------------------------------------------------------------------
// Merchant Price Multiplier
// ---------------------------------------------------------------------------

async function fetchMerchantPriceMultiplier(): Promise<number> {
  const res = await apiFetch<{ success: true; priceMultiplier: number }>(
    API_ENDPOINTS.MERCHANT_PRICE_MULTIPLIER,
    { method: "GET" },
  )
  return res.priceMultiplier ?? 1.0
}

async function updateMerchantPriceMultiplier(priceMultiplier: number): Promise<number> {
  const res = await apiFetch<{ success: true; priceMultiplier: number }>(
    API_ENDPOINTS.MERCHANT_PRICE_MULTIPLIER,
    { method: "PUT", body: JSON.stringify({ priceMultiplier }) },
  )
  return res.priceMultiplier ?? priceMultiplier
}

export function useMerchantPriceMultiplierQuery() {
  return useQuery({
    queryKey: ["dashboard", "merchant-price-multiplier"],
    queryFn: fetchMerchantPriceMultiplier,
  })
}

export function useUpdateMerchantPriceMultiplierMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateMerchantPriceMultiplier,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["dashboard", "merchant-price-multiplier"] })
    },
  })
}
