export const API_ENDPOINTS = {
  USERS: "/admin/users",
  MERCHANT_EMPLOYEES: "/merchant/employees",
  BUSINESS_PARTNERS: "/admin/business-partners",
  CATEGORIES: "/admin/categories",
  PRODUCTS: "/admin/products",
  PRODUCTS_FROM_SAP: "/admin/products/from-sap",
  PRODUCTS_REFRESH_FROM_SAP: "/admin/products/refresh-from-sap",
  PRODUCTS_SAP_PREVIEW: "/admin/products/sap-preview",
  PRODUCTS_SAP_SEARCH: "/admin/products/sap-search",
  PRODUCTS_IMPORT_FROM_SAP: "/admin/products/import-from-sap",
  // Base path for the rich, live-SAP-joined product detail (GET
  // /products/:sku) and its /telegram-images sub-route — NOT the same as
  // PRODUCTS above (that's the Supabase-mirror admin CRUD endpoint, keyed
  // on the internal numeric id, and doesn't carry Finish/Showroom/Warehouse
  // Bins/Quantity per Carton at all since those aren't synced columns).
  PRODUCT_SAP_DETAIL: "/products",
  PRODUCT_IMAGES: "/admin/product-images",
  PRODUCT_GROUPS: "/admin/product-groups",
  BUSINESS_PARTNER_ASSIGNMENTS: "/admin/merchants",
  MERCHANT_DASHBOARD_STATS: "/merchant/dashboard-stats",
  MERCHANT_PRICE_MULTIPLIER: "/merchant/price-multiplier",
  EMPLOYEE_DASHBOARD_STATS: "/employee/dashboard-stats",
  EMPLOYEE_PRODUCTS: "/employee/products",
  EMPLOYEE_PRODUCT_GROUPS: "/employee/product-groups",
  HOMEPAGE_CONFIG: "/admin/homepage/config",
  HOMEPAGE_CAROUSEL: "/admin/homepage/carousel",
  HOMEPAGE_CATEGORY_PINS: "/admin/homepage/category",
  BRANDING_CONFIG: "/admin/branding",
  BRANDING_ICONS: "/admin/branding/icons",
  WHATSAPP_TEMPLATES: "/admin/whatsapp-templates",
  WHATSAPP_TEMPLATE_DEFAULT: "/admin/whatsapp-templates/default",
  CATALOG_PRODUCTS: "/catalog/products",
  SIMILARITY_ANALYZE_ALL: "/admin/products/analyze-similarity-all",
  SIMILARITY_STATUS: "/admin/products/similarity-status",
  FIELD_VISIBILITY: "/admin/field-visibility",
  FIELD_VISIBILITY_FIELDS: "/admin/field-visibility/fields",
  FIELD_VISIBILITY_BP_USERS: "/admin/field-visibility/merchants",

  // SKU Management Platform
  SKU_METADATA: "/sku/metadata",
  SKU_METADATA_BULK: "/sku/metadata/bulk",
  SKU_METADATA_BULK_DELETE: "/sku/metadata/bulk",
  SKU_DROPDOWNS: "/sku/dropdowns",
  SKU_DROPDOWNS_SUGGEST_LABELS: "/sku/dropdowns/suggest-labels",
  SKU_TEMPLATES: "/sku/templates",
  SKU_VALIDATE: "/sku/validate",
  SKU_CHECK_DUPLICATES: "/sku/check-duplicates",
  SKU_GENERATE_NAME: "/sku/generate-name",
  SKU_UPLOAD_IMAGE: "/sku/upload-image",
  SKU_SUBMIT_TO_SAP: "/sku/submit-to-sap",
  SKU_IMPORT_SAP_ITEMS: "/sku/import-sap-items",
  SKU_IMPORT_ALL_SAP_ITEMS: "/sku/import-all-sap-items",
  SKU_IMPORTABLE_SAP_ITEMS: "/sku/importable-sap-items",
  SKU_CLEANUP_STATS: "/sku/cleanup-stats",
  SKU_AUDIT_LOG: "/sku/audit-log",
  SKU_AUTOCOMPLETE_HINTS: "/sku/autocomplete-hints",
  SKU_EXTRACT_PDF: "/sku/extract-pdf",
  SKU_EXTRACT_JOB: "/sku/extract-job",

  // PDF Templates
  PDF_TEMPLATES: "/pdf-templates",
  PDF_TEMPLATES_FROM_PDF: "/pdf-templates/from-pdf",
  PDF_ASSETS: "/pdf-assets",
  PDF_PAGE_TEMPLATES: "/pdf-page-templates",

  // PDF Master (in-place PDF editing)
  PDF_MASTER_TEMPLATES: "/pdf-master/templates",

  // AI image generation (Generate AI Images — independent nav item)
  AI_IMAGES_GENERATE: "/ai-images/generate",
} as const
