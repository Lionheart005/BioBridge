const DEFAULT_VISION_DIM_PX = 1568;
const BASE_VISION_TOKENS_PER_PAGE = 1100;

/**
 * BPE-like token count heuristic accounting for:
 * - Latin/German words and long compound words
 * - LaTeX commands (\frac, \partial, etc.)
 * - Numeric sequences
 * - Punctuation, operators, and JSON/code delimiters
 * - Non-ASCII / CJK scripts
 */
export function estimateTokenCount(text: string): number {
  if (!text) {
    return 0;
  }

  let tokens = 0;
  const segmentRegex =
    /\\[A-Za-z]+|\d+(?:\.\d+)?|[A-Za-zÀ-ÖØ-öø-ÿ]+|[^\sA-Za-zÀ-ÖØ-öø-ÿ0-9\\]+|\n+/g;

  let match = segmentRegex.exec(text);
  while (match !== null) {
    const seg = match[0];

    if (seg.startsWith('\n')) {
      tokens += Math.min(2, seg.length);
    } else if (seg.startsWith('\\')) {
      // LaTeX macro e.g. \frac, \sum
      tokens += seg.length <= 6 ? 1 : 2;
    } else if (/^\d/.test(seg)) {
      // BPE typically chunks digits in groups of 2-3
      tokens += Math.max(1, Math.ceil(seg.length / 2.5));
    } else if (/^[A-Za-zÀ-ÖØ-öø-ÿ]+$/.test(seg)) {
      if (seg.length <= 5) {
        tokens += 1;
      } else {
        // Long/compound words split into subword pieces (~4.5 chars per extra token)
        tokens += 1 + Math.ceil((seg.length - 5) / 4.5);
      }
    } else {
      // Punctuation / symbols / CJK / operators
      const hasNonAscii = /[^\x20-\x7E]/.test(seg);
      if (hasNonAscii) {
        tokens += Math.max(1, Math.ceil(seg.length * 1.2));
      } else {
        tokens += Math.max(1, Math.ceil(seg.length / 2));
      }
    }

    match = segmentRegex.exec(text);
  }

  return Math.max(1, Math.round(tokens));
}

/**
 * Estimates multimodal image token consumption for a single rendered PDF page.
 * Standard 1568px max-dimension page renders at ~1,100 tokens.
 */
export function estimateVisionTokensPerPage(
  maxDimPx = DEFAULT_VISION_DIM_PX,
): number {
  if (!Number.isFinite(maxDimPx) || maxDimPx <= 0) {
    return BASE_VISION_TOKENS_PER_PAGE;
  }
  const scale = maxDimPx / DEFAULT_VISION_DIM_PX;
  const scaled = Math.round(BASE_VISION_TOKENS_PER_PAGE * Math.pow(scale, 1.3));
  return Math.max(258, Math.min(2500, scaled));
}
