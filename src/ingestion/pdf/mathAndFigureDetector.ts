import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfTextItem } from './columnLayout';

export interface ImageOpCodes {
  paintImageXObject: number;
  paintInlineImageXObject: number;
  stroke?: number;
  fill?: number;
}

export interface MathAndFigureInput {
  items: PdfTextItem[];
  operatorIds?: number[];
  pageText: string;
  imageOpCodes?: ImageOpCodes;
}

export interface MathAndFigureDetectionResult {
  hasDiagram: boolean;
  hasMathAnomaly: boolean;
  reasons: string[];
}

const MATH_FONT_REGEX = /CMMI|CMSY|CMEX|STIX|CambriaMath|Symbol|MTExtra|Math|Euclid/i;
const CAPTION_REGEX = /\b(Fig\.|Figure\b|Abb\.|Abbildung\b|Diagram\b|Schema\b|Chart\b)\s*\d*/i;
const UNICODE_MATH_REGEX = /[\u2200-\u22FF\u{1D400}-\u{1D7FF}]/u;
const PUA_OR_REPLACEMENT_REGEX = /[\uFFFD\uE000-\uF8FF]/;

const DEFAULT_VECTOR_OPS = new Set<number>([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);

function countFragmentedSubSupJumps(items: PdfTextItem[]): number {
  let jumps = 0;
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    const currTrim = curr.str.trim();
    if (currTrim.length === 0 || currTrim.length > 2) continue;

    const prevH = prev.height > 0 ? prev.height : 10;
    const currH = curr.height > 0 ? curr.height : 10;
    const yDiff = Math.abs(curr.y - prev.y);
    const xGap = curr.x - (prev.x + prev.width);

    // Small vertical shift (sub/superscript) coupled with close horizontal proximity or smaller font
    const isSubSupOffset = yDiff >= 1.5 && yDiff <= Math.max(prevH, currH) * 0.9;
    const isHorizontallyAdjacent = xGap >= -2 && xGap <= prevH * 1.5;
    const isSmallerScript = currH <= prevH * 0.85;

    if (isSubSupOffset && (isHorizontallyAdjacent || isSmallerScript)) {
      jumps += 1;
    }
  }
  return jumps;
}

/**
 * Detects embedded figures/diagrams and math-encoding anomalies on a PDF page
 * to decide whether Vision-LLM fallback rendering is warranted.
 */
export function detectMathAndFigures(
  input: MathAndFigureInput,
): MathAndFigureDetectionResult {
  const { items, operatorIds = [], pageText, imageOpCodes } = input;
  const reasons: string[] = [];

  const paintImageXObjectCode = imageOpCodes?.paintImageXObject ?? OPS.paintImageXObject;
  const paintInlineImageCode =
    imageOpCodes?.paintInlineImageXObject ?? OPS.paintInlineImageXObject;

  const vectorOpSet = new Set<number>(DEFAULT_VECTOR_OPS);
  if (typeof imageOpCodes?.stroke === 'number') vectorOpSet.add(imageOpCodes.stroke);
  if (typeof imageOpCodes?.fill === 'number') vectorOpSet.add(imageOpCodes.fill);

  let hasImageOp = false;
  let vectorOpCount = 0;

  for (const op of operatorIds) {
    if (
      op === paintImageXObjectCode ||
      op === paintInlineImageCode ||
      (!imageOpCodes && op === OPS.paintImageMaskXObject)
    ) {
      hasImageOp = true;
    }
    if (vectorOpSet.has(op)) {
      vectorOpCount += 1;
    }
  }

  const hasCaption = CAPTION_REGEX.test(pageText);
  let hasDiagram = false;

  if (hasImageOp) {
    hasDiagram = true;
    reasons.push(
      hasCaption
        ? 'Detected embedded image operator with figure caption'
        : 'Detected embedded image operator (XObject/inline image)',
    );
  } else if (vectorOpCount > 80 && hasCaption) {
    hasDiagram = true;
    reasons.push(`High vector path density (${vectorOpCount} ops) with figure caption`);
  }

  let hasMathAnomaly = false;

  const mathFonts = new Set<string>();
  for (const item of items) {
    if (item.fontName && MATH_FONT_REGEX.test(item.fontName)) {
      mathFonts.add(item.fontName);
    }
  }
  if (mathFonts.size > 0) {
    hasMathAnomaly = true;
    reasons.push(`Detected math font(s): ${Array.from(mathFonts).join(', ')}`);
  }

  const combinedItemText = items.map((i) => i.str).join('');
  const textToInspect = `${pageText}\n${combinedItemText}`;

  if (PUA_OR_REPLACEMENT_REGEX.test(textToInspect)) {
    hasMathAnomaly = true;
    reasons.push('Detected replacement character (U+FFFD) or Private Use Area glyphs');
  }

  if (UNICODE_MATH_REGEX.test(textToInspect)) {
    hasMathAnomaly = true;
    reasons.push('Detected Unicode mathematical symbols/alphanumeric block');
  }

  const subSupJumps = countFragmentedSubSupJumps(items);
  if (subSupJumps >= 3) {
    hasMathAnomaly = true;
    reasons.push(`Detected ${subSupJumps} fragmented sub-/superscript Y-jumps`);
  }

  return {
    hasDiagram,
    hasMathAnomaly,
    reasons,
  };
}
