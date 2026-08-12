/**
 * Low-level PDFium plumbing: WASM init plus the malloc/read/write helpers
 * every PDFium C call needs (pointers, UTF-16LE strings, float structs).
 *
 * Contains no file-system or network access, so the same code runs in the
 * main thread, in a Web Worker, and in Node test scripts — only the way the
 * .wasm bytes are obtained differs (see loader.ts).
 *
 * This is the engine layer for the Create PDF module's in-place editing.
 * It replaces the previous pdf.js + Canvas + PyMuPDF pipeline, in which
 * three different text engines had to be kept in agreement by hand; here
 * one engine renders, edits and saves, so preview and download cannot
 * disagree by construction.
 */
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium"

export type { WrappedPdfiumModule }

export async function initPdfium(wasmBinary: ArrayBuffer | Uint8Array): Promise<WrappedPdfiumModule> {
  const pdfium = await init({ wasmBinary })
  pdfium.PDFiumExt_Init()
  return pdfium
}

/**
 * Scratch allocator for one unit of work. Every pointer handed to PDFium
 * comes from here and is released together by free(), which keeps the
 * WASM heap from growing across a long editing session.
 */
export class Scratch {
  private pdfium: WrappedPdfiumModule
  private ptrs: number[] = []

  constructor(pdfium: WrappedPdfiumModule) {
    this.pdfium = pdfium
  }

  malloc(bytes: number): number {
    const ptr = this.pdfium.pdfium.wasmExports.malloc(Math.max(1, bytes))
    this.ptrs.push(ptr)
    return ptr
  }

  writeBuffer(buf: Uint8Array): number {
    const ptr = this.malloc(buf.length)
    // HEAPU8 exists at runtime (Emscripten always exposes it) but isn't in
    // the ambient EmscriptenModule types this package ships against.
    ;(this.pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(buf, ptr)
    return ptr
  }

  writeUtf16(str: string): number {
    // +1 char for the NUL terminator FPDFText_SetText expects.
    const bytes = (str.length + 1) * 2
    const ptr = this.malloc(bytes)
    this.pdfium.pdfium.stringToUTF16(str, ptr, bytes)
    return ptr
  }

  readUtf16(ptr: number): string {
    return this.pdfium.pdfium.UTF16ToString(ptr)
  }

  readUtf8(ptr: number): string {
    return this.pdfium.pdfium.UTF8ToString(ptr)
  }

  readFloat(ptr: number): number {
    return this.pdfium.pdfium.getValue(ptr, "float")
  }

  readInt(ptr: number): number {
    return this.pdfium.pdfium.getValue(ptr, "i32")
  }

  setFloat(ptr: number, value: number): void {
    this.pdfium.pdfium.setValue(ptr, value, "float")
  }

  setInt(ptr: number, value: number): void {
    this.pdfium.pdfium.setValue(ptr, value, "i32")
  }

  /** FS_MATRIX layout: 6 consecutive floats {a,b,c,d,e,f}, 24 bytes. */
  readMatrix(ptr: number): PdfMatrix {
    return {
      a: this.readFloat(ptr + 0),
      b: this.readFloat(ptr + 4),
      c: this.readFloat(ptr + 8),
      d: this.readFloat(ptr + 12),
      e: this.readFloat(ptr + 16),
      f: this.readFloat(ptr + 20),
    }
  }

  writeMatrix(a: number, b: number, c: number, d: number, e: number, f: number): number {
    const ptr = this.malloc(24)
    this.setFloat(ptr + 0, a)
    this.setFloat(ptr + 4, b)
    this.setFloat(ptr + 8, c)
    this.setFloat(ptr + 12, d)
    this.setFloat(ptr + 16, e)
    this.setFloat(ptr + 20, f)
    return ptr
  }

  /**
   * Copies out of the WASM heap into a standalone array. Must be a COPY,
   * not a view: any later PDFium call can reallocate the heap, which would
   * silently detach or repoint a view onto it.
   */
  readBytes(ptr: number, len: number): Uint8Array {
    const heap = (this.pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8
    return new Uint8Array(heap.subarray(ptr, ptr + len))
  }

  free(): void {
    for (const ptr of this.ptrs) {
      try {
        this.pdfium.pdfium.wasmExports.free(ptr)
      } catch {
        // Never let a double-free abort an edit — the heap is discarded
        // with the session anyway.
      }
    }
    this.ptrs = []
  }
}

export interface PdfMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface PdfRect {
  left: number
  bottom: number
  right: number
  top: number
}

export const PAGEOBJ_TYPE = {
  UNKNOWN: 0,
  TEXT: 1,
  PATH: 2,
  IMAGE: 3,
  SHADING: 4,
  FORM: 5,
} as const

export const FONT_TYPE = {
  TYPE1: 1,
  TRUETYPE: 2,
} as const

/** Same Hebrew block the previous Python implementation checked
 * (pdf_editor.py's HEBREW_CHARS), kept identical so the two never disagree
 * about what is right-to-left. */
export function isRtlText(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x0590 && cp < 0x0600) return true
  }
  return false
}
