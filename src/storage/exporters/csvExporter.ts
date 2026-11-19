import type {
  BioBridgeProjectBundle,
  Citation,
  CriticReview,
  ExtractedMechanism,
  ExtractedProblem,
} from '@/core/schemas';

export interface CsvExportOptions {
  includeBom?: boolean;
}

const CSV_HEADERS = [
  'Rank',
  'Status',
  'TotalScore',
  'BridgeTitle',
  'MechanismDepth',
  'Scalability',
  'TechnicalValue',
  'Novelty',
  'EvidenceQuality',
  'BiologySource',
  'BiologyPage',
  'BiologyQuote',
  'BiologyVerification',
  'TechnologySource',
  'TechnologyPage',
  'TechnologyQuote',
  'TechnologyVerification',
  'ScalingWarning',
  'KnownPriorArt',
  'CriticalCounterarguments',
  'VerdictSummary',
] as const;

export function escapeCsvField(value: string | number | undefined | null): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function resolvePrimaryCitation(
  citationIds: string[],
  fallbackCitations: Citation[] | undefined,
): Citation | undefined {
  if (!fallbackCitations || fallbackCitations.length === 0) {
    return undefined;
  }
  const byId = new Map(fallbackCitations.map((c) => [c.id, c]));
  for (const id of citationIds) {
    const found = byId.get(id);
    if (found) {
      return found;
    }
  }
  return fallbackCitations[0];
}

export function exportExperimentToCsv(
  bundle: BioBridgeProjectBundle,
  options: CsvExportOptions = {},
): string {
  const includeBom = options.includeBom ?? true;
  const reviewByCandidateId = new Map<string, CriticReview>(
    bundle.reviews.map((review) => [review.candidateId, review]),
  );
  const mechanismById = new Map<string, ExtractedMechanism>(
    bundle.mechanisms.map((mechanism) => [mechanism.id, mechanism]),
  );
  const problemById = new Map<string, ExtractedProblem>(
    bundle.problems.map((problem) => [problem.id, problem]),
  );

  const sortedCandidates = [...bundle.candidates].sort((a, b) => {
    const scoreA = reviewByCandidateId.get(a.id)?.weightedTotalScore ?? -1;
    const scoreB = reviewByCandidateId.get(b.id)?.weightedTotalScore ?? -1;
    return scoreB - scoreA;
  });

  const rows: string[] = [CSV_HEADERS.join(',')];

  sortedCandidates.forEach((candidate, index) => {
    const review = reviewByCandidateId.get(candidate.id);
    const mechanism = mechanismById.get(candidate.mechanismId);
    const problem = problemById.get(candidate.problemId);
    const bioCitation = resolvePrimaryCitation(
      candidate.mechanismCitationIds,
      mechanism?.citations,
    );
    const techCitation = resolvePrimaryCitation(
      candidate.problemCitationIds,
      problem?.citations,
    );

    const fields: Array<string | number | undefined> = [
      index + 1,
      review?.status ?? 'UNREVIEWED',
      review ? review.weightedTotalScore.toFixed(2) : '',
      candidate.bridgeTitle,
      review?.scores.mechanismDepth,
      review?.scores.scalabilityAndConstraints,
      review?.scores.technicalValue,
      review?.scores.novelty,
      review?.scores.evidenceQuality,
      bioCitation?.documentTitle,
      bioCitation?.pageNumber,
      bioCitation?.quoteOriginal,
      bioCitation?.verification.status,
      techCitation?.documentTitle,
      techCitation?.pageNumber,
      techCitation?.quoteOriginal,
      techCitation?.verification.status,
      review?.scalingWarning,
      review?.knownPriorArt,
      review ? review.criticalCounterarguments.join(' | ') : '',
      review?.verdictSummary,
    ];

    rows.push(fields.map(escapeCsvField).join(','));
  });

  const csvContent = rows.join('\r\n');
  return includeBom ? `\uFEFF${csvContent}` : csvContent;
}
