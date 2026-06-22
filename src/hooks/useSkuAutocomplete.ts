import { useMemo } from 'react'
import type { SkuAutocompleteHints, SkuSupplierHints, SkuMetadataRow } from '@/features/skuManagement/types'

export interface SkuAutocompleteAPI {
  supplierSuggestions:                        string[]
  getSeriesSuggestions(supplier: string):     string[]
  getColorSuggestions(supplier: string):      string[]
  getFinishSuggestions(supplier: string):     string[]
  getSeriesEnSuggestions(supplier: string):   string[]
  getColorEnSuggestions(supplier: string):    string[]
  getDisplayNameSuggestions(supplier: string): string[]
  getQtyPerCartonSuggestions(supplier: string): string[]
  getQtyPerPalletSuggestions(supplier: string): string[]
  getSupplierCodeSuggestions():               string[]
  getCascadeFill(
    changedField: string,
    newValue:     string,
    currentRow:   SkuMetadataRow
  ): Partial<SkuMetadataRow> | null
}

const EMPTY_HINTS: SkuAutocompleteHints = { suppliers: [], bySupplier: {} }

export function useSkuAutocomplete(
  dbHints:     SkuAutocompleteHints | undefined,
  currentRows: SkuMetadataRow[]
): SkuAutocompleteAPI {

  const mergedHints = useMemo<SkuAutocompleteHints>(() => {
    const base = dbHints ?? EMPTY_HINTS
    const merged: SkuAutocompleteHints = {
      suppliers:  [...base.suppliers],
      bySupplier: { ...base.bySupplier },
    }

    for (const row of currentRows) {
      const s = row.supplier?.trim()
      if (!s) continue

      if (!merged.bySupplier[s]) {
        merged.suppliers.push(s)
        merged.bySupplier[s] = {
          supplier_code:     row.supplier_code     ?? null,
          country_of_origin: row.country_of_origin ?? null,
          series:        [],
          seriesEnMap:   {},
          colors:        [],
          colorEnMap:    {},
          finishes:      [],
          displayNames:  [],
          qtyPerCarton:  [],
          qtyPerPallet:  [],
          combinations:  [],
        }
      }

      const e = merged.bySupplier[s]

      if (!e.supplier_code     && row.supplier_code)     e.supplier_code     = row.supplier_code
      if (!e.country_of_origin && row.country_of_origin) e.country_of_origin = row.country_of_origin

      if (row.series    && !e.series.includes(row.series))           e.series.push(row.series)
      if (row.series    && row.series_en)                            e.seriesEnMap[row.series] = row.series_en
      if (row.color     && !e.colors.includes(row.color))            e.colors.push(row.color)
      if (row.color     && row.color_en)                             e.colorEnMap[row.color]   = row.color_en
      if (row.finish    && !e.finishes.includes(row.finish))         e.finishes.push(row.finish)
      if (row.display_name_en && !e.displayNames.includes(row.display_name_en)) e.displayNames.push(row.display_name_en)
      if (row.qty_per_carton  && !e.qtyPerCarton.includes(row.qty_per_carton))  e.qtyPerCarton.push(row.qty_per_carton)
      if (row.qty_per_pallet  && !e.qtyPerPallet.includes(row.qty_per_pallet))  e.qtyPerPallet.push(row.qty_per_pallet)

      if (row.series && row.color && row.display_name_en) {
        const exists = e.combinations.some(c => c.series === row.series && c.color === row.color)
        if (!exists) {
          e.combinations.push({
            series:          row.series,
            color:           row.color,
            series_en:       row.series_en  ?? null,
            color_en:        row.color_en   ?? null,
            display_name_en: row.display_name_en,
          })
        }
      }
    }

    return merged
  }, [dbHints, currentRows])

  // Flat list of all known supplier codes (one per supplier)
  const allSupplierCodes = useMemo(() =>
    Object.values(mergedHints.bySupplier)
      .map(sh => sh.supplier_code)
      .filter((c): c is string => Boolean(c))
      .filter((c, i, a) => a.indexOf(c) === i)
      .sort(),
    [mergedHints]
  )

  return useMemo<SkuAutocompleteAPI>(() => ({
    supplierSuggestions: mergedHints.suppliers,

    getSeriesSuggestions:      (supplier) => mergedHints.bySupplier[supplier]?.series        ?? [],
    getColorSuggestions:       (supplier) => mergedHints.bySupplier[supplier]?.colors        ?? [],
    getFinishSuggestions:      (supplier) => mergedHints.bySupplier[supplier]?.finishes      ?? [],
    getSeriesEnSuggestions:    (supplier) => Object.values(mergedHints.bySupplier[supplier]?.seriesEnMap ?? {}),
    getColorEnSuggestions:     (supplier) => Object.values(mergedHints.bySupplier[supplier]?.colorEnMap  ?? {}),
    getDisplayNameSuggestions: (supplier) => mergedHints.bySupplier[supplier]?.displayNames  ?? [],
    getQtyPerCartonSuggestions:(supplier) => mergedHints.bySupplier[supplier]?.qtyPerCarton  ?? [],
    getQtyPerPalletSuggestions:(supplier) => mergedHints.bySupplier[supplier]?.qtyPerPallet  ?? [],
    getSupplierCodeSuggestions: ()        => allSupplierCodes,

    getCascadeFill(changedField, newValue, currentRow) {
      const fill: Partial<SkuMetadataRow> = {}
      const hints = mergedHints.bySupplier

      if (changedField === 'supplier') {
        const sh: SkuSupplierHints | undefined = hints[newValue]
        if (sh?.country_of_origin) fill.country_of_origin = sh.country_of_origin
        if (sh?.supplier_code)     fill.supplier_code     = sh.supplier_code
        // If supplier consistently uses a single display name, fill it immediately
        if (!currentRow.display_name_en && sh?.displayNames.length === 1) {
          fill.display_name_en = sh.displayNames[0]
        }
      }

      const activeSupplier = changedField === 'supplier' ? newValue : (currentRow.supplier ?? '')
      const sh = activeSupplier ? hints[activeSupplier] : undefined

      // series committed → fill series_en via map (reliable, no index bugs)
      if (changedField === 'series' && sh) {
        const seriesEn = sh.seriesEnMap[newValue]
        if (seriesEn) fill.series_en = seriesEn
      }

      // color committed → fill color_en via map
      if (changedField === 'color' && sh) {
        const colorEn = sh.colorEnMap[newValue]
        if (colorEn) fill.color_en = colorEn
      }

      // supplier + series + color all known → fill display_name_en (only if still empty)
      const series = changedField === 'series' ? newValue : (currentRow.series ?? '')
      const color  = changedField === 'color'  ? newValue : (currentRow.color  ?? '')
      const pendingDisplayName = fill.display_name_en

      if (!currentRow.display_name_en && !pendingDisplayName && activeSupplier && series && color && sh) {
        const combo = sh.combinations.find(c => c.series === series && c.color === color)
        if (combo?.display_name_en) fill.display_name_en = combo.display_name_en
      }

      return Object.keys(fill).length > 0 ? fill : null
    },
  }), [mergedHints, allSupplierCodes])
}
