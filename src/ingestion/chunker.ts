import type { DocumentChunk, ParsedPage, SourceDocument } from '@/core/schemas/document.schema';

export interface ChunkerOptions {
  targetTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
}

const DEFAULT_TARGET_TOKENS = 3800;
const DEFAULT_MAX_TOKENS = 4500;
const DEFAULT_OVERLAP_TOKENS = 250;

const ABBREVIATIONS = new Set([
  'abb',
  'al',
  'bzw',
  'ca',
  'dr',
  'e.g',
  'etc',
  'fig',
  'hrsg',
  'i.e',
  'inc',
  'nr',
  'prof',
  'resp',
  's',
  'str',
  'u.a',
  'usw',
  'vgl',
  'vs',
  'z.b',
]);

interface AtomicSentence {
  pageNumber: number;
  sectionPath: string[];
  text: string;
  isPageStart: boolean;
  estimatedTokens: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sectionPathsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isAbbreviationBeforeDot(text: string, dotIndex: number): boolean {
  let start = dotIndex - 1;
  while (start >= 0 && /[a-zA-ZäöüÄÖÜß.]/.test(text[start])) {
    start -= 1;
  }
  const token = text.slice(start + 1, dotIndex).toLowerCase();
  if (!token) return false;
  if (ABBREVIATIONS.has(token)) return true;
  // Single-letter initials like "J." or multi-dot abbreviations like "z.B."
  if (token.length === 1 || token.includes('.')) return true;
  return false;
}

/**
 * Splits text into complete sentences in linear time without cutting inside
 * decimals, common abbreviations, or $...$ / $$...$$ math expressions.
 */
function splitParagraphIntoSentences(paragraph: string): string[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [];

  const sentences: string[] = [];
  let start = 0;
  let inDisplayMath = false;
  let inInlineMath = false;
  const len = trimmed.length;

  for (let i = 0; i < len; i++) {
    const ch = trimmed[i];

    if (ch === '$' && (i === 0 || trimmed[i - 1] !== '\\')) {
      if (trimmed[i + 1] === '$') {
        inDisplayMath = !inDisplayMath;
        i += 1;
        continue;
      }
      if (!inDisplayMath) {
        inInlineMath = !inInlineMath;
      }
      continue;
    }

    if (inDisplayMath || inInlineMath) {
      continue;
    }

    if (ch === '.' || ch === '!' || ch === '?') {
      // Do not split inside decimal numbers (e.g. 3.14)
      if (ch === '.' && i > 0 && i + 1 < len && /\d/.test(trimmed[i - 1]) && /\d/.test(trimmed[i + 1])) {
        continue;
      }
      // Consume consecutive punctuation like "..." or "?!"
      let endIdx = i;
      while (endIdx + 1 < len && (trimmed[endIdx + 1] === '.' || trimmed[endIdx + 1] === '!' || trimmed[endIdx + 1] === '?')) {
        endIdx += 1;
      }
      // Consume optional closing quote or parenthesis right after sentence punctuation
      if (endIdx + 1 < len && /['")\]”’»]/.test(trimmed[endIdx + 1])) {
        endIdx += 1;
      }

      const nextIdx = endIdx + 1;
      if (nextIdx >= len || /\s/.test(trimmed[nextIdx])) {
        if (ch === '.' && endIdx === i && isAbbreviationBeforeDot(trimmed, i)) {
          i = endIdx;
          continue;
        }

        const sentence = trimmed.slice(start, nextIdx).trim();
        if (sentence.length > 0) {
          sentences.push(sentence);
        }
        let ws = nextIdx;
        while (ws < len && /\s/.test(trimmed[ws])) {
          ws += 1;
        }
        start = ws;
        i = ws - 1;
      }
    }
  }

  if (start < len) {
    const tail = trimmed.slice(start).trim();
    if (tail.length > 0) {
      sentences.push(tail);
    }
  }

  return sentences;
}

function splitOversizedUnit(unit: string, maxChars: number): string[] {
  if (unit.length <= maxChars) return [unit];
  const parts: string[] = [];
  let pos = 0;
  while (pos < unit.length) {
    let end = Math.min(pos + maxChars, unit.length);
    if (end < unit.length) {
      const spaceIdx = unit.lastIndexOf(' ', end);
      if (spaceIdx > pos + Math.floor(maxChars * 0.5)) {
        end = spaceIdx;
      }
    }
    const slice = unit.slice(pos, end).trim();
    if (slice.length > 0) parts.push(slice);
    pos = end;
    while (pos < unit.length && unit[pos] === ' ') pos += 1;
  }
  return parts;
}

function decomposePagesToSentences(pages: ParsedPage[], maxTokens: number): AtomicSentence[] {
  const result: AtomicSentence[] = [];
  const maxUnitChars = Math.max(200, maxTokens * 4 - 40);

  for (const page of pages) {
    const raw = page.rawNormalizedText.trim();
    if (raw.length === 0) {
      result.push({
        pageNumber: page.pageNumber,
        sectionPath: page.sectionPath,
        text: '',
        isPageStart: true,
        estimatedTokens: estimateTokens(`[[PAGE:${page.pageNumber}]]\n`),
      });
      continue;
    }

    const paragraphs = raw.split(/\n{2,}/);
    let firstOnPage = true;

    for (const para of paragraphs) {
      const rawSentences = splitParagraphIntoSentences(para);
      for (const s of rawSentences) {
        const units = s.length > maxUnitChars ? splitOversizedUnit(s, maxUnitChars) : [s];
        for (const unit of units) {
          const isPageStart = firstOnPage;
          firstOnPage = false;
          const markerOverhead = isPageStart ? `[[PAGE:${page.pageNumber}]]\n`.length : 1;
          result.push({
            pageNumber: page.pageNumber,
            sectionPath: page.sectionPath,
            text: unit,
            isPageStart,
            estimatedTokens: estimateTokens(unit) + Math.ceil(markerOverhead / 4),
          });
        }
      }
    }
  }

  return result;
}

function renderChunkText(segments: AtomicSentence[]): string {
  if (segments.length === 0) return '';

  const parts: string[] = [];
  let prevPageNumber: number | null = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const needsPageMarker =
      i === 0 || seg.isPageStart || (prevPageNumber !== null && seg.pageNumber !== prevPageNumber);

    if (needsPageMarker) {
      if (parts.length > 0) {
        parts.push('\n\n');
      }
      parts.push(`[[PAGE:${seg.pageNumber}]]`);
      if (seg.text.length > 0) {
        parts.push('\n', seg.text);
      }
    } else if (seg.text.length > 0) {
      parts.push(' ', seg.text);
    }

    prevPageNumber = seg.pageNumber;
  }

  return parts.join('').trim();
}

/**
 * Chunks parsed document pages into retrieval/LLM-ready DocumentChunks.
 * Preserves [[PAGE:N]] markers, prefers section-boundary splits, always breaks
 * on sentence boundaries, and carries sentence-level overlap across consecutive chunks.
 */
export function chunkDocumentPages(
  document: SourceDocument,
  pages: ParsedPage[],
  options?: ChunkerOptions,
): DocumentChunk[] {
  const targetTokens = options?.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const maxTokens = Math.max(targetTokens, options?.maxTokens ?? DEFAULT_MAX_TOKENS);
  const overlapTokens = Math.max(0, options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS);

  if (pages.length === 0) {
    return [];
  }

  const sentences = decomposePagesToSentences(pages, maxTokens);
  if (sentences.length === 0) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  let currentSegments: AtomicSentence[] = [];
  let currentOverlapCount = 0;
  let currentTokens = 0;
  let lastSectionPath: string[] = sentences[0].sectionPath;

  const computeOverlapSlice = (segments: AtomicSentence[]): AtomicSentence[] => {
    if (overlapTokens <= 0 || segments.length <= 1) return [];
    const collected: AtomicSentence[] = [];
    let tok = 0;

    // Never reuse every single segment as overlap, ensuring strict forward progress
    for (let i = segments.length - 1; i >= 1; i--) {
      const seg = segments[i];
      if (!seg.text) continue;
      const segTok = estimateTokens(seg.text);
      if (collected.length > 0 && tok + segTok > overlapTokens * 1.4) {
        break;
      }
      if (tok + segTok > maxTokens * 0.35) {
        break;
      }
      collected.push({
        ...seg,
        isPageStart: false,
      });
      tok += segTok;
      if (tok >= overlapTokens) {
        break;
      }
    }

    collected.reverse();
    return collected;
  };

  const flushChunk = (carryOverlap: boolean) => {
    if (currentSegments.length === 0) return;
    // Skip flushing if the buffer consists solely of carried-over overlap
    if (currentOverlapCount >= currentSegments.length && carryOverlap) return;

    const text = renderChunkText(currentSegments);
    const first = currentSegments[0];
    const last = currentSegments[currentSegments.length - 1];
    const primaryNonOverlap = currentSegments[currentOverlapCount] ?? first;
    const chunkIndex = chunks.length;

    chunks.push({
      chunkKey: `${document.id}:chunk:${chunkIndex}`,
      documentId: document.id,
      domain: document.domain,
      chunkIndex,
      startPage: first.pageNumber,
      endPage: last.pageNumber,
      sectionPath: [...primaryNonOverlap.sectionPath],
      text,
      estimatedTokens: estimateTokens(text),
    });

    if (carryOverlap) {
      const overlap = computeOverlapSlice(currentSegments);
      currentSegments = overlap;
      currentOverlapCount = overlap.length;
      currentTokens = overlap.reduce((sum, s) => sum + estimateTokens(s.text), 0);
      if (overlap.length > 0) {
        currentTokens += estimateTokens(`[[PAGE:${overlap[0].pageNumber}]]\n`);
      }
    } else {
      currentSegments = [];
      currentOverlapCount = 0;
      currentTokens = 0;
    }
  };

  for (let i = 0; i < sentences.length; i++) {
    const seg = sentences[i];
    const hasNewContent = currentSegments.length > currentOverlapCount;

    if (hasNewContent) {
      const sectionChanged = !sectionPathsEqual(seg.sectionPath, lastSectionPath);
      const reachedSoftSectionThreshold =
        sectionChanged && currentTokens >= Math.floor(targetTokens * 0.55);
      const exceedsMax = currentTokens + seg.estimatedTokens > maxTokens;
      const reachedTarget =
        currentTokens >= targetTokens &&
        currentTokens + seg.estimatedTokens > Math.floor(targetTokens * 1.05);

      if (reachedSoftSectionThreshold || exceedsMax || reachedTarget) {
        flushChunk(true);
      }
    }

    currentSegments.push(seg);
    currentTokens += seg.estimatedTokens;
    lastSectionPath = seg.sectionPath;
  }

  if (currentSegments.length > currentOverlapCount) {
    flushChunk(false);
  }

  return chunks;
}
