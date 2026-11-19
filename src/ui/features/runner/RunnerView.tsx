import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Coins,
  DatabaseZap,
  Loader2,
  Pause,
  Play,
  ShieldAlert,
  Square,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import type { ExperimentRun, ExperimentStatus, PipelinePhase } from '@/core/schemas';
import type { PipelineEvent } from '@/pipeline';
import { formatEur, formatUsd, useAppStore } from '@/state/appStore';

type LogFilter = 'all' | 'citations' | 'phases' | 'warnings';

const STATUS_BADGES: Record<
  ExperimentStatus,
  { label: string; classes: string }
> = {
  DRAFT: {
    label: 'Entwurf',
    classes:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
  ESTIMATED: {
    label: 'Geschätzt',
    classes:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
  RUNNING: {
    label: 'Läuft',
    classes:
      'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/80',
  },
  PAUSED: {
    label: 'Pausiert',
    classes:
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/80',
  },
  BUDGET_STOPPED: {
    label: 'Budget-Stopp',
    classes:
      'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/80',
  },
  COMPLETED: {
    label: 'Abgeschlossen',
    classes:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80',
  },
  FAILED: {
    label: 'Fehlgeschlagen',
    classes:
      'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/80',
  },
};

const PIPELINE_STEPS: Array<{
  phase: PipelinePhase;
  shortLabel: string;
  description: string;
}> = [
  {
    phase: 'phase1_vision',
    shortLabel: '1. Vision & Formeln',
    description: 'Diagramme & PDF-Gleichungen rekonstruieren',
  },
  {
    phase: 'phase2_extract',
    shortLabel: '2. Blinde Extraktion',
    description: 'Mechanismen & Probleme getrennt belegen',
  },
  {
    phase: 'phase3_cross',
    shortLabel: '3. Kreuzungs-Engine',
    description: 'Analogie-Brücken generieren',
  },
  {
    phase: 'phase4_critic',
    shortLabel: '4. Advocatus Diaboli',
    description: 'Härteprüfung & Gegenargumente',
  },
  {
    phase: 'completed',
    shortLabel: '5. Abgeschlossen',
    description: 'Bereit für die Bewertungsmatrix',
  },
];

const PHASE_ORDER: Record<PipelinePhase, number> = {
  idle: 0,
  phase1_vision: 1,
  phase2_extract: 2,
  phase3_cross: 3,
  phase4_critic: 4,
  completed: 5,
};

interface NormalizedLogRow {
  id: string;
  timestamp: string;
  category: 'info' | 'cache' | 'correction' | 'retraction' | 'warn' | 'error';
  title: string;
  detail: string;
}

function eventToLogRow(event: PipelineEvent, idx: number): NormalizedLogRow | null {
  switch (event.type) {
    case 'progress':
      return null;
    case 'cost_updated':
      return null;
    case 'phase_changed':
      return {
        id: `${idx}-phase`,
        timestamp: event.timestamp,
        category: 'info',
        title: `Phase: ${event.phase}`,
        detail: event.message,
      };
    case 'log': {
      const lower = event.message.toLowerCase();
      const isCache =
        lower.includes('cache') || lower.includes('zwischengespeichert');
      return {
        id: `${idx}-log`,
        timestamp: event.timestamp,
        category:
          event.level === 'error'
            ? 'error'
            : event.level === 'warn'
              ? 'warn'
              : isCache
                ? 'cache'
                : 'info',
        title:
          event.level === 'error'
            ? 'Fehler'
            : event.level === 'warn'
              ? 'Hinweis'
              : isCache
                ? 'Cache-Treffer'
                : 'Protokoll',
        detail: event.message,
      };
    }
    case 'citation_verified': {
      if (event.status === 'CORRECTED_VERIFIED') {
        return {
          id: `${idx}-cit`,
          timestamp: event.timestamp,
          category: 'correction',
          title: 'Zitat-Selbstkorrektur erfolgreich',
          detail: `${event.documentTitle} (S. ${event.pageNumber}) nach ${event.attempts} Versuchen verifiziert.`,
        };
      }
      if (
        event.status === 'RETRACTED_HALLUCINATION' ||
        event.status === 'FAILED_UNVERIFIED'
      ) {
        return {
          id: `${idx}-cit`,
          timestamp: event.timestamp,
          category: 'retraction',
          title:
            event.status === 'RETRACTED_HALLUCINATION'
              ? 'Halluziniertes Zitat zurückgezogen'
              : 'Zitat unbelegt (K.O.)',
          detail: `${event.documentTitle} (S. ${event.pageNumber}) • ${event.attempts} Versuche`,
        };
      }
      return {
        id: `${idx}-cit`,
        timestamp: event.timestamp,
        category: 'info',
        title: 'Zitat verifiziert',
        detail: `${event.documentTitle} (S. ${event.pageNumber}) • Status: ${event.status}`,
      };
    }
    case 'budget_stopped':
      return {
        id: `${idx}-budget`,
        timestamp: event.timestamp,
        category: 'warn',
        title: 'Budget-Stopp',
        detail: `Kosten (${formatUsd(event.totalCostUsd)}) erreichten Limit (${formatUsd(event.budgetLimitUsd)}).`,
      };
    case 'paused':
      return {
        id: `${idx}-paused`,
        timestamp: event.timestamp,
        category: 'warn',
        title: 'Pausiert',
        detail: `Lauf in Phase ${event.phase} mit Checkpoint gesichert.`,
      };
    case 'completed':
      return {
        id: `${idx}-done`,
        timestamp: event.timestamp,
        category: 'info',
        title: 'Experiment abgeschlossen',
        detail: `${event.candidateCount} Kandidaten generiert, ${event.reviewCount} Reviews erstellt.`,
      };
    case 'error':
      return {
        id: `${idx}-err`,
        timestamp: event.timestamp,
        category: 'error',
        title: `Fehler in ${event.phase}`,
        detail: event.error,
      };
  }
}

export function RunnerView() {
  const experiments = useAppStore((s) => s.experiments);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const setActiveExperimentId = useAppStore((s) => s.setActiveExperimentId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const usdToEurRate = useAppStore((s) => s.settings.usdToEurRate);
  const liveEvents = useAppStore((s) => s.liveEvents);
  const liveProgress = useAppStore((s) => s.liveProgress);
  const isRunning = useAppStore((s) => s.isRunning);
  const isPaused = useAppStore((s) => s.isPaused);
  const pauseExperiment = useAppStore((s) => s.pauseExperiment);
  const resumeExperiment = useAppStore((s) => s.resumeExperiment);
  const stopExperiment = useAppStore((s) => s.stopExperiment);
  const resumePersistedExperiment = useAppStore(
    (s) => s.resumePersistedExperiment,
  );
  const deleteExperiment = useAppStore((s) => s.deleteExperiment);

  const [logFilter, setLogFilter] = useState<LogFilter>('all');

  const activeExperiment: ExperimentRun | null =
    experiments.find((e) => e.id === activeExperimentId) ??
    experiments[0] ??
    null;

  const activePhase: PipelinePhase = activeExperiment
    ? activeExperiment.status === 'COMPLETED'
      ? 'completed'
      : isRunning && liveProgress
        ? liveProgress.phase
        : activeExperiment.checkpoint.currentPhase
    : 'idle';

  const currentPhaseRank = PHASE_ORDER[activePhase] ?? 0;

  const progressPct =
    activeExperiment?.status === 'COMPLETED'
      ? 100
      : liveProgress && liveProgress.total > 0
        ? Math.min(
            100,
            Math.round((liveProgress.completed / liveProgress.total) * 100),
          )
        : 0;

  const experimentEvents = activeExperiment
    ? liveEvents.filter((ev) => ev.experimentId === activeExperiment.id)
    : [];

  const logRows = experimentEvents
    .map((ev, idx) => eventToLogRow(ev, idx))
    .filter((row): row is NormalizedLogRow => row !== null)
    .filter((row) => {
      if (logFilter === 'citations') {
        return row.category === 'correction' || row.category === 'retraction';
      }
      if (logFilter === 'phases') {
        return row.category === 'info' || row.category === 'cache';
      }
      if (logFilter === 'warnings') {
        return (
          row.category === 'warn' ||
          row.category === 'error' ||
          row.category === 'retraction'
        );
      }
      return true;
    })
    .reverse();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Experiment History & Selector */}
      <aside className="space-y-3 lg:col-span-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Experiment-Läufe ({experiments.length})
            </h2>
            <button
              type="button"
              onClick={() => setActiveTab('setup')}
              className="text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-400"
            >
              + Neues Setup
            </button>
          </div>

          {experiments.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Noch kein Experiment gestartet. Starten Sie ein Kreuzungs-Experiment
              im Setup oder laden Sie das Demo-Experiment.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {experiments.map((exp) => {
                const isSelected = activeExperiment?.id === exp.id;
                const badge = STATUS_BADGES[exp.status];
                const canResumePersisted =
                  !isRunning &&
                  (exp.status === 'PAUSED' ||
                    exp.status === 'BUDGET_STOPPED' ||
                    exp.status === 'FAILED');

                return (
                  <li
                    key={exp.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/40 dark:border-indigo-500/80 dark:bg-indigo-950/40'
                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveExperimentId(exp.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {exp.name}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.classes}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>
                          {exp.biologyDocIds.length} Bio ×{' '}
                          {exp.technologyDocIds.length} Tech
                        </span>
                        <span>{formatUsd(exp.costLedger.totalCostUsd)}</span>
                      </div>
                    </button>

                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        {new Date(exp.updatedAt).toLocaleString('de-DE')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {canResumePersisted ? (
                          <button
                            type="button"
                            onClick={() => void resumePersistedExperiment(exp.id)}
                            className="inline-flex items-center gap-1 rounded-md bg-indigo-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                          >
                            <Play className="h-3 w-3" />
                            <span>Fortsetzen</span>
                          </button>
                        ) : null}
                        {!isRunning || exp.id !== activeExperiment?.id ? (
                          <button
                            type="button"
                            aria-label={`Experiment ${exp.name} löschen`}
                            onClick={() => void deleteExperiment(exp.id)}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700 dark:text-slate-500 dark:hover:bg-rose-950/60 dark:hover:text-rose-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Right: Active Experiment Monitor */}
      <section className="space-y-5 lg:col-span-8">
        {!activeExperiment ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
            <Activity className="mx-auto h-9 w-9 text-slate-400 dark:text-slate-500" />
            <h2 className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Kein Experiment ausgewählt
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Wählen Sie links ein bestehendes Experiment aus oder erstellen Sie
              im Setup einen neuen Lauf.
            </p>
          </div>
        ) : (
          <>
            {/* Status, Phase Stepper & Controls */}
            <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {activeExperiment.name}
                    </h1>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        STATUS_BADGES[activeExperiment.status].classes
                      }`}
                    >
                      {STATUS_BADGES[activeExperiment.status].label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Strategie:{' '}
                    {activeExperiment.config.crossingStrategy ===
                    'embedding-hybrid'
                      ? 'Embedding-Matching'
                      : 'Thematisches Clustering'}{' '}
                    • Max. {activeExperiment.config.maxCandidates} Kandidaten •
                    Ausgabe: {activeExperiment.config.outputLanguage.toUpperCase()}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isRunning && activeExperiment.id === activeExperimentId ? (
                    <>
                      {isPaused ? (
                        <button
                          type="button"
                          onClick={() => void resumeExperiment()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                        >
                          <Play className="h-3.5 w-3.5" />
                          <span>Fortsetzen</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void pauseExperiment(false)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-900/60"
                        >
                          <Pause className="h-3.5 w-3.5" />
                          <span>Pausieren</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void pauseExperiment(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        <span>Sichern &amp; später fortsetzen</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void stopExperiment(false)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60"
                      >
                        <Square className="h-3.5 w-3.5" />
                        <span>Abbrechen</span>
                      </button>
                    </>
                  ) : activeExperiment.status === 'PAUSED' ||
                    activeExperiment.status === 'BUDGET_STOPPED' ||
                    activeExperiment.status === 'FAILED' ? (
                    <button
                      type="button"
                      onClick={() =>
                        void resumePersistedExperiment(activeExperiment.id)
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Ab Checkpoint fortsetzen</span>
                    </button>
                  ) : null}

                  {activeExperiment.status === 'COMPLETED' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveExperimentId(activeExperiment.id);
                        setActiveTab('matrix');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                    >
                      <span>Ergebnisse in Bewertungsmatrix öffnen</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>

              {/* 5-Phase Stepper */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                {PIPELINE_STEPS.map((step) => {
                  const stepRank = PHASE_ORDER[step.phase];
                  const isDone =
                    activeExperiment.status === 'COMPLETED' ||
                    currentPhaseRank > stepRank;
                  const isCurrent =
                    activeExperiment.status !== 'COMPLETED' &&
                    activePhase === step.phase;

                  return (
                    <div
                      key={step.phase}
                      className={`rounded-xl border p-3 transition-colors ${
                        isDone
                          ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-800/80 dark:bg-emerald-950/40'
                          : isCurrent
                            ? 'border-indigo-400 bg-indigo-50/70 dark:border-indigo-500/80 dark:bg-indigo-950/50'
                            : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {isDone ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                        ) : isCurrent && isRunning ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-700 dark:text-indigo-400" />
                        ) : (
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                        )}
                        <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {step.shortLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                        {step.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Progress bar + Live Cost vs Budget */}
              <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-800">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {liveProgress?.detail ??
                        (activeExperiment.status === 'COMPLETED'
                          ? 'Alle Phasen abgeschlossen'
                          : `Aktuelle Phase: ${activePhase}`)}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {progressPct}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <div
                      className={`h-full transition-all ${
                        activeExperiment.status === 'COMPLETED'
                          ? 'bg-emerald-600 dark:bg-emerald-500'
                          : 'bg-indigo-600 dark:bg-indigo-500'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {formatUsd(activeExperiment.costLedger.totalCostUsd)} (
                        {formatEur(
                          activeExperiment.costLedger.totalCostUsd,
                          usdToEurRate,
                        )}
                        )
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {activeExperiment.costLedger.totalInputTokens.toLocaleString(
                          'de-DE',
                        )}{' '}
                        In •{' '}
                        {activeExperiment.costLedger.totalOutputTokens.toLocaleString(
                          'de-DE',
                        )}{' '}
                        Out • {activeExperiment.costLedger.totalVisionImages}{' '}
                        Bilder
                      </div>
                    </div>
                  </div>
                  {activeExperiment.config.budgetLimitUsd ? (
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Budget-Limit
                      </div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {formatUsd(activeExperiment.config.budgetLimitUsd)}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Live Activity & Self-Correction Log */}
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Live-Aktivitäts- &amp; Selbstkorrektur-Protokoll
                </h2>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs dark:border-slate-700 dark:bg-slate-800/70">
                  {(
                    [
                      { id: 'all', label: 'Alle' },
                      { id: 'citations', label: 'Zitate & Korrekturen' },
                      { id: 'phases', label: 'Cache & Phasen' },
                      { id: 'warnings', label: 'Warnungen & Fehler' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setLogFilter(tab.id)}
                      className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                        logFilter === tab.id
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {logRows.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                  Noch keine Live-Ereignisse für dieses Experiment in der
                  aktuellen Sitzung.
                </p>
              ) : (
                <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {logRows.map((row) => {
                    const styleMap = {
                      info: {
                        wrap: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200',
                        icon: CheckCircle2,
                        iconColor: 'text-slate-500 dark:text-slate-400',
                      },
                      cache: {
                        wrap: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-200',
                        icon: DatabaseZap,
                        iconColor: 'text-emerald-700 dark:text-emerald-400',
                      },
                      correction: {
                        wrap: 'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200',
                        icon: Wrench,
                        iconColor: 'text-amber-700 dark:text-amber-400',
                      },
                      retraction: {
                        wrap: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-200',
                        icon: ShieldAlert,
                        iconColor: 'text-rose-700 dark:text-rose-400',
                      },
                      warn: {
                        wrap: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200',
                        icon: AlertTriangle,
                        iconColor: 'text-amber-700 dark:text-amber-400',
                      },
                      error: {
                        wrap: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-200',
                        icon: XCircle,
                        iconColor: 'text-rose-700 dark:text-rose-400',
                      },
                    }[row.category];
                    const Icon = styleMap.icon;

                    return (
                      <li
                        key={row.id}
                        className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${styleMap.wrap}`}
                      >
                        <Icon
                          className={`mt-0.5 h-4 w-4 shrink-0 ${styleMap.iconColor}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{row.title}</span>
                            <span className="text-[10px] opacity-70">
                              {new Date(row.timestamp).toLocaleTimeString(
                                'de-DE',
                              )}
                            </span>
                          </div>
                          <p className="mt-0.5 leading-relaxed opacity-90">
                            {row.detail}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
