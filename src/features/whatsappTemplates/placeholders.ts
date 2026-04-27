export interface PlaceholderDef {
  key: string
  labelKey: string
  sample: string
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  { key: "product_name", labelKey: "whatsappTemplates.placeholders.productName", sample: "Ceramic Tile Premium" },
  { key: "sku", labelKey: "whatsappTemplates.placeholders.sku", sample: "CT-PRE-001" },
  { key: "price", labelKey: "whatsappTemplates.placeholders.price", sample: "149.90" },
  { key: "stock_quantity", labelKey: "whatsappTemplates.placeholders.stockQuantity", sample: "250" },
  { key: "app_download_link", labelKey: "whatsappTemplates.placeholders.appDownloadLink", sample: "http://138.68.90.134:5001/download " },
  { key: "size", labelKey: "whatsappTemplates.placeholders.size", sample: "60x60" },
  { key: "category", labelKey: "whatsappTemplates.placeholders.category", sample: "Floor Tiles" },
  { key: "country_of_origin", labelKey: "whatsappTemplates.placeholders.countryOfOrigin", sample: "Italy" },
  { key: "finish", labelKey: "whatsappTemplates.placeholders.finish", sample: "Matte" },
  { key: "model", labelKey: "whatsappTemplates.placeholders.model", sample: "SMOKE" },
  { key: "version", labelKey: "whatsappTemplates.placeholders.version", sample: "ABK,ATLANTIS" },
]

export function renderPreview(template: string): string {
  const sampleMap: Record<string, string> = {}
  for (const p of PLACEHOLDERS) {
    sampleMap[p.key] = p.sample
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => sampleMap[key] ?? `{{${key}}}`)
}
