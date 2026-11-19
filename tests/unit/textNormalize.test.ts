import { describe, expect, it } from 'vitest';
import {
  normalizeForCaseInsensitiveMatch,
  normalizeTextForMatching,
  repairLineBreakHyphens,
} from '@/core/utils/textNormalize';

describe('textNormalize', () => {
  it('repairs hyphenated line breaks including umlauts while preserving paragraph breaks', () => {
    const input = 'Strömungs-\nmechanik und Wärme-\nübertragung.\n\nNächster Absatz.';
    const result = repairLineBreakHyphens(input);
    expect(result).toBe('Strömungsmechanik und Wärmeübertragung.\n\nNächster Absatz.');
  });

  it('expands ligatures, removes soft hyphens, and normalizes typographic punctuation', () => {
    const input = '„Ef\uFB01zienz“ und \uFB02exible\u00AD Bau\u200Bweise — ein\u00A0Test.';
    const result = normalizeTextForMatching(input);
    expect(result).toBe('"Effizienz" und flexible Bauweise - ein Test.');
  });

  it('handles NFKC and whitespace collapse', () => {
    const input = '  H₂O   und  \n   ﬂow   –  rate  ';
    const result = normalizeTextForMatching(input);
    expect(result).toBe('H2O und flow - rate');
  });

  it('normalizes case-insensitively', () => {
    const input = '„Bionische\nStrömungs-\nführung“';
    expect(normalizeForCaseInsensitiveMatch(input)).toBe('"bionische strömungsführung"');
  });
});
