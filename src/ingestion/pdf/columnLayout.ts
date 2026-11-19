import { repairLineBreakHyphens } from '@/core/utils/textNormalize';

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
}

export interface LayoutLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  columnIndex: number;
}

export interface PageLayoutResult {
  lines: LayoutLine[];
  text: string;
}

export interface PageLinesInput {
  pageNumber: number;
  pageHeight: number;
  lines: LayoutLine[];
}

export interface StrippedPageLayoutResult {
  pageNumber: number;
  lines: LayoutLine[];
  text: string;
}

function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface VerticalSplit {
  splitX: number;
  gutterWidth: number;
  left: PdfTextItem[];
  right: PdfTextItem[];
}

function findBestVerticalSplit(items: PdfTextItem[], pageWidth: number): VerticalSplit | null {
  if (items.length < 4) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  for (const item of items) {
    const right = item.x + Math.max(item.width, 1);
    if (item.x < minX) minX = item.x;
    if (right > maxX) maxX = right;
  }

  const spanW = maxX - minX;
  if (spanW < 60) return null;

  // Build merged X-intervals
  const intervals = items
    .map((item) => [item.x, item.x + Math.max(item.width, 1)] as const)
    .sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    if (merged.length === 0 || start > merged[merged.length - 1][1]) {
      merged.push([start, end]);
    } else if (end > merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = end;
    }
  }

  const minGutterWidth = Math.max(10, pageWidth * 0.02);
  const minInteriorX = minX + spanW * 0.15;
  const maxInteriorX = maxX - spanW * 0.15;
  const regionCenterX = minX + spanW / 2;

  let best: VerticalSplit | null = null;

  for (let i = 0; i < merged.length - 1; i++) {
    const gapStart = merged[i][1];
    const gapEnd = merged[i + 1][0];
    const gutterWidth = gapEnd - gapStart;

    if (gutterWidth < minGutterWidth) continue;
    if (gapStart < minInteriorX || gapEnd > maxInteriorX) continue;

    const splitX = (gapStart + gapEnd) / 2;
    const left: PdfTextItem[] = [];
    const right: PdfTextItem[] = [];

    for (const item of items) {
      const center = item.x + Math.max(item.width, 1) / 2;
      if (center < splitX) {
        left.push(item);
      } else {
        right.push(item);
      }
    }

    if (left.length < 2 || right.length < 2) continue;

    if (!best || gutterWidth > best.gutterWidth) {
      best = { splitX, gutterWidth, left, right };
    } else if (
      gutterWidth === best.gutterWidth &&
      Math.abs(splitX - regionCenterX) < Math.abs(best.splitX - regionCenterX)
    ) {
      best = { splitX, gutterWidth, left, right };
    }
  }

  return best;
}

function groupItemsIntoRawBands(items: PdfTextItem[]): PdfTextItem[][] {
  if (items.length === 0) return [];
  const medHeight = median(
    items.map((it) => (it.height > 0 ? it.height : 10)),
    10,
  );
  const yTolerance = Math.max(2, medHeight * 0.45);

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const bands: PdfTextItem[][] = [];
  let currentBand: PdfTextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - currentY) <= yTolerance) {
      currentBand.push(item);
    } else {
      bands.push(currentBand);
      currentBand = [item];
      currentY = item.y;
    }
  }
  bands.push(currentBand);
  return bands;
}

function findHorizontalCutForColumns(
  items: PdfTextItem[],
  pageWidth: number,
): [PdfTextItem[], PdfTextItem[]] | null {
  const bands = groupItemsIntoRawBands(items);
  if (bands.length < 3) return null;

  // Try splitting below top spanning bands or above bottom spanning bands
  for (let splitIdx = 1; splitIdx < bands.length; splitIdx++) {
    const topItems = bands.slice(0, splitIdx).flat();
    const bottomItems = bands.slice(splitIdx).flat();

    if (
      (topItems.length >= 4 && findBestVerticalSplit(topItems, pageWidth) !== null) ||
      (bottomItems.length >= 4 && findBestVerticalSplit(bottomItems, pageWidth) !== null)
    ) {
      return [topItems, bottomItems];
    }
  }
  return null;
}

function buildLinesForSingleColumn(items: PdfTextItem[], columnIndex: number): LayoutLine[] {
  const bands = groupItemsIntoRawBands(items);
  const lines: LayoutLine[] = [];

  for (const band of bands) {
    const sorted = [...band].sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = 0;
    let prevItem: PdfTextItem | null = null;
    let maxHeight = 0;
    const fontCounts = new Map<string, number>();

    for (const item of sorted) {
      const itemH = item.height > 0 ? item.height : 10;
      if (itemH > maxHeight) maxHeight = itemH;
      if (item.fontName) {
        fontCounts.set(item.fontName, (fontCounts.get(item.fontName) ?? 0) + item.str.length);
      }

      if (prevItem !== null) {
        const gap = item.x - prevEnd;
        const spaceThreshold = Math.max(1.5, Math.min(prevItem.height || 10, itemH) * 0.22);
        const needsSpace =
          gap > spaceThreshold &&
          !text.endsWith(' ') &&
          !item.str.startsWith(' ');
        if (needsSpace) {
          text += ' ';
        }
      }

      text += item.str;
      prevEnd = item.x + item.width;
      prevItem = item;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) continue;

    let dominantFont = '';
    let maxCount = -1;
    for (const [font, count] of fontCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantFont = font;
      }
    }

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const lineWidth = Math.max(0, last.x + last.width - first.x);

    lines.push({
      text: trimmed,
      x: first.x,
      y: first.y,
      width: lineWidth,
      height: maxHeight || 10,
      fontName: dominantFont,
      columnIndex,
    });
  }

  return lines;
}

function xyCutColumns(
  items: PdfTextItem[],
  pageWidth: number,
  columnCounter: { value: number },
  depth = 0,
): LayoutLine[] {
  if (items.length === 0) return [];

  if (depth < 6) {
    const vertical = findBestVerticalSplit(items, pageWidth);
    if (vertical) {
      const leftLines = xyCutColumns(vertical.left, pageWidth, columnCounter, depth + 1);
      const rightLines = xyCutColumns(vertical.right, pageWidth, columnCounter, depth + 1);
      return [...leftLines, ...rightLines];
    }

    const horizontal = findHorizontalCutForColumns(items, pageWidth);
    if (horizontal) {
      const [topItems, bottomItems] = horizontal;
      const topLines = xyCutColumns(topItems, pageWidth, columnCounter, depth + 1);
      const bottomLines = xyCutColumns(bottomItems, pageWidth, columnCounter, depth + 1);
      return [...topLines, ...bottomLines];
    }
  }

  const colIdx = columnCounter.value;
  columnCounter.value += 1;
  return buildLinesForSingleColumn(items, colIdx);
}

/**
 * Converts ordered LayoutLines into normalized text, preserving paragraph breaks
 * and repairing line-break hyphenations.
 */
export function linesToText(lines: LayoutLine[]): string {
  if (lines.length === 0) return '';

  const parts: string[] = [lines[0].text];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];

    if (curr.columnIndex !== prev.columnIndex) {
      parts.push('\n\n', curr.text);
      continue;
    }

    const yGap = prev.y - curr.y;
    const baseHeight = Math.max(prev.height, curr.height, 10);
    if (yGap > baseHeight * 1.5) {
      parts.push('\n\n', curr.text);
    } else {
      parts.push('\n', curr.text);
    }
  }

  return repairLineBreakHyphens(parts.join(''));
}

/**
 * Reconstructs reading-order text and lines for a PDF page using recursive XY-Cut
 * column detection (left-to-right columns, top-to-bottom within each column).
 */
export function reconstructPageTextLayout(
  items: PdfTextItem[],
  pageWidth: number,
  pageHeight: number,
): PageLayoutResult {
  void pageHeight;
  const nonEmpty = items.filter((item) => item.str.trim().length > 0);
  if (nonEmpty.length === 0) {
    return { lines: [], text: '' };
  }

  const lines = xyCutColumns(nonEmpty, pageWidth, { value: 0 });
  const text = linesToText(lines);
  return { lines, text };
}

function normalizeMarginCandidate(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\d+/g, '#');
}

function getMarginZone(line: LayoutLine, pageHeight: number): 'top' | 'bottom' | null {
  if (pageHeight <= 0) return null;
  const centerY = line.y + line.height * 0.5;
  if (centerY >= pageHeight * 0.92 || line.y >= pageHeight * 0.92) {
    return 'top';
  }
  if (centerY <= pageHeight * 0.08 || line.y <= pageHeight * 0.08) {
    return 'bottom';
  }
  return null;
}

/**
 * Detects and removes repeated headers/footers in the top/bottom 8% page margins
 * across 3 or more pages (e.g. running titles, chapter headers, or page numbers).
 */
export function stripRepeatedHeadersAndFooters(
  pages: PageLinesInput[],
): StrippedPageLayoutResult[] {
  if (pages.length < 3) {
    return pages.map((p) => ({
      pageNumber: p.pageNumber,
      lines: p.lines,
      text: linesToText(p.lines),
    }));
  }

  const patternPages = new Map<string, Set<number>>();

  for (const page of pages) {
    for (const line of page.lines) {
      const zone = getMarginZone(line, page.pageHeight);
      if (!zone) continue;
      const normalized = normalizeMarginCandidate(line.text);
      if (!normalized) continue;
      const key = `${zone}:${normalized}`;
      let pageSet = patternPages.get(key);
      if (!pageSet) {
        pageSet = new Set<number>();
        patternPages.set(key, pageSet);
      }
      pageSet.add(page.pageNumber);
    }
  }

  const repeatedKeys = new Set<string>();
  for (const [key, pageSet] of patternPages.entries()) {
    if (pageSet.size >= 3) {
      repeatedKeys.add(key);
    }
  }

  return pages.map((page) => {
    const filteredLines = page.lines.filter((line) => {
      const zone = getMarginZone(line, page.pageHeight);
      if (!zone) return true;
      const key = `${zone}:${normalizeMarginCandidate(line.text)}`;
      return !repeatedKeys.has(key);
    });
    return {
      pageNumber: page.pageNumber,
      lines: filteredLines,
      text: linesToText(filteredLines),
    };
  });
}
