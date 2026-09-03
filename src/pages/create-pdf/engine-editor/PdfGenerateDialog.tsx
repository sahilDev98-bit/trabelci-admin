import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, UploadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { PdfPageTemplate } from "@/features/pdfPageTemplates/types"
import { pagesNeeded, parseSkuList, readSkuFile } from "./skuList"

/**
 * Building catalogue pages from a template and a list of SKUs.
 *
 * The client's four steps, in order: pick a template, give it the SKUs,
 * generate, then review. This screen is the first three; the fourth is the
 * editor the result lands in.
 *
 * What it mostly does is SAY WHAT WILL HAPPEN before it happens — how many
 * SKUs were read, which are repeated, how many pages that makes, and above
 * all which SKUs are not in the catalogue. Finding out that three products
 * are missing after forty pages have been built is far worse than being told
 * before the first one is.
 */

interface PdfGenerateDialogProps {
  open: boolean
  templates: PdfPageTemplate[]
  templatesLoading: boolean
  /** Where the generated pages will be inserted, 1-based, for the summary. */
  afterPageNumber: number
  /** Resolves the list against the catalogue: which SKUs exist, which do not. */
  onCheck: (skus: string[]) => Promise<{ found: number; missing: string[] }>
  busy: boolean
  /** Progress while generating, so a forty-page build is not a frozen box. */
  progress: { done: number; total: number } | null
  onGenerate: (template: PdfPageTemplate, skus: string[]) => void
  onCancel: () => void
}

export function PdfGenerateDialog({
  open, templates, templatesLoading, afterPageNumber,
  onCheck, busy, progress, onGenerate, onCancel,
}: PdfGenerateDialogProps) {
  const { t } = useTranslation()
  const [templateId, setTemplateId] = useState<string>("")
  const [text, setText] = useState("")
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<{ found: number; missing: string[] } | null>(null)
  const [fileProblem, setFileProblem] = useState<"spreadsheet" | "unreadable" | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Only templates that can actually receive products. One with no slots
  // would generate pages that never fill, which is not a catalogue.
  const usable = templates.filter((tpl) => tpl.productCount > 0)
  const template = usable.find((tpl) => tpl.id === templateId) ?? null

  const parsed = useMemo(() => parseSkuList(text), [text])
  const perPage = template?.productCount ?? 0
  const pages = pagesNeeded(parsed.skus.length, perPage)

  /** Any change to the list invalidates a previous check — that answer was
   * about a different list. */
  const updateText = (value: string) => {
    setText(value)
    setChecked(null)
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setFileProblem(null)
    const outcome = await readSkuFile(file)
    if (!outcome.ok) {
      setFileProblem(outcome.reason)
      return
    }
    updateText(outcome.text)
  }

  const check = async () => {
    if (parsed.skus.length === 0) return
    setChecking(true)
    try {
      setChecked(await onCheck(parsed.skus))
    } finally {
      setChecking(false)
    }
  }

  const missingList = checked
    ? checked.missing.slice(0, 8).join(", ") + (checked.missing.length > 8 ? "…" : "")
    : ""

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("pdfTemplates.generateTitle", "Generate catalogue pages")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* ── 1. Which template ─────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="generate-template">
              {t("pdfTemplates.generateTemplate", "Page template")}
            </Label>
            <select
              id="generate-template"
              data-pdf-generate-template
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={busy}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
            >
              <option value="">
                {templatesLoading
                  ? t("pdfTemplates.templateLoading", "Loading templates…")
                  : t("pdfTemplates.generatePickTemplate", "Choose a template…")}
              </option>
              {usable.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                  {" — "}
                  {t("pdfTemplates.generatePerPage", "{{count}} per page", {
                    count: tpl.productCount,
                  })}
                </option>
              ))}
            </select>
            {!templatesLoading && usable.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t(
                  "pdfTemplates.generateNoTemplates",
                  "No templates with product slots yet. Lay out a page, mark its product slots, then save it as a template.",
                )}
              </p>
            )}
          </div>

          {/* ── 2. The SKUs ───────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="generate-skus">
                {t("pdfTemplates.generateSkus", "SKUs, in the order you want them")}
              </Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-xs"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <UploadIcon className="size-3.5" />
                {t("pdfTemplates.generateUpload", "Upload a file")}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.tsv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  void pickFile(e.target.files?.[0])
                  // Cleared so choosing the SAME file twice fires again.
                  e.target.value = ""
                }}
              />
            </div>
            <Textarea
              id="generate-skus"
              data-pdf-generate-skus
              value={text}
              onChange={(e) => updateText(e.target.value)}
              disabled={busy}
              rows={6}
              // A fixed height that SCROLLS. The component grows to fit its
              // content by default, and a four-hundred-SKU list would push
              // the buttons off the bottom of the screen — which is exactly
              // the size of list this feature exists for.
              className="h-32 max-h-32 resize-none overflow-y-auto font-mono text-xs"
              placeholder={"100201305\n911120\n.4211121"}
            />
            {fileProblem && (
              <p className="text-xs text-destructive">
                {fileProblem === "spreadsheet"
                  ? t(
                    "pdfTemplates.generateFileSpreadsheet",
                    "That is an Excel workbook, which cannot be read directly. In Excel choose File, then Save As, then CSV — and upload that.",
                  )
                  : t(
                    "pdfTemplates.generateFileUnreadable",
                    "That file could not be read as a list. A CSV or a plain text file works.",
                  )}
              </p>
            )}
          </div>

          {/* ── What was read ─────────────────────────────────────────── */}
          {/* Said BEFORE anything is built. A catalogue that turns out to be
              missing three products after forty pages is far worse than one
              that says so first. */}
          {parsed.skus.length > 0 && (
            <div data-pdf-generate-summary className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <p className="font-medium">
                {t("pdfTemplates.generateReadCount", "{{count}} SKUs read", {
                  count: parsed.skus.length,
                })}
                {template && pages > 0 && (
                  <>
                    {" · "}
                    {t("pdfTemplates.generatePageCount", "{{count}} pages", { count: pages })}
                  </>
                )}
              </p>

              {parsed.droppedHeader && (
                <p className="mt-1 text-muted-foreground">
                  {t("pdfTemplates.generateHeaderDropped", "Ignored the heading {{header}}.", {
                    header: parsed.droppedHeader,
                  })}
                </p>
              )}
              {parsed.ignoredLines > 0 && (
                <p className="mt-1 text-muted-foreground">
                  {t(
                    "pdfTemplates.generateIgnored",
                    "{{count}} lines were not SKUs and were ignored.",
                    { count: parsed.ignoredLines },
                  )}
                </p>
              )}
              {parsed.duplicates.length > 0 && (
                <p className="mt-1 text-amber-600 dark:text-amber-500">
                  {t(
                    "pdfTemplates.generateDuplicates",
                    "{{count}} SKUs appear more than once. They are kept — that product will appear that many times.",
                    { count: parsed.duplicates.length },
                  )}
                </p>
              )}

              {checked && (
                <p
                  className={`mt-1 flex items-start gap-1 ${
                    checked.missing.length > 0
                      ? "text-destructive"
                      : "text-emerald-600 dark:text-emerald-500"
                  }`}
                >
                  {checked.missing.length > 0
                    ? <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    : <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" />}
                  <span>
                    {checked.missing.length === 0
                      ? t("pdfTemplates.generateAllFound", "All {{count}} found in the catalogue.", {
                        count: checked.found,
                      })
                      : t(
                        "pdfTemplates.generateSomeMissing",
                        "{{found}} found. Not in the catalogue: {{list}}",
                        { found: checked.found, list: missingList },
                      )}
                  </span>
                </p>
              )}

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2 h-7 gap-1.5 px-2 text-xs"
                data-pdf-generate-check
                disabled={checking || busy}
                onClick={() => void check()}
              >
                {checking && <Loader2Icon className="size-3 animate-spin" />}
                {t("pdfTemplates.generateCheck", "Check these against the catalogue")}
              </Button>
            </div>
          )}

          {template && parsed.skus.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t(
                "pdfTemplates.generateWillInsert",
                "{{pages}} pages will be added after page {{after}}. You can edit everything afterwards.",
                { pages, after: afterPageNumber },
              )}
            </p>
          )}

          {progress && (
            <p data-pdf-generate-progress className="text-xs text-muted-foreground">
              {t("pdfTemplates.generateProgress", "Building page {{done}} of {{total}}…", progress)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            data-pdf-generate-run
            className="gap-1.5"
            // Nothing to build without both a template and a list.
            disabled={busy || !template || parsed.skus.length === 0}
            onClick={() => { if (template) onGenerate(template, parsed.skus) }}
          >
            {busy && <Loader2Icon className="size-4 animate-spin" />}
            {t("pdfTemplates.generateRun", "Generate {{count}} pages", { count: pages })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
