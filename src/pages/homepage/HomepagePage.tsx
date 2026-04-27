import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { PlusIcon, SaveIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useHomepageConfigQuery, useUpdateCarouselMutation, useUpdateCategoryPinsMutation } from "@/features/homepage/api"
import { useCategoriesQuery } from "@/features/categories/api"
import { ProductPicker } from "./components/ProductPicker"
import { SortableProductList } from "./components/SortableProductList"
import type { SortableProduct } from "./components/SortableProductList"

export function HomepagePage() {
  const { t } = useTranslation()
  const configQuery = useHomepageConfigQuery()
  const categoriesQuery = useCategoriesQuery()
  const updateCarouselMutation = useUpdateCarouselMutation()
  const updateCategoryPinsMutation = useUpdateCategoryPinsMutation()

  // ── Carousel state ───────────────────────────────────────────────────────
  const [carouselItems, setCarouselItems] = useState<SortableProduct[]>([])
  const [carouselDirty, setCarouselDirty] = useState(false)
  const [carouselPickerOpen, setCarouselPickerOpen] = useState(false)

  // ── Category pins state ──────────────────────────────────────────────────
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [categoryPinItems, setCategoryPinItems] = useState<SortableProduct[]>([])
  const [categoryPinsDirty, setCategoryPinsDirty] = useState(false)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)

  // Sync carousel items from server
  useEffect(() => {
    if (configQuery.data) {
      setCarouselItems(
        configQuery.data.carousel.map((item) => ({
          id: item.product.id,
          sku: item.product.sku,
          name: item.product.name,
          coverUrl: item.product.coverUrl,
        })),
      )
      setCarouselDirty(false)
    }
  }, [configQuery.data])

  // Sync category pin items when category selection changes or data loads
  useEffect(() => {
    if (configQuery.data && selectedCategoryId) {
      const pins = configQuery.data.categoryPins[selectedCategoryId] ?? []
      setCategoryPinItems(
        pins.map((pin) => ({
          id: pin.product.id,
          sku: pin.product.sku,
          name: pin.product.name,
          coverUrl: pin.product.coverUrl,
        })),
      )
      setCategoryPinsDirty(false)
    }
  }, [configQuery.data, selectedCategoryId])

  const carouselExcludeIds = useMemo(() => new Set(carouselItems.map((i) => i.id)), [carouselItems])
  const categoryPinExcludeIds = useMemo(() => new Set(categoryPinItems.map((i) => i.id)), [categoryPinItems])

  const visibleCategories = useMemo(
    () => (categoriesQuery.data ?? []).filter((c) => !c.isHidden),
    [categoriesQuery.data],
  )

  // ── Carousel handlers ────────────────────────────────────────────────────

  const handleCarouselReorder = (items: SortableProduct[]) => {
    setCarouselItems(items)
    setCarouselDirty(true)
  }

  const handleCarouselRemove = (productId: string) => {
    setCarouselItems((prev) => prev.filter((i) => i.id !== productId))
    setCarouselDirty(true)
  }

  const handleCarouselAdd = (product: SortableProduct) => {
    setCarouselItems((prev) => [...prev, product])
    setCarouselDirty(true)
    setCarouselPickerOpen(false)
  }

  const handleCarouselSave = async () => {
    try {
      const productIds = carouselItems.map((i) => Number(i.id))
      await updateCarouselMutation.mutateAsync(productIds)
      setCarouselDirty(false)
      toast.success(t("homepage.carouselSaved", "Carousel saved successfully"))
    } catch {
      toast.error(t("homepage.carouselSaveError", "Failed to save carousel"))
    }
  }

  // ── Category pin handlers ────────────────────────────────────────────────

  const handleCategoryPinReorder = (items: SortableProduct[]) => {
    setCategoryPinItems(items)
    setCategoryPinsDirty(true)
  }

  const handleCategoryPinRemove = (productId: string) => {
    setCategoryPinItems((prev) => prev.filter((i) => i.id !== productId))
    setCategoryPinsDirty(true)
  }

  const handleCategoryPinAdd = (product: SortableProduct) => {
    setCategoryPinItems((prev) => [...prev, product])
    setCategoryPinsDirty(true)
    setCategoryPickerOpen(false)
  }

  const handleCategoryPinsSave = async () => {
    if (!selectedCategoryId) return
    try {
      const productIds = categoryPinItems.map((i) => Number(i.id))
      await updateCategoryPinsMutation.mutateAsync({
        categoryId: selectedCategoryId,
        productIds,
      })
      setCategoryPinsDirty(false)
      toast.success(t("homepage.categoryPinsSaved", "Category pins saved successfully"))
    } catch {
      toast.error(t("homepage.categoryPinsSaveError", "Failed to save category pins"))
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────

  if (configQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
        <span>{t("common.loadingEntity", { entity: "homepage configuration" })}</span>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      {/* ── Section 1: Carousel ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>{t("homepage.carouselTitle", "Promotional Carousel")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("homepage.carouselDesc", "Choose which products appear in the promotional banner carousel on the home screen. Drag to reorder.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCarouselPickerOpen(true)}>
              <PlusIcon className="size-4" />
              {t("homepage.addProduct", "Add Product")}
            </Button>
            <Button
              size="sm"
              disabled={!carouselDirty || updateCarouselMutation.isPending}
              onClick={handleCarouselSave}
            >
              {updateCarouselMutation.isPending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SaveIcon className="size-4" />
              )}
              {t("common.save", "Save")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <SortableProductList
            items={carouselItems}
            onReorder={handleCarouselReorder}
            onRemove={handleCarouselRemove}
          />
        </CardContent>
      </Card>

      {/* ── Section 2: Category Pins ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>{t("homepage.categoryPinsTitle", "Category Featured Products")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("homepage.categoryPinsDesc", "Pin specific products to appear first in a category section on the home screen. Remaining slots are filled automatically.")}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-3">
            <Select
              value={selectedCategoryId ?? ""}
              onValueChange={(value) => setSelectedCategoryId(value || null)}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder={t("homepage.selectCategory", "Select a category...")} />
              </SelectTrigger>
              <SelectContent>
                {visibleCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedCategoryId && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setCategoryPickerOpen(true)}>
                  <PlusIcon className="size-4" />
                  {t("homepage.addProduct", "Add Product")}
                </Button>
                <Button
                  size="sm"
                  disabled={!categoryPinsDirty || updateCategoryPinsMutation.isPending}
                  onClick={handleCategoryPinsSave}
                >
                  {updateCategoryPinsMutation.isPending ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <SaveIcon className="size-4" />
                  )}
                  {t("common.save", "Save")}
                </Button>
              </div>
            )}
          </div>

          {selectedCategoryId ? (
            <SortableProductList
              items={categoryPinItems}
              onReorder={handleCategoryPinReorder}
              onRemove={handleCategoryPinRemove}
            />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("homepage.selectCategoryPrompt", "Select a category above to manage its featured products.")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <ProductPicker
        open={carouselPickerOpen}
        onOpenChange={setCarouselPickerOpen}
        onSelect={handleCarouselAdd}
        excludeIds={carouselExcludeIds}
      />

      <ProductPicker
        open={categoryPickerOpen}
        onOpenChange={setCategoryPickerOpen}
        onSelect={handleCategoryPinAdd}
        excludeIds={categoryPinExcludeIds}
        categoryId={selectedCategoryId}
      />
    </div>
  )
}
