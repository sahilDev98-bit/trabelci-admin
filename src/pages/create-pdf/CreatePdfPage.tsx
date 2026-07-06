import { useTranslation } from "react-i18next"
import { FileTextIcon, LayoutTemplateIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function CreatePdfPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("nav.createPdf")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a template and generate a product catalog PDF.
          </p>
        </div>
        <Button disabled>
          <PlusIcon className="size-4" />
          New PDF
        </Button>
      </header>

      {/* Templates section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Templates
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Placeholder template cards */}
          {Array.from({ length: 3 }).map((_, i) => (
            <Card
              key={i}
              className="cursor-not-allowed opacity-50 bg-card/70 border-dashed"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="grid size-8 place-items-center rounded-md bg-muted">
                    <LayoutTemplateIcon className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">Template {i + 1}</CardTitle>
                    <CardDescription className="text-xs">Coming soon</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-28 rounded-md bg-muted/40 flex items-center justify-center">
                  <FileTextIcon className="size-8 text-muted-foreground/40" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Empty state */}
      <Card className="bg-card/70 border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-muted">
            <FileTextIcon className="size-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No PDFs generated yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Select a template above to get started.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
