/**
 * Turning a file someone picked into something the PDF engine can use.
 *
 * One module rather than the three copies of `createImageBitmap(file)` this
 * replaces, because those three had the same bug and only one of them would
 * ever have been found: SVG.
 *
 * Browsers refuse SVG in createImageBitmap — measured, not assumed: it throws
 * "The source image could not be decoded", while a PNG through the identical
 * path succeeds. So dropping a supplier logo on a page failed with an error
 * and nothing landed, and supplier logos are very often SVG. They decode
 * perfectly well through an <img> element; that is the route taken here.
 */

/**
 * How large an SVG is rasterised, measured on its longest edge.
 *
 * SVG is vector and has no true pixel size, so one has to be chosen. Its
 * declared size is usually far too small — a 120x60 logo drawn 180pt wide on
 * a print page would be visibly soft — and rasterising huge wastes megabytes
 * inside every saved PDF. This is the compromise: sharp at any size a logo is
 * realistically placed at, without bloating the file.
 */
const SVG_RASTER_LONG_EDGE_PX = 1024

/**
 * A last-resort size for an SVG that declares none.
 *
 * An SVG with only a viewBox, or with percentage width/height, reports
 * naturalWidth 0 in some browsers. Rasterising that produces a zero-sized
 * canvas, and toBlob on a zero-sized canvas returns null — so without this
 * the failure would come back as the unhelpful "Could not convert that image".
 */
const SVG_FALLBACK_SIZE_PX = 512

const isSvg = (file: File): boolean =>
  file.type.toLowerCase().includes("svg") || /\.svg$/i.test(file.name)

/**
 * Draws an SVG into a canvas at a usable resolution.
 *
 * The object URL is revoked in a finally, and only after the image has
 * loaded: revoking earlier cancels the decode in some browsers, which fails
 * intermittently and looks like a corrupt file.
 */
async function rasteriseSvg(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("That SVG could not be read"))
      img.src = url
    })

    const naturalWidth = img.naturalWidth || SVG_FALLBACK_SIZE_PX
    const naturalHeight = img.naturalHeight || SVG_FALLBACK_SIZE_PX
    // Only ever scaled UP to the target; an SVG that already declares a large
    // size is drawn as it is rather than shrunk.
    const scale = Math.max(1, SVG_RASTER_LONG_EDGE_PX / Math.max(naturalWidth, naturalHeight))

    const canvas = document.createElement("canvas")
    canvas.width = Math.round(naturalWidth * scale)
    canvas.height = Math.round(naturalHeight * scale)
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Could not read that image")
    // Nothing is painted behind it, so a logo's transparent background stays
    // transparent all the way into the PDF.
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * The pixel size of a picked image, for choosing the box it goes in.
 *
 * Returns plain numbers rather than an ImageBitmap so callers cannot forget
 * to close one — the three call sites this replaces each had to.
 */
export async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  if (isSvg(file)) {
    const canvas = await rasteriseSvg(file)
    return { width: canvas.width, height: canvas.height }
  }
  const bitmap = await createImageBitmap(file)
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

/**
 * PDFium accepts PNG and JPEG directly; anything else is converted first, so
 * a WebP, GIF or SVG logo still does what the user expects.
 *
 * PNG and JPEG are passed through UNTOUCHED — the original bytes, not a
 * re-encode. Re-encoding a photograph would lose quality for nothing.
 */
export async function toEmbeddableImage(
  file: File,
): Promise<{ bytes: ArrayBuffer; kind: "png" | "jpeg" }> {
  const type = file.type.toLowerCase()
  if (type === "image/png") return { bytes: await file.arrayBuffer(), kind: "png" }
  if (type === "image/jpeg" || type === "image/jpg") return { bytes: await file.arrayBuffer(), kind: "jpeg" }

  const canvas = isSvg(file) ? await rasteriseSvg(file) : await drawToCanvas(file)
  // PNG rather than JPEG: the source may have transparency (a cut-out logo),
  // and re-encoding that to JPEG would fill it with black.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("Could not convert that image")
  return { bytes: await blob.arrayBuffer(), kind: "png" }
}

async function drawToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Could not read that image")
    ctx.drawImage(bitmap, 0, 0)
    return canvas
  } finally {
    bitmap.close()
  }
}
