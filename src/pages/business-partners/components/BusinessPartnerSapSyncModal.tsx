import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2Icon, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useSapSyncSuggestionsQuery, useBulkLinkBusinessPartnersToSapMutation } from "@/features/businessPartners/api"
import type { SapSyncSuggestion, BulkLinkInput } from "@/features/businessPartners/types"
import { useCheckboxDragSelect } from "@/lib/useCheckboxDragSelect"
import { cn } from "@/lib/utils"

interface BusinessPartnerSapSyncModalProps {
  open: boolean
  onClose: () => void
}

const SKELETON_ROWS = 6

function SyncModalSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-1">
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border px-4 py-3">
          <div className="h-4 w-4 shrink-0 animate-pulse rounded-sm bg-muted" />
          <div className="h-3.5 w-28 shrink-0 animate-pulse rounded bg-muted" />
          <div className="h-3.5 flex-1 animate-pulse rounded bg-muted" style={{ maxWidth: `${50 + (i * 7) % 35}%` }} />
        </div>
      ))}
    </div>
  )
}

const getRowKey = (s: SapSyncSuggestion) => s.businessPartnerId

export function BusinessPartnerSapSyncModal({ open, onClose }: BusinessPartnerSapSyncModalProps) {
  const { t } = useTranslation()

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [selectedCandidate, setSelectedCandidate] = useState<Map<string, string>>(new Map())

  const { data, isLoading } = useSapSyncSuggestionsQuery(open)
  const items = useMemo(() => data ?? [], [data])

  const eligibleIds = useMemo(
    () => new Set(items.filter((s) => s.candidates.length > 0).map((s) => s.businessPartnerId)),
    [items],
  )

  // Reset everything fresh on each open, then seed defaults once suggestions load.
  useEffect(() => {
    if (!open) {
      setSelectedKeys(new Set())
      setSelectedCandidate(new Map())
    }
  }, [open])

  useEffect(() => {
    if (!open || items.length === 0) return
    const initialKeys = new Set<string>()
    const initialCandidates = new Map<string, string>()
    items.forEach((s) => {
      if (s.candidates.length > 0) {
        initialCandidates.set(s.businessPartnerId, s.candidates[0].cardCode)
      }
      if (s.candidates.length === 1 && s.candidates[0].confidence === "high") {
        initialKeys.add(s.businessPartnerId)
      }
    })
    setSelectedKeys(initialKeys)
    setSelectedCandidate(initialCandidates)
  }, [open, items])

  const isRowSelected = (s: SapSyncSuggestion) => selectedKeys.has(s.businessPartnerId)

  const onRowToggle = (key: string) => {
    if (!eligibleIds.has(key)) return
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allEligibleSelected = eligibleIds.size > 0 && Array.from(eligibleIds).every((id) => selectedKeys.has(id))

  const onHeaderToggle = () => {
    setSelectedKeys(allEligibleSelected ? new Set() : new Set(eligibleIds))
  }

  const onCandidateChange = (bpId: string, cardCode: string) => {
    setSelectedCandidate((prev) => new Map(prev).set(bpId, cardCode))
  }

  const { startDrag: startCheckboxDrag, handleNativeChange: handleCheckboxChange } = useCheckboxDragSelect({
    items,
    getKey: getRowKey,
    isSelected: isRowSelected,
    toggle: onRowToggle,
  })

  const bulkLinkMutation = useBulkLinkBusinessPartnersToSapMutation()

  const links: BulkLinkInput[] = Array.from(selectedKeys)
    .map((id) => ({ id, cardCode: selectedCandidate.get(id) ?? "" }))
    .filter((l) => Boolean(l.cardCode))

  const handleConfirm = async () => {
    if (links.length === 0) return
    try {
      const result = await bulkLinkMutation.mutateAsync(links)
      if (result.linkedCount > 0) {
        toast.success(t("businessPartners.sapSyncLinkedSummary", { linked: result.linkedCount }))
      }
      if (result.failedCount > 0) {
        toast.error(t("businessPartners.sapSyncFailedSummary", { failed: result.failedCount }))
      }
      onClose()
    } catch {
      toast.error(t("businessPartners.sapSyncFailedSummary", { failed: links.length }))
    }
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  const showSkeleton = isLoading

  return (
    <>
      <div className="bp-sap-sync-backdrop" aria-hidden="true" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t("businessPartners.sapSyncModalTitle")} className="bp-sap-sync-panel">
        <style>{`
          .bp-sap-sync-backdrop {
            position: fixed;
            inset: 0;
            z-index: 9998;
            background: rgba(15, 20, 40, 0.55);
            backdrop-filter: blur(3px);
            -webkit-backdrop-filter: blur(3px);
            animation: bp-sap-sync-fade-in 180ms ease forwards;
          }
          .bp-sap-sync-panel {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            background: var(--background);
            overflow: hidden;
            animation: bp-sap-sync-scale-in 200ms cubic-bezier(.22,.8,.32,1) forwards;
          }
          @keyframes bp-sap-sync-fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes bp-sap-sync-scale-in {
            from { opacity: 0; transform: scale(0.985); }
            to   { opacity: 1; transform: scale(1); }
          }
        `}</style>

        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-3">
          <div>
            <h1 className="text-base font-semibold">{t("businessPartners.sapSyncModalTitle")}</h1>
            <p className="text-xs text-muted-foreground">{t("businessPartners.sapSyncModalDesc")}</p>
          </div>

          <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose} aria-label="Close">
            <X className="mr-1 h-4 w-4" />
            {t("common.close")}
          </Button>
        </div>

        {/* Selection toolbar */}
        <div className="flex shrink-0 items-center justify-between border-b bg-background/80 px-4 py-2 backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            {showSkeleton ? t("common.loading") : `${items.length} ${items.length === 1 ? "business partner" : "business partners"}`}
          </span>

          <Button
            size="sm"
            className={cn(links.length === 0 && "invisible")}
            tabIndex={links.length === 0 ? -1 : 0}
            aria-hidden={links.length === 0}
            disabled={bulkLinkMutation.isPending}
            onClick={handleConfirm}
          >
            {bulkLinkMutation.isPending ? (
              <Loader2Icon className="mr-1 h-4 w-4 animate-spin" />
            ) : null}
            {bulkLinkMutation.isPending
              ? t("businessPartners.sapSyncLinking")
              : `${t("businessPartners.sapSyncBulkLinkSelected")} (${links.length})`}
          </Button>
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {showSkeleton ? (
            <SyncModalSkeleton />
          ) : items.length === 0 ? (
            <div className="flex h-40 w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <p className="text-sm">{t("businessPartners.sapSyncNoUnlinked")}</p>
            </div>
          ) : (
            <Table containerClassName="h-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 z-10 w-[40px] bg-background">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={allEligibleSelected}
                      onChange={onHeaderToggle}
                      disabled={eligibleIds.size === 0}
                    />
                  </TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">{t("common.name")}</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">{t("common.email")}</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-background">{t("businessPartners.sapSyncSelectMatch")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s, idx) => {
                  const selected = isRowSelected(s)
                  const eligible = eligibleIds.has(s.businessPartnerId)
                  const chosenCode = selectedCandidate.get(s.businessPartnerId)
                  const chosenCandidate = s.candidates.find((c) => c.cardCode === chosenCode)

                  return (
                    <TableRow
                      key={s.businessPartnerId}
                      data-row-index={idx}
                      className={cn(eligible && "cursor-pointer", selected && "bg-blue-50 dark:bg-blue-950/20")}
                      onClick={() => eligible && onRowToggle(s.businessPartnerId)}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selected}
                          disabled={!eligible}
                          onChange={() => handleCheckboxChange(s.businessPartnerId)}
                          onMouseDown={(e) => {
                            if (!eligible) return
                            e.stopPropagation()
                            startCheckboxDrag(idx, e)
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.email ?? t("common.noData")}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {s.candidates.length === 0 ? (
                          <span className="text-sm text-muted-foreground">{t("businessPartners.sapSyncNoCandidates")}</span>
                        ) : s.candidates.length === 1 ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm">
                              {s.candidates[0].cardName} <span className="font-mono text-xs text-muted-foreground">({s.candidates[0].cardCode})</span>
                            </span>
                            <Badge variant={s.candidates[0].confidence === "high" ? "default" : "secondary"}>
                              {s.candidates[0].confidence === "high"
                                ? t("businessPartners.sapSyncConfidenceHigh")
                                : t("businessPartners.sapSyncConfidenceLow")}
                            </Badge>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <select
                              className="h-8 rounded-md border bg-background px-2 text-sm"
                              value={chosenCode ?? ""}
                              onChange={(e) => onCandidateChange(s.businessPartnerId, e.target.value)}
                            >
                              {s.candidates.map((c) => (
                                <option key={c.cardCode} value={c.cardCode}>
                                  {c.cardName} ({c.cardCode})
                                </option>
                              ))}
                            </select>
                            {chosenCandidate ? (
                              <Badge variant={chosenCandidate.confidence === "high" ? "default" : "secondary"}>
                                {chosenCandidate.confidence === "high"
                                  ? t("businessPartners.sapSyncConfidenceHigh")
                                  : t("businessPartners.sapSyncConfidenceLow")}
                              </Badge>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </>
  )
}
