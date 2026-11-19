import { Coins } from 'lucide-react';
import { formatEur, formatUsd, useAppStore } from '@/state/appStore';

export function CostTicker() {
  const experiments = useAppStore((s) => s.experiments);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const usdToEurRate = useAppStore((s) => s.settings.usdToEurRate);
  const liveCostEstimate = useAppStore((s) => s.liveCostEstimate);
  const isRunning = useAppStore((s) => s.isRunning);
  const activeTab = useAppStore((s) => s.activeTab);

  const activeExperiment =
    experiments.find((e) => e.id === activeExperimentId) ?? null;

  const showLiveLedger =
    activeExperiment !== null && (isRunning || activeTab !== 'setup');

  if (showLiveLedger && activeExperiment) {
    const spentUsd = activeExperiment.costLedger.totalCostUsd;
    const budget = activeExperiment.config.budgetLimitUsd;
    const ratio =
      budget && budget > 0 ? Math.min(1, spentUsd / budget) : undefined;
    const nearBudget = ratio !== undefined && ratio >= 0.85;

    return (
      <div
        className={`flex items-center gap-2.5 rounded-xl border px-3 py-1.5 text-xs ${
          activeExperiment.status === 'BUDGET_STOPPED'
            ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-200'
            : nearBudget
              ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200'
              : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300'
        }`}
      >
        <Coins className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
        <div className="leading-tight">
          <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
            <span>{formatUsd(spentUsd)}</span>
            <span className="font-normal text-slate-500 dark:text-slate-400">
              ({formatEur(spentUsd, usdToEurRate)})
            </span>
          </div>
          {budget ? (
            <div className="mt-1 flex items-center gap-1.5">
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className={`h-full transition-all ${
                    activeExperiment.status === 'BUDGET_STOPPED'
                      ? 'bg-rose-600'
                      : nearBudget
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                  }`}
                  style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }}
                />
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Limit {formatUsd(budget)}
              </span>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Laufende Kosten
            </div>
          )}
        </div>
      </div>
    );
  }

  if (liveCostEstimate && liveCostEstimate.total.expectedUsd > 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
        <Coins className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
        <div className="leading-tight">
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            ca. {formatUsd(liveCostEstimate.total.expectedUsd)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Schätzung ({formatEur(liveCostEstimate.total.expectedUsd, usdToEurRate)})
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500 sm:flex dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
      <Coins className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
      <span>Kosten: $0.00</span>
    </div>
  );
}
