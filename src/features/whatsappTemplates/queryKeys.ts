export const whatsappTemplateQueryKeys = {
  all: ["whatsappTemplates"] as const,
  list: () => [...whatsappTemplateQueryKeys.all, "list"] as const,
  default: () => [...whatsappTemplateQueryKeys.all, "default"] as const,
  byBp: (bpId: string) => [...whatsappTemplateQueryKeys.all, "bp", bpId] as const,
} as const
