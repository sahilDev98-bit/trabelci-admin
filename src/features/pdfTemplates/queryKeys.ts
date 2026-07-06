export const pdfTemplatesQueryKeys = {
  all:  ['pdf-templates'] as const,
  list: () => ['pdf-templates', 'list'] as const,
  byId: (id: string) => ['pdf-templates', id] as const,
}
