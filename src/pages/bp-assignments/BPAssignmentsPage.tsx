import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Eye, Package, Plus, Search, ShieldX, Trash2, Users } from "lucide-react"

import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { formatDate } from "@/lib/formatDate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { useBusinessPartnersQuery } from "@/features/businessPartners/api"
import { useProductGroupsQuery } from "@/features/productGroups/api"
import { useProductsQuery } from "@/features/products/api"
import {
  useBPAssignmentsQuery,
  useEffectiveProductsQuery,
  useAssignGroupsMutation,
  useRemoveGroupsMutation,
  useAssignProductsMutation,
  useRemoveProductsMutation,
  useExcludeProductsMutation,
  useRemoveExclusionsMutation,
} from "@/features/bpAssignments/api"
import type { ProductGroup } from "@/features/productGroups/types"
import type { Product } from "@/features/products/types"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabKey = "groups" | "products" | "exclusions"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterBySearchQuery<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) => getText(item).toLowerCase().includes(q))
}

// ---------------------------------------------------------------------------
// Selection Dialog (shared for groups and products)
// ---------------------------------------------------------------------------

interface SelectionDialogProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  items: T[]
  isLoading: boolean
  getKey: (item: T) => string
  getLabel: (item: T) => string
  getSubLabel?: (item: T) => string
  searchPlaceholder: string
  confirmLabel: string
  isPending: boolean
  onConfirm: (selectedIds: string[], startsAt?: string, expiresAt?: string) => void
}

function SelectionDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  items,
  isLoading,
  getKey,
  getLabel,
  getSubLabel,
  searchPlaceholder,
  confirmLabel,
  isPending,
  onConfirm,
}: SelectionDialogProps<T>) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [startsAt, setStartsAt] = useState<string>("")
  const [expiresAt, setExpiresAt] = useState<string>("")

  const filtered = useMemo(
    () => filterBySearchQuery(items, search, (item) => getLabel(item) + " " + (getSubLabel?.(item) ?? "")),
    [items, search, getLabel, getSubLabel],
  )

  const handleToggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleConfirm = () => {
    onConfirm(Array.from(selected), startsAt || undefined, expiresAt || undefined)
    setSelected(new Set())
    setSearch("")
    setStartsAt("")
    setExpiresAt("")
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelected(new Set())
      setSearch("")
      setStartsAt("")
      setExpiresAt("")
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex-1 overflow-y-auto border rounded-lg max-h-64 my-11">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("bpAssignments.noItemsFound")}</p>
          ) : (
            <div className="divide-y">
              {filtered.map((item) => {
                const id = getKey(item)
                const isSelected = selected.has(id)
                return (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
                      isSelected && "bg-primary/5",
                    )}
                    onClick={() => handleToggle(id)}
                  >
                    <div
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        isSelected ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {isSelected ? (
                        <svg className="size-3" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{getLabel(item)}</p>
                      {getSubLabel ? (
                        <p className="truncate text-xs text-muted-foreground">{getSubLabel(item)}</p>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-muted/30 px-3 py-2.5 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("bpAssignments.visibilityWindow")}
          </p>
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("bpAssignments.visibleFrom")}</label>
              <DateTimePicker
                value={startsAt || undefined}
                onChange={(iso) => setStartsAt(iso ?? "")}
                placeholder={t("bpAssignments.fromNow")}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("bpAssignments.visibleUntil")}</label>
              <DateTimePicker
                value={expiresAt || undefined}
                onChange={(iso) => setExpiresAt(iso ?? "")}
                placeholder={t("bpAssignments.forever")}
                minDate={startsAt ? new Date(startsAt) : undefined}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("bpAssignments.visibilityWindowHint")}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0 || isPending}
            onClick={handleConfirm}
          >
            {isPending ? t("common.saving") : `${confirmLabel} (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Visibility Window Cell
// ---------------------------------------------------------------------------

function VisibilityWindowCell({
  startsAt,
  expiresAt,
  t,
}: {
  startsAt: string | null
  expiresAt: string | null
  t: (key: string) => string
}) {
  const now = new Date()
  const start = startsAt ? new Date(startsAt) : null
  const end = expiresAt ? new Date(expiresAt) : null

  // Determine status
  const isExpired = end != null && end <= now
  const isPending = start != null && start > now
  const isActive = !isExpired && !isPending

  if (!start && !end) {
    return <Badge variant="secondary">{t("bpAssignments.lifetime")}</Badge>
  }

  return (
    <div className="space-y-0.5">
      {isExpired && <Badge variant="destructive">{t("bpAssignments.expired")}</Badge>}
      {isPending && <Badge variant="outline">{t("bpAssignments.scheduled")}</Badge>}
      {isActive && !isExpired && <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-200">{t("bpAssignments.active")}</Badge>}
      <p className="text-xs text-muted-foreground">
        {start ? `${t("bpAssignments.from")} ${formatDate(startsAt)}` : t("bpAssignments.fromNow")}
        {" → "}
        {end ? formatDate(expiresAt) : t("bpAssignments.forever")}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function BPAssignmentsPage() {
  const { t } = useTranslation()
  const [selectedBpId, setSelectedBpId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>("groups")
  const [showPreview, setShowPreview] = useState(false)

  // Dialog states
  const [assignGroupsOpen, setAssignGroupsOpen] = useState(false)
  const [addProductsOpen, setAddProductsOpen] = useState(false)
  const [addExclusionsOpen, setAddExclusionsOpen] = useState(false)

  // Tabs (inside component so t() is available)
  const tabs = useMemo(() => [
    { key: "groups" as TabKey, label: t("bpAssignments.assignedGroups"), icon: <Users className="size-4" /> },
    { key: "products" as TabKey, label: t("bpAssignments.individualProducts"), icon: <Package className="size-4" /> },
    { key: "exclusions" as TabKey, label: t("bpAssignments.excludedProducts"), icon: <ShieldX className="size-4" /> },
  ], [t])

  // Data queries
  const { data: businessPartners, isLoading: bpLoading } = useBusinessPartnersQuery()
  const { data: productGroups, isLoading: groupsLoading } = useProductGroupsQuery()
  const { data: allProducts, isLoading: productsLoading } = useProductsQuery()

  const {
    data: assignments,
    isLoading: assignmentsLoading,
    isError: assignmentsError,
    error: assignmentsErrorObj,
  } = useBPAssignmentsQuery(selectedBpId)


  const {
    data: effectiveProducts,
    isLoading: effectiveLoading,
    isError: effectiveError,
    error: effectiveErrorObj,
  } = useEffectiveProductsQuery(showPreview ? selectedBpId : null)

  // Mutations (only created when a business partner is selected)
  const bpIdForMutations = selectedBpId ?? ""
  const assignGroupsMutation = useAssignGroupsMutation(bpIdForMutations)
  const removeGroupsMutation = useRemoveGroupsMutation(bpIdForMutations)
  const assignProductsMutation = useAssignProductsMutation(bpIdForMutations)
  const removeProductsMutation = useRemoveProductsMutation(bpIdForMutations)
  const excludeProductsMutation = useExcludeProductsMutation(bpIdForMutations)
  const removeExclusionsMutation = useRemoveExclusionsMutation(bpIdForMutations)

  // Derived data: filter out already-assigned groups
  const assignedGroupIds = useMemo(
    () => new Set((assignments?.groups ?? []).map((g) => String(g.group_id))),
    [assignments],
  )
  const availableGroups = useMemo(
    () => (productGroups ?? []).filter((g) => !assignedGroupIds.has(g.id)),
    [productGroups, assignedGroupIds],
  )

  // Derived data: filter out already-assigned products
  const assignedProductIds = useMemo(
    () => new Set((assignments?.products ?? []).map((p) => String(p.product_id))),
    [assignments],
  )
  const availableProducts = useMemo(
    () => (allProducts ?? []).filter((p) => !assignedProductIds.has(p.id)),
    [allProducts, assignedProductIds],
  )

  // Derived data: filter out already-excluded products
  const excludedProductIds = useMemo(
    () => new Set((assignments?.exclusions ?? []).map((e) => String(e.product_id))),
    [assignments],
  )
  const availableForExclusion = useMemo(
    () => (allProducts ?? []).filter((p) => !excludedProductIds.has(p.id)),
    [allProducts, excludedProductIds],
  )

  const selectedBPName = useMemo(
    () => businessPartners?.find((bp) => bp.id === selectedBpId)?.name ?? null,
    [businessPartners, selectedBpId],
  )

  // Handlers
  const handleBPChange = (bpId: string) => {
    setSelectedBpId(bpId)
    setShowPreview(false)
  }

  const handleAssignGroups = async (groupIds: string[], startsAt?: string, expiresAt?: string) => {
    await assignGroupsMutation.mutateAsync({
      groupIds: groupIds.map(Number),
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    })
    setAssignGroupsOpen(false)
    toast.success(t("bpAssignments.groupsAssigned"), {
      description: t("bpAssignments.groupsAssignedDesc", { count: groupIds.length, name: selectedBPName ?? "business partner" }),
    })
  }

  const handleRemoveGroup = async (groupId: string) => {
    await removeGroupsMutation.mutateAsync({ groupIds: [Number(groupId)] })
    toast.success(t("bpAssignments.groupRemoved"), {
      description: t("bpAssignments.groupRemovedDesc"),
    })
  }

  const handleAssignProducts = async (productIds: string[], startsAt?: string, expiresAt?: string) => {
    await assignProductsMutation.mutateAsync({
      productIds: productIds.map(Number),
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    })
    setAddProductsOpen(false)
    toast.success(t("bpAssignments.productsAssigned"), {
      description: t("bpAssignments.productsAssignedDesc", { count: productIds.length, name: selectedBPName ?? "business partner" }),
    })
  }

  const handleRemoveProduct = async (product_id: string) => {
    await removeProductsMutation.mutateAsync({ productIds: [Number(product_id)] })
    toast.success(t("bpAssignments.productRemoved"), {
      description: t("bpAssignments.productRemovedDesc"),
    })
  }

  const handleExcludeProducts = async (productIds: string[], startsAt?: string, expiresAt?: string) => {
    await excludeProductsMutation.mutateAsync({
      productIds: productIds.map(Number),
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    })
    setAddExclusionsOpen(false)
    toast.success(t("bpAssignments.productsExcluded"), {
      description: t("bpAssignments.productsExcludedDesc", { count: productIds.length, name: selectedBPName ?? "business partner" }),
    })
  }

  const handleRemoveExclusion = async (product_id: string) => {
    await removeExclusionsMutation.mutateAsync({ productIds: [Number(product_id)] })
    toast.success(t("bpAssignments.exclusionRemoved"), {
      description: t("bpAssignments.exclusionRemovedDesc"),
    })
  }

  return (
    <div className="grid gap-6">
      {/* Business Partner Selector */}
      <Card>
        <CardHeader>
          <CardTitle>{t("bpAssignments.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("bpAssignments.description")}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap">{t("bpAssignments.selectBp")}</label>
            <Select
              value={selectedBpId ?? ""}
              onValueChange={handleBPChange}
              disabled={bpLoading}
            >
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder={bpLoading ? t("bpAssignments.loadingBps") : t("bpAssignments.chooseBp")} />
              </SelectTrigger>
              <SelectContent>
                {(businessPartners ?? []).map((bp) => (
                  <SelectItem key={bp.id} value={bp.id}>
                    {bp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Assignment Dashboard */}
      {selectedBpId ? (
        <>
          {/* Tab Navigation */}
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon}
                {tab.label}
                {activeTab === tab.key && assignments ? (
                  <Badge variant="secondary" className="ml-1">
                    {tab.key === "groups"
                      ? assignments.groups.length
                      : tab.key === "products"
                        ? assignments.products.length
                        : assignments.exclusions.length}
                  </Badge>
                ) : null}
              </button>
            ))}
          </div>

          {/* Section A: Assigned Groups */}
          {activeTab === "groups" ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>{t("bpAssignments.assignedGroups")}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("bpAssignments.groupsAssignedTo", { name: selectedBPName })}
                  </p>
                </div>
                <Button type="button" onClick={() => setAssignGroupsOpen(true)}>
                  <Plus className="size-4" />
                  {t("bpAssignments.assignGroup")}
                </Button>
              </CardHeader>
              <CardContent>
                <QueryStateWrapper
                  isLoading={assignmentsLoading}
                  isError={assignmentsError}
                  error={assignmentsErrorObj}
                  entityName="assigned groups"
                  isEmpty={!assignments || assignments.groups.length === 0}
                  emptyMessage={t("bpAssignments.noGroupsAssigned")}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("bpAssignments.groupName")}</TableHead>
                        <TableHead>{t("bpAssignments.assignedAt")}</TableHead>
                        <TableHead>{t("bpAssignments.visibilityWindow")}</TableHead>
                        <TableHead className="w-[100px] text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments?.groups.map((g) => (
                        <TableRow key={g.id}>
                          <TableCell className="font-medium">{g.group_name ?? g.group_id}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(g.created_at)}
                          </TableCell>
                          <TableCell className="text-sm">
                            <VisibilityWindowCell startsAt={g.starts_at} expiresAt={g.expires_at} t={t} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={removeGroupsMutation.isPending}
                              onClick={() => handleRemoveGroup(String(g.group_id))}
                            >
                              <Trash2 className="size-3.5" />
                              {t("common.remove")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </QueryStateWrapper>
              </CardContent>
            </Card>
          ) : null}

          {/* Section B: Individual Products */}
          {activeTab === "products" ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>{t("bpAssignments.individualProducts")}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("bpAssignments.productsAssignedTo", { name: selectedBPName })}
                  </p>
                </div>
                <Button type="button" onClick={() => setAddProductsOpen(true)}>
                  <Plus className="size-4" />
                  {t("bpAssignments.addProduct")}
                </Button>
              </CardHeader>
              <CardContent>
                <QueryStateWrapper
                  isLoading={assignmentsLoading}
                  isError={assignmentsError}
                  error={assignmentsErrorObj}
                  entityName="assigned products"
                  isEmpty={!assignments || assignments.products.length === 0}
                  emptyMessage={t("bpAssignments.noProductsAssigned")}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("products.sku")}</TableHead>
                        <TableHead>{t("common.name")}</TableHead>
                        <TableHead>{t("bpAssignments.assignedAt")}</TableHead>
                        <TableHead>{t("bpAssignments.visibilityWindow")}</TableHead>
                        <TableHead className="w-[100px] text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments?.products.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs sm:text-sm">
                            {p.product_sku ?? "---"}
                          </TableCell>
                          <TableCell className="font-medium">
                            {p.product_name ?? p.product_id}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(p.created_at)}
                          </TableCell>
                          <TableCell className="text-sm">
                            <VisibilityWindowCell startsAt={p.starts_at} expiresAt={p.expires_at} t={t} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={removeProductsMutation.isPending}
                              onClick={() => handleRemoveProduct(String(p.product_id))}
                            >
                              <Trash2 className="size-3.5" />
                              {t("common.remove")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </QueryStateWrapper>
              </CardContent>
            </Card>
          ) : null}

          {/* Section C: Excluded Products */}
          {activeTab === "exclusions" ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>{t("bpAssignments.excludedProducts")}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("bpAssignments.excludedFrom", { name: selectedBPName })}
                  </p>
                </div>
                <Button type="button" onClick={() => setAddExclusionsOpen(true)}>
                  <Plus className="size-4" />
                  {t("bpAssignments.addExclusion")}
                </Button>
              </CardHeader>
              <CardContent>
                <QueryStateWrapper
                  isLoading={assignmentsLoading}
                  isError={assignmentsError}
                  error={assignmentsErrorObj}
                  entityName="excluded products"
                  isEmpty={!assignments || assignments.exclusions.length === 0}
                  emptyMessage={t("bpAssignments.noExclusions")}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("products.sku")}</TableHead>
                        <TableHead>{t("common.name")}</TableHead>
                        <TableHead>{t("bpAssignments.excludedAt")}</TableHead>
                        <TableHead>{t("bpAssignments.visibilityWindow")}</TableHead>
                        <TableHead className="w-[120px] text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments?.exclusions.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-mono text-xs sm:text-sm">
                            {e.product_sku ?? "---"}
                          </TableCell>
                          <TableCell className="font-medium">
                            {e.product_name ?? e.product_id}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(e.created_at)}
                          </TableCell>
                          <TableCell className="text-sm">
                            <VisibilityWindowCell startsAt={e.starts_at} expiresAt={e.expires_at} t={t} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={removeExclusionsMutation.isPending}
                              onClick={() => handleRemoveExclusion(String(e.product_id))}
                            >
                              <Trash2 className="size-3.5" />
                              {t("bpAssignments.removeExclusion")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </QueryStateWrapper>
              </CardContent>
            </Card>
          ) : null}

          {/* Effective Products Preview */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>{t("bpAssignments.effectivePreview")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("bpAssignments.effectivePreviewDesc", { name: selectedBPName })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {showPreview && effectiveProducts ? (
                  <Badge variant="secondary">{effectiveProducts.length} products</Badge>
                ) : null}
                <Button
                  type="button"
                  variant={showPreview ? "outline" : "default"}
                  onClick={() => setShowPreview((prev) => !prev)}
                >
                  <Eye className="size-4" />
                  {showPreview ? t("bpAssignments.hidePreview") : t("bpAssignments.previewEffective")}
                </Button>
              </div>
            </CardHeader>
            {showPreview ? (
              <CardContent>
                <QueryStateWrapper
                  isLoading={effectiveLoading}
                  isError={effectiveError}
                  error={effectiveErrorObj}
                  entityName="effective products"
                  isEmpty={!effectiveProducts || effectiveProducts.length === 0}
                  emptyMessage={t("bpAssignments.noEffectiveProducts")}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("products.sku")}</TableHead>
                        <TableHead>{t("common.name")}</TableHead>
                        <TableHead>{t("bpAssignments.price")}</TableHead>
                        <TableHead>{t("products.size")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {effectiveProducts?.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs sm:text-sm">{p.sku}</TableCell>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell>
                            {p.unitPrice != null ? `${p.unitPrice.toFixed(2)}` : "---"}
                          </TableCell>
                          <TableCell>{p.size ?? "---"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </QueryStateWrapper>
              </CardContent>
            ) : null}
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto size-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              {t("bpAssignments.selectBpPrompt")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Assign Groups Dialog */}
      <SelectionDialog<ProductGroup>
        open={assignGroupsOpen}
        onOpenChange={setAssignGroupsOpen}
        title={t("bpAssignments.assignGroupsTitle")}
        description={t("bpAssignments.assignGroupsDesc", { name: selectedBPName ?? "this business partner" })}
        items={availableGroups}
        isLoading={groupsLoading}
        getKey={(g) => g.id}
        getLabel={(g) => g.name}
        getSubLabel={(g) => `${g.productCount} product${g.productCount === 1 ? "" : "s"}`}
        searchPlaceholder={t("bpAssignments.searchGroups")}
        confirmLabel={t("bpAssignments.assign")}
        isPending={assignGroupsMutation.isPending}
        onConfirm={handleAssignGroups}
      />

      {/* Add Products Dialog */}
      <SelectionDialog<Product>
        open={addProductsOpen}
        onOpenChange={setAddProductsOpen}
        title={t("bpAssignments.addProductsTitle")}
        description={t("bpAssignments.addProductsDesc", { name: selectedBPName ?? "this business partner" })}
        items={availableProducts}
        isLoading={productsLoading}
        getKey={(p) => p.id}
        getLabel={(p) => p.name}
        getSubLabel={(p) => p.sku}
        searchPlaceholder={t("bpAssignments.searchByNameOrSku")}
        confirmLabel={t("products.add")}
        isPending={assignProductsMutation.isPending}
        onConfirm={handleAssignProducts}
      />

      {/* Add Exclusions Dialog */}
      <SelectionDialog<Product>
        open={addExclusionsOpen}
        onOpenChange={setAddExclusionsOpen}
        title={t("bpAssignments.excludeProductsTitle")}
        description={t("bpAssignments.excludeProductsDesc", { name: selectedBPName ?? "this business partner" })}
        items={availableForExclusion}
        isLoading={productsLoading}
        getKey={(p) => p.id}
        getLabel={(p) => p.name}
        getSubLabel={(p) => p.sku}
        searchPlaceholder={t("bpAssignments.searchByNameOrSku")}
        confirmLabel={t("bpAssignments.exclude")}
        isPending={excludeProductsMutation.isPending}
        onConfirm={handleExcludeProducts}
      />
    </div>
  )
}
