import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { skuQueryKeys } from "./queryKeys"
import type {
  SkuAuditEntry,
  SkuBulkUpsertResponse,
  SkuCleanupStats,
  SkuDuplicateResult,
  SkuDropdownMap,
  SkuDropdownValue,
  SkuImportResult,
  SkuImportAllResult,
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

export async function importAllSapItemsToCleanup(): Promise<SkuImportAllResult> {
  return apiFetch(API_ENDPOINTS.SKU_IMPORT_ALL_SAP_ITEMS, { method: "POST" })
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

// ─── React Query hooks ───────────────────────────────────────────────────────

export function useSkuMetadataListQuery(filters: SkuMetadataFilters = {}) {
  return useQuery({
    queryKey: skuQueryKeys.metadata.list(filters),
    queryFn: () => fetchSkuMetadataList(filters),
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
    },
  })
}

export function useImportAllSapItemsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => importAllSapItemsToCleanup(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: skuQueryKeys.metadata.all })
      qc.invalidateQueries({ queryKey: skuQueryKeys.cleanupStats })
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

export function useCreateSkuTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Omit<SkuTemplate, "id" | "created_at">) =>
      createSkuTemplate(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: skuQueryKeys.templates.all }),
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
