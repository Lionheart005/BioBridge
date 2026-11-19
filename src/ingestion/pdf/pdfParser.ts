import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { ParsedBlock, ParsedPage } from '@/core/schemas/document.schema';
import { repairLineBreakHyphens } from '@/core/utils/textNormalize';
import {
  reconstructPageTextLayout,
  stripRepeatedHeadersAndFooters,
  type LayoutLine,
  type PdfTextItem,
} from './columnLayout';
import { detectMathAndFigures } from './mathAndFigureDetector';
import { ensurePdfJsWorkerConfigured } from './pageRenderer';

interface RawPdfPageData {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  items: PdfTextItem[];
  operatorIds: number[];
  lines: LayoutLine[];
}

function isTextItem(item: unknown): item is TextItem {
  return typeof item === 'object' && item !== null && 'str' in item && 'transform' in item;
}

function computeMedianHeight(pages: Array<{ lines: LayoutLine[] }>, fallback = 11): number {
  const heights: number[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.height > 0 && line.text.trim().length > 0) {
        heights.push(line.height);
      }
    }
  }
  if (heights.length === 0) return fallback;
  heights.sort((a, b) => a - b);
  const mid = Math.floor(heights.length / 2);
  return heights.length % 2 === 0
    ? (heights[mid - 1] + heights[mid]) / 2
    : heights[mid];
}

function isHeadingLine(line: LayoutLine, medianHeight: number): boolean {
  const trimmed = line.text.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return false;
  if (line.height < medianHeight * 1.25) return false;
  // Exclude regular sentences that merely happen to be in a slightly larger block
  if (trimmed.length > 80 && /[.!?]$/.test(trimmed)) return false;
  return true;
}

function buildBlocksFromLines(
  lines: LayoutLine[],
  medianHeight: number,
  documentId: string,
  sectionStack: Array<{ depth: number; title: string }>,
  blockCounterRef: { value: number },
): { blocks: ParsedBlock[]; pageSectionPath: string[] } {
  const nextId = () => {
    blockCounterRef.value += 1;
    return `${documentId}:b:${blockCounterRef.value}`;
  };

  const currentSectionPath = (): string[] => sectionStack.map((s) => s.title);
  let capturedPageSectionPath: string[] | null = null;
  const blocks: ParsedBlock[] = [];
  let paragraphLines: LayoutLine[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const raw = paragraphLines.map((l) => l.text).join('\n');
    const content = repairLineBreakHyphens(raw).trim();
    paragraphLines = [];
    if (content.length === 0) return;
    if (capturedPageSectionPath === null) {
      capturedPageSectionPath = currentSectionPath();
    }
    blocks.push({
      id: nextId(),
      type: 'paragraph',
      content,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeadingLine(line, medianHeight)) {
      flushParagraph();
      const depth = line.height >= medianHeight * 1.5 ? 1 : 2;
      const title = line.text.trim();
      while (
        sectionStack.length > 0 &&
        sectionStack[sectionStack.length - 1].depth >= depth
      ) {
        sectionStack.pop();
      }
      sectionStack.push({ depth, title });
      if (capturedPageSectionPath === null) {
        capturedPageSectionPath = currentSectionPath();
      }
      blocks.push({
        id: nextId(),
        type: 'heading',
        content: `${'#'.repeat(depth)} ${title}`,
      });
      continue;
    }

    if (paragraphLines.length > 0) {
      const prev = paragraphLines[paragraphLines.length - 1];
      const yGap = prev.y - line.y;
      const baseH = Math.max(prev.height, line.height, 10);
      if (line.columnIndex !== prev.columnIndex || yGap > baseH * 1.5) {
        flushParagraph();
      }
    }
    paragraphLines.push(line);
  }

  flushParagraph();

  return {
    blocks,
    pageSectionPath: capturedPageSectionPath ?? currentSectionPath(),
  };
}

/**
 * Parses a PDF binary buffer into structured ParsedPages with column layout reconstruction,
 * header/footer stripping, heading/sectionPath tracking, and math/figure anomaly detection.
 */
export async function parsePdfDocument(
  data: ArrayBuffer | Uint8Array,
  documentId: string,
): Promise<ParsedPage[]> {
  ensurePdfJsWorkerConfigured();

  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
  });

  const pdfDoc = await loadingTask.promise;
  try {
    const numPages = pdfDoc.numPages;
    if (numPages === 0) {
      return [
        {
          documentId,
          pageNumber: 1,
          sectionPath: [],
          rawNormalizedText: '',
          blocks: [],
          hasDiagram: false,
          hasMathAnomaly: false,
        },
      ];
    }

    const rawPages: RawPdfPageData[] = [];
    for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.0 });
      const [textContent, operatorList] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList(),
      ]);

      const items: PdfTextItem[] = [];
      for (const rawItem of textContent.items) {
        if (!isTextItem(rawItem)) continue;
        const transform = rawItem.transform;
        const derivedHeight =
          rawItem.height > 0
            ? rawItem.height
            : Math.hypot(transform[2], transform[3]) ||
              Math.hypot(transform[0], transform[1]) ||
              10;
        items.push({
          str: rawItem.str,
          x: transform[4],
          y: transform[5],
          width: rawItem.width,
          height: derivedHeight,
          fontName: rawItem.fontName ?? '',
          hasEOL: rawItem.hasEOL,
        });
      }

      const layout = reconstructPageTextLayout(items, viewport.width, viewport.height);
      rawPages.push({
        pageNumber,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        items,
        operatorIds: Array.from(operatorList.fnArray),
        lines: layout.lines,
      });
    }

    const strippedPages = stripRepeatedHeadersAndFooters(
      rawPages.map((p) => ({
        pageNumber: p.pageNumber,
        pageHeight: p.pageHeight,
        lines: p.lines,
      })),
    );

    const medianHeight = computeMedianHeight(strippedPages);
    const sectionStack: Array<{ depth: number; title: string }> = [];
    const blockCounterRef = { value: 0 };

    return strippedPages.map((stripped, idx) => {
      const raw = rawPages[idx];
      const { blocks, pageSectionPath } = buildBlocksFromLines(
        stripped.lines,
        medianHeight,
        documentId,
        sectionStack,
        blockCounterRef,
      );

      const detection = detectMathAndFigures({
        items: raw.items,
        operatorIds: raw.operatorIds,
        pageText: stripped.text,
      });

      return {
        documentId,
        pageNumber: raw.pageNumber,
        sectionPath: pageSectionPath,
        rawNormalizedText: stripped.text,
        blocks,
        hasDiagram: detection.hasDiagram,
        hasMathAnomaly: detection.hasMathAnomaly,
      };
    });
  } finally {
    await pdfDoc.destroy();
  }
}
