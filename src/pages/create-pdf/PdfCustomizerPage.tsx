import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeftIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { usePdfTemplateQuery } from "@/features/pdfTemplates/api"
import { ROUTES } from "@/lib/routes"
import { Button } from "@/components/ui/button"

// ── What gets injected into the iframe ────────────────────────────────────────
//
// Runs entirely inside the iframe. Goals:
//   • Text slots → click to type directly (contenteditable, select-all on first click)
//   • Image slots → clear placeholder text, show upload zone, file picker on click
//   • Both → subtle visual ring so users know what's editable
//   • postMessage → parent gets height updates & can request final clean HTML
//
const IFRAME_INJECTION = `
<style>
  /* ── Text slots ── */
  [data-pdf-slot="text"] {
    outline: none !important;
    cursor: text !important;
    min-height: 1.2em;
    transition: box-shadow 0.12s ease, background 0.12s ease;
    border-radius: 2px;
  }
  [data-pdf-slot="text"]:hover {
    box-shadow: inset 0 0 0 2px rgba(59,130,246,0.3) !important;
  }
  [data-pdf-slot="text"]:focus {
    box-shadow: inset 0 0 0 2px rgba(59,130,246,0.65) !important;
    background: rgba(59,130,246,0.03) !important;
  }

  /* ── Image slots ── */
  [data-pdf-slot="image"] {
    cursor: pointer !important;
    transition: box-shadow 0.12s ease !important;
  }
  [data-pdf-slot="image"]:hover {
    box-shadow: 0 0 0 2px rgba(245,158,11,0.55) !important;
  }

  /* Upload zone (replaces placeholder text inside image slots) */
  ._pz {
    width: 100%;
    height: 100%;
    min-height: 72px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    background: rgba(245,158,11,0.07);
    border: 1.5px dashed rgba(180,120,0,0.35);
    box-sizing: border-box;
    pointer-events: none;
    font-family: system-ui,-apple-system,sans-serif;
    transition: background 0.12s ease;
  }
  [data-pdf-slot="image"]:hover ._pz {
    background: rgba(245,158,11,0.14);
    border-color: rgba(180,120,0,0.55);
  }
  ._pz svg {
    width: 26px; height: 26px;
    stroke: rgba(120,80,0,0.55);
    flex-shrink: 0;
  }
  ._pz span {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: rgba(100,65,0,0.5);
  }
</style>

<script>
(function () {
  var UPLOAD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"/></svg>';

  /* ──────────── TEXT SLOTS ──────────── */
  document.querySelectorAll('[data-pdf-slot="text"]').forEach(function (el) {
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.dataset.firstClick = 'true';

    el.addEventListener('click', function () {
      // On the very first click: select all so users can just start typing
      if (el.dataset.firstClick === 'true') {
        el.dataset.firstClick = 'false';
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      }
    });
  });

  /* ──────────── IMAGE SLOTS ──────────── */
  document.querySelectorAll('[data-pdf-slot="image"]').forEach(function (el) {
    var isImg = el.tagName.toLowerCase() === 'img';

    // Hidden file input — appended to body so it's never inside the slot
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px;';
    document.body.appendChild(picker);

    if (!isImg) {
      // Clear whatever placeholder text the template put here and replace with
      // a centered upload zone that fills the slot completely
      el.innerHTML = '<div class="_pz">' + UPLOAD_SVG + '<span>Click to upload</span></div>';
    } else {
      // For <img> tags: show a placeholder background
      if (!el.getAttribute('src') || el.getAttribute('src') === '') {
        el.style.background = 'rgba(245,158,11,0.08)';
        el.style.minHeight = el.style.height || '80px';
      }
    }

    el.addEventListener('click', function (e) {
      e.stopPropagation();
      picker.click();
    });

    picker.addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        var dataUrl = ev.target.result;
        if (isImg) {
          el.src = dataUrl;
          el.style.background = '';
          el.style.objectFit = 'cover';
        } else {
          // Replace the upload zone with the actual image
          el.innerHTML = '<img src="' + dataUrl + '" style="width:100%;height:100%;object-fit:cover;display:block;" />';
        }
        reportHeight();
      };
      reader.readAsDataURL(file);
      picker.value = '';
    });
  });

  /* ──────────── HEIGHT REPORTING ──────────── */
  function reportHeight() {
    var h = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
    window.parent.postMessage({ type: 'pdf-height', value: h }, '*');
  }

  /* ──────────── SLOT COUNT ──────────── */
  window.parent.postMessage({
    type: 'pdf-slots',
    value: document.querySelectorAll('[data-pdf-slot]').length
  }, '*');

  window.addEventListener('load', reportHeight);
  reportHeight();
  setTimeout(reportHeight, 300);
  if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.body);

  /* ──────────── EXPORT HANDLER ──────────── */
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'pdf-get-content') return;

    var clone = document.documentElement.cloneNode(true);

    // Remove all things we injected
    clone.querySelectorAll('._pz, script, input[type="file"], style').forEach(function (n) { n.remove(); });

    // Clean slot markers & interactive styles from every slot
    clone.querySelectorAll('[data-pdf-slot]').forEach(function (el) {
      ['data-pdf-slot','data-pdf-id','data-pdf-label','contenteditable','spellcheck','data-first-click']
        .forEach(function (a) { el.removeAttribute(a); });
      el.style.cursor = '';
      el.style.boxShadow = '';
      el.style.background = '';
    });

    window.parent.postMessage({
      type: 'pdf-content',
      html: '<!DOCTYPE html>' + clone.outerHTML
    }, '*');
  });
})();
</script>
`

function buildSrcDoc(templateHtml: string): string {
  if (templateHtml.includes("</body>")) {
    return templateHtml.replace("</body>", IFRAME_INJECTION + "</body>")
  }
  return templateHtml + IFRAME_INJECTION
}

// ── Request clean HTML from the iframe ───────────────────────────────────────

function requestContent(iframe: HTMLIFrameElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("iframe timeout")), 8000)
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== "pdf-content") return
      clearTimeout(timer)
      window.removeEventListener("message", handler)
      resolve(e.data.html as string)
    }
    window.addEventListener("message", handler)
    iframe.contentWindow?.postMessage({ type: "pdf-get-content" }, "*")
  })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PdfCustomizerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { templateId } = useParams({ from: "/_app/create-pdf/customize/$templateId" })

  const { data: template, isLoading, isError } = usePdfTemplateQuery(templateId)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeHeight, setIframeHeight] = useState(600)
  const [slotCount, setSlotCount] = useState<number | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  // Listen for height / slot-count messages from inside the iframe
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data
      if (!d) return
      if (d.type === "pdf-height" && typeof d.value === "number") {
        setIframeHeight(Math.max(d.value, 200))
      }
      if (d.type === "pdf-slots" && typeof d.value === "number") {
        setSlotCount(d.value)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  async function handleDownload() {
    if (!template || !iframeRef.current) return
    setIsDownloading(true)
    try {
      // 1. Ask the iframe for the fully filled, cleaned HTML
      const finalHtml = await requestContent(iframeRef.current)

      // 2. Render that HTML at A4 width (794 px) in a hidden off-screen iframe
      const renderFrame = document.createElement("iframe")
      renderFrame.style.cssText =
        "position:fixed;top:-9999px;left:-9999px;width:794px;border:0;"
      document.body.appendChild(renderFrame)

      const renderDoc = renderFrame.contentDocument!
      renderDoc.open()
      renderDoc.write(finalHtml)
      renderDoc.close()

      // 3. Wait for every image inside that iframe to finish loading
      await Promise.all(
        Array.from(renderDoc.images).map(
          (img) =>
            new Promise<void>((res) => {
              if (img.complete) { res(); return }
              img.onload = () => res()
              img.onerror = () => res()
              setTimeout(res, 5000)
            }),
        ),
      )

      // 4. Size the render frame to the full document height before capturing
      const b = renderDoc.body
      const r = renderDoc.documentElement
      const fullH = Math.max(b.scrollHeight, b.offsetHeight, r.scrollHeight, r.offsetHeight)
      renderFrame.style.height = `${fullH}px`
      await new Promise((res) => setTimeout(res, 80))

      const { default: html2canvas } = await import("html2canvas")
      const { default: jsPDF } = await import("jspdf")

      const canvas = await html2canvas(b, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        scrollX: 0,
        scrollY: 0,
        windowWidth: 794,
        windowHeight: fullH,
        onclone: (doc) => {
          // Remove external sheets to prevent oklch color-parse errors
          doc.querySelectorAll('link[rel="stylesheet"]').forEach((n) => n.remove())
        },
      })

      document.body.removeChild(renderFrame)

      // 5. Slice the canvas across A4 pages and build the PDF
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const scale = pageW / canvas.width
      const sliceH = Math.floor(pageH / scale)

      let yOffset = 0
      let pageIdx = 0
      while (yOffset < canvas.height) {
        if (pageIdx > 0) pdf.addPage()
        const h = Math.min(canvas.height - yOffset, sliceH)
        const slice = document.createElement("canvas")
        slice.width = canvas.width
        slice.height = h
        slice.getContext("2d")!.drawImage(canvas, 0, yOffset, canvas.width, h, 0, 0, canvas.width, h)
        pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, h * scale)
        yOffset += h
        pageIdx++
      }

      pdf.save(`${template.name}.pdf`)
      toast.success(t("pdfTemplates.pdfDownloaded"))
    } catch (err) {
      console.error(err)
      toast.error(t("common.error"))
    } finally {
      setIsDownloading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || !template) {
    return (
      <div className="flex min-h-96 flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{t("common.error")}</p>
        <Button variant="outline" size="sm" onClick={() => void navigate({ to: ROUTES.CREATE_PDF })}>
          <ArrowLeftIcon className="size-4" />
          {t("common.back")}
        </Button>
      </div>
    )
  }

  return (
    <div className="-m-6 flex flex-col" style={{ minHeight: "calc(100vh - 57px)" }}>

      {/* ── Sticky toolbar — theme-aware, works in dark AND light mode ── */}
      <header className="sticky z-20 flex items-center gap-3 border-b bg-background/90 px-5 py-3 backdrop-blur-md" style={{ top: 57 }}>

        {/* Back */}
        <button
          type="button"
          onClick={() => void navigate({ to: ROUTES.CREATE_PDF })}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          <span>{t("common.back")}</span>
        </button>

        <span className="select-none text-muted-foreground/40">/</span>

        {/* Template name */}
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {template.name}
        </span>

        {/* Slot count badge */}
        {slotCount !== null && slotCount > 0 && (
          <span className="hidden shrink-0 rounded-full border bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground sm:inline">
            {slotCount} {t("pdfTemplates.editableSlots").toLowerCase()}
          </span>
        )}

        {/* Download */}
        <Button
          onClick={() => void handleDownload()}
          disabled={isDownloading}
          size="sm"
          className="ml-auto shrink-0 gap-1.5 rounded-full px-5"
        >
          {isDownloading
            ? <Loader2Icon className="size-3.5 animate-spin" />
            : <DownloadIcon className="size-3.5" />
          }
          {isDownloading ? t("pdfTemplates.generating") : t("pdfTemplates.downloadPdf")}
        </Button>
      </header>

      {/* ── "Document desk" — the warm background the paper sits on ── */}
      <div className="flex-1" style={{ background: "#EEECE6" }}>

        {/* Subtle usage hint */}
        {slotCount !== null && slotCount > 0 && (
          <p className="pt-4 text-center text-[11px] text-stone-400">
            {t("pdfTemplates.slotLegend")}
          </p>
        )}

        {/* Paper — full width of the available content area */}
        <div
          className="mx-auto my-6"
          style={{
            /* Fill the available horizontal space; leave breathing room */
            width: "calc(100% - 48px)",
            maxWidth: "1200px",
            background: "#fff",
            borderRadius: "3px",
            overflow: "hidden",
            boxShadow:
              "0 1px 2px rgba(0,0,0,.05),"
              + "0 4px 12px rgba(0,0,0,.08),"
              + "0 20px 40px rgba(0,0,0,.1)",
          }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={buildSrcDoc(template.html_content)}
            title={template.name}
            className="block w-full"
            style={{ height: iframeHeight, border: "none" }}
          />
        </div>

        {/* Bottom breathing room */}
        <div className="h-12" />
      </div>
    </div>
  )
}
