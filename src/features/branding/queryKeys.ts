export const brandingQueryKeys = {
  all: ["branding"] as const,
  config: (businessPartnerId: string) => ["branding", "config", businessPartnerId] as const,
  icons: ["branding", "icons"] as const,
} as const
