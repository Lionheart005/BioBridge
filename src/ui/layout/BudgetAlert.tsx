import { AlertOctagon, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatEur, formatUsd, useAppStore } from '@/state/appStore';
import { listExperiments, saveExperiment } from '@/storage';

export function BudgetAlert() {
  const experiments = useAppStore((s) => s.experiments);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const usdToEurRate = useAppStore((s) => s.settings.usdToEurRate);
  const resumePersistedExperiment = useAppStore(
    (s) => s.resumePersistedExperiment,
  );
  const setLastError = useAppStore((s) => s.setLastError);

  const stoppedExperiment =
    experiments.find(
      (e) => e.id === activeExperimentId && e.status === 'BUDGET_STOPPED',
    ) ?? experiments.find((e) => e.status === 'BUDGET_STOPPED');

  const currentLimit =
    stoppedExperiment?.config.budgetLimitUsd ??
    stoppedExperiment?.costLedger.totalCostUsd ??
    1;

  const [newLimitInput, setNewLimitInput] = useState<string>(() =>
    (Math.ceil((currentLimit + 1.5) * 100) / 100).toFixed(2),
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (stoppedExperiment) {
      const base =
        stoppedExperiment.config.budgetLimitUsd ??
        stoppedExperiment.costLedger.totalCostUsd;
      setNewLimitInput((Math.ceil((base + 1.5) * 100) / 100).toFixed(2));
    }
  }, [stoppedExperiment]);

  if (!stoppedExperiment) {
    return null;
  }

  const handleIncreaseAndResume = async () => {
    const parsed = Number(newLimitInput.replace(',', '.'));
    if (
      !Number.isFinite(parsed) ||
      parsed <= stoppedExperiment.costLedger.totalCostUsd
    ) {
      setLastError(
        `Das neue Budget muss über den bisherigen Kosten (${formatUsd(stoppedExperiment.costLedger.totalCostUsd)}) liegen.`,
      );
      return;
    }

    setSubmitting(true);
    try {
      const updatedRun = {
        ...stoppedExperiment,
        status: 'PAUSED' as const,
        updatedAt: new Date().toISOString(),
        config: {
          ...stoppedExperiment.config,
          budgetLimitUsd: parsed,
        },
      };
      await saveExperiment(updatedRun);
      const refreshed = await listExperiments();
      useAppStore.setState({ experiments: refreshed });
      await resumePersistedExperiment(stoppedExperiment.id);
    } catch (err) {
      setLastError(
        err instanceof Error
          ? err.message
          : 'Budget konnte nicht aktualisiert werden.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="alert"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold text-amber-950 dark:text-amber-100">
              Budget-Stopp ausgelöst: „{stoppedExperiment.name}“
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-200/90">
              Aktuelle Kosten:{' '}
              <strong>
                {formatUsd(stoppedExperiment.costLedger.totalCostUsd)}
              </strong>{' '}
              ({formatEur(stoppedExperiment.costLedger.totalCostUsd, usdToEurRate)})
              {' • '}Eingestelltes Limit:{' '}
              <strong>{formatUsd(currentLimit)}</strong>. Alle bisherigen
              Ergebnisse wurden im Checkpoint gesichert.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
            <span>Neues Limit ($):</span>
            <input
              type="number"
              step="0.25"
              min={(stoppedExperiment.costLedger.totalCostUsd + 0.1).toFixed(2)}
              value={newLimitInput}
              onChange={(e) => setNewLimitInput(e.target.value)}
              className="w-24 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleIncreaseAndResume()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-500"
          >
            <Play className="h-3.5 w-3.5" />
            <span>Budget erhöhen & fortsetzen</span>
          </button>
        </div>
      </div>
    </div>
  );
}
