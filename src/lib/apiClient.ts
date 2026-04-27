import axios, { AxiosError } from "axios"
import { buildAdminApiUrl } from "@/config/api"
import { supabaseClient } from "@/lib/supabaseClient"

const HTTP_UNAUTHORIZED = 401

/** Maps known backend error details to i18n keys */
const API_ERROR_I18N_MAP: Record<string, string> = {
  "A user with this email address has already been registered": "common.emailAlreadyRegistered",
}

export class ApiError extends Error {
  public readonly status: number
  public readonly payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.payload = payload
  }

  /** Returns an i18n key if the error details match a known message, otherwise null */
  get i18nKey(): string | null {
    const details = (this.payload as Record<string, unknown> | null)?.details
    if (typeof details === "string") {
      return API_ERROR_I18N_MAP[details] ?? null
    }
    return null
  }
}

const api = axios.create({
  baseURL: "",
  headers: { "Content-Type": "application/json" },
})

// Cache the auth token instead of calling getSession() on every request
let cachedToken: string | null = null

supabaseClient.auth.onAuthStateChange((_event, session) => {
  cachedToken = session?.access_token ?? null
})

// Initialize from current session
supabaseClient.auth.getSession().then(({ data: { session } }) => {
  cachedToken = session?.access_token ?? null
})

let isLoggingOut = false

// Inject cached Supabase auth token on every request
api.interceptors.request.use(async (config) => {
  if (cachedToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${cachedToken}`
  }
  return config
})

// Normalize errors
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === HTTP_UNAUTHORIZED && !isLoggingOut) {
      isLoggingOut = true
      await supabaseClient.auth.signOut()
      isLoggingOut = false
    }
    const payload = error.response?.data as Record<string, unknown> | null
    const message =
      (typeof payload?.error === "string" ? payload.error : null) ??
      `Request failed with status ${error.response?.status ?? 0}`
    throw new ApiError(message, error.response?.status ?? 0, payload)
  },
)

export async function apiFetch<TResponse>(
  pathname: string,
  init?: RequestInit,
): Promise<TResponse> {
  const url = buildAdminApiUrl(pathname)
  const method = (init?.method ?? "GET").toUpperCase()

  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData
  const headers: Record<string, string> = {}

  // Copy over any custom headers from init
  if (init?.headers) {
    const h = init.headers
    if (h instanceof Headers) {
      h.forEach((v, k) => { headers[k] = v })
    } else if (Array.isArray(h)) {
      h.forEach(([k, v]) => { headers[k] = v })
    } else {
      Object.assign(headers, h)
    }
  }

  if (isFormData) {
    // Set to undefined so axios auto-detects multipart boundary
    // (deleting isn't enough — the instance default would still apply)
    headers["Content-Type"] = undefined as unknown as string
  }

  const response = await api.request<TResponse>({
    url,
    method,
    headers,
    data: init?.body,
  })

  return response.data
}
