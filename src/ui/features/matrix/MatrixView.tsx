import * as Collapsible from '@radix-ui/react-collapsible';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  Filter,
  FlaskConical,
  LayoutGrid,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CriticReview, CrossingCandidate, SourceDocument } from '@/core/schemas';
import { formatEur, formatUsd, useAppStore } from '@/state/appStore';
import {
  getCandidatesForExperiment,
  getReviewsForExperiment,
} from '@/storage';
import { CitationBadge } from '@/ui/components/CitationBadge';
import { InfoPopover } from '@/ui/components/InfoPopover';
import { EvidenceDrawer } from './EvidenceDrawer';
import { ExportMenu } from './ExportMenu';
import {
  DEFAULT_MATRIX_FILTER_STATE,
  VERDICT_META,
  buildMatrixRows,
  computeMatrixSummary,
  filterAndSortMatrixRows,
  partitionMatrixRows,
  resolveMechanismsAndProblems,
  type MatrixFilterState,
  type MatrixRow,
  type MatrixSortBy,
  type MatrixStatusFilter,
  type MatrixVerificationFilter,
} from './matrixHelpers';

export interface MatrixViewProps {
  activeExperimentId: string | null;
  onSelectExperiment: (experimentId: string) => void;
  onNavigateToSetup: () => void;
}

function getPrimaryDocumentTitle(
  row: MatrixRow,
  domain: 'biology' | 'technology',
  docById: Map<string, SourceDocument>,
): string {
  const citations =
    domain === 'biology' ? row.mechanismCitations : row.problemCitations;
  const firstCitation = citations[0];
  if (firstCitation) {
    return firstCitation.documentTitle;
  }

  const docIds =
    domain === 'biology'
      ? row.mechanism?.sourceDocumentIds
      : row.problem?.sourceDocumentIds;
  const firstId = docIds?.[0];
  if (firstId) {
    return docById.get(firstId)?.fileName ?? firstId;
  }

  return domain === 'biology' ? 'Biologie-Quelle' : 'Technik-Quelle';
}

function MatrixCandidateCard({
  row,
  docById,
  onOpenDrawer,
}: {
  row: MatrixRow;
  docById: Map<string, SourceDocument>;
  onOpenDrawer: (row: MatrixRow) => void;
}) {
  const verdict = row.review ? VERDICT_META[row.review.status] : undefined;
  const bioCitation = row.mechanismCitations[0];
  const techCitation = row.problemCitations[0];
  const bioTitle = getPrimaryDocumentTitle(row, 'biology', docById);
  const techTitle = getPrimaryDocumentTitle(row, 'technology', docById);
  const hasScalingWarning =
    Boolean(row.review?.scalingWarning?.trim()) ||
    row.review?.status === 'REJECTED_SCALING';

  return (
    <article
      onClick={() => onOpenDrawer(row)}
      className={`group cursor-pointer rounded-xl border p-4 shadow-2xs transition-all hover:border-indigo-300 hover:shadow-sm dark:hover:border-indigo-500/70 ${
        row.isRejectedOrRetracted
          ? 'border-slate-200 bg-slate-50/75 dark:border-slate-800 dark:bg-slate-900/60'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        {/* Left: Rank, Title, Sources & Dimensions */}
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-slate-900 px-2 py-0.5 text-xs font-bold text-white tabular-nums dark:bg-indigo-600">
              #{row.rank}
            </span>

            {verdict ? (
              <span
                title={verdict.description}
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${verdict.badgeClasses}`}
              >
                {verdict.label}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Unbewertet
              </span>
            )}

            {hasScalingWarning ? (
              <span
                title={
                  row.review?.scalingWarning ??
                  'Skalierungs- oder Randbedingungsproblem erkannt'
                }
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-300"
              >
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>Skalierungs-Warnung</span>
              </span>
            ) : null}

            {row.candidate.strategyUsed === 'embedding-hybrid' &&
            row.candidate.similarityScore !== undefined ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Sim: {Math.round(row.candidate.similarityScore * 100)} %
              </span>
            ) : null}
          </div>

          <h3 className="text-sm font-bold text-slate-900 group-hover:text-indigo-700 dark:text-slate-100 dark:group-hover:text-indigo-400">
            {row.candidate.bridgeTitle}
          </h3>

          {/* Source document tags */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 font-medium text-emerald-900 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300">
              <FlaskConical className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="max-w-56 truncate" title={bioTitle}>
                {bioTitle}
              </span>
              {bioCitation ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  S. {bioCitation.pageNumber}
                </span>
              ) : null}
            </span>

            <span className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50/70 px-2 py-0.5 font-medium text-indigo-900 dark:border-indigo-800/80 dark:bg-indigo-950/60 dark:text-indigo-300">
              <Cpu className="h-3 w-3 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <span className="max-w-56 truncate" title={techTitle}>
                {techTitle}
              </span>
              {techCitation ? (
                <span className="text-indigo-700 dark:text-indigo-400">
                  S. {techCitation.pageNumber}
                </span>
              ) : null}
            </span>
          </div>

          {row.review ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {row.review.verdictSummary}
            </p>
          ) : null}
        </div>

        {/* Right: Score, 5-Dimension Summary, Citation Badges & Action */}
        <div className="flex shrink-0 flex-col items-start gap-2.5 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {row.review ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <span title="Mechanismus-Tiefe (0–3)">
                  M:{row.review.scores.mechanismDepth}
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span title="Randbedingungen & Skalierbarkeit (0–3)">
                  S:{row.review.scores.scalabilityAndConstraints}
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span title="Technischer Mehrwert (0–2)">
                  V:{row.review.scores.technicalValue}
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span title="Neuheitsgrad (0–2)">
                  N:{row.review.scores.novelty}
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span
                  title="Belegqualität"
                  className={
                    row.review.scores.evidenceQuality === 'PASS'
                      ? 'font-bold text-emerald-700 dark:text-emerald-400'
                      : 'font-bold text-rose-700 dark:text-rose-400'
                  }
                >
                  {row.review.scores.evidenceQuality === 'PASS' ? 'PASS' : 'K.O.'}
                </span>
              </div>
            ) : null}

            {row.review ? (
              <div className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-bold text-white tabular-nums dark:bg-slate-800 dark:text-slate-100">
                {row.review.weightedTotalScore.toFixed(1)} / 10
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {bioCitation ? (
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                  Bio:
                </span>
                <CitationBadge verification={bioCitation.verification} />
              </div>
            ) : null}
            {techCitation ? (
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-medium text-indigo-800 dark:text-indigo-300">
                  Tech:
                </span>
                <CitationBadge verification={techCitation.verification} />
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDrawer(row);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-500/70 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-300"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Belege öffnen</span>
          </button>
        </div>
      </div>
    </article>
  );
}

export function MatrixView({
  activeExperimentId,
  onSelectExperiment,
  onNavigateToSetup,
}: MatrixViewProps) {
  const experiments = useAppStore((s) => s.experiments);
  const documents = useAppStore((s) => s.documents);
  const extractionCaches = useAppStore((s) => s.extractionCaches);
  const usdToEurRate = useAppStore((s) => s.settings.usdToEurRate);

  const [candidates, setCandidates] = useState<CrossingCandidate[]>([]);
  const [reviews, setReviews] = useState<CriticReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<MatrixFilterState>(
    DEFAULT_MATRIX_FILTER_STATE,
  );
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null,
  );

  const activeExperiment =
    experiments.find((e) => e.id === activeExperimentId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setSelectedCandidateId(null);

    if (!activeExperimentId) {
      setCandidates([]);
      setReviews([]);
      return;
    }

    setLoading(true);
    void Promise.all([
      getCandidatesForExperiment(activeExperimentId),
      getReviewsForExperiment(activeExperimentId),
    ])
      .then(([loadedCandidates, loadedReviews]) => {
        if (cancelled) return;
        setCandidates(loadedCandidates);
        setReviews(loadedReviews);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeExperimentId]);

  const docById = useMemo(
    () => new Map(documents.map((doc) => [doc.id, doc])),
    [documents],
  );

  const { mechanisms, problems } = useMemo(() => {
    if (!activeExperiment) {
      return { mechanisms: [], problems: [] };
    }
    return resolveMechanismsAndProblems(
      extractionCaches,
      activeExperiment.biologyDocIds,
      activeExperiment.technologyDocIds,
    );
  }, [activeExperiment, extractionCaches]);

  const allRows = useMemo(
    () =>
      buildMatrixRows({
        candidates,
        reviews,
        mechanisms,
        problems,
      }),
    [candidates, reviews, mechanisms, problems],
  );

  const summary = useMemo(() => computeMatrixSummary(allRows), [allRows]);

  const filteredRows = useMemo(
    () => filterAndSortMatrixRows(allRows, filter),
    [allRows, filter],
  );

  const { primaryRows, rejectedRows } = useMemo(
    () => partitionMatrixRows(filteredRows),
    [filteredRows],
  );

  const experimentDocuments = useMemo(() => {
    if (!activeExperiment) {
      return [];
    }
    const ids = new Set<string>([
      ...activeExperiment.biologyDocIds,
      ...activeExperiment.technologyDocIds,
      ...allRows.flatMap((r) => r.sourceDocumentIds),
    ]);
    return Array.from(ids)
      .map((id) => docById.get(id))
      .filter((doc): doc is SourceDocument => doc !== undefined);
  }, [activeExperiment, allRows, docById]);

  const isRejectedSectionOpen =
    rejectedOpen ||
    filter.statusFilter === 'REJECTED' ||
    filter.statusFilter === 'RETRACTED';

  const navigableRows = useMemo(
    () => [...primaryRows, ...rejectedRows],
    [primaryRows, rejectedRows],
  );

  const selectedIndex = useMemo(() => {
    if (!selectedCandidateId) {
      return -1;
    }
    return navigableRows.findIndex(
      (r) => r.candidate.id === selectedCandidateId,
    );
  }, [navigableRows, selectedCandidateId]);

  const selectedRow =
    selectedIndex >= 0 ? navigableRows[selectedIndex] : null;

  const hasActiveFilter =
    filter.searchQuery.trim() !== '' ||
    filter.statusFilter !== 'ALL' ||
    filter.documentIdFilter !== 'ALL' ||
    filter.onlyScalingWarnings ||
    filter.verificationFilter !== 'ALL' ||
    filter.sortBy !== 'score_desc';

  const statusPills: Array<{
    id: MatrixStatusFilter;
    label: string;
    count: number;
  }> = [
    { id: 'ALL', label: 'Alle', count: summary.total },
    { id: 'PROMISING', label: 'Vielversprechend', count: summary.promising },
    { id: 'NEEDS_CHECK', label: 'Prüfenswert', count: summary.needsCheck },
    { id: 'KNOWN_STANDARD', label: 'Bekannt', count: summary.knownStandard },
    { id: 'REJECTED', label: 'Verworfen', count: summary.rejected },
    { id: 'RETRACTED', label: 'Zurückgezogen', count: summary.retracted },
  ];

  const totalCostUsd = activeExperiment?.costLedger.totalCostUsd ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Bewertungsmatrix &amp; Dual-Beleg-Ansicht
              </h1>
              <InfoPopover
                title="Anti-Sycophancy-Bewertungsmatrix"
                side="bottom"
              >
                <p>
                  Jede Bionik-Brücke muss in beiden Domänen durch verifizierte
                  Originalzitate belegt sein und durchläuft ein strenges
                  Advocatus-Diaboli-Gutachten über 5 Dimensionen.
                </p>
                <p className="mt-1.5">
                  Eine hohe Ablehnungsquote (typisch 70–90 %) ist ein
                  Qualitätsmerkmal: Sie filtert oberflächliche Metaphern,
                  Skalierungsbrüche und Halluzinationen konsequent aus.
                </p>
              </InfoPopover>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              {activeExperiment
                ? `Aktives Experiment: ${activeExperiment.name} • ${candidates.length} Kandidaten • ${reviews.length} Gutachten`
                : 'Kein Experiment ausgewählt — wählen Sie ein Experiment oder importieren Sie ein .biobridge.json-Paket.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {experiments.length > 0 ? (
              <select
                aria-label="Experiment für Matrix auswählen"
                value={activeExperimentId ?? ''}
                onChange={(e) => onSelectExperiment(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {experiments.map((exp) => (
                  <option key={exp.id} value={exp.id}>
                    {exp.name}
                  </option>
                ))}
              </select>
            ) : null}

            <button
              type="button"
              onClick={onNavigateToSetup}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Neues Experiment</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Klicken Sie auf eine Hypothese, um Biologie- &amp; Technik-Belege
            nebeneinander im Detail zu prüfen.
          </p>
          <ExportMenu
            experiment={activeExperiment}
            documents={documents}
            mechanisms={mechanisms}
            problems={problems}
            candidates={candidates}
            reviews={reviews}
          />
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-10 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Lade Kandidaten und Gutachten aus IndexedDB…</span>
        </div>
      ) : !activeExperiment ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <Sparkles className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-500" />
          <h2 className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Noch keine Matrix-Ergebnisse vorhanden
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Starten Sie ein Experiment im Setup, laden Sie dort das
            Demo-Experiment oder importieren Sie oben ein{' '}
            <code>.biobridge.json</code>-Paket.
          </p>
          <button
            type="button"
            onClick={onNavigateToSetup}
            className="mt-4 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
          >
            Setup öffnen
          </button>
        </div>
      ) : (
        <>
          {/* KPI Overview Bar */}
          <section
            aria-label="Kennzahlen des Experiments"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
          >
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Gesamt-Kandidaten
              </p>
              <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {summary.total}
              </p>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 shadow-2xs dark:border-emerald-800/80 dark:bg-emerald-950/40">
              <p className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                Vielversprechend
              </p>
              <p className="mt-1 text-xl font-bold text-emerald-900 tabular-nums dark:text-emerald-200">
                {summary.promising}
              </p>
            </div>

            <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-3.5 shadow-2xs dark:border-sky-800/80 dark:bg-sky-950/40">
              <p className="text-[11px] font-medium text-sky-800 dark:text-sky-300">
                Prüfenswert
              </p>
              <p className="mt-1 text-xl font-bold text-sky-900 tabular-nums dark:text-sky-200">
                {summary.needsCheck}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-800/60">
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                Bekannter Standard
              </p>
              <p className="mt-1 text-xl font-bold text-slate-800 tabular-nums dark:text-slate-100">
                {summary.knownStandard}
              </p>
            </div>

            <div
              title="Eine Ablehnungsquote von 70–90 % ist ein Qualitätsmerkmal der strengen Anti-Sycophancy-Prüfung."
              className="rounded-xl border border-rose-200 bg-rose-50/40 p-3.5 shadow-2xs dark:border-rose-800/80 dark:bg-rose-950/40"
            >
              <p className="text-[11px] font-medium text-rose-800 dark:text-rose-300">
                Verworfen / Zurückgez.
              </p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <p className="text-xl font-bold text-rose-900 tabular-nums dark:text-rose-200">
                  {summary.rejected + summary.retracted}
                </p>
                <span className="text-xs font-semibold text-rose-700 tabular-nums dark:text-rose-400">
                  ({summary.rejectionRatePercent} %)
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-rose-700/80 dark:text-rose-300/80">
                70–90 % = strenger Qualitätsfilter
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Gesamtkosten
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums dark:text-slate-100">
                {formatUsd(totalCostUsd)}
              </p>
              <p className="text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                {formatEur(totalCostUsd, usdToEurRate)}
              </p>
            </div>
          </section>

          {/* Filter & Sort Bar */}
          <section
            aria-label="Filter und Sortierung"
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Status Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <Filter className="h-3.5 w-3.5" />
                <span>Status:</span>
              </span>
              {statusPills.map((pill) => {
                const active = filter.statusFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() =>
                      setFilter((prev) => ({ ...prev, statusFilter: pill.id }))
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span>{pill.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums ${
                        active
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200/80 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {pill.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search, Document, Verification, Scaling Warning, Sort */}
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-5">
              <div className="relative xl:col-span-2">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="search"
                  value={filter.searchQuery}
                  onChange={(e) =>
                    setFilter((prev) => ({
                      ...prev,
                      searchQuery: e.target.value,
                    }))
                  }
                  placeholder="Suche in Titeln, Mechanismen, Zitaten, Gutachten…"
                  aria-label="Hypothesen durchsuchen"
                  className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <select
                aria-label="Nach Quelldokument filtern"
                value={filter.documentIdFilter}
                onChange={(e) =>
                  setFilter((prev) => ({
                    ...prev,
                    documentIdFilter: e.target.value,
                  }))
                }
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
              >
                <option value="ALL">Alle Quelldokumente</option>
                {experimentDocuments.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.domain === 'biology' ? 'Bio: ' : 'Tech: '}
                    {doc.fileName}
                  </option>
                ))}
              </select>

              <select
                aria-label="Nach Beleg-Verifikation filtern"
                value={filter.verificationFilter}
                onChange={(e) =>
                  setFilter((prev) => ({
                    ...prev,
                    verificationFilter: e.target
                      .value as MatrixVerificationFilter,
                  }))
                }
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
              >
                <option value="ALL">Alle Belegstatus</option>
                <option value="VERIFIED_ONLY">Nur vollständig belegt</option>
                <option value="CORRECTED_ONLY">Mit korrigierten Zitaten</option>
                <option value="ISSUES_ONLY">Mit Belegproblemen / K.O.</option>
              </select>

              <select
                aria-label="Ergebnisse sortieren"
                value={filter.sortBy}
                onChange={(e) =>
                  setFilter((prev) => ({
                    ...prev,
                    sortBy: e.target.value as MatrixSortBy,
                  }))
                }
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
              >
                <option value="score_desc">Sortierung: Score absteigend</option>
                <option value="score_asc">Sortierung: Score aufsteigend</option>
                <option value="mechanism_desc">
                  Sortierung: Mechanismus-Tiefe
                </option>
                <option value="scalability_desc">
                  Sortierung: Skalierbarkeit
                </option>
                <option value="novelty_desc">Sortierung: Neuheitsgrad</option>
                <option value="title_asc">Sortierung: Titel (A–Z)</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={filter.onlyScalingWarnings}
                  onChange={(e) =>
                    setFilter((prev) => ({
                      ...prev,
                      onlyScalingWarnings: e.target.checked,
                    }))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                />
                <span>Nur mit Skalierungs-Warnung</span>
              </label>

              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {filteredRows.length} von {allRows.length} Hypothesen
                  angezeigt
                </span>
                {hasActiveFilter ? (
                  <button
                    type="button"
                    onClick={() => setFilter(DEFAULT_MATRIX_FILTER_STATE)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Filter zurücksetzen</span>
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {/* Primary Rows */}
          {allRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Für dieses Experiment wurden noch keine Crossing-Kandidaten
              erzeugt.
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Keine Hypothesen entsprechen den aktuellen Filterkriterien.
              </p>
              <button
                type="button"
                onClick={() => setFilter(DEFAULT_MATRIX_FILTER_STATE)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Filter zurücksetzen</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {primaryRows.length > 0 ? (
                <section aria-label="Aktive und geprüfte Hypothesen" className="space-y-3">
                  {primaryRows.map((row) => (
                    <MatrixCandidateCard
                      key={row.candidate.id}
                      row={row}
                      docById={docById}
                      onOpenDrawer={(selected) =>
                        setSelectedCandidateId(selected.candidate.id)
                      }
                    />
                  ))}
                </section>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  Keine aktiven (nicht-verworfenen) Hypothesen im aktuellen
                  Filter.
                </div>
              )}

              {/* Rejected & Retracted Collapsible Section */}
              {rejectedRows.length > 0 ? (
                <Collapsible.Root
                  open={isRejectedSectionOpen}
                  onOpenChange={setRejectedOpen}
                  className="rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <Collapsible.Trigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          Verworfene &amp; zurückgezogene Hypothesen anzeigen (
                          {rejectedRows.length})
                        </span>
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-300">
                          Transparenz-Archiv
                        </span>
                      </div>
                      {isRejectedSectionOpen ? (
                        <ChevronUp className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                      )}
                    </button>
                  </Collapsible.Trigger>

                  <Collapsible.Content className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-800">
                    {rejectedRows.map((row) => (
                      <MatrixCandidateCard
                        key={row.candidate.id}
                        row={row}
                        docById={docById}
                        onOpenDrawer={(selected) =>
                          setSelectedCandidateId(selected.candidate.id)
                        }
                      />
                    ))}
                  </Collapsible.Content>
                </Collapsible.Root>
              ) : null}
            </div>
          )}
        </>
      )}

      {/* Dual-Evidence Slide-Over Drawer */}
      <EvidenceDrawer
        row={selectedRow}
        open={selectedRow !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCandidateId(null);
          }
        }}
        onPrev={() => {
          if (selectedIndex > 0) {
            setSelectedCandidateId(
              navigableRows[selectedIndex - 1].candidate.id,
            );
          }
        }}
        onNext={() => {
          if (selectedIndex >= 0 && selectedIndex < navigableRows.length - 1) {
            setSelectedCandidateId(
              navigableRows[selectedIndex + 1].candidate.id,
            );
          }
        }}
        hasPrev={selectedIndex > 0}
        hasNext={
          selectedIndex >= 0 && selectedIndex < navigableRows.length - 1
        }
        currentIndex={selectedIndex >= 0 ? selectedIndex : undefined}
        totalCount={navigableRows.length}
      />
    </div>
  );
}
