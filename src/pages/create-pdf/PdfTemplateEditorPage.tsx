import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, CodeIcon, EyeIcon, PencilIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  useCreatePdfTemplateMutation,
  useUpdatePdfTemplateMutation,
  usePdfTemplateQuery,
} from "@/features/pdfTemplates/api"
import { ROUTES } from "@/lib/routes"

// ── Slot snippet library ──────────────────────────────────────────────────────

interface Snippet {
  label: string
  description: string
  html: string
}

const SNIPPET_GROUPS: { labelKey: string; items: Snippet[] }[] = [
  {
    labelKey: "pdfTemplates.basicSlots",
    items: [
      {
        label: "Image slot",
        description: "Drop-zone for a single image",
        html: `<div data-pdf-slot="image" data-pdf-id="img-${Date.now()}" data-pdf-label="Image" style="width:200px;height:150px;border:2px dashed #ccc;display:flex;align-items:center;justify-content:center;background:#f9f9f9;">
  <span style="color:#aaa;font-size:12px;">Image</span>
</div>`,
      },
      {
        label: "Text slot",
        description: "Editable text area",
        html: `<p data-pdf-slot="text" data-pdf-id="txt-${Date.now()}" data-pdf-label="Text block" style="font-size:14px;color:#333;min-height:24px;">
  Your text here
</p>`,
      },
      {
        label: "Title slot",
        description: "Large heading",
        html: `<h1 data-pdf-slot="text" data-pdf-id="title-${Date.now()}" data-pdf-label="Title" style="font-size:28px;font-weight:bold;color:#111;margin:0 0 8px;">
  Document Title
</h1>`,
      },
      {
        label: "Subtitle slot",
        description: "Secondary heading",
        html: `<h2 data-pdf-slot="text" data-pdf-id="subtitle-${Date.now()}" data-pdf-label="Subtitle" style="font-size:18px;font-weight:600;color:#444;margin:0 0 6px;">
  Subtitle
</h2>`,
      },
    ],
  },
  {
    labelKey: "pdfTemplates.components",
    items: [
      {
        label: "Product card",
        description: "Image + title + price block",
        html: `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;display:inline-block;width:220px;font-family:sans-serif;">
  <div data-pdf-slot="image" data-pdf-id="card-img-${Date.now()}" data-pdf-label="Product Image" style="width:100%;height:140px;background:#f3f4f6;border-radius:6px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;">
    <span style="color:#9ca3af;font-size:11px;">Product Image</span>
  </div>
  <p data-pdf-slot="text" data-pdf-id="card-name-${Date.now()}" data-pdf-label="Product Name" style="font-size:14px;font-weight:600;color:#111;margin:0 0 4px;">Product Name</p>
  <p data-pdf-slot="text" data-pdf-id="card-price-${Date.now()}" data-pdf-label="Price" style="font-size:16px;font-weight:700;color:#059669;margin:0;">$0.00</p>
</div>`,
      },
      {
        label: "Logo + company",
        description: "Header with logo and company name",
        html: `<div style="display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:2px solid #e5e7eb;margin-bottom:24px;">
  <div data-pdf-slot="image" data-pdf-id="logo-${Date.now()}" data-pdf-label="Company Logo" style="width:60px;height:60px;background:#f3f4f6;border-radius:6px;display:flex;align-items:center;justify-content:center;">
    <span style="color:#9ca3af;font-size:10px;">Logo</span>
  </div>
  <div>
    <h1 data-pdf-slot="text" data-pdf-id="company-${Date.now()}" data-pdf-label="Company Name" style="font-size:20px;font-weight:700;color:#111;margin:0;">Company Name</h1>
    <p data-pdf-slot="text" data-pdf-id="tagline-${Date.now()}" data-pdf-label="Tagline" style="font-size:12px;color:#6b7280;margin:2px 0 0;">Your tagline here</p>
  </div>
</div>`,
      },
      {
        label: "Footer",
        description: "Page footer with contact info",
        html: `<div style="border-top:1px solid #e5e7eb;padding:12px 0;margin-top:32px;display:flex;justify-content:space-between;font-family:sans-serif;font-size:11px;color:#9ca3af;">
  <p data-pdf-slot="text" data-pdf-id="footer-left-${Date.now()}" data-pdf-label="Footer Left" style="margin:0;">Company Name · phone · email</p>
  <p data-pdf-slot="text" data-pdf-id="footer-right-${Date.now()}" data-pdf-label="Footer Right" style="margin:0;">Page 1</p>
</div>`,
      },
    ],
  },
  {
    labelKey: "pdfTemplates.pageLayouts",
    items: [
      {
        label: "A4 catalog page",
        description: "Full A4 page with header, grid, footer",
        html: `<div style="width:794px;min-height:1123px;padding:40px;font-family:sans-serif;box-sizing:border-box;position:relative;">
  <!-- Header -->
  <div style="display:flex;align-items:center;gap:16px;padding-bottom:20px;border-bottom:2px solid #111;margin-bottom:24px;">
    <div data-pdf-slot="image" data-pdf-id="header-logo-${Date.now()}" data-pdf-label="Logo" style="width:50px;height:50px;background:#f3f4f6;border-radius:4px;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:9px;color:#aaa;">Logo</span>
    </div>
    <h1 data-pdf-slot="text" data-pdf-id="header-title-${Date.now()}" data-pdf-label="Catalog Title" style="font-size:22px;font-weight:700;color:#111;margin:0;">Product Catalog</h1>
  </div>

  <!-- Product grid (3 columns) -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:auto;">
    <!-- Repeat this block as needed -->
    <div style="border:1px solid #e5e7eb;border-radius:6px;padding:12px;">
      <div data-pdf-slot="image" data-pdf-id="p1-img-${Date.now()}" data-pdf-label="Product 1 Image" style="width:100%;height:110px;background:#f9fafb;border-radius:4px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;">
        <span style="font-size:10px;color:#aaa;">Image</span>
      </div>
      <p data-pdf-slot="text" data-pdf-id="p1-name-${Date.now()}" data-pdf-label="Product 1 Name" style="font-size:12px;font-weight:600;margin:0 0 4px;">Product Name</p>
      <p data-pdf-slot="text" data-pdf-id="p1-price-${Date.now()}" data-pdf-label="Product 1 Price" style="font-size:13px;font-weight:700;color:#059669;margin:0;">$0.00</p>
    </div>
  </div>

  <!-- Footer -->
  <div style="position:absolute;bottom:24px;left:40px;right:40px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;">
    <span data-pdf-slot="text" data-pdf-id="footer-co-${Date.now()}" data-pdf-label="Footer Company">Company · Contact</span>
    <span data-pdf-slot="text" data-pdf-id="footer-pg-${Date.now()}" data-pdf-label="Footer Page">Page 1</span>
  </div>
</div>`,
      },
    ],
  },
]

// ── Editor component ──────────────────────────────────────────────────────────

function EditorForm({
  initialName,
  initialDescription,
  initialHtml,
  isSaving,
  onSave,
}: {
  initialName: string
  initialDescription: string
  initialHtml: string
  isSaving: boolean
  onSave: (values: { name: string; description: string; html_content: string }) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [html, setHtml] = useState(initialHtml)
  const [previewHtml, setPreviewHtml] = useState(initialHtml)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setPreviewHtml(html), 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [html])

  const insertSnippet = useCallback((snippet: string) => {
    const el = textareaRef.current
    if (!el) {
      setHtml((prev) => prev + "\n" + snippet)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = html.slice(0, start) + "\n" + snippet + "\n" + html.slice(end)
    setHtml(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + snippet.length + 2
      el.focus()
    })
  }, [html])

  return (
    <div className="flex flex-1 flex-col gap-0 overflow-hidden">
      {/* Meta fields */}
      <div className="flex gap-3 border-b px-4 py-3">
        <div className="flex flex-1 flex-col gap-1">
          <Label className="sr-only">{t("pdfTemplates.templateName")}</Label>
          <Input
            placeholder={t("pdfTemplates.templateName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm font-medium"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label className="sr-only">{t("pdfTemplates.descriptionPlaceholder")}</Label>
          <Input
            placeholder={t("pdfTemplates.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <Button
          size="sm"
          onClick={() => onSave({ name, description, html_content: html })}
          disabled={isSaving || !name.trim() || !html.trim()}
        >
          {isSaving ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
          {t("common.save")}
        </Button>
      </div>

      {/* Main split pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: code editor */}
        <div className="flex w-1/2 flex-col border-r">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-1.5">
              <CodeIcon className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">{t("pdfTemplates.htmlContent")}</span>
            </div>
            {/* Slot helpers dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                  {t("pdfTemplates.slotHelpers")}
                  <ChevronDownIcon className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 max-h-96 overflow-y-auto">
                {SNIPPET_GROUPS.map((group) => (
                  <div key={group.labelKey}>
                    <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {t(group.labelKey)}
                    </DropdownMenuLabel>
                    {group.items.map((item) => (
                      <DropdownMenuItem
                        key={item.label}
                        onClick={() => insertSnippet(item.html)}
                        className="flex flex-col items-start gap-0.5"
                      >
                        <span className="text-xs font-medium">{item.label}</span>
                        <span className="text-xs text-muted-foreground">{item.description}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Textarea
            ref={textareaRef}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            className="flex-1 resize-none rounded-none border-0 font-mono text-xs focus-visible:ring-0"
            placeholder={`<div style="padding: 40px; font-family: sans-serif;">\n  <h1 data-pdf-slot="text" data-pdf-id="title" data-pdf-label="Title">Your Title</h1>\n</div>`}
            spellCheck={false}
          />
        </div>

        {/* Right: live preview */}
        <div className="flex w-1/2 flex-col">
          <div className="flex items-center gap-1.5 border-b px-3 py-2">
            <EyeIcon className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">{t("pdfTemplates.livePreview")}</span>
            <span className="ml-auto text-xs text-muted-foreground italic">
              {t("pdfTemplates.updatesAsYouType")}
            </span>
          </div>
          <div className="flex-1 overflow-auto bg-white">
            {previewHtml.trim() ? (
              <iframe
                srcDoc={previewHtml}
                className="block w-full"
                style={{ minHeight: 200, display: "block" }}
                sandbox="allow-same-origin"
                scrolling="no"
                title="live preview"
                onLoad={(e) => {
                  const doc = e.currentTarget.contentDocument
                  if (!doc) return
                  const h = Math.max(
                    doc.body?.scrollHeight ?? 0,
                    doc.body?.offsetHeight ?? 0,
                    doc.documentElement?.scrollHeight ?? 0,
                    doc.documentElement?.offsetHeight ?? 0,
                  )
                  e.currentTarget.style.height = h + "px"
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Start typing HTML on the left…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── New template page ─────────────────────────────────────────────────────────

function NewTemplateEditor() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createMutation = useCreatePdfTemplateMutation()

  async function handleSave(values: { name: string; description: string; html_content: string }) {
    try {
      await createMutation.mutateAsync({
        name: values.name,
        description: values.description || undefined,
        html_content: values.html_content,
      })
      toast.success(t("pdfTemplates.templateCreated"))
      void navigate({ to: ROUTES.CREATE_PDF })
    } catch {
      toast.error(t("common.error"))
    }
  }

  return (
    <EditorForm
      initialName=""
      initialDescription=""
      initialHtml=""
      isSaving={createMutation.isPending}
      onSave={handleSave}
    />
  )
}

// ── Edit template page ────────────────────────────────────────────────────────

function EditTemplateEditor({ templateId }: { templateId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: template, isLoading, isError } = usePdfTemplateQuery(templateId)
  const updateMutation = useUpdatePdfTemplateMutation()

  async function handleSave(values: { name: string; description: string; html_content: string }) {
    try {
      await updateMutation.mutateAsync({
        id: templateId,
        data: {
          name: values.name,
          description: values.description || undefined,
          html_content: values.html_content,
        },
      })
      toast.success(t("pdfTemplates.templateUpdated"))
      void navigate({ to: ROUTES.CREATE_PDF })
    } catch {
      toast.error(t("common.error"))
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || !template) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        {t("common.error")}
      </div>
    )
  }

  return (
    <EditorForm
      initialName={template.name}
      initialDescription={template.description ?? ""}
      initialHtml={template.html_content ?? ""}
      isSaving={updateMutation.isPending}
      onSave={handleSave}
    />
  )
}

// ── Page shell ────────────────────────────────────────────────────────────────

export function PdfTemplateEditorPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // templateId is undefined on the /new route
  let templateId: string | undefined
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const params = useParams({ from: "/_app/create-pdf/templates/$templateId" })
    templateId = params.templateId
  } catch {
    templateId = undefined
  }

  const isEdit = !!templateId
  const title = isEdit ? t("pdfTemplates.editTemplate") : t("pdfTemplates.newTemplate")

  return (
    <div
      className="-m-6 flex flex-col overflow-hidden"
      style={{ height: "calc(100vh - 57px)" }}
    >
      {/* Sticky header */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => void navigate({ to: ROUTES.CREATE_PDF })}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Separator orientation="vertical" className="h-4" />
        <div className="flex items-center gap-2">
          <PencilIcon className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">{title}</h1>
        </div>
      </div>

      {isEdit ? (
        <EditTemplateEditor templateId={templateId!} />
      ) : (
        <NewTemplateEditor />
      )}
    </div>
  )
}
