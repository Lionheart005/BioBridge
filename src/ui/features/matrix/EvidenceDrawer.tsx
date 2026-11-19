import * as Collapsible from '@radix-ui/react-collapsible';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertOctagon,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cpu,
  FileText,
  FlaskConical,
  Info,
  Scale,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type {
  BoundaryConditions,
  Citation,
  DistanceBand,
  ScoreBreakdown,
} from '@/core/schemas';
import { CitationBadge } from '@/ui/components/CitationBadge';
import { MathText } from '@/ui/components/MathText';
import { VERDICT_META, type MatrixRow } from './matrixHelpers';

export interface EvidenceDrawerProps {
  row: MatrixRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  currentIndex?: number;
  totalCount?: number;
}

const DISTANCE_BAND_LABELS: Record<DistanceBand, string> = {
  strict: 'Streng (nahe)',
  balanced: 'Ausgewogen',
  exploratory: 'Explorativ (weit)',
};

function BoundaryConditionsGrid({
  conditions,
  accent,
}: {
  conditions: BoundaryConditions;
  accent: 'emerald' | 'indigo';
}) {
  const borderClass =
    accent === 'emerald'
      ? 'border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-800/80 dark:bg-emerald-950/40'
      : 'border-indigo-200/80 bg-indigo-50/40 dark:border-indigo-800/80 dark:bg-indigo-950/40';

  const entries: Array<{ label: string; value?: string }> = [
    { label: 'Raumskala', value: conditions.spatialScale },
    { label: 'Zeitskala', value: conditions.timeScale },
    { label: 'Medium', value: conditions.medium },
    { label: 'Energieform', value: conditions.energyForm },
    { label: 'Betriebsgrenzen', value: conditions.operatingConstraints },
    { label: 'Fehlertoleranz', value: conditions.faultTolerance },
    { label: 'Zuverlässigkeit', value: conditions.reliabilityRequirements },
  ].filter((entry) => Boolean(entry.value && entry.value.trim()));

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-lg border p-3 ${borderClass}`}>
      <h4 className="text-[11px] font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-300">
        Randbedingungen
      </h4>
      <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map((entry) => (
          <div key={entry.label} className="text-xs">
            <dt className="font-medium text-slate-500 dark:text-slate-400">
              {entry.label}
            </dt>
            <dd className="mt-0.5 text-slate-800 dark:text-slate-200">
              {entry.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CitationEvidenceCard({
  citation,
  accent,
}: {
  citation: Citation;
  accent: 'emerald' | 'indigo';
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const borderAccent =
    accent === 'emerald'
      ? 'border-emerald-200 dark:border-emerald-800/80'
      : 'border-indigo-200 dark:border-indigo-800/80';
  const quoteBorder =
    accent === 'emerald'
      ? 'border-emerald-400 dark:border-emerald-500'
      : 'border-indigo-400 dark:border-indigo-500';
  const highlightBg =
    accent === 'emerald'
      ? 'bg-emerald-100/80 text-emerald-950 dark:bg-emerald-900/70 dark:text-emerald-100'
      : 'bg-indigo-100/80 text-indigo-950 dark:bg-indigo-900/70 dark:text-indigo-100';

  const isRetracted =
    citation.verification.status === 'RETRACTED_HALLUCINATION' ||
    citation.verification.status === 'FAILED_UNVERIFIED';

  const attemptsLabel =
    citation.verification.attempts === 1
      ? '1 Prüfversuch'
      : `${citation.verification.attempts} Prüfversuche`;

  const hasContext =
    Boolean(citation.contextBefore.trim()) || Boolean(citation.contextAfter.trim());

  return (
    <div
      className={`space-y-2.5 rounded-lg border bg-white p-3.5 shadow-2xs dark:bg-slate-900 ${
        isRetracted
          ? 'border-rose-300 bg-rose-50/30 dark:border-rose-800/80 dark:bg-rose-950/30'
          : borderAccent
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
            <span className="truncate">{citation.documentTitle}</span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              S. {citation.pageNumber}
            </span>
          </div>
          {citation.sectionPath ? (
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Abschnitt: {citation.sectionPath}
            </p>
          ) : null}
        </div>
        <CitationBadge verification={citation.verification} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          Match-Score:{' '}
          <strong className="text-slate-700 dark:text-slate-200">
            {Math.round(citation.verification.matchScore * 100)} %
          </strong>
        </span>
        <span>•</span>
        <span>
          Geprüfte Seite:{' '}
          <strong className="text-slate-700 dark:text-slate-200">
            S. {citation.verification.matchedPageNumber}
          </strong>
        </span>
        <span>•</span>
        <span>{attemptsLabel}</span>
      </div>

      {citation.verification.retractionReason ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-900 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-200">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
          <div>
            <span className="font-semibold">Hinweis zur Zitatprüfung: </span>
            {citation.verification.retractionReason}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          Originalzitat (Originalsprache)
        </p>
        <blockquote
          className={`rounded-r-md border-l-3 bg-slate-50 px-3 py-2 text-xs text-slate-800 dark:bg-slate-800/70 dark:text-slate-200 ${quoteBorder}`}
        >
          <MathText
            content={citation.quoteOriginal}
            className="text-xs text-slate-800 dark:text-slate-200"
          />
        </blockquote>
      </div>

      {citation.quoteTranslation ? (
        <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
          <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Übersetzung
          </p>
          <MathText
            content={citation.quoteTranslation}
            className="mt-0.5 text-xs text-slate-700 dark:text-slate-300"
          />
        </div>
      ) : null}

      {hasContext ? (
        <Collapsible.Root open={contextOpen} onOpenChange={setContextOpen}>
          <Collapsible.Trigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {contextOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              )}
              <span>
                {contextOpen
                  ? 'Quellkontext ausblenden'
                  : 'Quellkontext vor/nach Zitat anzeigen'}
              </span>
            </button>
          </Collapsible.Trigger>
          <Collapsible.Content className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
            {citation.contextBefore ? (
              <span className="text-slate-500 dark:text-slate-400">
                {citation.contextBefore}{' '}
              </span>
            ) : null}
            <mark className={`rounded px-1 py-0.5 font-medium ${highlightBg}`}>
              {citation.quoteOriginal}
            </mark>
            {citation.contextAfter ? (
              <span className="text-slate-500 dark:text-slate-400">
                {' '}
                {citation.contextAfter}
              </span>
            ) : null}
          </Collapsible.Content>
        </Collapsible.Root>
      ) : null}
    </div>
  );
}

function ScoreDimensionCard({
  label,
  value,
  max,
  hint,
}: {
  label: string;
  value: number;
  max: number;
  hint: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const barColor =
    pct >= 67 ? 'bg-emerald-500' : pct >= 34 ? 'bg-sky-500' : 'bg-amber-500';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
          {label}
        </span>
        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
          {value} / {max}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        {hint}
      </p>
    </div>
  );
}

function ScoreBreakdownGrid({ scores }: { scores: ScoreBreakdown }) {
  const isPass = scores.evidenceQuality === 'PASS';

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
      <ScoreDimensionCard
        label="Mechanismus-Tiefe"
        value={scores.mechanismDepth}
        max={3}
        hint="Kausaler Wirkmechanismus vs. bloße Metapher"
      />
      <ScoreDimensionCard
        label="Randbedingungen & Skalierung"
        value={scores.scalabilityAndConstraints}
        max={3}
        hint="Übertragbarkeit von Skala, Medium & Energie"
      />
      <ScoreDimensionCard
        label="Technischer Mehrwert"
        value={scores.technicalValue}
        max={2}
        hint="Lösungskraft für den Kernengpass"
      />
      <ScoreDimensionCard
        label="Neuheitsgrad"
        value={scores.novelty}
        max={2}
        hint="Abgrenzung zum bekannten Stand der Technik"
      />
      <div
        className={`rounded-lg border p-3 ${
          isPass
            ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/80 dark:bg-emerald-950/40'
            : 'border-rose-300 bg-rose-50/70 dark:border-rose-800/80 dark:bg-rose-950/40'
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Belegqualität
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              isPass
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                : 'bg-rose-200 text-rose-900 dark:bg-rose-950/80 dark:text-rose-300'
            }`}
          >
            {scores.evidenceQuality === 'PASS' ? 'PASS' : 'K.O.'}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
          {isPass
            ? 'Beide Domänen durch verifizierte Originalzitate gedeckt.'
            : 'K.O.-Kriterium: Zitatbeleg unzureichend oder zurückgezogen.'}
        </p>
      </div>
    </div>
  );
}

export function EvidenceDrawer({
  row,
  open,
  onOpenChange,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  currentIndex,
  totalCount,
}: EvidenceDrawerProps) {
  const verdict = row?.review ? VERDICT_META[row.review.status] : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/45 backdrop-blur-[1px] dark:bg-slate-950/75" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-5xl flex-col border-l border-slate-200 bg-slate-50 shadow-2xl focus:outline-none dark:border-slate-800 dark:bg-slate-950">
          {row ? (
            <>
              {/* Sticky Header */}
              <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-md bg-slate-900 px-2 py-0.5 text-xs font-bold text-white dark:bg-indigo-600">
                        Rang #{row.rank}
                      </span>
                      {row.review ? (
                        <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-900 dark:border-indigo-800/80 dark:bg-indigo-950/60 dark:text-indigo-300">
                          {row.review.weightedTotalScore.toFixed(1)} / 10
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          Noch kein Gutachten
                        </span>
                      )}
                      {verdict ? (
                        <span
                          title={verdict.description}
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${verdict.badgeClasses}`}
                        >
                          {verdict.label}
                        </span>
                      ) : null}
                    </div>

                    <Dialog.Title className="text-base font-bold leading-snug text-slate-900 sm:text-lg dark:text-slate-100">
                      {row.candidate.bridgeTitle}
                    </Dialog.Title>

                    <Dialog.Description className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <span>
                        Strategie:{' '}
                        <strong className="text-slate-800 dark:text-slate-100">
                          {row.candidate.strategyUsed === 'embedding-hybrid'
                            ? 'Embedding-Hybrid'
                            : 'Cluster-Batch'}
                        </strong>
                        {row.candidate.strategyUsed === 'embedding-hybrid' &&
                        row.candidate.similarityScore !== undefined ? (
                          <>
                            {' '}
                            (Cosine-Similarity:{' '}
                            <strong className="text-slate-800 dark:text-slate-100">
                              {Math.round(row.candidate.similarityScore * 100)} %
                            </strong>
                            {row.candidate.distanceBand
                              ? ` • Band: ${DISTANCE_BAND_LABELS[row.candidate.distanceBand]}`
                              : ''}
                            )
                          </>
                        ) : null}
                      </span>
                      {row.review ? (
                        <span>
                          Gutachter-Modell:{' '}
                          <strong className="font-mono text-[11px] text-slate-800 dark:text-slate-200">
                            {row.review.criticModelUsed}
                          </strong>
                        </span>
                      ) : null}
                    </Dialog.Description>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {onPrev || onNext ? (
                      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
                        <button
                          type="button"
                          onClick={onPrev}
                          disabled={!hasPrev}
                          aria-label="Vorherige Hypothese"
                          title="Vorherige Hypothese"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        {currentIndex !== undefined && totalCount !== undefined ? (
                          <span className="px-1.5 text-[11px] font-medium text-slate-600 tabular-nums dark:text-slate-300">
                            {currentIndex + 1} / {totalCount}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={onNext}
                          disabled={!hasNext}
                          aria-label="Nächste Hypothese"
                          title="Nächste Hypothese"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}

                    <Dialog.Close asChild>
                      <button
                        type="button"
                        aria-label="Dual-Beleg-Ansicht schließen"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </Dialog.Close>
                  </div>
                </div>
              </header>

              {/* Scrollable Body */}
              <div className="flex-1 space-y-6 overflow-y-auto p-5">
                {/* Dual-Beleg-Ansicht */}
                <section aria-label="Dual-Beleg-Ansicht">
                  <div className="mb-3 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-slate-700 dark:text-slate-300" />
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Dual-Beleg-Ansicht (Domäne A × Domäne B)
                    </h2>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {/* Left: Biology (Domain A) */}
                    <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/35 p-4 dark:border-emerald-800/80 dark:bg-emerald-950/25">
                      <div className="flex items-center gap-2 border-b border-emerald-200/80 pb-2.5 dark:border-emerald-800/60">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white">
                          <FlaskConical className="h-4 w-4" />
                        </span>
                        <div>
                          <span className="text-[11px] font-bold tracking-wider text-emerald-800 uppercase dark:text-emerald-400">
                            Biologie (Domäne A)
                          </span>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {row.mechanism?.title ??
                              `Mechanismus-ID: ${row.candidate.mechanismId}`}
                          </h3>
                        </div>
                      </div>

                      {row.mechanism ? (
                        <div className="space-y-3 text-xs">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="rounded-lg border border-emerald-100 bg-white/80 p-2.5 dark:border-emerald-900/60 dark:bg-slate-900/80">
                              <span className="font-semibold text-emerald-900 dark:text-emerald-300">
                                Biologisches System
                              </span>
                              <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                                {row.mechanism.biologicalSystem}
                              </p>
                            </div>
                            <div className="rounded-lg border border-emerald-100 bg-white/80 p-2.5 dark:border-emerald-900/60 dark:bg-slate-900/80">
                              <span className="font-semibold text-emerald-900 dark:text-emerald-300">
                                Struktur
                              </span>
                              <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                                {row.mechanism.structure}
                              </p>
                            </div>
                          </div>

                          <div className="rounded-lg border border-emerald-100 bg-white p-3 dark:border-emerald-900/60 dark:bg-slate-900">
                            <span className="font-semibold text-emerald-900 dark:text-emerald-300">
                              Wirkprinzip
                            </span>
                            <MathText
                              content={row.mechanism.workingPrinciple}
                              className="mt-1 text-xs"
                            />
                          </div>

                          <div className="rounded-lg border border-emerald-100 bg-white p-3 dark:border-emerald-900/60 dark:bg-slate-900">
                            <span className="font-semibold text-emerald-900 dark:text-emerald-300">
                              Erzielter Effekt
                            </span>
                            <p className="mt-1 text-slate-700 dark:text-slate-300">
                              {row.mechanism.achievedEffect}
                            </p>
                          </div>

                          <BoundaryConditionsGrid
                            conditions={row.mechanism.boundaryConditions}
                            accent="emerald"
                          />
                        </div>
                      ) : (
                        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200">
                          Details zum biologischen Mechanismus konnten im lokalen
                          Extraktions-Cache nicht gefunden werden.
                        </p>
                      )}

                      <div className="space-y-2.5">
                        <h4 className="text-xs font-bold text-emerald-950 dark:text-emerald-300">
                          Verknüpfte Primärzitate Biologie ({row.mechanismCitations.length})
                        </h4>
                        {row.mechanismCitations.length > 0 ? (
                          row.mechanismCitations.map((citation) => (
                            <CitationEvidenceCard
                              key={citation.id}
                              citation={citation}
                              accent="emerald"
                            />
                          ))
                        ) : (
                          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-200">
                            Keine verknüpften Biologie-Zitate vorhanden.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Technology (Domain B) */}
                    <div className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/35 p-4 dark:border-indigo-800/80 dark:bg-indigo-950/25">
                      <div className="flex items-center gap-2 border-b border-indigo-200/80 pb-2.5 dark:border-indigo-800/60">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
                          <Cpu className="h-4 w-4" />
                        </span>
                        <div>
                          <span className="text-[11px] font-bold tracking-wider text-indigo-800 uppercase dark:text-indigo-400">
                            Technik (Domäne B)
                          </span>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {row.problem?.title ??
                              `Problem-ID: ${row.candidate.problemId}`}
                          </h3>
                        </div>
                      </div>

                      {row.problem ? (
                        <div className="space-y-3 text-xs">
                          <div className="rounded-lg border border-indigo-100 bg-white/80 p-2.5 dark:border-indigo-900/60 dark:bg-slate-900/80">
                            <span className="font-semibold text-indigo-900 dark:text-indigo-300">
                              Technische Domäne
                            </span>
                            <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                              {row.problem.technicalDomain}
                            </p>
                          </div>

                          <div className="rounded-lg border border-indigo-100 bg-white p-3 dark:border-indigo-900/60 dark:bg-slate-900">
                            <span className="font-semibold text-indigo-900 dark:text-indigo-300">
                              Problemstellung
                            </span>
                            <MathText
                              content={row.problem.problemStatement}
                              className="mt-1 text-xs"
                            />
                          </div>

                          <div className="rounded-lg border border-indigo-100 bg-white p-3 dark:border-indigo-900/60 dark:bg-slate-900">
                            <span className="font-semibold text-indigo-900 dark:text-indigo-300">
                              Kernengpass
                            </span>
                            <MathText
                              content={row.problem.coreBottleneck}
                              className="mt-1 text-xs"
                            />
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="rounded-lg border border-indigo-100 bg-white p-2.5 dark:border-indigo-900/60 dark:bg-slate-900">
                              <span className="font-semibold text-indigo-900 dark:text-indigo-300">
                                Zielmetriken
                              </span>
                              <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                                {row.problem.targetMetrics || '—'}
                              </p>
                            </div>
                            <div className="rounded-lg border border-indigo-100 bg-white p-2.5 dark:border-indigo-900/60 dark:bg-slate-900">
                              <span className="font-semibold text-indigo-900 dark:text-indigo-300">
                                Bisherige Ansätze &amp; Grenzen
                              </span>
                              <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                                {row.problem.currentApproachesAndLimits || '—'}
                              </p>
                            </div>
                          </div>

                          <BoundaryConditionsGrid
                            conditions={row.problem.boundaryConditions}
                            accent="indigo"
                          />
                        </div>
                      ) : (
                        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200">
                          Details zum technischen Problem konnten im lokalen
                          Extraktions-Cache nicht gefunden werden.
                        </p>
                      )}

                      <div className="space-y-2.5">
                        <h4 className="text-xs font-bold text-indigo-950 dark:text-indigo-300">
                          Verknüpfte Primärzitate Technik ({row.problemCitations.length})
                        </h4>
                        {row.problemCitations.length > 0 ? (
                          row.problemCitations.map((citation) => (
                            <CitationEvidenceCard
                              key={citation.id}
                              citation={citation}
                              accent="indigo"
                            />
                          ))
                        ) : (
                          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-200">
                            Keine verknüpften Technik-Zitate vorhanden.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Phase 3: Abstraction & Transfer */}
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                    <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Abstraktions-Übertragung (Phase 3)
                    </h2>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-700 dark:bg-slate-800/60">
                      <h3 className="text-xs font-bold tracking-wide text-slate-600 uppercase dark:text-slate-300">
                        Abstrakte Übertragungslogik
                      </h3>
                      <MathText
                        content={row.candidate.abstractTransferLogic}
                        className="mt-2 text-xs"
                      />
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-700 dark:bg-slate-800/60">
                      <h3 className="text-xs font-bold tracking-wide text-slate-600 uppercase dark:text-slate-300">
                        Vorgeschlagene Umsetzungsskizze
                      </h3>
                      <MathText
                        content={row.candidate.proposedImplementationSketch}
                        className="mt-2 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
                      <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Zentrale Annahmen ({row.candidate.keyAssumptions.length})
                      </h3>
                      {row.candidate.keyAssumptions.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700 dark:text-slate-300">
                          {row.candidate.keyAssumptions.map((assumption, idx) => (
                            <li key={idx}>{assumption}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                          Keine expliziten Annahmen aufgeführt.
                        </p>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
                      <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Potenzielle Fehlermodi (
                        {row.candidate.potentialFailureModes.length})
                      </h3>
                      {row.candidate.potentialFailureModes.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700 dark:text-slate-300">
                          {row.candidate.potentialFailureModes.map((mode, idx) => (
                            <li key={idx}>{mode}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                          Keine Fehlermodi aufgeführt.
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                {/* Phase 4: Adversarial Critic Review */}
                <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <Scale className="h-4 w-4 text-slate-800 dark:text-slate-200" />
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        Advocatus-Diaboli-Gutachten (Phase 4)
                      </h2>
                    </div>
                    {row.review ? (
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Gesamtscore:{' '}
                        <strong className="text-slate-900 dark:text-slate-100">
                          {row.review.weightedTotalScore.toFixed(1)} / 10
                        </strong>
                      </span>
                    ) : null}
                  </div>

                  {row.review ? (
                    <div className="space-y-4">
                      <ScoreBreakdownGrid scores={row.review.scores} />

                      {row.review.scalingWarning ? (
                        <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          <div>
                            <h3 className="font-bold text-amber-900 dark:text-amber-300">
                              Skalierungs- &amp; Randbedingungswarnung
                            </h3>
                            <p className="mt-1 leading-relaxed">
                              {row.review.scalingWarning}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      {row.review.knownPriorArt ? (
                        <div className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50/70 p-3.5 text-xs text-sky-950 dark:border-sky-800/80 dark:bg-sky-950/60 dark:text-sky-200">
                          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                          <div>
                            <h3 className="font-bold text-sky-900 dark:text-sky-300">
                              Bekannter Stand der Technik (Prior Art)
                            </h3>
                            <p className="mt-1 leading-relaxed">
                              {row.review.knownPriorArt}
                            </p>
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3.5 dark:border-rose-800/80 dark:bg-rose-950/40">
                        <div className="flex items-center gap-1.5">
                          <AlertOctagon className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                          <h3 className="text-xs font-bold text-rose-950 dark:text-rose-300">
                            Pflicht-Gegenargumente (
                            {row.review.criticalCounterarguments.length})
                          </h3>
                        </div>
                        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-rose-950 dark:text-rose-200">
                          {row.review.criticalCounterarguments.map((arg, idx) => (
                            <li key={idx} className="leading-relaxed">
                              {arg}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-700 dark:bg-slate-800/60">
                          <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            Offene Hürden ({row.review.openHurdles.length})
                          </h3>
                          {row.review.openHurdles.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700 dark:text-slate-300">
                              {row.review.openHurdles.map((hurdle, idx) => (
                                <li key={idx}>{hurdle}</li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                              Keine offenen Hürden dokumentiert.
                            </p>
                          )}
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-700 dark:bg-slate-800/60">
                          <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            Gutachter-Kurzurteil
                          </h3>
                          <MathText
                            content={row.review.verdictSummary}
                            className="mt-2 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                      Für diesen Crossing-Kandidaten liegt noch kein
                      Advocatus-Diaboli-Gutachten vor.
                    </p>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
