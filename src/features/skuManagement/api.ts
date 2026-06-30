import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { skuQueryKeys } from "./queryKeys"
import type {
  SkuAuditEntry,
  SkuAutocompleteHints,
  SkuBulkUpsertResponse,
  SkuCleanupStats,
  SkuDuplicateResult,
  SkuDropdownMap,
  SkuDropdownValue,
  SkuImportResult,
  SkuImportAllResult,
  SkuImportableSapItemsResponse,
  SkuMetadataFilters,
  SkuMetadataListResponse,
  SkuMetadataRow,
  SkuSubmitToSapResult,
  SkuTemplate,
  SkuValidationResult,
} from "./types"

// ─── Metadata ────────────────────────────────────────────────────────────────

export async function fetchSkuMetadataList(
  filters: SkuMetadataFilters = {}
): Promise<SkuMetadataListResponse> {
  const params = new URLSearchParams()
  if (filters.workflowType) params.set("workflowType", filters.workflowType)
  if (filters.status) params.set("status", filters.status)
  if (filters.page) params.set("page", String(filters.page))
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize))
  if (filters.search) params.set("search", filters.search)
  const qs = params.toString()
  return apiFetch(`${API_ENDPOINTS.SKU_METADATA}${qs ? `?${qs}` : ""}`)
}

export async function fetchSkuMetadata(sku: string): Promise<SkuMetadataRow> {
  return apiFetch(`${API_ENDPOINTS.SKU_METADATA}/${encodeURIComponent(sku)}`)
}

export async function bulkUpsertSkuMetadata(
  rows: Partial<SkuMetadataRow>[]
): Promise<SkuBulkUpsertResponse> {
  return apiFetch(API_ENDPOINTS.SKU_METADATA_BULK, {
    method: "POST",
    body: JSON.stringify({ rows }),
  })
}

export async function updateSkuMetadata(
  sku: string,
  data: Partial<SkuMetadataRow>
): Promise<SkuMetadataRow> {
  return apiFetch(`${API_ENDPOINTS.SKU_METADATA}/${encodeURIComponent(sku)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export async function deleteSkuMetadata(sku: string): Promise<void> {
  return apiFetch(`${API_ENDPOINTS.SKU_METADATA}/${encodeURIComponent(sku)}`, {
    method: "DELETE",
  })
}

export async function fetchSkuAuditLog(sku: string): Promise<SkuAuditEntry[]> {
  return apiFetch(`${API_ENDPOINTS.SKU_AUDIT_LOG}/${encodeURIComponent(sku)}`)
}

// ─── Dropdowns ───────────────────────────────────────────────────────────────

export async function fetchSkuDropdowns(): Promise<SkuDropdownMap> {
  return apiFetch(API_ENDPOINTS.SKU_DROPDOWNS)
}

export async function createSkuDropdownValue(
  payload: Omit<SkuDropdownValue, "id" | "created_at">
): Promise<SkuDropdownValue> {
  return apiFetch(API_ENDPOINTS.SKU_DROPDOWNS, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function updateSkuDropdownValue(
  id: number,
  payload: Partial<SkuDropdownValue>
): Promise<SkuDropdownValue> {
  return apiFetch(`${API_ENDPOINTS.SKU_DROPDOWNS}/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  })
}

export async function deleteSkuDropdownValue(id: number): Promise<void> {
  return apiFetch(`${API_ENDPOINTS.SKU_DROPDOWNS}/${id}`, { method: "DELETE" })
}

export interface SkuDropdownLabelSuggestion {
  label_en: string
  label_he: string
}

export async function suggestSkuDropdownLabels(
  value: string,
  fieldKey: string
): Promise<SkuDropdownLabelSuggestion> {
  return apiFetch(API_ENDPOINTS.SKU_DROPDOWNS_SUGGEST_LABELS, {
    method: "POST",
    body: JSON.stringify({ value, fieldKey }),
  })
}

// ─── Templates ───────────────────────────────────────────────────────────────

export async function fetchSkuTemplates(): Promise<SkuTemplate[]> {
  return apiFetch(API_ENDPOINTS.SKU_TEMPLATES)
}

export async function createSkuTemplate(
  payload: Omit<SkuTemplate, "id" | "created_at">
): Promise<SkuTemplate> {
  return apiFetch(API_ENDPOINTS.SKU_TEMPLATES, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function updateSkuTemplate(
  id: number,
  payload: Partial<SkuTemplate>
): Promise<SkuTemplate> {
  return apiFetch(`${API_ENDPOINTS.SKU_TEMPLATES}/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  })
}

// ─── Validation & tools ──────────────────────────────────────────────────────

export async function validateSkuRows(
  rows: Partial<SkuMetadataRow>[],
  templateId?: number
): Promise<SkuValidationResult[]> {
  return apiFetch(API_ENDPOINTS.SKU_VALIDATE, {
    method: "POST",
    body: JSON.stringify({ rows, templateId }),
  })
}

export async function checkSkuDuplicates(
  rows: Partial<SkuMetadataRow>[]
): Promise<SkuDuplicateResult[]> {
  return apiFetch(API_ENDPOINTS.SKU_CHECK_DUPLICATES, {
    method: "POST",
    body: JSON.stringify({ rows }),
  })
}

export async function generateSkuName(
  row: Partial<SkuMetadataRow>,
  options?: { pattern?: string; templateId?: number }
): Promise<{ name: string }> {
  return apiFetch(API_ENDPOINTS.SKU_GENERATE_NAME, {
    method: "POST",
    body: JSON.stringify({ row, ...options }),
  })
}

export type SkuImageType = "product" | "gallery"

export async function uploadSkuImage(
  file: File,
  imageType: SkuImageType,
  sku?: string
): Promise<{ url: string }> {
  const form = new FormData()
  form.append("file", file)
  form.append("imageType", imageType)
  if (sku) form.append("sku", sku)
  return apiFetch(API_ENDPOINTS.SKU_UPLOAD_IMAGE, {
    method: "POST",
    body: form,
  })
}

export async function submitSkusToSap(
  skus: string[]
): Promise<SkuSubmitToSapResult> {
  return apiFetch(API_ENDPOINTS.SKU_SUBMIT_TO_SAP, {
    method: "POST",
    body: JSON.stringify({ skus }),
  })
}

export async function importSapItemsToCleanup(
  itemCodes: string[]
): Promise<SkuImportResult> {
  return apiFetch(API_ENDPOINTS.SKU_IMPORT_SAP_ITEMS, {
    method: "POST",
    body: JSON.stringify({ itemCodes }),
  })
}

export async function fetchCleanupStats(): Promise<SkuCleanupStats> {
  return apiFetch(API_ENDPOINTS.SKU_CLEANUP_STATS)
}

export interface SkuImportAllParams {
  /** Scope to products matching this sku/name term — mirrors the importable-items preview filter */
  search?: string
  /** Skip these SKUs even though they're otherwise importable (deselected in the picker) */
  excludedSkus?: string[]
}

export async function importAllSapItemsToCleanup(
  params: SkuImportAllParams = {}
): Promise<SkuImportAllResult> {
  return apiFetch(API_ENDPOINTS.SKU_IMPORT_ALL_SAP_ITEMS, {
    method: "POST",
    body: JSON.stringify(params),
  })
}

export interface SkuImportableSapItemsParams {
  search?: string
  page?: number
  pageSize?: number
}

export async function fetchImportableSapItems(
  params: SkuImportableSapItemsParams = {}
): Promise<SkuImportableSapItemsResponse> {
  const qs = new URLSearchParams()
  if (params.search) qs.set("search", params.search)
  if (params.page) qs.set("page", String(params.page))
  if (params.pageSize) qs.set("pageSize", String(params.pageSize))
  const query = qs.toString()
  return apiFetch(`${API_ENDPOINTS.SKU_IMPORTABLE_SAP_ITEMS}${query ? `?${query}` : ""}`)
}

export interface SkuBulkDeleteParams {
  /** Explicit SKU list (page-level selection). If provided, filters are ignored. */
  skus?: string[]
  /** Filter-based delete (select-all mode). Requires at least workflowType. */
  workflowType?: "new_creation" | "cleanup"
  status?: string
  search?: string
  /** In select-all mode: SKUs to exclude from the filter-based delete. */
  excludedSkus?: string[]
}

export interface SkuBulkDeleteResult {
  deleted: number
}

export async function bulkDeleteSkuMetadataItems(
  params: SkuBulkDeleteParams
): Promise<SkuBulkDeleteResult> {
  return apiFetch(API_ENDPOINTS.SKU_METADATA_BULK_DELETE, {
    method: "DELETE",
    body: JSON.stringify(params),
  })
}

// ─── PDF extraction ──────────────────────────────────────────────────────────

export interface PdfExtractedProduct {
  internal_category: string | null
  supplier_name: string | null
  series: string | null
  color: string | null
  size: string | null
  finish: string | null
  product_image: string | null
  images: string[]
  country_of_origin: string | null
  order_quantity: string | null
  unit_of_measure: string | null
  quantity_per_carton: string | null
  quantity_per_pallet: string | null
  shade: string | null
  supplier_code: string | null
  name_english: string | null
  series_english: string | null
  color_english: string | null
  supplier_sku: string | null
}

export interface PdfExtractedEntry {
  product: PdfExtractedProduct
  sources: Partial<Record<keyof PdfExtractedProduct, string>>
  docs: string[]
  missing_required: string[]
  complete: boolean
}

export interface PdfExtractResponse {
  products: PdfExtractedEntry[]
  total: number
  complete: number
}

export interface PdfExtractJobStatus {
  job_id: string
  status: "processing" | "done" | "failed"
  total_files: number
  total_pages: number
  completed_pages: number
  result: PdfExtractResponse | null
  error: string | null
}

// The base URL for local dev — when set, requests go directly to the Python server.
const DEV_PYTHON_URL = (import.meta.env.VITE_PDF_EXTRACT_URL as string | undefined)?.trim() || null

async function _startPdfExtractJob(files: File[]): Promise<Pick<PdfExtractJobStatus, "job_id" | "status" | "total_files" | "total_pages" | "completed_pages">> {
  const form = new FormData()
  for (const file of files) form.append("pdfs", file)

  if (DEV_PYTHON_URL) {
    const res = await fetch(`${DEV_PYTHON_URL}/start-batch`, { method: "POST", body: form })
    if (!res.ok) throw new Error(`Failed to start extraction (${res.status})`)
    return res.json()
  }

  return apiFetch(API_ENDPOINTS.SKU_EXTRACT_PDF, { method: "POST", body: form })
}

async function _pollPdfExtractJob(jobId: string): Promise<PdfExtractJobStatus> {
  if (DEV_PYTHON_URL) {
    const res = await fetch(`${DEV_PYTHON_URL}/job/${encodeURIComponent(jobId)}`)
    if (!res.ok) throw new Error(`Poll failed (${res.status})`)
    return res.json()
  }

  return apiFetch(`${API_ENDPOINTS.SKU_EXTRACT_JOB}/${encodeURIComponent(jobId)}`)
}

export type PdfExtractStatus = "idle" | "uploading" | "processing" | "done" | "failed"

export interface UsePdfExtractJobReturn {
  status: PdfExtractStatus
  progress: { completedPages: number; totalPages: number; totalFiles: number }
  result: PdfExtractResponse | null
  error: string | null
  start: (files: File[]) => Promise<void>
  reset: () => void
}

export function usePdfExtractJob(): UsePdfExtractJobReturn {
  const [status, setStatus] = useState<PdfExtractStatus>("idle")
  const [progress, setProgress] = useState({ completedPages: 0, totalPages: 0, totalFiles: 0 })
  const [result, setResult] = useState<PdfExtractResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  const reset = useCallback(() => {
    stopPolling()
    jobIdRef.current = null
    setStatus("idle")
    setProgress({ completedPages: 0, totalPages: 0, totalFiles: 0 })
    setResult(null)
    setError(null)
  }, [])

  useEffect(() => () => stopPolling(), [])

  const start = useCallback(async (files: File[]) => {
    reset()
    setStatus("uploading")

    let jobData: Awaited<ReturnType<typeof _startPdfExtractJob>>
    try {
      jobData = await _startPdfExtractJob(files)
    } catch (err) {
      setStatus("failed")
      setError(err instanceof Error ? err.message : "Failed to start extraction")
      return
    }

    jobIdRef.current = jobData.job_id
    setStatus("processing")
    setProgress({ completedPages: 0, totalPages: 0, totalFiles: jobData.total_files })

    pollIntervalRef.current = setInterval(async () => {
      if (!jobIdRef.current) return
      try {
        const s = await _pollPdfExtractJob(jobIdRef.current)
        setProgress({
          completedPages: s.completed_pages,
          totalPages: s.total_pages,
          totalFiles: s.total_files,
        })
        if (s.status === "done") {
          stopPolling()
          setResult(s.result)
          setStatus("done")
        } else if (s.status === "failed") {
          stopPolling()
          setError(s.error ?? "Extraction failed")
          setStatus("failed")
        }
      } catch (err) {
        // transient poll failure — keep trying
        console.warn("[PDF extract poll]", err)
      }
    }, 2000)
  }, [reset])

  return { status, progress, result, error, start, reset }
}

// ─── React Query hooks ───────────────────────────────────────────────────────

export function useSkuMetadataListQuery(filters: SkuMetadataFilters = {}) {
  return useQuery({
    queryKey: skuQueryKeys.metadata.list(filters),
    queryFn: () => fetchSkuMetadataList(filters),
  })
}

const INFINITE_PAGE_SIZE = 100

// Infinite-scroll variant — `page` is managed internally by React Query as
// the fetch cursor, not passed in by the caller. `filters` should NOT
// include `page`/`pageSize`; pageSize is fixed at INFINITE_PAGE_SIZE so the
// "load next 100 near the bottom" behavior is consistent everywhere it's used.
export function useSkuMetadataInfiniteQuery(filters: Omit<SkuMetadataFilters, "page" | "pageSize"> = {}) {
  return useInfiniteQuery({
    queryKey: skuQueryKeys.metadata.infiniteList(filters),
    queryFn: ({ pageParam }) =>
      fetchSkuMetadataList({ ...filters, page: pageParam, pageSize: INFINITE_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  })
}

export function useSkuMetadataQuery(sku: string) {
  return useQuery({
    queryKey: skuQueryKeys.metadata.byId(sku),
    queryFn: () => fetchSkuMetadata(sku),
    enabled: !!sku,
  })
}

export function useSkuAuditLogQuery(sku: string) {
  return useQuery({
    queryKey: skuQueryKeys.metadata.auditLog(sku),
    queryFn: () => fetchSkuAuditLog(sku),
    enabled: !!sku,
  })
}

export function useSkuDropdownsQuery() {
  return useQuery({
    queryKey: skuQueryKeys.dropdowns.all,
    queryFn: fetchSkuDropdowns,
    staleTime: 5 * 60 * 1000,
  })
}

export function useSkuTemplatesQuery() {
  return useQuery({
    queryKey: skuQueryKeys.templates.all,
    queryFn: fetchSkuTemplates,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCleanupStatsQuery() {
  return useQuery({
    queryKey: skuQueryKeys.cleanupStats,
    queryFn: fetchCleanupStats,
  })
}

export function useImportableSapItemsQuery(params: SkuImportableSapItemsParams, enabled = true) {
  return useQuery({
    queryKey: skuQueryKeys.importableSapItems(params),
    queryFn: () => fetchImportableSapItems(params),
    enabled,
  })
}

export function useSkuBulkUpsertMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rows: Partial<SkuMetadataRow>[]) => bulkUpsertSkuMetadata(rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skuQueryKeys.metadata.all })
      qc.invalidateQueries({ queryKey: skuQueryKeys.cleanupStats })
    },
  })
}

export function useSkuDeleteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sku: string) => deleteSkuMetadata(sku),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skuQueryKeys.metadata.all })
    },
  })
}

export function useSkuBulkDeleteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: SkuBulkDeleteParams) => bulkDeleteSkuMetadataItems(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skuQueryKeys.metadata.all })
      qc.invalidateQueries({ queryKey: skuQueryKeys.cleanupStats })
    },
  })
}

export function useSkuValidateMutation() {
  return useMutation({
    mutationFn: ({
      rows,
      templateId,
    }: {
      rows: Partial<SkuMetadataRow>[]
      templateId?: number
    }) => validateSkuRows(rows, templateId),
  })
}

export function useSkuCheckDuplicatesMutation() {
  return useMutation({
    mutationFn: (rows: Partial<SkuMetadataRow>[]) => checkSkuDuplicates(rows),
  })
}

export function useSkuGenerateNameMutation() {
  return useMutation({
    mutationFn: ({
      row,
      templateId,
    }: {
      row: Partial<SkuMetadataRow>
      templateId?: number
    }) => generateSkuName(row, { templateId }),
  })
}

export function useSkuSubmitToSapMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skus: string[]) => submitSkusToSap(skus),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skuQueryKeys.metadata.all })
    },
  })
}

export function useImportSapItemsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemCodes: string[]) => importSapItemsToCleanup(itemCodes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skuQueryKeys.metadata.all })
      qc.invalidateQueries({ queryKey: skuQueryKeys.cleanupStats })
      qc.invalidateQueries({ queryKey: ["sku", "importable-sap-items"] })
    },
  })
}

export function useImportAllSapItemsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: SkuImportAllParams = {}) => importAllSapItemsToCleanup(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skuQueryKeys.metadata.all })
      qc.invalidateQueries({ queryKey: skuQueryKeys.cleanupStats })
      qc.invalidateQueries({ queryKey: ["sku", "importable-sap-items"] })
    },
  })
}

export function useCreateSkuDropdownValueMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Omit<SkuDropdownValue, "id" | "created_at">) =>
      createSkuDropdownValue(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: skuQueryKeys.dropdowns.all }),
  })
}

export function useUpdateSkuDropdownValueMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SkuDropdownValue> }) =>
      updateSkuDropdownValue(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: skuQueryKeys.dropdowns.all }),
  })
}

export function useDeleteSkuDropdownValueMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteSkuDropdownValue(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: skuQueryKeys.dropdowns.all }),
  })
}

// No invalidation — this only suggests text for the add-value form, it
// never touches stored data.
export function useSuggestSkuDropdownLabelsMutation() {
  return useMutation({
    mutationFn: ({ value, fieldKey }: { value: string; fieldKey: string }) =>
      suggestSkuDropdownLabels(value, fieldKey),
  })
}

export function useCreateSkuTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Omit<SkuTemplate, "id" | "created_at">) =>
      createSkuTemplate(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: skuQueryKeys.templates.all }),
  })
}

// ─── Autocomplete hints ───────────────────────────────────────────────────────

export async function fetchSkuAutocompleteHints(): Promise<SkuAutocompleteHints> {
  return apiFetch(API_ENDPOINTS.SKU_AUTOCOMPLETE_HINTS)
}

export function useSkuAutocompleteHintsQuery() {
  return useQuery({
    queryKey: skuQueryKeys.autocompleteHints,
    queryFn:  fetchSkuAutocompleteHints,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateSkuTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SkuTemplate> }) =>
      updateSkuTemplate(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: skuQueryKeys.templates.all }),
  })
}

