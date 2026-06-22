import type { SkuMetadataRow } from "@/features/skuManagement/types"

export interface SupplierPreset {
  id: string
  name: string
  defaults: Partial<SkuMetadataRow>
}

export const SUPPLIER_PRESETS: SupplierPreset[] = [
  {
    id: "1",
    name: "La Fabrica",
    defaults: {
      supplier: "La Fabrica",
      supplier_code: "LF-001",
      country_of_origin: "ES",
      display_name_en: "La Fabrica Ceramic Tile",
      supplier_sku: "LF-CERM-001",
      series: "Marble Pro",
      color: "White",
      size: "60x60 cm",
      finish: "Polished",
      shade: "Light",
      qty_per_carton: "10",
      qty_per_pallet: "120",
    },
  },
  {
    id: "2",
    name: "Atlas Concorde",
    defaults: {
      supplier: "Atlas Concorde",
      supplier_code: "AC-002",
      country_of_origin: "IT",
      display_name_en: "Atlas Concorde Stone Tile",
      supplier_sku: "AC-STN-002",
      series: "Marvel Stone",
      color: "Grey",
      size: "80x80 cm",
      finish: "Matt",
      shade: "Medium",
      qty_per_carton: "8",
      qty_per_pallet: "96",
    },
  },
  {
    id: "3",
    name: "Porcelanosa",
    defaults: {
      supplier: "Porcelanosa",
      supplier_code: "PC-003",
      country_of_origin: "ES",
      display_name_en: "Porcelanosa Floor Tile",
      supplier_sku: "PC-FLR-003",
      series: "Urban",
      color: "Beige",
      size: "45x90 cm",
      finish: "Natural",
      shade: "Warm",
      qty_per_carton: "6",
      qty_per_pallet: "72",
    },
  },
  {
    id: "4",
    name: "Marazzi",
    defaults: {
      supplier: "Marazzi",
      supplier_code: "MZ-004",
      country_of_origin: "IT",
      display_name_en: "Marazzi Wall Tile",
      supplier_sku: "MZ-WLL-004",
      series: "Grande Marble Look",
      color: "Cream",
      size: "120x120 cm",
      finish: "Lux",
      shade: "Light",
      qty_per_carton: "4",
      qty_per_pallet: "48",
    },
  },
  {
    id: "5",
    name: "Ragno",
    defaults: {
      supplier: "Ragno",
      supplier_code: "RG-005",
      country_of_origin: "IT",
      display_name_en: "Ragno Terracotta Tile",
      supplier_sku: "RG-TRC-005",
      series: "Terramix",
      color: "Brown",
      size: "30x30 cm",
      finish: "Rustic",
      shade: "Dark",
      qty_per_carton: "12",
      qty_per_pallet: "144",
    },
  },
]
