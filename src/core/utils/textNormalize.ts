const LIGATURE_MAP: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};

const LIGATURE_REGEX = /[\uFB00-\uFB06]/g;

/**
 * Repairs hyphenated line breaks (e.g. "Wort-\nfortsetzung") including Unicode letters/umlauts,
 * while preserving paragraph breaks ("\n\n").
 */
export function repairLineBreakHyphens(text: string): string {
  const normalizedNewlines = text.replace(/\r\n?/g, '\n');
  return normalizedNewlines.replace(/(\p{L})-[ \t]*\n[ \t]*(\p{L})/gu, '$1$2');
}

/**
 * Normalizes text for deterministic citation matching:
 * - NFKC normalization and explicit ligature expansion
 * - Removes soft hyphens and zero-width characters
 * - Normalizes typographic quotes and dashes
 * - Repairs line-break hyphens
 * - Collapses whitespace and trims
 */
export function normalizeTextForMatching(text: string): string {
  let result = text.replace(LIGATURE_REGEX, (ch) => LIGATURE_MAP[ch] ?? ch);
  result = result.normalize('NFKC');
  result = result.replace(/[\u00AD\u200B\uFEFF]/g, '');
  result = result
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛‹›]/g, "'")
    .replace(/[–—−]/g, '-');
  result = repairLineBreakHyphens(result);
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/**
 * Normalizes text for case-insensitive deterministic matching.
 */
export function normalizeForCaseInsensitiveMatch(text: string): string {
  return normalizeTextForMatching(text).toLowerCase();
}
