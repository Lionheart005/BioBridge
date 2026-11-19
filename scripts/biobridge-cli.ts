import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type {
  BoundaryConditions,
  Citation,
  CrossingCandidate,
  CrossingStrategyType,
  CriticReview,
  Domain,
  ExperimentRun,
  ExtractedMechanism,
  ExtractedProblem,
  ParsedPage,
  ScoreBreakdown,
  SourceDocument,
} from '@/core/schemas';
import { enforceDeterministicReviewRules } from '@/core/scoring/deterministicRules';
import { chunkDocumentPages } from '@/ingestion/chunker';
import { ingestDocument } from '@/ingestion/ingestionRouter';
import { createDefaultPromptProfile } from '@/prompts/defaults';
import { exportExperimentToCsv } from '@/storage/exporters/csvExporter';
import { exportExperimentToMarkdown } from '@/storage/exporters/markdownExporter';
import { exportProjectBundle, serializeProjectBundle } from '@/storage/exporters/projectBundleIo';
import { verifyCitationAgainstPages } from '@/verification/citationVerifier';

export interface CliIngestOptions {
  bioPaths: string[];
  techPaths: string[];
  outDir: string;
}

export interface ManifestDocumentEntry {
  id: string;
  domain: Domain;
  fileName: string;
  format: SourceDocument['format'];
  pageCount: number;
  estimatedTokens: number;
  detectedFigurePages: number[];
  detectedMathAnomalyPages: number[];
  chunkFiles: string[];
}

export interface RunManifest {
  createdAt: string;
  runDir: string;
  documents: ManifestDocumentEntry[];
  bioChunks: string[];
  techChunks: string[];
}

export interface CliIngestResult {
  runDir: string;
  documents: SourceDocument[];
  parsedPages: ParsedPage[];
  manifest: RunManifest;
}

export interface RawCitationInput {
  id?: string;
  documentId?: string;
  documentTitle?: string;
  pageNumber: number;
  sectionPath?: string;
  quoteOriginal: string;
  quoteTranslation?: string;
  retracted?: boolean;
  retractionReason?: string;
}

export interface RawMechanismInput {
  id?: string;
  sourceDocumentIds?: string[];
  title: string;
  biologicalSystem: string;
  structure: string;
  workingPrinciple: string;
  achievedEffect: string;
  boundaryConditions?: Partial<BoundaryConditions>;
  functionalAbstract: string;
  citations: RawCitationInput[];
}

export interface RawProblemInput {
  id?: string;
  sourceDocumentIds?: string[];
  title: string;
  technicalDomain: string;
  problemStatement: string;
  coreBottleneck: string;
  targetMetrics?: string;
  currentApproachesAndLimits?: string;
  boundaryConditions?: Partial<BoundaryConditions>;
  functionalNeedAbstract: string;
  citations: RawCitationInput[];
}

export interface CliVerifyOptions {
  runDir: string;
  domain: Domain;
  inputPath: string;
  outPath?: string;
  attempt?: 1 | 2;
}

export interface FailedQuoteEntry {
  itemId: string;
  itemTitle: string;
  citationId: string;
  documentId: string;
  documentTitle: string;
  quoteOriginal: string;
  claimedPageNumber: number;
  failureReason: string;
  failureDetails: string;
  nearbySourceText: string;
}

export interface VerificationReport {
  domain: Domain;
  attempt: 1 | 2;
  totalCitations: number;
  verifiedCount: number;
  failedCount: number;
  retractedCount: number;
  failedQuotes: FailedQuoteEntry[];
}

export interface CliVerifyResult {
  outPath: string;
  reportPath: string;
  items: Array<ExtractedMechanism | ExtractedProblem>;
  report: VerificationReport;
}

export interface RawCandidateInput {
  id?: string;
  experimentId?: string;
  mechanismId: string;
  problemId: string;
  strategyUsed?: CrossingStrategyType;
  similarityScore?: number;
  distanceBand?: CrossingCandidate['distanceBand'];
  bridgeTitle: string;
  abstractTransferLogic: string;
  proposedImplementationSketch: string;
  keyAssumptions?: string[];
  potentialFailureModes?: string[];
  mechanismCitationIds?: string[];
  problemCitationIds?: string[];
  createdAt?: string;
}

export interface RawReviewInput {
  candidateId: string;
  experimentId?: string;
  criticModelUsed?: string;
  scores: ScoreBreakdown;
  status?: CriticReview['status'];
  scalingWarning?: string;
  knownPriorArt?: string;
  criticalCounterarguments?: string[];
  openHurdles?: string[];
  verdictSummary: string;
  createdAt?: string;
}

export interface CliBuildBundleOptions {
  runDir: string;
  name: string;
  outPath?: string;
  language?: string;
  strategy?: CrossingStrategyType;
  criticModel?: string;
  exportMd?: boolean;
  exportCsv?: boolean;
}

export interface CliBuildBundleResult {
  bundlePath: string;
  markdownPath?: string;
  csvPath?: string;
  experimentId: string;
  candidateCount: number;
  reviewCount: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function normalizeBoundaryConditions(
  partial?: Partial<BoundaryConditions>,
): BoundaryConditions {
  return {
    spatialScale: partial?.spatialScale?.trim() || 'nicht spezifiziert',
    timeScale: partial?.timeScale?.trim() || 'nicht spezifiziert',
    medium: partial?.medium?.trim() || 'nicht spezifiziert',
    energyForm: partial?.energyForm?.trim() || 'nicht spezifiziert',
    operatingConstraints: partial?.operatingConstraints?.trim() || 'nicht spezifiziert',
    ...(partial?.faultTolerance ? { faultTolerance: partial.faultTolerance } : {}),
    ...(partial?.reliabilityRequirements
      ? { reliabilityRequirements: partial.reliabilityRequirements }
      : {}),
  };
}

function buildNearbySourceText(
  pages: ParsedPage[],
  claimedPageNumber: number,
): string {
  const minPage = Math.max(1, claimedPageNumber - 1);
  const maxPage = claimedPageNumber + 1;
  const relevant = pages
    .filter((p) => p.pageNumber >= minPage && p.pageNumber <= maxPage)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const targetPages = relevant.length > 0 ? relevant : pages.slice(0, 3);
  return targetPages
    .map((p) => `[[PAGE:${p.pageNumber}]]\n${p.rawNormalizedText}`)
    .join('\n\n');
}

function formatChunkHeader(
  doc: SourceDocument,
  chunkIndex: number,
  startPage: number,
  endPage: number,
  sectionPath: string[],
): string {
  const lines = [
    `# BioBridge Chunk`,
    `documentId: ${doc.id}`,
    `documentTitle: ${doc.fileName}`,
    `domain: ${doc.domain}`,
    `chunkIndex: ${chunkIndex}`,
    `pages: ${startPage}..${endPage}`,
    `sectionPath: ${sectionPath.join(' > ') || 'Root'}`,
    `---`,
    '',
  ];
  return lines.join('\n');
}

/**
 * Ingests biology and technology documents into a BioBridge CLI run directory.
 */
export async function runCliIngest(options: CliIngestOptions): Promise<CliIngestResult> {
  const runDir = path.resolve(options.outDir);
  if (options.bioPaths.length === 0 && options.techPaths.length === 0) {
    throw new Error('Mindestens ein Dokument (--bio oder --tech) muss angegeben werden.');
  }

  const bioChunksDir = path.join(runDir, 'chunks', 'bio');
  const techChunksDir = path.join(runDir, 'chunks', 'tech');
  await mkdir(bioChunksDir, { recursive: true });
  await mkdir(techChunksDir, { recursive: true });

  const documents: SourceDocument[] = [];
  const parsedPages: ParsedPage[] = [];
  const manifestDocs: ManifestDocumentEntry[] = [];
  const bioChunks: string[] = [];
  const techChunks: string[] = [];

  const inputs: Array<{ domain: Domain; filePath: string }> = [
    ...options.bioPaths.map((filePath) => ({ domain: 'biology' as const, filePath })),
    ...options.techPaths.map((filePath) => ({ domain: 'technology' as const, filePath })),
  ];

  for (const item of inputs) {
    const absPath = path.resolve(item.filePath);
    const bytes = await readFile(absPath);
    const fileName = path.basename(absPath);

    const ingested = await ingestDocument({
      fileName,
      data: new Uint8Array(bytes),
      domain: item.domain,
    });

    documents.push(ingested.document);
    parsedPages.push(...ingested.pages);

    const chunks = chunkDocumentPages(ingested.document, ingested.pages);
    const chunkFiles: string[] = [];
    const targetSubdir = item.domain === 'biology' ? bioChunksDir : techChunksDir;

    for (const chunk of chunks) {
      const chunkFileName = `${ingested.document.id}_chunk_${chunk.chunkIndex}.txt`;
      const chunkAbsPath = path.join(targetSubdir, chunkFileName);
      const chunkRelPath = path.relative(runDir, chunkAbsPath).replace(/\\/g, '/');
      const header = formatChunkHeader(
        ingested.document,
        chunk.chunkIndex,
        chunk.startPage,
        chunk.endPage,
        chunk.sectionPath,
      );
      await writeFile(chunkAbsPath, `${header}${chunk.text}\n`, 'utf-8');
      chunkFiles.push(chunkRelPath);
      if (item.domain === 'biology') {
        bioChunks.push(chunkRelPath);
      } else {
        techChunks.push(chunkRelPath);
      }
    }

    manifestDocs.push({
      id: ingested.document.id,
      domain: item.domain,
      fileName: ingested.document.fileName,
      format: ingested.document.format,
      pageCount: ingested.document.pageCount,
      estimatedTokens: ingested.document.stats.estimatedTokens,
      detectedFigurePages: ingested.document.stats.detectedFigurePages,
      detectedMathAnomalyPages: ingested.document.stats.detectedMathAnomalyPages,
      chunkFiles,
    });
  }

  const manifest: RunManifest = {
    createdAt: nowIso(),
    runDir,
    documents: manifestDocs,
    bioChunks,
    techChunks,
  };

  await writeJsonFile(path.join(runDir, 'documents.json'), documents);
  await writeJsonFile(path.join(runDir, 'parsedPages.json'), parsedPages);
  await writeJsonFile(path.join(runDir, 'manifest.json'), manifest);

  return {
    runDir,
    documents,
    parsedPages,
    manifest,
  };
}

function extractRawItems<T>(rawJson: unknown, key: 'mechanisms' | 'problems'): T[] {
  if (Array.isArray(rawJson)) {
    return rawJson as T[];
  }
  if (rawJson && typeof rawJson === 'object' && key in rawJson) {
    const value = (rawJson as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }
  throw new Error(
    `Ungültiges Eingabeformat: Erwartet Array oder Objekt mit Feld "${key}".`,
  );
}

/**
 * Deterministically verifies extracted biology or technology citations against parsedPages.json.
 */
export async function runCliVerify(options: CliVerifyOptions): Promise<CliVerifyResult> {
  const runDir = path.resolve(options.runDir);
  const attempt: 1 | 2 = options.attempt === 2 ? 2 : 1;

  const documents = await readJsonFile<SourceDocument[]>(path.join(runDir, 'documents.json'));
  const parsedPages = await readJsonFile<ParsedPage[]>(path.join(runDir, 'parsedPages.json'));
  const rawInput = await readJsonFile<unknown>(path.resolve(options.inputPath));

  const docById = new Map(documents.map((d) => [d.id, d]));
  const domainDocs = documents.filter((d) => d.domain === options.domain);
  const pagesByDocId = new Map<string, ParsedPage[]>();
  for (const page of parsedPages) {
    const list = pagesByDocId.get(page.documentId) ?? [];
    list.push(page);
    pagesByDocId.set(page.documentId, list);
  }

  const rawItems =
    options.domain === 'biology'
      ? extractRawItems<RawMechanismInput>(rawInput, 'mechanisms')
      : extractRawItems<RawProblemInput>(rawInput, 'problems');

  const verifiedItems: Array<ExtractedMechanism | ExtractedProblem> = [];
  const failedQuotes: FailedQuoteEntry[] = [];
  let totalCitations = 0;
  let verifiedCount = 0;
  let failedCount = 0;
  let retractedCount = 0;

  rawItems.forEach((rawItem, itemIdx) => {
    const itemId =
      rawItem.id?.trim() ||
      `${options.domain === 'biology' ? 'mech' : 'prob'}_${itemIdx + 1}`;
    const rawCitations = Array.isArray(rawItem.citations) ? rawItem.citations : [];

    const verifiedCitations: Citation[] = rawCitations.map((rawCit, citIdx) => {
      totalCitations += 1;
      const citationId = rawCit.id?.trim() || `${itemId}_cit_${citIdx + 1}`;
      const resolvedDocId =
        rawCit.documentId?.trim() ||
        rawItem.sourceDocumentIds?.[0] ||
        domainDocs[0]?.id ||
        documents[0]?.id ||
        'unknown-doc';
      const doc = docById.get(resolvedDocId);
      const documentTitle =
        rawCit.documentTitle?.trim() || doc?.fileName || resolvedDocId;
      const sectionPath = rawCit.sectionPath?.trim() || '';
      const pageNumber = Math.max(1, Math.trunc(rawCit.pageNumber || 1));
      const docPages = pagesByDocId.get(resolvedDocId) ?? [];

      if (rawCit.retracted === true) {
        retractedCount += 1;
        return {
          id: citationId,
          documentId: resolvedDocId,
          documentTitle,
          pageNumber,
          sectionPath,
          quoteOriginal: rawCit.quoteOriginal,
          ...(rawCit.quoteTranslation ? { quoteTranslation: rawCit.quoteTranslation } : {}),
          contextBefore: '',
          contextAfter: '',
          verification: {
            status: 'RETRACTED_HALLUCINATION',
            matchScore: 0,
            matchedPageNumber: pageNumber,
            attempts: attempt,
            retractionReason:
              rawCit.retractionReason?.trim() ||
              'Vom Agenten in der Selbstkorrektur zurückgezogen.',
          },
        };
      }

      const result = verifyCitationAgainstPages({
        quoteOriginal: rawCit.quoteOriginal,
        claimedPageNumber: pageNumber,
        pages: docPages,
      });

      if (result.verified) {
        verifiedCount += 1;
        return {
          id: citationId,
          documentId: resolvedDocId,
          documentTitle,
          pageNumber,
          sectionPath,
          quoteOriginal: rawCit.quoteOriginal,
          ...(rawCit.quoteTranslation ? { quoteTranslation: rawCit.quoteTranslation } : {}),
          contextBefore: result.contextBefore,
          contextAfter: result.contextAfter,
          verification: {
            status: attempt === 2 ? 'CORRECTED_VERIFIED' : result.status,
            matchScore: result.matchScore,
            matchedPageNumber: result.matchedPageNumber,
            attempts: attempt,
          },
        };
      }

      failedCount += 1;
      failedQuotes.push({
        itemId,
        itemTitle: rawItem.title,
        citationId,
        documentId: resolvedDocId,
        documentTitle,
        quoteOriginal: rawCit.quoteOriginal,
        claimedPageNumber: pageNumber,
        failureReason: result.failureReason ?? 'NOT_FOUND',
        failureDetails: result.failureDetails ?? 'Zitat nicht im Quelltext gefunden.',
        nearbySourceText: buildNearbySourceText(docPages, pageNumber),
      });

      return {
        id: citationId,
        documentId: resolvedDocId,
        documentTitle,
        pageNumber,
        sectionPath,
        quoteOriginal: rawCit.quoteOriginal,
        ...(rawCit.quoteTranslation ? { quoteTranslation: rawCit.quoteTranslation } : {}),
        contextBefore: result.contextBefore,
        contextAfter: result.contextAfter,
        verification: {
          status: 'FAILED_UNVERIFIED',
          matchScore: result.matchScore,
          matchedPageNumber: result.matchedPageNumber,
          attempts: attempt,
        },
      };
    });

    const derivedDocIds = Array.from(
      new Set(
        (rawItem.sourceDocumentIds && rawItem.sourceDocumentIds.length > 0
          ? rawItem.sourceDocumentIds
          : verifiedCitations.map((c) => c.documentId)
        ).filter((id) => id.length > 0),
      ),
    );
    const sourceDocumentIds =
      derivedDocIds.length > 0
        ? derivedDocIds
        : [domainDocs[0]?.id ?? documents[0]?.id ?? 'unknown-doc'];

    if (options.domain === 'biology') {
      const bioItem = rawItem as RawMechanismInput;
      verifiedItems.push({
        id: itemId,
        sourceDocumentIds,
        title: bioItem.title,
        biologicalSystem: bioItem.biologicalSystem,
        structure: bioItem.structure,
        workingPrinciple: bioItem.workingPrinciple,
        achievedEffect: bioItem.achievedEffect,
        boundaryConditions: normalizeBoundaryConditions(bioItem.boundaryConditions),
        functionalAbstract: bioItem.functionalAbstract,
        citations: verifiedCitations,
      });
    } else {
      const techItem = rawItem as RawProblemInput;
      verifiedItems.push({
        id: itemId,
        sourceDocumentIds,
        title: techItem.title,
        technicalDomain: techItem.technicalDomain,
        problemStatement: techItem.problemStatement,
        coreBottleneck: techItem.coreBottleneck,
        targetMetrics: techItem.targetMetrics ?? '',
        currentApproachesAndLimits: techItem.currentApproachesAndLimits ?? '',
        boundaryConditions: normalizeBoundaryConditions(techItem.boundaryConditions),
        functionalNeedAbstract: techItem.functionalNeedAbstract,
        citations: verifiedCitations,
      });
    }
  });

  const defaultOutFile =
    options.domain === 'biology' ? 'verified_biology.json' : 'verified_technology.json';
  const outPath = path.resolve(options.outPath ?? path.join(runDir, defaultOutFile));
  const reportPath = path.join(runDir, `verification_report_${options.domain}.json`);

  const report: VerificationReport = {
    domain: options.domain,
    attempt,
    totalCitations,
    verifiedCount,
    failedCount,
    retractedCount,
    failedQuotes,
  };

  await writeJsonFile(outPath, verifiedItems);
  await writeJsonFile(reportPath, report);

  return {
    outPath,
    reportPath,
    items: verifiedItems,
    report,
  };
}

function resolveItemCitations(
  citationIds: string[] | undefined,
  fallbackCitations: Citation[] | undefined,
): Citation[] {
  const all = fallbackCitations ?? [];
  if (!citationIds || citationIds.length === 0) {
    return all;
  }
  const byId = new Map(all.map((c) => [c.id, c]));
  const matched = citationIds
    .map((id) => byId.get(id))
    .filter((c): c is Citation => Boolean(c));
  return matched.length > 0 ? matched : all;
}

/**
 * Validates and builds a BioBridge .biobridge.json project bundle from CLI run artifacts,
 * enforcing all deterministic scoring and anti-sycophancy rules.
 */
export async function runCliBuildBundle(
  options: CliBuildBundleOptions,
): Promise<CliBuildBundleResult> {
  const runDir = path.resolve(options.runDir);
  const documents = await readJsonFile<SourceDocument[]>(path.join(runDir, 'documents.json'));
  const parsedPages = await readJsonFile<ParsedPage[]>(path.join(runDir, 'parsedPages.json'));
  const mechanisms = await readJsonFile<ExtractedMechanism[]>(
    path.join(runDir, 'verified_biology.json'),
  );
  const problems = await readJsonFile<ExtractedProblem[]>(
    path.join(runDir, 'verified_technology.json'),
  );

  const rawCandidatesJson = await readJsonFile<unknown>(path.join(runDir, 'candidates.json'));
  const rawReviewsJson = await readJsonFile<unknown>(path.join(runDir, 'raw_reviews.json'));

  const rawCandidates: RawCandidateInput[] = Array.isArray(rawCandidatesJson)
    ? (rawCandidatesJson as RawCandidateInput[])
    : ((rawCandidatesJson as { candidates?: RawCandidateInput[] }).candidates ?? []);

  const rawReviews: RawReviewInput[] = Array.isArray(rawReviewsJson)
    ? (rawReviewsJson as RawReviewInput[])
    : ((rawReviewsJson as { reviews?: RawReviewInput[] }).reviews ?? []);

  const experimentId = createUuid();
  const timestamp = nowIso();
  const strategyUsed: CrossingStrategyType = options.strategy ?? 'cluster-batch';
  const outputLanguage = options.language ?? 'de';
  const criticModel = options.criticModel ?? 'antigravity-subscription-critic';

  const mechanismById = new Map(mechanisms.map((m) => [m.id, m]));
  const problemById = new Map(problems.map((p) => [p.id, p]));

  const candidates: CrossingCandidate[] = rawCandidates.map((raw, idx) => {
    const mechanism = mechanismById.get(raw.mechanismId);
    const problem = problemById.get(raw.problemId);
    const mechCitIds =
      raw.mechanismCitationIds && raw.mechanismCitationIds.length > 0
        ? raw.mechanismCitationIds
        : (mechanism?.citations.map((c) => c.id) ?? []);
    const probCitIds =
      raw.problemCitationIds && raw.problemCitationIds.length > 0
        ? raw.problemCitationIds
        : (problem?.citations.map((c) => c.id) ?? []);

    return {
      id: raw.id?.trim() || `cand_${idx + 1}`,
      experimentId,
      mechanismId: raw.mechanismId,
      problemId: raw.problemId,
      strategyUsed: raw.strategyUsed ?? strategyUsed,
      ...(typeof raw.similarityScore === 'number'
        ? { similarityScore: raw.similarityScore }
        : {}),
      ...(raw.distanceBand ? { distanceBand: raw.distanceBand } : {}),
      bridgeTitle: raw.bridgeTitle,
      abstractTransferLogic: raw.abstractTransferLogic,
      proposedImplementationSketch: raw.proposedImplementationSketch,
      keyAssumptions: raw.keyAssumptions ?? [],
      potentialFailureModes: raw.potentialFailureModes ?? [],
      mechanismCitationIds: mechCitIds,
      problemCitationIds: probCitIds,
      createdAt: raw.createdAt ?? timestamp,
    };
  });

  const candidateById = new Map(candidates.map((c) => [c.id, c]));

  const reviews: CriticReview[] = rawReviews.map((raw) => {
    const candidate = candidateById.get(raw.candidateId);
    const mechanism = candidate ? mechanismById.get(candidate.mechanismId) : undefined;
    const problem = candidate ? problemById.get(candidate.problemId) : undefined;

    const mechanismCitations = resolveItemCitations(
      candidate?.mechanismCitationIds,
      mechanism?.citations,
    );
    const problemCitations = resolveItemCitations(
      candidate?.problemCitationIds,
      problem?.citations,
    );

    return enforceDeterministicReviewRules({
      rawReview: {
        candidateId: raw.candidateId,
        experimentId,
        criticModelUsed: raw.criticModelUsed?.trim() || criticModel,
        scores: raw.scores,
        ...(raw.status ? { status: raw.status } : {}),
        ...(raw.scalingWarning ? { scalingWarning: raw.scalingWarning } : {}),
        ...(raw.knownPriorArt ? { knownPriorArt: raw.knownPriorArt } : {}),
        criticalCounterarguments: raw.criticalCounterarguments ?? [],
        openHurdles: raw.openHurdles ?? [],
        verdictSummary: raw.verdictSummary,
        createdAt: raw.createdAt ?? timestamp,
      },
      mechanismCitations,
      problemCitations,
    });
  });

  const biologyDocIds = documents.filter((d) => d.domain === 'biology').map((d) => d.id);
  const technologyDocIds = documents.filter((d) => d.domain === 'technology').map((d) => d.id);

  const experiment: ExperimentRun = {
    id: experimentId,
    name: options.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'COMPLETED',
    biologyDocIds,
    technologyDocIds,
    config: {
      outputLanguage,
      crossingStrategy: strategyUsed,
      creativityDistance: 0.5,
      distanceBand: 'balanced',
      maxCandidates: Math.max(1, candidates.length),
      includeDiagrams: false,
      pdfMathVisionMode: 'off',
      modelAssignments: {
        extraction: { provider: 'custom', modelId: 'antigravity-subscription' },
        vision: { provider: 'custom', modelId: 'antigravity-subscription' },
        embedding: { provider: 'custom', modelId: 'antigravity-subscription' },
        crossing: { provider: 'custom', modelId: 'antigravity-subscription' },
        critic: { provider: 'custom', modelId: criticModel },
      },
      weights: {
        mechanismDepth: 1,
        scalabilityAndConstraints: 1,
        technicalValue: 1,
        novelty: 1,
      },
      promptProfileSnapshot: createDefaultPromptProfile(),
    },
    checkpoint: {
      currentPhase: 'completed',
      completedVisionPageKeys: [],
      completedChunkKeys: [],
      completedPairKeys: candidates.map((c) => c.id),
      completedReviewKeys: reviews.map((r) => r.candidateId),
    },
    costLedger: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalVisionImages: 0,
      totalCostUsd: 0,
      entries: [],
    },
  };

  const bundle = exportProjectBundle({
    experiment,
    documents,
    parsedPages,
    mechanisms,
    problems,
    candidates,
    reviews,
    exportedAt: timestamp,
  });

  const bundlePath = path.resolve(
    options.outPath ?? path.join(runDir, 'experiment.biobridge.json'),
  );
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await writeFile(bundlePath, serializeProjectBundle(bundle), 'utf-8');

  let markdownPath: string | undefined;
  let csvPath: string | undefined;

  if (options.exportMd ?? true) {
    markdownPath = path.join(runDir, 'report.md');
    await writeFile(markdownPath, exportExperimentToMarkdown(bundle), 'utf-8');
  }

  if (options.exportCsv ?? true) {
    csvPath = path.join(runDir, 'matrix.csv');
    await writeFile(csvPath, exportExperimentToCsv(bundle), 'utf-8');
  }

  return {
    bundlePath,
    markdownPath,
    csvPath,
    experimentId,
    candidateCount: candidates.length,
    reviewCount: reviews.length,
  };
}

function splitCommaPaths(value: string): string[] {
  return value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function printHelp(): void {
  console.log(`BioBridge Local CLI (Antigravity-Abo-Brücke)

Verwendung:
  npm run cli -- <command> [flags]

Kommandos:
  ingest         Dokumente (.pdf, .docx, .md, .txt) einlesen & in Chunks zerlegen
    --bio <pfad>           Biologie-Quelldatei(en), wiederholbar oder kommagetrennt
    --tech <pfad>          Technik-Quelldatei(en), wiederholbar oder kommagetrennt
    --out <runDir>         Ausgabeverzeichnis (z. B. runs/mein-lauf)

  verify         Extrahierte Zitate deterministisch gegen parsedPages.json prüfen
    --run <runDir>         Run-Verzeichnis aus ingest
    --domain <dom>         biology | technology
    --input <pfad>         Pfad zur Roh-JSON-Datei (z. B. raw_biology.json)
    --out <pfad>           Optionaler Ausgabepfad (Standard: verified_<domain>.json)
    --attempt <1|2>        Prüfungsrunde (Standard: 1; bei 2 -> CORRECTED_VERIFIED)

  build-bundle   Deterministische Regeln anwenden & .biobridge.json erzeugen
    --run <runDir>         Run-Verzeichnis
    --name "<Name>"        Name des Experiments
    --out <pfad>           Optionaler Pfad (Standard: <runDir>/experiment.biobridge.json)
    --language <lang>      Ausgabesprache (Standard: de)
    --strategy <strat>     cluster-batch | embedding-hybrid (Standard: cluster-batch)
    --critic-model <id>    Modell-Label des Gutachters (Standard: antigravity-subscription-critic)
    --export-md            Erzeugt report.md (Standard: aktiv)
    --export-csv           Erzeugt matrix.csv (Standard: aktiv)
`);
}

function parseFlags(args: string[]): {
  multi: Record<string, string[]>;
  single: Record<string, string>;
  booleans: Set<string>;
} {
  const multi: Record<string, string[]> = {};
  const single: Record<string, string> = {};
  const booleans = new Set<string>();

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) continue;
    const eqIdx = token.indexOf('=');
    if (eqIdx !== -1) {
      const key = token.slice(2, eqIdx);
      const val = token.slice(eqIdx + 1);
      single[key] = val;
      multi[key] = [...(multi[key] ?? []), val];
      continue;
    }

    const key = token.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      single[key] = next;
      multi[key] = [...(multi[key] ?? []), next];
      i += 1;
    } else {
      booleans.add(key);
    }
  }

  return { multi, single, booleans };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const command = args[0];
  const { multi, single, booleans } = parseFlags(args.slice(1));

  if (command === 'ingest') {
    const bioPaths = (multi.bio ?? []).flatMap(splitCommaPaths);
    const techPaths = (multi.tech ?? []).flatMap(splitCommaPaths);
    const outDir = single.out;
    if (!outDir) {
      throw new Error('Fehlendes Pflicht-Flag: --out <runDir>');
    }

    const res = await runCliIngest({ bioPaths, techPaths, outDir });
    console.log(
      `Ingest abgeschlossen: ${res.documents.length} Dokumente, ${res.parsedPages.length} Seiten, ` +
        `${res.manifest.bioChunks.length} Bio-Chunks, ${res.manifest.techChunks.length} Tech-Chunks -> ${res.runDir}`,
    );
    return;
  }

  if (command === 'verify') {
    const runDir = single.run;
    const domain = single.domain;
    const inputPath = single.input;
    if (!runDir || !inputPath || (domain !== 'biology' && domain !== 'technology')) {
      throw new Error(
        'Pflicht-Flags für verify: --run <runDir> --domain biology|technology --input <raw_json_path>',
      );
    }
    const attempt = single.attempt === '2' ? 2 : 1;
    const res = await runCliVerify({
      runDir,
      domain,
      inputPath,
      outPath: single.out,
      attempt,
    });
    const { totalCitations, verifiedCount, failedCount, retractedCount } = res.report;
    console.log(
      `Verified: ${verifiedCount}/${totalCitations} | Failed: ${failedCount} | Retracted: ${retractedCount}`,
    );
    console.log(`Ausgabe: ${res.outPath} | Bericht: ${res.reportPath}`);
    return;
  }

  if (command === 'build-bundle') {
    const runDir = single.run;
    const name = single.name;
    if (!runDir || !name) {
      throw new Error('Pflicht-Flags für build-bundle: --run <runDir> --name "<Experiment Name>"');
    }
    const strategy =
      single.strategy === 'embedding-hybrid' ? 'embedding-hybrid' : 'cluster-batch';
    const exportMd = booleans.has('no-export-md') ? false : true;
    const exportCsv = booleans.has('no-export-csv') ? false : true;

    const res = await runCliBuildBundle({
      runDir,
      name,
      outPath: single.out,
      language: single.language,
      strategy,
      criticModel: single['critic-model'],
      exportMd,
      exportCsv,
    });

    console.log(
      `Bundle erstellt (${res.candidateCount} Kandidaten, ${res.reviewCount} Reviews): ${res.bundlePath}`,
    );
    console.log(
      `Fertig! Öffne BioBridge (npm run dev) → Tab 1 (Setup) oder Tab 4 (Bewertungsmatrix) → ‚Importieren (.biobridge.json)‘ und wähle ${res.bundlePath}.`,
    );
    return;
  }

  throw new Error(`Unbekanntes Kommando: ${command}. Nutze --help für Hilfe.`);
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Fehler: ${message}`);
    process.exitCode = 1;
  });
}
