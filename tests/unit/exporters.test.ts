import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BioBridgeProjectBundle, PromptSlotId } from '@/core/schemas';
import {
  createBioBridgeDB,
  exportExperimentToCsv,
  exportExperimentToMarkdown,
  exportProjectBundle,
  getCandidatesForExperiment,
  getDocumentById,
  getExperiment,
  getPagesForDocument,
  getReviewsForExperiment,
  importProjectBundleIntoDb,
  listExtractionCaches,
  parseProjectBundle,
  serializeProjectBundle,
  type BioBridgeDB,
} from '@/storage';

function createSampleBundle(): BioBridgeProjectBundle {
  const promptSlot = (id: PromptSlotId) => ({
    id,
    title: `Slot ${id}`,
    description: `Description for ${id}`,
    phase: 'phase2',
    riskHint: 'Low',
    editableSystemInstruction: 'Be precise.',
    lockedOutputContract: '{"type":"object"}',
    requiredVariables: ['input'],
  });

  return exportProjectBundle({
    exportedAt: '2026-11-19T14:00:00.000Z',
    experiment: {
      id: 'exp-roundtrip-1',
      name: 'Lotus & Turbinenschaufel',
      createdAt: '2026-11-19T12:00:00.000Z',
      updatedAt: '2026-11-19T13:30:00.000Z',
      status: 'COMPLETED',
      biologyDocIds: ['doc-bio-1'],
      technologyDocIds: ['doc-tech-1'],
      config: {
        outputLanguage: 'de',
        crossingStrategy: 'embedding-hybrid',
        creativityDistance: 0.65,
        distanceBand: 'balanced',
        maxCandidates: 5,
        includeDiagrams: true,
        pdfMathVisionMode: 'auto',
        modelAssignments: {
          extraction: { provider: 'gemini', modelId: 'gemini-2.5-flash' },
          vision: { provider: 'gemini', modelId: 'gemini-2.5-flash' },
          embedding: { provider: 'openai', modelId: 'text-embedding-3-small' },
          crossing: { provider: 'gemini', modelId: 'gemini-2.5-pro' },
          critic: { provider: 'openai', modelId: 'gpt-4o' },
        },
        weights: {
          mechanismDepth: 1,
          scalabilityAndConstraints: 1,
          technicalValue: 1,
          novelty: 1,
        },
        promptProfileSnapshot: {
          id: 'prof-1',
          name: 'Standard',
          isDefault: true,
          slots: {
            extractBio: promptSlot('extractBio'),
            extractTech: promptSlot('extractTech'),
            visionExtract: promptSlot('visionExtract'),
            consolidate: promptSlot('consolidate'),
            crossing: promptSlot('crossing'),
            cluster: promptSlot('cluster'),
            critic: promptSlot('critic'),
            citationRepair: promptSlot('citationRepair'),
          },
          createdAt: '2026-11-19T10:00:00.000Z',
          updatedAt: '2026-11-19T10:00:00.000Z',
        },
      },
      checkpoint: {
        currentPhase: 'completed',
        completedVisionPageKeys: [],
        completedChunkKeys: ['c1', 'c2'],
        completedPairKeys: ['p1', 'p2'],
        completedReviewKeys: ['cand-high', 'cand-low'],
      },
      costEstimate: {
        phase1Vision: { minUsd: 0.01, expectedUsd: 0.02, maxUsd: 0.03, estimatedTokens: 100 },
        phase2Extract: { minUsd: 0.02, expectedUsd: 0.03, maxUsd: 0.05, estimatedTokens: 500 },
        phase3Cross: { minUsd: 0.03, expectedUsd: 0.05, maxUsd: 0.08, estimatedTokens: 800 },
        phase4Critic: { minUsd: 0.02, expectedUsd: 0.04, maxUsd: 0.06, estimatedTokens: 600 },
        total: { minUsd: 0.08, expectedUsd: 0.14, maxUsd: 0.22, estimatedTokens: 2000 },
        cachedDocumentIds: [],
        visionPageCount: 1,
        estimatedDurationSec: { min: 10, expected: 20, max: 30 },
        usdToEurRate: 0.92,
        computedAt: '2026-11-19T12:00:00.000Z',
      },
      costLedger: {
        totalInputTokens: 1500,
        totalOutputTokens: 500,
        totalVisionImages: 1,
        totalCostUsd: 0.135,
        entries: [],
      },
    },
    documents: [
      {
        id: 'doc-bio-1',
        domain: 'biology',
        fileName: 'nelumbo_nucifera.pdf',
        mimeType: 'application/pdf',
        format: 'pdf',
        contentHash: 'hash-bio-1',
        fileSizeBytes: 2048,
        pageCount: 2,
        detectedLanguage: 'en',
        stats: {
          totalChars: 400,
          estimatedTokens: 100,
          detectedFigurePages: [1],
          detectedMathAnomalyPages: [],
        },
        createdAt: '2026-11-19T11:00:00.000Z',
      },
      {
        id: 'doc-tech-1',
        domain: 'technology',
        fileName: 'turbine_fouling.pdf',
        mimeType: 'application/pdf',
        format: 'pdf',
        contentHash: 'hash-tech-1',
        fileSizeBytes: 3072,
        pageCount: 2,
        detectedLanguage: 'de',
        stats: {
          totalChars: 500,
          estimatedTokens: 125,
          detectedFigurePages: [],
          detectedMathAnomalyPages: [2],
        },
        createdAt: '2026-11-19T11:05:00.000Z',
      },
    ],
    parsedPages: [
      {
        documentId: 'doc-bio-1',
        pageNumber: 1,
        sectionPath: ['2. Surface Morphology'],
        rawNormalizedText: 'Dual-scale epicuticular wax crystals trap air pockets.',
        blocks: [{ id: 'b1', type: 'paragraph', content: 'Dual-scale epicuticular wax crystals trap air pockets.' }],
      },
      {
        documentId: 'doc-tech-1',
        pageNumber: 2,
        sectionPath: ['3. Vereisung & Verschmutzung'],
        rawNormalizedText: 'Anhaftung von Partikeln reduziert den Wirkungsgrad um 12%.',
        blocks: [{ id: 't1', type: 'paragraph', content: 'Anhaftung von Partikeln reduziert den Wirkungsgrad um 12%.' }],
      },
    ],
    mechanisms: [
      {
        id: 'mech-1',
        sourceDocumentIds: ['doc-bio-1'],
        title: 'Hierarchische Mikro-Nano-Benetzungsbarriere',
        biologicalSystem: 'Nelumbo nucifera',
        structure: 'Papillen + Wachskristalle',
        workingPrinciple: 'Cassie-Baxter-Zustand mit Lufteinschluss',
        achievedEffect: 'Selbstreinigung bei Kontaktwinkel > 150°',
        boundaryConditions: {
          spatialScale: '1-20 µm',
          timeScale: 'ms',
          medium: 'Wasser / Luft',
          energyForm: 'Grenzflächenenergie',
          operatingConstraints: 'Umgebungstemperatur',
        },
        functionalAbstract: 'Reduziert Feststoff-Flüssigkeits-Kontaktfläche drastisch.',
        citations: [
          {
            id: 'cit-bio-1',
            documentId: 'doc-bio-1',
            documentTitle: 'nelumbo_nucifera.pdf',
            pageNumber: 1,
            sectionPath: '2. Surface Morphology',
            quoteOriginal: 'Dual-scale epicuticular wax crystals, "micro-bumps", trap air pockets.',
            quoteTranslation: 'Zweiskalige Wachskristalle schließen Luftpolster ein.',
            contextBefore: 'In leaf epidermis...',
            contextAfter: 'leading to high contact angles.',
            verification: {
              status: 'VERIFIED_EXACT',
              matchScore: 1,
              matchedPageNumber: 1,
              attempts: 1,
            },
          },
        ],
      },
    ],
    problems: [
      {
        id: 'prob-1',
        sourceDocumentIds: ['doc-tech-1'],
        title: 'Partikelanhaftung an Rotorblättern',
        technicalDomain: 'Windenergie',
        problemStatement: 'Biofouling und Insektenreste stören die Grenzschicht.',
        coreBottleneck: 'Hohe Oberflächenbenetzung bei Regen-Staub-Gemisch',
        targetMetrics: 'Wirkungsgradverlust < 2%',
        currentApproachesAndLimits: 'PTFE-Lacke verschleißen unter UV-Erosion',
        boundaryConditions: {
          spatialScale: '10-100 m Rotorblatt',
          timeScale: 'Jahre',
          medium: 'Regen, Luft, Staub',
          energyForm: 'Aerodynamisch',
          operatingConstraints: 'v_tip bis 80 m/s',
        },
        functionalNeedAbstract: 'Passive Minimierung der Adhäsionskraft bei hoher Scherung.',
        citations: [
          {
            id: 'cit-tech-1',
            documentId: 'doc-tech-1',
            documentTitle: 'turbine_fouling.pdf',
            pageNumber: 2,
            sectionPath: '3. Vereisung & Verschmutzung',
            quoteOriginal: 'Anhaftung von Partikeln,\nreduziert den Wirkungsgrad um 12%.',
            contextBefore: 'Messungen zeigen:',
            contextAfter: 'Dies erfordert Wartungszyklen.',
            verification: {
              status: 'VERIFIED_NORMALIZED',
              matchScore: 0.96,
              matchedPageNumber: 2,
              attempts: 1,
            },
          },
        ],
      },
    ],
    candidates: [
      {
        id: 'cand-low',
        experimentId: 'exp-roundtrip-1',
        mechanismId: 'mech-1',
        problemId: 'prob-1',
        strategyUsed: 'cluster-batch',
        bridgeTitle: 'Einfache Wachsbeschichtung',
        abstractTransferLogic: 'Direkte Wachsapplikation.',
        proposedImplementationSketch: 'Sprühauftrag ohne Matrix.',
        keyAssumptions: ['Statische Belastung'],
        potentialFailureModes: ['Schneller Abrieb'],
        mechanismCitationIds: ['cit-bio-1'],
        problemCitationIds: ['cit-tech-1'],
        createdAt: '2026-11-19T13:00:00.000Z',
      },
      {
        id: 'cand-high',
        experimentId: 'exp-roundtrip-1',
        mechanismId: 'mech-1',
        problemId: 'prob-1',
        strategyUsed: 'embedding-hybrid',
        similarityScore: 0.89,
        distanceBand: 'balanced',
        bridgeTitle: 'Erosionsresistente "Cassie-Baxter"-Keramikmatrix',
        abstractTransferLogic: 'Kontaktwinkel folgt $$\\cos \\theta^* = f_1 \\cos \\theta_1 - f_2$$.',
        proposedImplementationSketch: 'Lasertexturierte SiC-Deckschicht im Mikrometerbereich.',
        keyAssumptions: ['Luftpolster bleiben unter 80 m/s stabil'],
        potentialFailureModes: ['Kavitation bei Starkregen'],
        mechanismCitationIds: ['cit-bio-1'],
        problemCitationIds: ['cit-tech-1'],
        createdAt: '2026-11-19T13:05:00.000Z',
      },
    ],
    reviews: [
      {
        candidateId: 'cand-low',
        experimentId: 'exp-roundtrip-1',
        criticModelUsed: 'gpt-4o',
        scores: {
          mechanismDepth: 1,
          scalabilityAndConstraints: 0,
          technicalValue: 1,
          novelty: 0,
          evidenceQuality: 'PASS',
        },
        weightedTotalScore: 2,
        status: 'REJECTED_SCALING',
        scalingWarning: 'Nicht erosionsbeständig bei 80 m/s.',
        criticalCounterarguments: ['Wachs wird sofort abgetragen.'],
        openHurdles: [],
        verdictSummary: 'Ungeeignet für Hochgeschwindigkeitsrotoren.',
        createdAt: '2026-11-19T13:20:00.000Z',
      },
      {
        candidateId: 'cand-high',
        experimentId: 'exp-roundtrip-1',
        criticModelUsed: 'gpt-4o',
        scores: {
          mechanismDepth: 3,
          scalabilityAndConstraints: 2,
          technicalValue: 2,
          novelty: 2,
          evidenceQuality: 'PASS',
        },
        weightedTotalScore: 9,
        status: 'PROMISING',
        scalingWarning: 'Übergang Cassie-Baxter zu Wenzel bei Druckstößen prüfen.',
        knownPriorArt: 'Lasertexturierung auf Aluminium-Tragflächen (2021).',
        criticalCounterarguments: [
          'Herstellungskosten für 80m-Blätter hoch',
          'Regenerosionstest über 5000h ausstehend',
        ],
        openHurdles: ['Langzeit-Regenerosionstest'],
        verdictSummary: 'Sehr vielversprechend mit klar definiertem Skalierungsrisiko.',
        createdAt: '2026-11-19T13:25:00.000Z',
      },
    ],
  });
}

describe('exporters & projectBundleIo', () => {
  let testDb: BioBridgeDB;
  let dbCounter = 0;

  beforeEach(() => {
    dbCounter += 1;
    testDb = createBioBridgeDB(`biobridge_export_test_${Date.now()}_${dbCounter}`);
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('performs lossless .biobridge.json export -> serialize -> parse -> import roundtrip', async () => {
    const bundle = createSampleBundle();
    const jsonText = serializeProjectBundle(bundle);
    const parsed = parseProjectBundle(jsonText);

    expect(parsed).toEqual(bundle);

    const result = await importProjectBundleIntoDb(parsed, testDb);
    expect(result).toEqual({
      experimentId: 'exp-roundtrip-1',
      importedDocuments: 2,
      importedCandidates: 2,
      importedReviews: 2,
    });

    const exp = await getExperiment('exp-roundtrip-1', testDb);
    expect(exp).toEqual(bundle.experiment);
    expect(await getDocumentById('doc-bio-1', testDb)).toEqual(bundle.documents[0]);
    expect(await getPagesForDocument('doc-bio-1', testDb)).toEqual([bundle.parsedPages[0]]);
    expect(await getCandidatesForExperiment('exp-roundtrip-1', testDb)).toHaveLength(2);
    expect(await getReviewsForExperiment('exp-roundtrip-1', testDb)).toHaveLength(2);

    const caches = await listExtractionCaches(undefined, testDb);
    expect(caches).toHaveLength(2);
  });

  it('rejects invalid JSON and unsupported schemaVersion with clear error messages', () => {
    expect(() => parseProjectBundle('{not valid json')).toThrow(/Invalid BioBridge project bundle JSON/);
    expect(() =>
      parseProjectBundle(JSON.stringify({ schemaVersion: '2.0.0' })),
    ).toThrow(/Unsupported BioBridge project bundle schemaVersion: "2.0.0"/);
  });

  it('exports a complete Markdown report sorted by score with LaTeX, citations, and critic review', () => {
    const bundle = createSampleBundle();
    const md = exportExperimentToMarkdown(bundle);

    expect(md).toContain('# BioBridge Bericht: Lotus & Turbinenschaufel');
    expect(md).toContain('**Gesamtkosten:** $0.1350 USD (~0.1242 EUR)');
    expect(md).toContain('$$\\cos \\theta^* = f_1 \\cos \\theta_1 - f_2$$');
    expect(md).toContain('nelumbo_nucifera.pdf (S. 1)');
    expect(md).toContain('Zweiskalige Wachskristalle schließen Luftpolster ein.');
    expect(md).toContain('`VERIFIED_EXACT`');
    expect(md).toContain('#### Advocatus-Diaboli-Gutachten');
    expect(md).toContain('Übergang Cassie-Baxter zu Wenzel bei Druckstößen prüfen.');

    // Higher-scored candidate (cand-high, 9.00) must appear before lower-scored (cand-low, 2.00)
    const highPos = md.indexOf('Erosionsresistente "Cassie-Baxter"-Keramikmatrix');
    const lowPos = md.indexOf('Einfache Wachsbeschichtung');
    expect(highPos).toBeGreaterThan(-1);
    expect(lowPos).toBeGreaterThan(-1);
    expect(highPos).toBeLessThan(lowPos);
  });

  it('exports RFC-4180 compliant CSV with optional BOM and proper escaping of quotes, commas, and newlines', () => {
    const bundle = createSampleBundle();
    const csvWithBom = exportExperimentToCsv(bundle);
    expect(csvWithBom.startsWith('\uFEFF')).toBe(true);

    const csvNoBom = exportExperimentToCsv(bundle, { includeBom: false });
    expect(csvNoBom.startsWith('Rank,Status,TotalScore,BridgeTitle')).toBe(true);

    // Check required header columns
    const firstNewline = csvNoBom.indexOf('\r\n');
    const header = csvNoBom.slice(0, firstNewline);
    expect(header).toBe(
      'Rank,Status,TotalScore,BridgeTitle,MechanismDepth,Scalability,TechnicalValue,Novelty,EvidenceQuality,BiologySource,BiologyPage,BiologyQuote,BiologyVerification,TechnologySource,TechnologyPage,TechnologyQuote,TechnologyVerification,ScalingWarning,KnownPriorArt,CriticalCounterarguments,VerdictSummary',
    );

    // Quotes inside BridgeTitle and BioQuote must be doubled and wrapped in quotes
    expect(csvNoBom).toContain('"Erosionsresistente ""Cassie-Baxter""-Keramikmatrix"');
    expect(csvNoBom).toContain('"Dual-scale epicuticular wax crystals, ""micro-bumps"", trap air pockets."');
    // Embedded newline inside TechnologyQuote must be preserved inside double quotes
    expect(csvNoBom).toContain('"Anhaftung von Partikeln,\nreduziert den Wirkungsgrad um 12%."');
    // Rank 1 should be PROMISING (9.00), Rank 2 should be REJECTED_SCALING (2.00)
    expect(csvNoBom).toContain('\r\n1,PROMISING,9.00,');
    expect(csvNoBom).toContain('\r\n2,REJECTED_SCALING,2.00,');
  });
});
