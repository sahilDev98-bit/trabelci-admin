import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, UploadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { CatalogCollection } from "@/features/catalogProducts/types"
import { isolate } from "./bidi"
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
  /** The document's pages, so the user can say WHERE the generated ones go.
   * Named rather than numbered alone: "Cover" is recognisable, "page 1" is
   * something you have to go and check. */
  pages: { index: number; label: string }[]
  /** The page in view when the dialog opened — the sensible default. */
  defaultAfterIndex: number
  /** Resolves the list against the catalogue: which SKUs exist, which do not. */
  onCheck: (skus: string[]) => Promise<{ found: number; missing: string[] }>
  /** The brief's "or an entire collection" — the alternative to naming
   * products one at a time. Empty is a normal state, not a failure. */
  collections: CatalogCollection[]
  collectionsLoading: boolean
  /** Fetches one collection's SKUs. Returns null if they could not be read,
   * so the dialog can say so rather than silently adding nothing. */
  onLoadCollectionSkus: (collection: CatalogCollection) => Promise<string[] | null>
  busy: boolean
  /** Progress while generating, so a forty-page build is not a frozen box. */
  progress: { done: number; total: number } | null
  onGenerate: (template: PdfPageTemplate, skus: string[], afterIndex: number) => void
  onCancel: () => void
}

export function PdfGenerateDialog({
  open, templates, templatesLoading, pages, defaultAfterIndex,
  onCheck, collections, collectionsLoading, onLoadCollectionSkus,
  busy, progress, onGenerate, onCancel,
}: PdfGenerateDialogProps) {
  const { t, i18n } = useTranslation()
  const [templateId, setTemplateId] = useState<string>("")
  const [text, setText] = useState("")
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<{ found: number; missing: string[] } | null>(null)
  const [fileProblem, setFileProblem] = useState<"spreadsheet" | "unreadable" | null>(null)
  /**
   * Where the generated pages go.
   *
   * Null until chosen, so the DEFAULT follows the page you were looking at
   * when you opened this — storing it in state on mount would freeze it at
   * whatever was on screen the first time the dialog was ever opened.
   */
  const [afterIndex, setAfterIndex] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /** The collection picker: which one is selected, whether it is being
   * fetched, and what the last attempt did. The outcome is kept so adding a
   * collection is not a silent event — 200 SKUs appearing in a box you were
   * not looking at needs saying out loud. */
  const [collectionKey, setCollectionKey] = useState("")
  const [loadingCollection, setLoadingCollection] = useState(false)
  const [collectionNote, setCollectionNote] =
    useState<{ ok: boolean; name: string; count: number } | null>(null)

  const insertAfter = afterIndex ?? defaultAfterIndex
  const afterPageNumber = insertAfter + 1

  // Only templates that can actually receive products. One with no slots
  // would generate pages that never fill, which is not a catalogue.
  const usable = templates.filter((tpl) => tpl.productCount > 0)
  const template = usable.find((tpl) => tpl.id === templateId) ?? null

  const parsed = useMemo(() => parseSkuList(text), [text])
  const perPage = template?.productCount ?? 0
  /** How many pages the list will make. Named apart from the document's
   * own pages, which the prop above carries. */
  const pagesToMake = pagesNeeded(parsed.skus.length, perPage)

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

  /**
   * What to call a collection on screen.
   *
   * SKU Management records both names, and which one is the useful one
   * depends on who is reading: `series` is the name as it comes off the SAP
   * item, `series_en` the English rendering. Falls back rather than showing
   * a blank when only one of the two exists.
   */
  const collectionLabel = (collection: CatalogCollection): string => {
    const english = collection.seriesEn ?? collection.series
    return i18n.language.startsWith("he") ? collection.series : english
  }

  /**
   * Add a collection's SKUs to the list.
   *
   * APPENDS rather than replaces, for two reasons. A catalogue made of two
   * collections is an ordinary request, and replacing would make it
   * impossible. And a click that silently discards a list somebody pasted or
   * uploaded is destructive in a dialog with no undo.
   */
  const addCollection = async () => {
    const collection = collections.find((c) => c.key === collectionKey)
    if (!collection || loadingCollection) return

    setLoadingCollection(true)
    setCollectionNote(null)
    try {
      const skus = await onLoadCollectionSkus(collection)
      if (skus === null) {
        setCollectionNote({ ok: false, name: collectionLabel(collection), count: 0 })
        return
      }
      // Joined with a newline only when there is something to join to, so the
      // box does not start with a blank line — which parses fine, but looks
      // like the list is missing its first entry.
      const existing = text.trim()
      updateText(existing ? `${existing}\n${skus.join("\n")}` : skus.join("\n"))
      setCollectionNote({ ok: true, name: collectionLabel(collection), count: skus.length })
    } finally {
      setLoadingCollection(false)
    }
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

  /**
   * The SKUs that were not found, for dropping into a sentence.
   *
   * Each one isolated individually, not the joined string: these are codes
   * inside Hebrew prose, and without it the commas and any leading punctuation
   * are reordered against the words around them — the reader is then given a
   * list of SKUs that do not exist to go and look for.
   */
  const missingList = checked
    ? checked.missing.slice(0, 8).map(isolate).join(", ")
      + (checked.missing.length > 8 ? "…" : "")
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

          {/* ── 2. Where the new pages go ──────────────────────────────
              The client prepares a cover and a final page in advance, so the
              question that matters is what the product pages sit BETWEEN.
              Left implicit it is "wherever you happened to be scrolled to",
              which is fine until it is not — and a page landing in the wrong
              half of a forty-page catalogue is tedious to undo. */}
          <div className="space-y-1.5">
            <Label htmlFor="generate-after">
              {t("pdfTemplates.generateAfter", "Add the pages after")}
            </Label>
            <select
              id="generate-after"
              data-pdf-generate-after
              value={String(insertAfter)}
              onChange={(e) => setAfterIndex(Number(e.target.value))}
              disabled={busy}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
            >
              {pages.map((page) => (
                <option key={page.index} value={String(page.index)}>
                  {page.label}
                </option>
              ))}
            </select>
          </div>

          {/* ── 3. The SKUs ───────────────────────────────────────────── */}
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
              // ALWAYS left-to-right, whatever the interface language.
              //
              // A SKU is a code, not prose. Under Hebrew the box inherits RTL
              // and any SKU beginning with a neutral character is reordered on
              // screen: ".4211121" — a real SKU in this catalogue — displays as
              // "4211121.", so the reader sees a SKU that does not exist. The
              // value is untouched and looks up correctly, which is precisely
              // why it is worth pinning: the fault is invisible to everything
              // except a person reading the box.
              //
              // Same reasoning as the page counter in PdfEngineViewportBar,
              // where "3 / 14" was being shown as "14 / 3".
              dir="ltr"
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
            {/* ── Or take a whole collection ──────────────────────────────
                The brief offers "50 products / 100 products / 500 products,
                OR an entire collection". Everything above is the first half;
                this is the second. It deliberately fills the SAME box rather
                than being a separate mode: the count, the duplicate warning,
                the catalogue check and the page arithmetic are all already
                right for a list, and the user still gets to see and edit what
                they are about to build. */}
            <div className="flex items-center gap-2">
              <select
                aria-label={t("pdfTemplates.generateCollection", "Add a whole collection")}
                data-pdf-generate-collection
                value={collectionKey}
                onChange={(e) => setCollectionKey(e.target.value)}
                disabled={busy || loadingCollection || collections.length === 0}
                // bg-background, not a translucent tint: Chrome builds the
                // dropdown's own panel from this colour, and a see-through one
                // renders the open list unreadable.
                className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs text-foreground"
              >
                <option value="">
                  {collectionsLoading
                    ? t("pdfTemplates.generateCollectionsLoading", "Loading collections…")
                    : t("pdfTemplates.generateCollectionPick", "Or add a whole collection…")}
                </option>
                {collections.map((collection) => (
                  <option key={collection.key} value={collection.key}>
                    {/* Each run isolated separately: the name, the supplier
                        and the count can each be Hebrew or Latin independently
                        of the other two and of the interface language. */}
                    {isolate(collectionLabel(collection))}
                    {collection.supplier ? ` — ${isolate(collection.supplier)}` : ""}
                    {" · "}
                    {isolate(t("pdfTemplates.generateCollectionSize", "{{count}} products", {
                      count: collection.skuCount,
                    }))}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1.5 px-2 text-xs"
                data-pdf-generate-collection-add
                disabled={busy || loadingCollection || collectionKey === ""}
                onClick={() => void addCollection()}
              >
                {loadingCollection && <Loader2Icon className="size-3 animate-spin" />}
                {t("pdfTemplates.generateCollectionAdd", "Add to the list")}
              </Button>
            </div>
            {!collectionsLoading && collections.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t(
                  "pdfTemplates.generateNoCollections",
                  "No collections found. A collection is a Series in SKU Management — products need one recorded before they can be added this way.",
                )}
              </p>
            )}
            {collectionNote && (
              <p
                data-pdf-generate-collection-note
                className={`text-xs ${collectionNote.ok
                  ? "text-muted-foreground"
                  : "text-destructive"}`}
              >
                {collectionNote.ok
                  ? t(
                    "pdfTemplates.generateCollectionAdded",
                    "Added {{count}} SKUs from {{name}}. Edit or reorder them below before generating.",
                    // Isolated for the same reason as the dropdown: a Latin
                    // collection name dropped into a Hebrew sentence is
                    // otherwise reordered against the words around it.
                    { count: collectionNote.count, name: isolate(collectionNote.name) },
                  )
                  : t(
                    "pdfTemplates.generateCollectionFailed",
                    "Could not load {{name}}. Nothing was added.",
                    { name: isolate(collectionNote.name) },
                  )}
              </p>
            )}

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
                {template && pagesToMake > 0 && (
                  <>
                    {" · "}
                    {t("pdfTemplates.generatePageCount", "{{count}} pages", { count: pagesToMake })}
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
                { pages: pagesToMake, after: afterPageNumber },
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
            onClick={() => { if (template) onGenerate(template, parsed.skus, insertAfter) }}
          >
            {busy && <Loader2Icon className="size-4 animate-spin" />}
            {t("pdfTemplates.generateRun", "Generate {{count}} pages", { count: pagesToMake })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
