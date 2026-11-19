import { describe, expect, it, vi } from 'vitest';
import type { ITransportAdapter, NormalizedCompletionRequest } from '@/ai';
import {
  CitationSchema,
  type ModelAssignment,
  type ParsedPage,
} from '@/core/schemas';
import {
  CitationRepairDecisionSchema,
  isSufficientContextQuote,
  verifyCitationAgainstPages,
  verifyCitationWithSelfCorrection,
} from '@/verification';

function makePage(
  pageNumber: number,
  rawNormalizedText: string,
  documentId = 'doc-1',
): ParsedPage {
  return {
    documentId,
    pageNumber,
    sectionPath: ['1. Methodik'],
    rawNormalizedText,
    blocks: [
      {
        id: `block-${pageNumber}-1`,
        type: 'paragraph',
        content: rawNormalizedText,
      },
    ],
  };
}

function makeMockTransport(
  responses: Array<{
    text: string;
    inputTokens?: number;
    outputTokens?: number;
  }>,
): {
  transport: ITransportAdapter;
  sendCompletionSpy: ReturnType<typeof vi.fn<ITransportAdapter['sendCompletion']>>;
} {
  let callIndex = 0;
  const sendCompletionSpy = vi.fn<ITransportAdapter['sendCompletion']>(
    async () => {
      const resp = responses[Math.min(callIndex, responses.length - 1)];
      callIndex += 1;
      return {
        text: resp.text,
        provider: 'openai' as const,
        modelId: 'gpt-4o-mini',
        usage: {
          inputTokens: resp.inputTokens ?? 120,
          outputTokens: resp.outputTokens ?? 45,
          costUsd: 0.0005,
        },
      };
    },
  );

  const transport: ITransportAdapter = {
    mode: 'direct-byok',
    sendCompletion: sendCompletionSpy,
    sendEmbedding: vi.fn(),
  };

  return { transport, sendCompletionSpy };
}

const DEFAULT_MODEL: ModelAssignment = {
  provider: 'openai',
  modelId: 'gpt-4o-mini',
  temperature: 0,
};

describe('CitationVerifier & SelfCorrectionHandler (M4)', () => {
  it('1. verifies an exact quote on page N and extracts word-boundary contextBefore and contextAfter', () => {
    const prefix =
      'Einleitender Abschnitt zur Hydrodynamik schneller Schwimmer. Weitere Vorbemerkungen zur Grenzschicht und zum Aufbau der Experimente folgen hier. ';
    const quote =
      'Die mikrostrukturierten Längsrillen der Haihaut reduzieren den turbulenten Reibungswiderstand um bis zu acht Prozent.';
    const suffix =
      ' Dieser Effekt tritt besonders bei hohen Reynoldszahlen auf und wird in der Luftfahrt als Vorbild für Riblet-Folien genutzt.';

    const page = makePage(5, `${prefix}${quote}${suffix}`);
    const result = verifyCitationAgainstPages({
      quoteOriginal: quote,
      claimedPageNumber: 5,
      pages: [page],
      contextChars: 65,
    });

    expect(result.verified).toBe(true);
    expect(result.status).toBe('VERIFIED_EXACT');
    expect(result.matchScore).toBe(1);
    expect(result.matchedPageNumber).toBe(5);
    expect(result.contextBefore.length).toBeGreaterThan(0);
    expect(result.contextBefore.length).toBeLessThanOrEqual(65);
    expect(result.contextBefore).toContain('zum Aufbau der Experimente folgen hier.');
    // Clean word boundary: should not start with a chopped mid-word fragment
    expect(result.contextBefore.startsWith('renzschicht')).toBe(false);
    expect(result.contextAfter.length).toBeGreaterThan(0);
    expect(result.contextAfter.length).toBeLessThanOrEqual(65);
    expect(result.contextAfter).toContain('Dieser Effekt tritt besonders');
    expect(result.contextAfter.endsWith('Reynoldszah')).toBe(false);
  });

  it('2. verifies normalized quotes across PDF hyphenation, Unicode ligatures, typographic quotes, dashes, and case differences', () => {
    const pageText =
      'Vorheriger Kontext im Paper. „Die Ef\uFB01zienz-\nsteigerung bei \uFB02exiblen Riblet-Ober\uFB02ächen — gemessen im Windkanal — beträgt rund neun Prozent.“ Nachfolgender Kontext im Abschnitt.';
    const quote =
      '"Die Effizienzsteigerung bei flexiblen Riblet-Oberflächen - gemessen im Windkanal - beträgt rund neun Prozent."';

    const page = makePage(12, pageText);
    const result = verifyCitationAgainstPages({
      quoteOriginal: quote,
      claimedPageNumber: 12,
      pages: [page],
      contextChars: 40,
    });

    expect(result.verified).toBe(true);
    expect(result.status).toBe('VERIFIED_NORMALIZED');
    expect(result.matchScore).toBe(0.98);
    expect(result.matchedPageNumber).toBe(12);
    expect(result.contextBefore).toBe('Vorheriger Kontext im Paper.');
    expect(result.contextAfter).toBe('Nachfolgender Kontext im Abschnitt.');
  });

  it('3. accepts and verifies concise mathematical LaTeX formulas (>= 15 chars with $ or =)', () => {
    const formula = '$F = k \\cdot \\Delta x$';
    const sufficiency = isSufficientContextQuote(formula);
    expect(sufficiency.ok).toBe(true);

    const page = makePage(
      7,
      'Nach dem Hookeschen Gesetz gilt für lineare elastische Elemente $F = k \\cdot \\Delta x$ bis zum Erreichen der Proportionalitätsgrenze.',
    );
    const result = verifyCitationAgainstPages({
      quoteOriginal: formula,
      claimedPageNumber: 7,
      pages: [page],
    });

    expect(result.verified).toBe(true);
    expect(result.status).toBe('VERIFIED_EXACT');
    expect(result.matchScore).toBe(1);
    expect(result.contextBefore).toContain('Hookeschen Gesetz');
    expect(result.contextAfter).toContain('Proportionalitätsgrenze.');
  });

  it('4. verifies minor OCR typos via sliding-window fuzzy match (>= 0.88) and rejects fabricated paraphrases (< 0.88)', () => {
    const sourceSentence =
      'Die kapillare Wasserleitung im Xylem der Koniferen verhindert Embolien durch selbsttätig schließende Torus-Margo-Tüpfel.';
    const page = makePage(
      18,
      `Einleitung zur Pflanzenphysiologie. ${sourceSentence} Weitere Messungen bestätigen diesen Befund.`,
    );

    // Small OCR typos: "kapil1are", "Konifern", "Torus-Margo-Tupfel" (~96% similarity)
    const ocrQuote =
      'Die kapil1are Wasserleitung im Xylem der Konifern verhindert Embolien durch selbsttätig schließende Torus-Margo-Tupfel.';
    const fuzzyResult = verifyCitationAgainstPages({
      quoteOriginal: ocrQuote,
      claimedPageNumber: 18,
      pages: [page],
    });

    expect(fuzzyResult.verified).toBe(true);
    expect(fuzzyResult.status).toBe('VERIFIED_FUZZY');
    expect(fuzzyResult.matchScore).toBeGreaterThanOrEqual(0.88);
    expect(fuzzyResult.matchScore).toBeLessThan(1);
    expect(fuzzyResult.matchedPageNumber).toBe(18);
    expect(fuzzyResult.contextBefore).toContain('Pflanzenphysiologie.');
    expect(fuzzyResult.contextAfter).toContain('Weitere Messungen');

    // Fabricated paraphrase with completely different wording
    const paraphrase =
      'Bäume nutzen kleine Ventile in den Wurzeln, um Luftblasen beim Wassertransport aktiv wieder aufzulösen.';
    const failedResult = verifyCitationAgainstPages({
      quoteOriginal: paraphrase,
      claimedPageNumber: 18,
      pages: [page],
    });

    expect(failedResult.verified).toBe(false);
    expect(failedResult.status).toBe('FAILED_UNVERIFIED');
    expect(failedResult.failureReason).toBe('NO_MATCH_FOUND');
    expect(failedResult.matchScore).toBeLessThan(0.88);
    expect(failedResult.contextBefore).toBe('');
    expect(failedResult.contextAfter).toBe('');
  });

  it('5. verifies page-break stitched quotes (end of page 41 + start of page 42) and +-1 page offsets', () => {
    const page40 = makePage(
      40,
      'Dieses Zitat steht tatsächlich auf Seite vierzig, obwohl der Extraktor eine Seite zu hoch angegeben hat.',
    );
    const page41 = makePage(
      41,
      'Allgemeine Diskussion der Versuchsergebnisse. Durch die hierarchische Lamellenstruktur der Gecko-Haft-\nhaare entsteht eine außergewöhnlich hohe Adhäsions-',
    );
    const page42 = makePage(
      42,
      'kraft selbst auf mikroskopisch rauen Oberflächen ohne chemische Klebstoffe. Im nächsten Kapitel folgt die Bewertung.',
    );

    // Page-break crossing quote (starts at end of 41, ends at start of 42)
    const crossPageQuote =
      'Durch die hierarchische Lamellenstruktur der Gecko-Hafthaare entsteht eine außergewöhnlich hohe Adhäsionskraft selbst auf mikroskopisch rauen Oberflächen ohne chemische Klebstoffe.';
    const stitchResult = verifyCitationAgainstPages({
      quoteOriginal: crossPageQuote,
      claimedPageNumber: 41,
      pages: [page40, page41, page42],
      contextChars: 80,
    });

    expect(stitchResult.verified).toBe(true);
    expect(stitchResult.status).toBe('VERIFIED_NORMALIZED');
    expect(stitchResult.matchedPageNumber).toBe(41);
    expect(stitchResult.contextBefore).toContain('Versuchsergebnisse.');
    expect(stitchResult.contextAfter).toContain('Im nächsten Kapitel folgt');

    // +-1 page offset: claimed page 41, actual page 40
    const offsetResult = verifyCitationAgainstPages({
      quoteOriginal:
        'Dieses Zitat steht tatsächlich auf Seite vierzig, obwohl der Extraktor eine Seite zu hoch angegeben hat.',
      claimedPageNumber: 41,
      pages: [page40, page41, page42],
    });

    expect(offsetResult.verified).toBe(true);
    expect(offsetResult.status).toBe('VERIFIED_EXACT');
    expect(offsetResult.matchedPageNumber).toBe(40);
  });

  it('6. rejects short fragments (< 40 chars without formula) as TOO_SHORT_FRAGMENT and triggers self-correction', async () => {
    const shortCheck = isSufficientContextQuote('weniger Reibung');
    expect(shortCheck.ok).toBe(false);
    expect(shortCheck.reason).toBe('TOO_SHORT_FRAGMENT');

    const emptyCheck = isSufficientContextQuote('   \n\t  ');
    expect(emptyCheck.ok).toBe(false);
    expect(emptyCheck.reason).toBe('EMPTY_QUOTE');

    const pages = [
      makePage(
        3,
        'Im Versuch zeigten die Riblet-Profile weniger Reibung als glatte Referenzflächen bei Strömungsgeschwindigkeiten über zwölf Metern pro Sekunde.',
      ),
    ];

    const { transport, sendCompletionSpy } = makeMockTransport([
      {
        text: JSON.stringify({
          decision: 'CORRECT_QUOTE',
          correctedQuoteOriginal:
            'Im Versuch zeigten die Riblet-Profile weniger Reibung als glatte Referenzflächen bei Strömungsgeschwindigkeiten über zwölf Metern pro Sekunde.',
          pageNumber: 3,
        }),
      },
    ]);

    const result = await verifyCitationWithSelfCorrection({
      citation: {
        id: 'cit-short',
        documentId: 'doc-1',
        documentTitle: 'Haihaut Studie',
        pageNumber: 3,
        sectionPath: '2. Ergebnisse',
        quoteOriginal: 'weniger Reibung',
      },
      pages,
      sourceChunkText: pages[0].rawNormalizedText,
      transport,
      modelAssignment: DEFAULT_MODEL,
    });

    expect(sendCompletionSpy).toHaveBeenCalledTimes(1);
    const firstReq = sendCompletionSpy.mock
      .calls[0][0] as NormalizedCompletionRequest;
    expect(firstReq.messages[0].content).toContain('TOO_SHORT_FRAGMENT');
    expect(firstReq.messages[0].content).toContain('weniger Reibung');
    expect(result.corrected).toBe(true);
    expect(result.retracted).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.citation.verification.status).toBe('CORRECTED_VERIFIED');
  });

  it('7. handles CORRECT_QUOTE in self-correction and skips LLM completely when attempt 1 already verifies', async () => {
    const pages = [
      makePage(
        9,
        'Vortext auf Seite neun. Die Lotus-Oberfläche kombiniert hydrophobe Wachskristalle mit mikroskopischen Papillen zur Selbstreinigung. Nachtext.',
      ),
      makePage(
        10,
        'Einleitung Seite zehn. Durch diese doppelte Rauheitsstruktur rollen Wassertropfen bereits bei Neigungswinkeln unter fünf Grad vollständig ab. Schluss.',
      ),
    ];

    // Case A: valid quote -> zero LLM calls
    const mockUnused = makeMockTransport([]);
    const directResult = await verifyCitationWithSelfCorrection({
      citation: {
        id: 'cit-ok',
        documentId: 'doc-1',
        documentTitle: 'Lotus-Effekt',
        pageNumber: 9,
        sectionPath: '3. Struktur',
        quoteOriginal:
          'Die Lotus-Oberfläche kombiniert hydrophobe Wachskristalle mit mikroskopischen Papillen zur Selbstreinigung.',
      },
      pages,
      sourceChunkText: `${pages[0].rawNormalizedText}\n${pages[1].rawNormalizedText}`,
      transport: mockUnused.transport,
      modelAssignment: DEFAULT_MODEL,
    });

    expect(mockUnused.sendCompletionSpy).not.toHaveBeenCalled();
    expect(directResult.attempts).toBe(1);
    expect(directResult.corrected).toBe(false);
    expect(directResult.retracted).toBe(false);
    expect(directResult.citation.verification.status).toBe('VERIFIED_EXACT');
    expect(() => CitationSchema.parse(directResult.citation)).not.toThrow();

    // Case B: wrong quote on page 9 -> LLM corrects to exact quote on page 10
    const onUsage = vi.fn();
    const { transport, sendCompletionSpy } = makeMockTransport([
      {
        text: JSON.stringify({
          decision: 'CORRECT_QUOTE',
          correctedQuoteOriginal:
            'Durch diese doppelte Rauheitsstruktur rollen Wassertropfen bereits bei Neigungswinkeln unter fünf Grad vollständig ab.',
          pageNumber: 10,
        }),
        inputTokens: 200,
        outputTokens: 60,
      },
    ]);

    const repaired = await verifyCitationWithSelfCorrection({
      citation: {
        id: 'cit-repair',
        documentId: 'doc-1',
        documentTitle: 'Lotus-Effekt',
        pageNumber: 9,
        sectionPath: '3. Struktur',
        quoteOriginal:
          'Wassertropfen perlen bei genau einem Grad Neigung komplett von der Oberfläche ab.',
      },
      pages,
      sourceChunkText: `${pages[0].rawNormalizedText}\n${pages[1].rawNormalizedText}`,
      transport,
      modelAssignment: DEFAULT_MODEL,
      onUsage,
    });

    expect(sendCompletionSpy).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(repaired.corrected).toBe(true);
    expect(repaired.retracted).toBe(false);
    expect(repaired.attempts).toBe(2);
    expect(repaired.citation.pageNumber).toBe(10);
    expect(repaired.citation.quoteOriginal).toBe(
      'Durch diese doppelte Rauheitsstruktur rollen Wassertropfen bereits bei Neigungswinkeln unter fünf Grad vollständig ab.',
    );
    expect(repaired.citation.contextBefore).toBe('Einleitung Seite zehn.');
    expect(repaired.citation.contextAfter).toBe('Schluss.');
    expect(repaired.citation.verification).toEqual({
      status: 'CORRECTED_VERIFIED',
      matchScore: 1,
      matchedPageNumber: 10,
      attempts: 2,
    });
    expect(() => CitationSchema.parse(repaired.citation)).not.toThrow();
  });

  it('8. handles RETRACT_HALLUCINATION honestly and sets retractionReason', async () => {
    const pages = [
      makePage(
        14,
        'Die Knochenbälkchen der Spongiosa richten sich entlang der Hauptspannungstrajektorien aus und minimieren so das Strukturgewicht.',
      ),
    ];

    const reasonText =
      'Der Quelltext enthält keine Angabe zu einer 40-prozentigen Gewichtsreduktion bei Titanimplantaten.';
    const { transport } = makeMockTransport([
      {
        text: JSON.stringify({
          decision: 'RETRACT_HALLUCINATION',
          retractionReason: reasonText,
        }),
      },
    ]);

    const result = await verifyCitationWithSelfCorrection({
      citation: {
        id: 'cit-hallucination',
        documentId: 'doc-1',
        documentTitle: 'Leichtbau im Skelett',
        pageNumber: 14,
        sectionPath: '4. Analyse',
        quoteOriginal:
          'Titanimplantate mit Spongiosa-Muster erreichen exakt vierzig Prozent Gewichtsersparnis gegenüber Vollmaterial.',
      },
      pages,
      sourceChunkText: pages[0].rawNormalizedText,
      transport,
      modelAssignment: DEFAULT_MODEL,
    });

    expect(result.corrected).toBe(false);
    expect(result.retracted).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.citation.verification).toEqual({
      status: 'RETRACTED_HALLUCINATION',
      matchScore: 0,
      matchedPageNumber: 14,
      attempts: 2,
      retractionReason: reasonText,
    });
    expect(() => CitationSchema.parse(result.citation)).not.toThrow();
  });

  it('9. marks citation as FAILED_UNVERIFIED (hard knockout) when self-correction returns another non-matching quote', async () => {
    const pages = [
      makePage(
        22,
        'Termitenhügel nutzen temperaturabhängige Konvektionsströme über verzweigte Lüftungskanäle zur passiven Klimatisierung des Nestkerns.',
      ),
    ];

    const { transport, sendCompletionSpy } = makeMockTransport([
      {
        text: JSON.stringify({
          decision: 'CORRECT_QUOTE',
          correctedQuoteOriginal:
            'Termiten betreiben im Bau mechanische Ventilatoren zur aktiven Abkühlung bei starker Sonneneinstrahlung.',
          pageNumber: 22,
        }),
      },
    ]);

    const result = await verifyCitationWithSelfCorrection({
      citation: {
        id: 'cit-knockout',
        documentId: 'doc-1',
        documentTitle: 'Passive Thermoregulation',
        pageNumber: 22,
        sectionPath: '5. Thermik',
        quoteOriginal:
          'Aktive Pumpen kühlen die Kammern von Termitenbauten in der Wüste konstant auf achtzehn Grad.',
      },
      pages,
      sourceChunkText: pages[0].rawNormalizedText,
      transport,
      modelAssignment: DEFAULT_MODEL,
    });

    expect(sendCompletionSpy).toHaveBeenCalledTimes(1);
    expect(result.corrected).toBe(false);
    expect(result.retracted).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.citation.verification.status).toBe('FAILED_UNVERIFIED');
    expect(result.citation.verification.attempts).toBe(2);
    expect(result.citation.verification.matchScore).toBeLessThan(0.88);
    expect(() => CitationSchema.parse(result.citation)).not.toThrow();
  });

  it('supports long multi-sentence quotes (~1,500 chars) and validates CitationRepairDecisionSchema', () => {
    const longSentence =
      'Die bionische Übertragung biologischer Funktionsprinzipien erfordert eine sorgfältige Abstraktion der zugrundeliegenden physikalischen Randbedingungen über verschiedene Größenskalen hinweg. ';
    const longQuote = longSentence.repeat(7).trim(); // ~1290 chars
    expect(longQuote.length).toBeGreaterThan(1000);
    expect(longQuote.length).toBeLessThan(1500);

    expect(isSufficientContextQuote(longQuote).ok).toBe(true);

    const page = makePage(1, `Vorwort. ${longQuote} Nachwort.`);
    const result = verifyCitationAgainstPages({
      quoteOriginal: longQuote,
      claimedPageNumber: 1,
      pages: [page],
    });

    expect(result.verified).toBe(true);
    expect(result.status).toBe('VERIFIED_EXACT');
    expect(result.contextBefore).toBe('Vorwort.');
    expect(result.contextAfter).toBe('Nachwort.');

    expect(
      CitationRepairDecisionSchema.safeParse({
        decision: 'RETRACT_HALLUCINATION',
        retractionReason: 'Nicht belegt.',
      }).success,
    ).toBe(true);
    expect(
      CitationRepairDecisionSchema.safeParse({
        decision: 'INVALID',
      }).success,
    ).toBe(false);
  });
});
