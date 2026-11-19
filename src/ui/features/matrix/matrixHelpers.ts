import type {
  Citation,
  CriticReview,
  CrossingCandidate,
  ExtractedMechanism,
  ExtractedProblem,
  ExtractionCacheRecord,
  VerdictStatus,
} from '@/core/schemas';

export interface MatrixRow {
  rank: number;
  candidate: CrossingCandidate;
  review?: CriticReview;
  mechanism?: ExtractedMechanism;
  problem?: ExtractedProblem;
  mechanismCitations: Citation[];
  problemCitations: Citation[];
  sourceDocumentIds: string[];
  isRejectedOrRetracted: boolean;
}

export type MatrixStatusFilter =
  | 'ALL'
  | 'PROMISING'
  | 'NEEDS_CHECK'
  | 'KNOWN_STANDARD'
  | 'REJECTED'
  | 'RETRACTED';

export type MatrixVerificationFilter =
  | 'ALL'
  | 'VERIFIED_ONLY'
  | 'CORRECTED_ONLY'
  | 'ISSUES_ONLY';

export type MatrixSortBy =
  | 'score_desc'
  | 'score_asc'
  | 'mechanism_desc'
  | 'scalability_desc'
  | 'novelty_desc'
  | 'title_asc';

export interface MatrixFilterState {
  searchQuery: string;
  statusFilter: MatrixStatusFilter;
  documentIdFilter: string;
  onlyScalingWarnings: boolean;
  verificationFilter: MatrixVerificationFilter;
  sortBy: MatrixSortBy;
}

export const DEFAULT_MATRIX_FILTER_STATE: MatrixFilterState = {
  searchQuery: '',
  statusFilter: 'ALL',
  documentIdFilter: 'ALL',
  onlyScalingWarnings: false,
  verificationFilter: 'ALL',
  sortBy: 'score_desc',
};

export interface VerdictMetaEntry {
  label: string;
  shortLabel: string;
  description: string;
  badgeClasses: string;
}

export const VERDICT_META: Record<VerdictStatus, VerdictMetaEntry> = {
  PROMISING: {
    label: 'VIELVERSPRECHEND',
    shortLabel: 'Vielversprechend',
    description:
      'Mechanismus, Randbedingungen, technischer Mehrwert und Zitatbelege sind tragfähig und für vertiefte F&E-Prüfung geeignet.',
    badgeClasses:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80',
  },
  NEEDS_CHECK: {
    label: 'PRÜFENSWERT',
    shortLabel: 'Prüfenswert',
    description:
      'Plausibler Wirkprinzip-Transfer mit belastbaren Belegen, aber offenen technischen oder experimentellen Klärungspunkten.',
    badgeClasses:
      'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/80',
  },
  KNOWN_STANDARD: {
    label: 'BEKANNT',
    shortLabel: 'Bekannt',
    description:
      'Fachlich stimmig, jedoch in der Literatur oder industriellen Praxis bereits als etablierter Stand der Technik bekannt.',
    badgeClasses:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
  REJECTED_METAPHOR: {
    label: 'VERWORFEN (Metapher)',
    shortLabel: 'Metapher',
    description:
      'Oberflächliche Analogie ohne kausal übertragbaren physikalischen, chemischen oder algorithmischen Wirkmechanismus.',
    badgeClasses:
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/80',
  },
  REJECTED_SCALING: {
    label: 'VERWORFEN (Skalierung)',
    shortLabel: 'Skalierung',
    description:
      'Unüberbrückbarer Bruch bei Größenordnung, Zeitskala, Medium, Energieform oder Betriebsbedingungen.',
    badgeClasses:
      'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/80',
  },
  REJECTED_EVIDENCE: {
    label: 'VERWORFEN (Unbelegt)',
    shortLabel: 'Unbelegt',
    description:
      'Zentrale Behauptung konnte nicht durch verifizierte Primärzitate beider Domänen gedeckt werden.',
    badgeClasses:
      'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/80',
  },
  RETRACTED: {
    label: 'ZURÜCKGEZOGEN',
    shortLabel: 'Zurückgezogen',
    description:
      'Automatisch zurückgezogen, da zugrunde liegende Zitate als Halluzination oder nicht belegbar eingestuft wurden.',
    badgeClasses:
      'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/80 dark:text-rose-200 dark:border-rose-800',
  },
};

const REJECTED_STATUSES: ReadonlySet<VerdictStatus> = new Set([
  'REJECTED_METAPHOR',
  'REJECTED_SCALING',
  'REJECTED_EVIDENCE',
]);

const REJECTED_OR_RETRACTED_STATUSES: ReadonlySet<VerdictStatus> = new Set([
  'REJECTED_METAPHOR',
  'REJECTED_SCALING',
  'REJECTED_EVIDENCE',
  'RETRACTED',
]);

export function isRejectedOrRetractedStatus(status?: VerdictStatus): boolean {
  return status !== undefined && REJECTED_OR_RETRACTED_STATUSES.has(status);
}

export function resolveMechanismsAndProblems(
  caches: ExtractionCacheRecord[],
  biologyDocIds: string[],
  technologyDocIds: string[],
): { mechanisms: ExtractedMechanism[]; problems: ExtractedProblem[] } {
  const bioDocSet = new Set(biologyDocIds);
  const techDocSet = new Set(technologyDocIds);

  const sortedCaches = [...caches].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  const mechanismMap = new Map<string, ExtractedMechanism>();
  const problemMap = new Map<string, ExtractedProblem>();

  const ingestCache = (record: ExtractionCacheRecord) => {
    if (record.mechanisms) {
      for (const mechanism of record.mechanisms) {
        if (!mechanismMap.has(mechanism.id)) {
          mechanismMap.set(mechanism.id, mechanism);
        }
      }
    }
    if (record.problems) {
      for (const problem of record.problems) {
        if (!problemMap.has(problem.id)) {
          problemMap.set(problem.id, problem);
        }
      }
    }
  };

  // Pass 1: newest caches belonging directly to the experiment's documents
  for (const record of sortedCaches) {
    const matchesBio =
      record.domain === 'biology' &&
      (bioDocSet.has(record.documentId) ||
        (record.mechanisms?.some((m) =>
          m.sourceDocumentIds.some((docId) => bioDocSet.has(docId)),
        ) ??
          false));
    const matchesTech =
      record.domain === 'technology' &&
      (techDocSet.has(record.documentId) ||
        (record.problems?.some((p) =>
          p.sourceDocumentIds.some((docId) => techDocSet.has(docId)),
        ) ??
          false));

    if (matchesBio || matchesTech) {
      ingestCache(record);
    }
  }

  // Pass 2: collect any missing IDs from remaining caches (e.g. imported bundles)
  for (const record of sortedCaches) {
    ingestCache(record);
  }

  return {
    mechanisms: Array.from(mechanismMap.values()),
    problems: Array.from(problemMap.values()),
  };
}

function resolveCandidateCitations(
  citationIds: string[],
  fallbackCitations: Citation[] | undefined,
): Citation[] {
  if (!fallbackCitations || fallbackCitations.length === 0) {
    return [];
  }
  if (citationIds.length === 0) {
    return fallbackCitations;
  }

  const byId = new Map(fallbackCitations.map((citation) => [citation.id, citation]));
  const matched = citationIds
    .map((id) => byId.get(id))
    .filter((citation): citation is Citation => citation !== undefined);

  return matched.length > 0 ? matched : fallbackCitations;
}

function collectSourceDocumentIds(
  mechanism: ExtractedMechanism | undefined,
  problem: ExtractedProblem | undefined,
  mechanismCitations: Citation[],
  problemCitations: Citation[],
): string[] {
  const docIds = new Set<string>();

  for (const id of mechanism?.sourceDocumentIds ?? []) {
    docIds.add(id);
  }
  for (const id of problem?.sourceDocumentIds ?? []) {
    docIds.add(id);
  }
  for (const citation of mechanismCitations) {
    docIds.add(citation.documentId);
  }
  for (const citation of problemCitations) {
    docIds.add(citation.documentId);
  }

  return Array.from(docIds);
}

export function buildMatrixRows(input: {
  candidates: CrossingCandidate[];
  reviews: CriticReview[];
  mechanisms: ExtractedMechanism[];
  problems: ExtractedProblem[];
}): MatrixRow[] {
  const reviewByCandidateId = new Map<string, CriticReview>(
    input.reviews.map((review) => [review.candidateId, review]),
  );
  const mechanismById = new Map<string, ExtractedMechanism>(
    input.mechanisms.map((mechanism) => [mechanism.id, mechanism]),
  );
  const problemById = new Map<string, ExtractedProblem>(
    input.problems.map((problem) => [problem.id, problem]),
  );

  const sortedCandidates = [...input.candidates].sort((a, b) => {
    const scoreA = reviewByCandidateId.get(a.id)?.weightedTotalScore ?? -1;
    const scoreB = reviewByCandidateId.get(b.id)?.weightedTotalScore ?? -1;
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return a.bridgeTitle.localeCompare(b.bridgeTitle, 'de');
  });

  return sortedCandidates.map((candidate, index) => {
    const review = reviewByCandidateId.get(candidate.id);
    const mechanism = mechanismById.get(candidate.mechanismId);
    const problem = problemById.get(candidate.problemId);
    const mechanismCitations = resolveCandidateCitations(
      candidate.mechanismCitationIds,
      mechanism?.citations,
    );
    const problemCitations = resolveCandidateCitations(
      candidate.problemCitationIds,
      problem?.citations,
    );

    return {
      rank: index + 1,
      candidate,
      review,
      mechanism,
      problem,
      mechanismCitations,
      problemCitations,
      sourceDocumentIds: collectSourceDocumentIds(
        mechanism,
        problem,
        mechanismCitations,
        problemCitations,
      ),
      isRejectedOrRetracted: isRejectedOrRetractedStatus(review?.status),
    };
  });
}

function matchesSearchQuery(row: MatrixRow, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  const haystacks: Array<string | undefined> = [
    row.candidate.bridgeTitle,
    row.candidate.abstractTransferLogic,
    row.candidate.proposedImplementationSketch,
    row.mechanism?.title,
    row.mechanism?.biologicalSystem,
    row.mechanism?.workingPrinciple,
    row.problem?.title,
    row.problem?.technicalDomain,
    row.problem?.coreBottleneck,
    row.review?.verdictSummary,
    row.review?.scalingWarning,
    row.review?.knownPriorArt,
    ...row.candidate.keyAssumptions,
    ...row.candidate.potentialFailureModes,
    ...(row.review?.criticalCounterarguments ?? []),
    ...(row.review?.openHurdles ?? []),
    ...row.mechanismCitations.flatMap((c) => [
      c.documentTitle,
      c.quoteOriginal,
      c.quoteTranslation,
      c.sectionPath,
    ]),
    ...row.problemCitations.flatMap((c) => [
      c.documentTitle,
      c.quoteOriginal,
      c.quoteTranslation,
      c.sectionPath,
    ]),
  ];

  return haystacks.some(
    (entry) => entry !== undefined && entry.toLowerCase().includes(normalizedQuery),
  );
}

function matchesStatusFilter(
  row: MatrixRow,
  statusFilter: MatrixStatusFilter,
): boolean {
  if (statusFilter === 'ALL') {
    return true;
  }
  const status = row.review?.status;
  if (!status) {
    return false;
  }
  if (statusFilter === 'REJECTED') {
    return REJECTED_STATUSES.has(status);
  }
  return status === statusFilter;
}

function matchesVerificationFilter(
  row: MatrixRow,
  verificationFilter: MatrixVerificationFilter,
): boolean {
  if (verificationFilter === 'ALL') {
    return true;
  }

  const allCitations = [...row.mechanismCitations, ...row.problemCitations];

  if (verificationFilter === 'VERIFIED_ONLY') {
    if (allCitations.length === 0) {
      return false;
    }
    return allCitations.every(
      (c) =>
        c.verification.status === 'VERIFIED_EXACT' ||
        c.verification.status === 'VERIFIED_NORMALIZED' ||
        c.verification.status === 'VERIFIED_FUZZY' ||
        c.verification.status === 'CORRECTED_VERIFIED',
    );
  }

  if (verificationFilter === 'CORRECTED_ONLY') {
    return allCitations.some(
      (c) => c.verification.status === 'CORRECTED_VERIFIED',
    );
  }

  // ISSUES_ONLY
  const hasCitationIssue =
    allCitations.length === 0 ||
    allCitations.some(
      (c) =>
        c.verification.status === 'RETRACTED_HALLUCINATION' ||
        c.verification.status === 'FAILED_UNVERIFIED',
    );
  const hasReviewEvidenceIssue =
    row.review?.scores.evidenceQuality === 'KO' ||
    row.review?.status === 'REJECTED_EVIDENCE' ||
    row.review?.status === 'RETRACTED';

  return hasCitationIssue || hasReviewEvidenceIssue;
}

function compareMatrixRows(
  a: MatrixRow,
  b: MatrixRow,
  sortBy: MatrixSortBy,
): number {
  switch (sortBy) {
    case 'score_desc': {
      const scoreA = a.review?.weightedTotalScore ?? -1;
      const scoreB = b.review?.weightedTotalScore ?? -1;
      return scoreB !== scoreA ? scoreB - scoreA : a.rank - b.rank;
    }
    case 'score_asc': {
      const scoreA = a.review?.weightedTotalScore ?? Number.POSITIVE_INFINITY;
      const scoreB = b.review?.weightedTotalScore ?? Number.POSITIVE_INFINITY;
      return scoreA !== scoreB ? scoreA - scoreB : a.rank - b.rank;
    }
    case 'mechanism_desc': {
      const valA = a.review?.scores.mechanismDepth ?? -1;
      const valB = b.review?.scores.mechanismDepth ?? -1;
      if (valB !== valA) {
        return valB - valA;
      }
      return (
        (b.review?.weightedTotalScore ?? -1) -
          (a.review?.weightedTotalScore ?? -1) || a.rank - b.rank
      );
    }
    case 'scalability_desc': {
      const valA = a.review?.scores.scalabilityAndConstraints ?? -1;
      const valB = b.review?.scores.scalabilityAndConstraints ?? -1;
      if (valB !== valA) {
        return valB - valA;
      }
      return (
        (b.review?.weightedTotalScore ?? -1) -
          (a.review?.weightedTotalScore ?? -1) || a.rank - b.rank
      );
    }
    case 'novelty_desc': {
      const valA = a.review?.scores.novelty ?? -1;
      const valB = b.review?.scores.novelty ?? -1;
      if (valB !== valA) {
        return valB - valA;
      }
      return (
        (b.review?.weightedTotalScore ?? -1) -
          (a.review?.weightedTotalScore ?? -1) || a.rank - b.rank
      );
    }
    case 'title_asc': {
      const titleCmp = a.candidate.bridgeTitle.localeCompare(
        b.candidate.bridgeTitle,
        'de',
      );
      return titleCmp !== 0 ? titleCmp : a.rank - b.rank;
    }
  }
}

export function filterAndSortMatrixRows(
  rows: MatrixRow[],
  filter: MatrixFilterState,
): MatrixRow[] {
  const normalizedQuery = filter.searchQuery.trim().toLowerCase();

  const filtered = rows.filter((row) => {
    if (!matchesSearchQuery(row, normalizedQuery)) {
      return false;
    }
    if (!matchesStatusFilter(row, filter.statusFilter)) {
      return false;
    }
    if (
      filter.documentIdFilter &&
      filter.documentIdFilter !== 'ALL' &&
      !row.sourceDocumentIds.includes(filter.documentIdFilter)
    ) {
      return false;
    }
    if (
      filter.onlyScalingWarnings &&
      !row.review?.scalingWarning?.trim() &&
      row.review?.status !== 'REJECTED_SCALING'
    ) {
      return false;
    }
    if (!matchesVerificationFilter(row, filter.verificationFilter)) {
      return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => compareMatrixRows(a, b, filter.sortBy));
}

export function partitionMatrixRows(rows: MatrixRow[]): {
  primaryRows: MatrixRow[];
  rejectedRows: MatrixRow[];
} {
  const primaryRows: MatrixRow[] = [];
  const rejectedRows: MatrixRow[] = [];

  for (const row of rows) {
    if (row.isRejectedOrRetracted) {
      rejectedRows.push(row);
    } else {
      primaryRows.push(row);
    }
  }

  return { primaryRows, rejectedRows };
}

export interface MatrixSummary {
  total: number;
  promising: number;
  needsCheck: number;
  knownStandard: number;
  rejected: number;
  retracted: number;
  rejectionRatePercent: number;
}

export function computeMatrixSummary(rows: MatrixRow[]): MatrixSummary {
  let promising = 0;
  let needsCheck = 0;
  let knownStandard = 0;
  let rejected = 0;
  let retracted = 0;

  for (const row of rows) {
    const status = row.review?.status;
    switch (status) {
      case 'PROMISING':
        promising += 1;
        break;
      case 'NEEDS_CHECK':
        needsCheck += 1;
        break;
      case 'KNOWN_STANDARD':
        knownStandard += 1;
        break;
      case 'REJECTED_METAPHOR':
      case 'REJECTED_SCALING':
      case 'REJECTED_EVIDENCE':
        rejected += 1;
        break;
      case 'RETRACTED':
        retracted += 1;
        break;
      default:
        break;
    }
  }

  const total = rows.length;
  const rejectionRatePercent =
    total === 0 ? 0 : Math.round(((rejected + retracted) / total) * 100);

  return {
    total,
    promising,
    needsCheck,
    knownStandard,
    rejected,
    retracted,
    rejectionRatePercent,
  };
}
