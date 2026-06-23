export type SkuWorkflowType = 'new_creation' | 'cleanup';

export type SkuStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'created_in_sap'
  | 'cleanup_only'
  | 'deleted';

export type SkuValidationStatus = 'red' | 'yellow' | 'green' | 'unchecked';

export interface SkuMetadataRow {
  sku: string;
  workflow_type: SkuWorkflowType;
  status: SkuStatus;

  supplier?: string;
  supplier_code?: string;
  supplier_sku?: string;
  series?: string;
  series_en?: string;
  color?: string;
  color_en?: string;
  size?: string;
  finish?: string;
  country_of_origin?: string;
  shade?: string;
  qty_per_carton?: string;
  qty_per_pallet?: string;

  display_name_en?: string;

  // Image URLs — files live in Cloudflare R2; both fields hold multiple URLs
  // (mirrors the product table's cover_url + images pattern)
  product_image_urls?: string[];
  gallery_image_urls?: string[];

  original_sap_name?: string;
  original_sap_description?: string;

  sap_created_at?: string;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;

  // Transient wire field — set only when saving a row whose SKU the user
  // edited; tells the backend to rename the stored record instead of
  // inserting a new one. Never persisted.
  previous_sku?: string;

  // Client-only — not persisted
  _validationStatus?: SkuValidationStatus;
  _validationErrors?: SkuValidationError[];
  _validationWarnings?: SkuValidationError[];
  _duplicates?: SkuDuplicate[];
  _isDirty?: boolean;
  _clientId?: string;
  /** SKU this row is currently stored under in the DB (set on load/save) */
  _savedSku?: string;
}

export interface SkuValidationError {
  field: string;
  message: string;
}

export interface SkuDuplicate {
  type:
    | 'exact_sku'           // same SKU in sku_metadata, or repeated within the batch
    | 'existing_product'    // SKU exists in the synced product table
    | 'sap_itemcode'        // ItemCode exists in SAP (OITM, direct check)
    | 'structural'          // same series/color/size/finish within the batch
    | 'structural_existing' // same structure as an already-saved record
    | 'supplier_code'       // same supplier code (secondary signal, never blocks)
  message: string;
  matchedSku: string;
}

export interface SkuValidationResult {
  sku: string;
  status: SkuValidationStatus;
  errors: SkuValidationError[];
  warnings: SkuValidationError[];
}

export interface SkuDuplicateResult {
  sku: string;
  duplicates: SkuDuplicate[];
}

export interface SkuDropdownValue {
  id: number;
  field_key: string;
  value: string;
  label_en?: string;
  label_he?: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
}

export type SkuDropdownMap = Record<string, SkuDropdownValue[]>;

export interface SkuTemplate {
  id: number;
  name: string;
  description?: string;
  name_pattern?: string;
  required_fields: string[];
  recommended_fields: string[];
  is_default: boolean;
  created_at?: string;
}

export interface SkuAuditEntry {
  id: number;
  sku: string;
  field_name: string;
  old_value?: string;
  new_value?: string;
  changed_by?: string;
  changed_at: string;
  source: string;
}

export interface SkuMetadataListResponse {
  rows: SkuMetadataRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SkuBulkUpsertResponse {
  saved: number;
  rows: SkuMetadataRow[];
}

export interface SkuImportResult {
  imported: SkuMetadataRow[];
  skipped: string[];
  failed: Array<{ sku: string; error: string }>;
}

export interface SkuSubmitToSapResult {
  /** sku = final SAP ItemCode; originalSku = the sheet's SKU before SAP
   *  auto-assignment (differs for NEW-… rows) */
  created: Array<{ sku: string; originalSku?: string; sapResponse: unknown }>;
  failed: Array<{ sku: string; error: string }>;
}

export interface SkuCleanupStats {
  total: number;
  cleaned: number;
  pending: number;
  bySupplier: Record<string, { total: number; cleaned: number }>;
  productTotal?: number;
  importable?: number;
}

export interface SkuImportAllResult {
  imported: number;
  skipped: number;
  failed: number;
}

export interface SkuImportableSapItem {
  sku: string;
  name: string | null;
  size?: string | null;
  unitPrice?: number | null;
  dealerPrice?: number | null;
  stockQuantity?: number | null;
}

export interface SkuImportableSapItemsResponse {
  items: SkuImportableSapItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type SkuCleanupStatusTab = 'pending' | 'cleaned' | 'all';

export interface SkuSupplierHints {
  supplier_code:     string | null;
  country_of_origin: string | null;
  series:            string[];
  seriesEnMap:       Record<string, string>;
  colors:            string[];
  colorEnMap:        Record<string, string>;
  finishes:          string[];
  displayNames:      string[];
  qtyPerCarton:      string[];
  qtyPerPallet:      string[];
  combinations: Array<{
    series:          string;
    color:           string;
    series_en:       string | null;
    color_en:        string | null;
    display_name_en: string;
  }>;
}

export interface SkuAutocompleteHints {
  suppliers:  string[];
  bySupplier: Record<string, SkuSupplierHints>;
}

export interface SkuMetadataFilters {
  workflowType?: SkuWorkflowType;
  status?: SkuStatus;
  page?: number;
  pageSize?: number;
  search?: string;
}
