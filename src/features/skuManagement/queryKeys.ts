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
  autocompleteHints: ['sku', 'autocomplete-hints'] as const,
};
