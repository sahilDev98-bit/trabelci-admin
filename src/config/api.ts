const rawBaseUrl = import.meta.env.VITE_ADMIN_API_BASE_URL as string | undefined

export const adminApiBaseUrl = rawBaseUrl?.trim() ? rawBaseUrl.trim().replace(/\/+$/, "") : ""

export function buildAdminApiUrl(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`
  return adminApiBaseUrl ? `${adminApiBaseUrl}${path}` : path
}

