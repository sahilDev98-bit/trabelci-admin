import { useTranslation } from "react-i18next"
import { AlertTriangleIcon, Loader2Icon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { productFieldLabel } from "./productSlots"
import type { RefreshPlan } from "./productBindings"

/**
 * What "Refresh from database" is about to do — shown before it does it.
 *
 * Point 7 of the brief. Refresh is a frightening button on a finished
 * catalogue, and the number that reassures is not how many fields will change
 * but how many of your OWN edits are being left alone. So that gets its own
 * line, in its own colour, whether or not anything is changing.
 *
 * Examples are shown as "from -> to" rather than a count, because "34 fields
 * will change" tells you nothing about whether the change is right.
 */

/** Enough examples to recognise the shape of the change; not so many that
 * the dialog becomes a report nobody reads. */
const EXAMPLES_SHOWN = 6

interface PdfRefreshDialogProps {
  open: boolean
  /** Null while the plan is still being worked out. */
  plan: RefreshPlan | null
  busy: boolean
  onApply: (plan: RefreshPlan) => void
  onCancel: () => void
}

export function PdfRefreshDialog({ open, plan, busy, onApply, onCancel }: PdfRefreshDialogProps) {
  const { t } = useTranslation()

  const shorten = (value: string) =>
    value.length > 40 ? `${value.slice(0, 40)}…` : value

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("pdfTemplates.refreshTitle", "Refresh from database")}</DialogTitle>
        </DialogHeader>

        {!plan ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {t("pdfTemplates.refreshChecking", "Checking these pages against the catalogue…")}
          </p>
        ) : plan.products === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t(
              "pdfTemplates.refreshNothingLinked",
              "No products are linked to these pages yet. Fill a page's product slots first, and it can then be kept in step with the catalogue.",
            )}
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              {t("pdfTemplates.refreshProducts", "{{count}} products on these pages.", {
                count: plan.products,
              })}
            </p>

            {plan.changes.length === 0 ? (
              <p className="text-muted-foreground">
                {t("pdfTemplates.refreshUpToDate", "Everything already matches the catalogue.")}
              </p>
            ) : (
              <div className="rounded-md border bg-muted/40 px-3 py-2">
                <p className="text-xs font-medium">
                  {t("pdfTemplates.refreshWillChange", "{{count}} fields will change", {
                    count: plan.changes.length,
                  })}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {plan.changes.slice(0, EXAMPLES_SHOWN).map((change, i) => (
                    <li key={`${change.pageIndex}-${change.slotIndex}-${i}`} className="text-xs">
                      <span className="text-muted-foreground">
                        {productFieldLabel(t, change.fieldId)}
                        {" · "}
                        {change.sku}
                        {": "}
                      </span>
                      {/* The photo's "value" is a URL, which tells nobody
                          anything. For a picture the fact of the change is the
                          message. */}
                      {change.kind === "image"
                        ? t("pdfTemplates.refreshNewPhoto", "a new photo")
                        : (
                          <>
                            <span className="line-through opacity-60">{shorten(change.from)}</span>
                            {" → "}
                            <span className="font-medium">{shorten(change.to)}</span>
                          </>
                        )}
                    </li>
                  ))}
                </ul>
                {plan.changes.length > EXAMPLES_SHOWN && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("pdfTemplates.refreshAndMore", "and {{count}} more", {
                      count: plan.changes.length - EXAMPLES_SHOWN,
                    })}
                  </p>
                )}
              </div>
            )}

            {/* Shown WHETHER OR NOT anything is protected. "Your edits are
                safe" is the sentence somebody needs before pressing this, and
                a line that only appears sometimes is one you cannot rely on. */}
            <p className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-500">
              <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {plan.overridden > 0
                  ? t(
                    "pdfTemplates.refreshProtected",
                    "{{count}} fields you edited by hand will be left exactly as they are.",
                    { count: plan.overridden },
                  )
                  : t(
                    "pdfTemplates.refreshNoneEdited",
                    "Nothing here has been edited by hand, so nothing of yours can be lost.",
                  )}
              </span>
            </p>

            {plan.missingSkus.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t(
                    "pdfTemplates.refreshMissing",
                    "No longer in the catalogue, and left untouched: {{list}}",
                    { list: plan.missingSkus.slice(0, 6).join(", ") },
                  )}
                </span>
              </p>
            )}

            {/* Said plainly rather than discovered. A photo somebody swapped
                by hand cannot be told from one we placed, so it is the one
                thing a refresh can overwrite without warning. */}
            {plan.changes.some((c) => c.kind === "image") && (
              <p className="text-xs text-muted-foreground">
                {t(
                  "pdfTemplates.refreshPhotoCaveat",
                  "Photos you replaced by hand cannot be told apart from ones placed automatically, so a changed product photo will replace them.",
                )}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            data-pdf-refresh-apply
            className="gap-1.5"
            disabled={busy || !plan || plan.changes.length === 0}
            onClick={() => { if (plan) onApply(plan) }}
          >
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
            {plan && plan.changes.length > 0
              ? t("pdfTemplates.refreshApply", "Update {{count}} fields", {
                count: plan.changes.length,
              })
              : t("pdfTemplates.refreshApplyNone", "Nothing to update")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
