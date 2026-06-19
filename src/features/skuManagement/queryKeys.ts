import type { SkuMetadataFilters } from './types';

export const skuQueryKeys = {
  all: ['sku'] as const,

  metadata: {
    all: ['sku', 'metadata'] as const,
    list: (filters?: SkuMetadataFilters) =>
      ['sku', 'metadata', 'list', filters ?? {}] as const,
    byId: (sku: string) => ['sku', 'metadata', sku] as const,
    auditLog: (sku: string) => ['sku', 'metadata', sku, 'audit'] as const,
  },

  dropdowns: {
    all: ['sku', 'dropdowns'] as const,
  },

  templates: {
    all: ['sku', 'templates'] as const,
  },

  cleanupStats: ['sku', 'cleanup-stats'] as const,

  importableSapItems: (params?: { search?: string; page?: number; pageSize?: number }) =>
    ['sku', 'importable-sap-items', params ?? {}] as const,
};
