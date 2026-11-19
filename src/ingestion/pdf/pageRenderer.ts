import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PageRenderOptions {
  maxDimensionPx?: number;
  format?: 'image/webp' | 'image/jpeg';
  quality?: number;
}

export interface RenderedPdfPageImage {
  mimeType: string;
  dataBase64: string;
  width: number;
  height: number;
}

const DEFAULT_MAX_DIMENSION_PX = 1400;
const DEFAULT_FORMAT: 'image/webp' | 'image/jpeg' = 'image/webp';
const DEFAULT_QUALITY = 0.85;

const isNodeRuntime =
  typeof process !== 'undefined' && typeof process.versions?.node === 'string';

let workerConfigured = false;

/**
 * Configures pdf.js GlobalWorkerOptions for browser/WebWorker environments
 * while preserving Node/Vitest fake-worker resolution.
 */
export function ensurePdfJsWorkerConfigured(): void {
  if (workerConfigured) return;
  workerConfigured = true;
  if (!isNodeRuntime) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.mjs',
      import.meta.url,
    ).toString();
  }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Renders a single PDF page to a base64-encoded raster image (WebP or JPEG),
 * scaled so its largest dimension does not exceed maxDimensionPx (default 1400px).
 * Supports OffscreenCanvas (Web Workers) and HTMLCanvasElement (Browser main thread).
 */
export async function renderPdfPageToBase64(
  pdfData: Uint8Array,
  pageNumber: number,
  options?: PageRenderOptions,
): Promise<RenderedPdfPageImage> {
  const maxDimensionPx = options?.maxDimensionPx ?? DEFAULT_MAX_DIMENSION_PX;
  const format = options?.format ?? DEFAULT_FORMAT;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  const hasDomCanvas =
    typeof document !== 'undefined' && typeof document.createElement === 'function';

  if (!hasOffscreenCanvas && !hasDomCanvas) {
    throw new Error(
      'Canvas environment unavailable: neither OffscreenCanvas nor document.createElement("canvas") is defined in this runtime.',
    );
  }

  ensurePdfJsWorkerConfigured();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfData),
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });

  const pdfDoc = await loadingTask.promise;
  try {
    if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
      throw new Error(
        `Invalid pageNumber ${pageNumber}: document has ${pdfDoc.numPages} page(s).`,
      );
    }

    const page = await pdfDoc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1.0 });
    const maxEdge = Math.max(baseViewport.width, baseViewport.height, 1);
    const scale = maxDimensionPx / maxEdge;
    const viewport = page.getViewport({ scale });

    const targetWidth = Math.max(1, Math.round(viewport.width));
    const targetHeight = Math.max(1, Math.round(viewport.height));

    if (hasOffscreenCanvas) {
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to acquire 2D rendering context from OffscreenCanvas.');
      }

      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const blob = await canvas.convertToBlob({ type: format, quality });
      const buffer = await blob.arrayBuffer();
      const dataBase64 = uint8ArrayToBase64(new Uint8Array(buffer));

      return {
        mimeType: blob.type || format,
        dataBase64,
        width: targetWidth,
        height: targetHeight,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D rendering context from HTMLCanvasElement.');
    }

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    const dataUrl = canvas.toDataURL(format, quality);
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) {
      throw new Error('Unexpected canvas.toDataURL() output without base64 payload.');
    }
    const header = dataUrl.slice(0, commaIdx);
    const mimeMatch = /^data:([^;]+);base64$/i.exec(header);
    const actualMimeType = mimeMatch?.[1] ?? format;

    return {
      mimeType: actualMimeType,
      dataBase64: dataUrl.slice(commaIdx + 1),
      width: targetWidth,
      height: targetHeight,
    };
  } finally {
    await pdfDoc.destroy();
  }
}
