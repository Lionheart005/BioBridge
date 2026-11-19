import type { ParsedPage, VerificationStatus } from '@/core/schemas';
import { normalizeForCaseInsensitiveMatch } from '@/core/utils/textNormalize';

export type CitationFailureReason =
  | 'EMPTY_QUOTE'
  | 'TOO_SHORT_FRAGMENT'
  | 'NO_MATCH_FOUND';

export interface CitationVerificationInput {
  quoteOriginal: string;
  claimedPageNumber: number;
  pages: ParsedPage[];
  fuzzyThreshold?: number;
  contextChars?: number;
}

export interface CitationVerificationResult {
  verified: boolean;
  status: VerificationStatus;
  matchScore: number;
  matchedPageNumber: number;
  contextBefore: string;
  contextAfter: string;
  failureReason?: CitationFailureReason;
  failureDetails?: string;
}

export interface QuoteSufficiencyResult {
  ok: boolean;
  reason?: CitationFailureReason;
  details?: string;
}

const DEFAULT_FUZZY_THRESHOLD = 0.88;
const DEFAULT_CONTEXT_CHARS = 250;
const MIN_PROSE_QUOTE_CHARS = 40;
const MIN_PROSE_QUOTE_WORDS = 5;
const MIN_FORMULA_QUOTE_CHARS = 15;

const LIGATURE_MAP: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};

interface MappedChar {
  ch: string;
  origStart: number;
  origEnd: number;
}

interface NormalizedTextMap {
  normalized: string;
  chars: MappedChar[];
}

interface CandidateSource {
  text: string;
  matchedPageNumber: number;
  priority: number;
}

interface WordSpan {
  normStart: number;
  normEnd: number;
}

function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}

/**
 * Validates that a quote is non-empty and provides enough contiguous context
 * (either >= 40 normalized chars and >= 5 words, or a mathematical formula
 * containing `$` or `=` of >= 15 normalized chars) to prevent cherry-picked fragments.
 */
export function isSufficientContextQuote(
  quote: string,
): QuoteSufficiencyResult {
  if (!quote || quote.trim().length === 0) {
    return {
      ok: false,
      reason: 'EMPTY_QUOTE',
      details: 'Quote is empty or contains only whitespace.',
    };
  }

  const normalized = normalizeForCaseInsensitiveMatch(quote);
  if (normalized.length === 0) {
    return {
      ok: false,
      reason: 'EMPTY_QUOTE',
      details: 'Quote is empty after normalization.',
    };
  }

  const hasFormulaStructure =
    (normalized.includes('$') || normalized.includes('=')) &&
    normalized.length >= MIN_FORMULA_QUOTE_CHARS;

  if (hasFormulaStructure) {
    return { ok: true };
  }

  const words = normalized.split(' ').filter((w) => w.length > 0);
  if (
    normalized.length >= MIN_PROSE_QUOTE_CHARS &&
    words.length >= MIN_PROSE_QUOTE_WORDS
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: 'TOO_SHORT_FRAGMENT',
    details: `Quote too short (${normalized.length} chars, ${words.length} words). Expected at least ${MIN_PROSE_QUOTE_CHARS} chars and ${MIN_PROSE_QUOTE_WORDS} words (or a formula >= ${MIN_FORMULA_QUOTE_CHARS} chars).`,
  };
}

/**
 * Normalizes `text` identically to `normalizeForCaseInsensitiveMatch` while keeping
 * a character-level mapping back to `[origStart, origEnd)` in the original string.
 */
function normalizeWithSourceMap(text: string): NormalizedTextMap {
  const preHyphenTokens: MappedChar[] = [];

  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const firstStep = cp > 0xffff ? 2 : 1;
    let clusterEnd = i + firstStep;

    // Group combining marks with their base character so NFKC composes accurately.
    while (clusterEnd < text.length) {
      const nextCp = text.codePointAt(clusterEnd)!;
      const nextStep = nextCp > 0xffff ? 2 : 1;
      const nextStr = text.slice(clusterEnd, clusterEnd + nextStep);
      if (!/^\p{M}$/u.test(nextStr)) {
        break;
      }
      clusterEnd += nextStep;
    }

    let cluster = text.slice(i, clusterEnd);

    if (cluster === '\r') {
      if (text[clusterEnd] === '\n') {
        clusterEnd += 1;
      }
      preHyphenTokens.push({ ch: '\n', origStart: i, origEnd: clusterEnd });
      i = clusterEnd;
      continue;
    }

    cluster = cluster.replace(/[\uFB00-\uFB06]/g, (ch) => LIGATURE_MAP[ch] ?? ch);
    cluster = cluster.normalize('NFKC');
    cluster = cluster.replace(/[\u00AD\u200B\uFEFF]/g, '');
    cluster = cluster
      .replace(/[“”„‟«»]/g, '"')
      .replace(/[‘’‚‛‹›]/g, "'")
      .replace(/[–—−]/g, '-');
    cluster = cluster.replace(/\r\n?/g, '\n');

    for (const symbol of cluster) {
      preHyphenTokens.push({ ch: symbol, origStart: i, origEnd: clusterEnd });
    }

    i = clusterEnd;
  }

  // Replicate repairLineBreakHyphens: (\p{L})-[ \t]*\n[ \t]*(\p{L}) -> $1$2
  const hyphenRepaired: MappedChar[] = [];
  for (let idx = 0; idx < preHyphenTokens.length; idx += 1) {
    const curr = preHyphenTokens[idx];
    if (
      /^\p{L}$/u.test(curr.ch) &&
      idx + 2 < preHyphenTokens.length &&
      preHyphenTokens[idx + 1].ch === '-'
    ) {
      let scan = idx + 2;
      while (
        scan < preHyphenTokens.length &&
        (preHyphenTokens[scan].ch === ' ' || preHyphenTokens[scan].ch === '\t')
      ) {
        scan += 1;
      }
      if (
        scan < preHyphenTokens.length &&
        preHyphenTokens[scan].ch === '\n'
      ) {
        scan += 1;
        while (
          scan < preHyphenTokens.length &&
          (preHyphenTokens[scan].ch === ' ' || preHyphenTokens[scan].ch === '\t')
        ) {
          scan += 1;
        }
        if (
          scan < preHyphenTokens.length &&
          /^\p{L}$/u.test(preHyphenTokens[scan].ch)
        ) {
          hyphenRepaired.push(curr);
          hyphenRepaired.push(preHyphenTokens[scan]);
          idx = scan;
          continue;
        }
      }
    }
    hyphenRepaired.push(curr);
  }

  // Collapse whitespace, trim leading/trailing whitespace, and lowercase.
  const collapsed: MappedChar[] = [];
  let pendingSpace: MappedChar | null = null;

  for (const token of hyphenRepaired) {
    if (/^\s$/u.test(token.ch)) {
      if (collapsed.length > 0) {
        if (pendingSpace === null) {
          pendingSpace = {
            ch: ' ',
            origStart: token.origStart,
            origEnd: token.origEnd,
          };
        } else {
          pendingSpace.origEnd = token.origEnd;
        }
      }
      continue;
    }

    if (pendingSpace !== null) {
      collapsed.push(pendingSpace);
      pendingSpace = null;
    }

    const lowered = token.ch.toLowerCase();
    for (let k = 0; k < lowered.length; k += 1) {
      collapsed.push({
        ch: lowered[k],
        origStart: token.origStart,
        origEnd: token.origEnd,
      });
    }
  }

  return {
    normalized: collapsed.map((c) => c.ch).join(''),
    chars: collapsed,
  };
}

/**
 * Extracts `contextBefore` and `contextAfter` (~`contextChars` each) around `[origStart, origEnd)`,
 * trimmed cleanly at word boundaries.
 */
function extractContext(
  sourceText: string,
  origStart: number,
  origEnd: number,
  contextChars: number,
): { contextBefore: string; contextAfter: string } {
  if (contextChars <= 0) {
    return { contextBefore: '', contextAfter: '' };
  }

  let beforeStart = Math.max(0, origStart - contextChars);
  if (
    beforeStart > 0 &&
    beforeStart < origStart &&
    !/\s/.test(sourceText[beforeStart - 1]) &&
    !/\s/.test(sourceText[beforeStart])
  ) {
    let wsIdx = beforeStart;
    while (wsIdx < origStart && !/\s/.test(sourceText[wsIdx])) {
      wsIdx += 1;
    }
    beforeStart = wsIdx;
  }

  let afterEnd = Math.min(sourceText.length, origEnd + contextChars);
  if (
    afterEnd < sourceText.length &&
    afterEnd > origEnd &&
    !/\s/.test(sourceText[afterEnd - 1]) &&
    !/\s/.test(sourceText[afterEnd])
  ) {
    let wsIdx = afterEnd;
    while (wsIdx > origEnd && !/\s/.test(sourceText[wsIdx - 1])) {
      wsIdx -= 1;
    }
    afterEnd = wsIdx;
  }

  return {
    contextBefore: sourceText.slice(beforeStart, origStart).trim(),
    contextAfter: sourceText.slice(origEnd, afterEnd).trim(),
  };
}

function buildCandidates(
  pages: ParsedPage[],
  claimedPageNumber: number,
  quoteLength: number,
  contextChars: number,
): CandidateSource[] {
  const pageMap = new Map<number, ParsedPage>();
  for (const page of pages) {
    pageMap.set(page.pageNumber, page);
  }

  const candidates: CandidateSource[] = [];
  let priority = 0;

  const addSingle = (pageNum: number): void => {
    if (pageNum < 1) {
      return;
    }
    const page = pageMap.get(pageNum);
    if (page && page.rawNormalizedText.trim().length > 0) {
      candidates.push({
        text: page.rawNormalizedText,
        matchedPageNumber: page.pageNumber,
        priority: priority++,
      });
    }
  };

  // 1. Claimed page N
  addSingle(claimedPageNumber);

  // 2. Adjacent pages N-1 and N+1
  addSingle(claimedPageNumber - 1);
  addSingle(claimedPageNumber + 1);

  // 3. Page-break stitches: end of (N-1) + start of N, and end of N + start of (N+1)
  const stitchWindow = Math.max(2500, quoteLength + contextChars + 500);
  const addStitch = (firstNum: number, secondNum: number): void => {
    if (firstNum < 1 || secondNum < 1) {
      return;
    }
    const first = pageMap.get(firstNum);
    const second = pageMap.get(secondNum);
    if (!first || !second) {
      return;
    }
    if (
      first.rawNormalizedText.trim().length === 0 ||
      second.rawNormalizedText.trim().length === 0
    ) {
      return;
    }
    const tail = first.rawNormalizedText.slice(-stitchWindow);
    const head = second.rawNormalizedText.slice(0, stitchWindow);
    candidates.push({
      text: `${tail}\n${head}`,
      matchedPageNumber: first.pageNumber,
      priority: priority++,
    });
  };

  addStitch(claimedPageNumber - 1, claimedPageNumber);
  addStitch(claimedPageNumber, claimedPageNumber + 1);

  return candidates;
}

function splitWordSpans(normalized: string): WordSpan[] {
  const spans: WordSpan[] = [];
  let start = -1;

  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized[i] === ' ') {
      if (start !== -1) {
        spans.push({ normStart: start, normEnd: i });
        start = -1;
      }
    } else if (start === -1) {
      start = i;
    }
  }

  if (start !== -1) {
    spans.push({ normStart: start, normEnd: normalized.length });
  }

  return spans;
}

function buildTrigramSet(text: string): Set<string> {
  const trigrams = new Set<string>();
  for (let i = 0; i <= text.length - 3; i += 1) {
    trigrams.add(text.slice(i, i + 3));
  }
  return trigrams;
}

function buildTrigramHitPrefix(text: string, quoteTrigrams: Set<string>): Int32Array {
  const prefix = new Int32Array(text.length + 1);
  for (let i = 0; i <= text.length - 3; i += 1) {
    const hit = quoteTrigrams.has(text.slice(i, i + 3)) ? 1 : 0;
    prefix[i + 1] = prefix[i] + hit;
  }
  for (let i = Math.max(0, text.length - 2); i < text.length; i += 1) {
    prefix[i + 1] = prefix[i];
  }
  return prefix;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) {
    return lenB;
  }
  if (lenB === 0) {
    return lenA;
  }

  // Keep `b` as the shorter string for minimal memory footprint.
  if (lenA < lenB) {
    return levenshteinDistance(b, a);
  }

  let prev = new Int32Array(lenB + 1);
  let curr = new Int32Array(lenB + 1);

  for (let j = 0; j <= lenB; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    const chA = a.charCodeAt(i - 1);
    for (let j = 1; j <= lenB; j += 1) {
      const cost = chA === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[lenB];
}

function normalizedLevenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 1;
  }
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

interface FuzzyCandidateMatch {
  score: number;
  normStart: number;
  normEnd: number;
}

function findBestFuzzyMatchInNormalized(
  normPage: string,
  normQuote: string,
  quoteTrigrams: Set<string>,
  fuzzyThreshold: number,
): FuzzyCandidateMatch | null {
  const pageWords = splitWordSpans(normPage);
  if (pageWords.length === 0) {
    return null;
  }

  const quoteWordCount = normQuote.split(' ').filter((w) => w.length > 0).length;
  const minWin = Math.min(
    pageWords.length,
    Math.max(1, Math.floor(quoteWordCount * 0.75)),
  );
  const maxWin = Math.min(
    pageWords.length,
    Math.max(minWin, Math.ceil(quoteWordCount * 1.25)),
  );

  const prefixHits = buildTrigramHitPrefix(normPage, quoteTrigrams);
  const quoteTrigramCount = Math.max(1, normQuote.length - 2);
  // Generous O(1) prefilter cutoff so valid fuzzy matches are never dropped while
  // unrelated windows skip expensive Levenshtein computation.
  const minTrigramRatio = Math.max(0.25, fuzzyThreshold - 0.55);
  const minLengthRatio = Math.max(0.5, fuzzyThreshold - 0.15);

  let best: FuzzyCandidateMatch | null = null;

  for (let startWord = 0; startWord < pageWords.length; startWord += 1) {
    for (let winSize = minWin; winSize <= maxWin; winSize += 1) {
      const endWord = startWord + winSize - 1;
      if (endWord >= pageWords.length) {
        break;
      }

      const normStart = pageWords[startWord].normStart;
      const normEnd = pageWords[endWord].normEnd;
      const sliceLen = normEnd - normStart;

      const maxLen = Math.max(sliceLen, normQuote.length);
      const minLen = Math.min(sliceLen, normQuote.length);
      if (minLen / maxLen < minLengthRatio) {
        continue;
      }

      const trigramEnd = Math.max(normStart, normEnd - 2);
      const hits = prefixHits[trigramEnd] - prefixHits[normStart];
      if (hits / quoteTrigramCount < minTrigramRatio) {
        continue;
      }

      const windowText = normPage.slice(normStart, normEnd);
      const score = normalizedLevenshteinSimilarity(windowText, normQuote);
      if (best === null || score > best.score) {
        best = { score, normStart, normEnd };
      }
    }
  }

  return best;
}

function mapNormalizedSpanToOriginal(
  normMap: NormalizedTextMap,
  normStart: number,
  normEnd: number,
): { origStart: number; origEnd: number } {
  const origStart = normMap.chars[normStart].origStart;
  const origEnd = normMap.chars[normEnd - 1].origEnd;
  return { origStart, origEnd };
}

/**
 * Deterministically verifies a quote against parsed document pages using a 3-stage cascade:
 * 1. Exact substring match (`VERIFIED_EXACT`, score 1.0)
 * 2. Case-insensitive normalized match (`VERIFIED_NORMALIZED`, score 0.98)
 * 3. Sliding-window fuzzy match with O(1) trigram prefilter (`VERIFIED_FUZZY`, score >= threshold)
 */
export function verifyCitationAgainstPages(
  input: CitationVerificationInput,
): CitationVerificationResult {
  const fuzzyThreshold = input.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
  const contextChars = input.contextChars ?? DEFAULT_CONTEXT_CHARS;

  const sufficiency = isSufficientContextQuote(input.quoteOriginal);
  if (!sufficiency.ok) {
    return {
      verified: false,
      status: 'FAILED_UNVERIFIED',
      matchScore: 0,
      matchedPageNumber: input.claimedPageNumber,
      contextBefore: '',
      contextAfter: '',
      failureReason: sufficiency.reason,
      failureDetails: sufficiency.details,
    };
  }

  const candidates = buildCandidates(
    input.pages,
    input.claimedPageNumber,
    input.quoteOriginal.length,
    contextChars,
  );

  // Stage 1: Exact match in candidate priority order
  for (const candidate of candidates) {
    const exactIdx = candidate.text.indexOf(input.quoteOriginal);
    if (exactIdx !== -1) {
      const { contextBefore, contextAfter } = extractContext(
        candidate.text,
        exactIdx,
        exactIdx + input.quoteOriginal.length,
        contextChars,
      );
      return {
        verified: true,
        status: 'VERIFIED_EXACT',
        matchScore: 1,
        matchedPageNumber: candidate.matchedPageNumber,
        contextBefore,
        contextAfter,
      };
    }
  }

  // Stage 2: Normalized match in candidate priority order
  const normQuote = normalizeForCaseInsensitiveMatch(input.quoteOriginal);
  const candidateMaps = candidates.map((candidate) => ({
    candidate,
    normMap: normalizeWithSourceMap(candidate.text),
  }));

  for (const { candidate, normMap } of candidateMaps) {
    const normIdx = normMap.normalized.indexOf(normQuote);
    if (normIdx !== -1 && normQuote.length > 0) {
      const { origStart, origEnd } = mapNormalizedSpanToOriginal(
        normMap,
        normIdx,
        normIdx + normQuote.length,
      );
      const { contextBefore, contextAfter } = extractContext(
        candidate.text,
        origStart,
        origEnd,
        contextChars,
      );
      return {
        verified: true,
        status: 'VERIFIED_NORMALIZED',
        matchScore: 0.98,
        matchedPageNumber: candidate.matchedPageNumber,
        contextBefore,
        contextAfter,
      };
    }
  }

  // Stage 3: Sliding-window fuzzy match across candidates
  const quoteTrigrams = buildTrigramSet(normQuote);
  let bestFuzzy: {
    candidate: CandidateSource;
    normMap: NormalizedTextMap;
    match: FuzzyCandidateMatch;
    roundedScore: number;
  } | null = null;

  for (const { candidate, normMap } of candidateMaps) {
    const match = findBestFuzzyMatchInNormalized(
      normMap.normalized,
      normQuote,
      quoteTrigrams,
      fuzzyThreshold,
    );
    if (!match) {
      continue;
    }
    const roundedScore = roundScore(match.score);
    if (
      bestFuzzy === null ||
      roundedScore > bestFuzzy.roundedScore ||
      (roundedScore === bestFuzzy.roundedScore &&
        match.score > bestFuzzy.match.score)
    ) {
      bestFuzzy = { candidate, normMap, match, roundedScore };
    }
  }

  if (bestFuzzy !== null && bestFuzzy.roundedScore >= fuzzyThreshold) {
    const { origStart, origEnd } = mapNormalizedSpanToOriginal(
      bestFuzzy.normMap,
      bestFuzzy.match.normStart,
      bestFuzzy.match.normEnd,
    );
    const { contextBefore, contextAfter } = extractContext(
      bestFuzzy.candidate.text,
      origStart,
      origEnd,
      contextChars,
    );
    return {
      verified: true,
      status: 'VERIFIED_FUZZY',
      matchScore: bestFuzzy.roundedScore,
      matchedPageNumber: bestFuzzy.candidate.matchedPageNumber,
      contextBefore,
      contextAfter,
    };
  }

  const bestScore = bestFuzzy ? bestFuzzy.roundedScore : 0;
  return {
    verified: false,
    status: 'FAILED_UNVERIFIED',
    matchScore: bestScore,
    matchedPageNumber: input.claimedPageNumber,
    contextBefore: '',
    contextAfter: '',
    failureReason: 'NO_MATCH_FOUND',
    failureDetails: `No match >= ${fuzzyThreshold} found near page ${input.claimedPageNumber} (best score: ${bestScore}).`,
  };
}
