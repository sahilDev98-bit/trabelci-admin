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

  company?: string;
  supplier?: string;
  series?: string;
  model?: string;
  color?: string;
  size?: string;
  finish?: string;
  surface_type?: string;
  r_rating?: string;
  thickness?: string;
  country_of_origin?: string;
  category?: string;
  subcategory?: string;
  product_type?: string;

  display_name_en?: string;
  display_name_he?: string;
  sap_item_name?: string;
  internal_notes?: string;

  original_sap_name?: string;
  original_sap_description?: string;

  sap_created_at?: string;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;

  // Client-only — not persisted
  _validationStatus?: SkuValidationStatus;
  _validationErrors?: SkuValidationError[];
  _validationWarnings?: SkuValidationError[];
  _duplicates?: SkuDuplicate[];
  _isDirty?: boolean;
}

export interface SkuValidationError {
  field: string;
  message: string;
}

export interface SkuDuplicate {
  type: 'exact_sku' | 'existing_product' | 'structural';
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
  created: Array<{ sku: string; sapResponse: unknown }>;
  failed: Array<{ sku: string; error: string }>;
}

export interface SkuCleanupStats {
  total: number;
  cleaned: number;
  pending: number;
  byCompany: Record<string, { total: number; cleaned: number }>;
}

export interface SkuMetadataFilters {
  workflowType?: SkuWorkflowType;
  status?: SkuStatus;
  page?: number;
  pageSize?: number;
  search?: string;
}
