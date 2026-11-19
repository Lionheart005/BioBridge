import {
  Activity,
  BookOpen,
  Dna,
  FlaskConical,
  LayoutGrid,
  Monitor,
  Moon,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { type AppTab, useAppStore } from '@/state/appStore';
import type { ThemeMode } from '@/storage';
import { BudgetAlert } from './BudgetAlert';
import { CostTicker } from './CostTicker';

export interface AppShellProps {
  children: ReactNode;
}

interface NavItem {
  id: AppTab;
  label: string;
  icon: typeof FlaskConical;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'setup', label: '1. Setup & Upload', icon: FlaskConical },
  { id: 'library', label: '2. Wissensbibliothek', icon: BookOpen },
  { id: 'runner', label: '3. Pipeline-Lauf', icon: Activity },
  { id: 'matrix', label: '4. Bewertungsmatrix', icon: LayoutGrid },
  { id: 'settings', label: '5. Einstellungen & Prompts', icon: Settings },
];

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  label: string;
  ariaLabel: string;
  icon: typeof Sun;
}> = [
  { id: 'light', label: 'Hell', ariaLabel: 'Heller Modus aktivieren', icon: Sun },
  { id: 'dark', label: 'Dunkel', ariaLabel: 'Dunkler Modus aktivieren', icon: Moon },
  {
    id: 'system',
    label: 'System',
    ariaLabel: 'System-Darstellungsmodus verwenden',
    icon: Monitor,
  },
];

export function AppShell({ children }: AppShellProps) {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const documentsCount = useAppStore((s) => s.documents.length);
  const experimentsCount = useAppStore((s) => s.experiments.length);
  const isRunning = useAppStore((s) => s.isRunning);
  const lastError = useAppStore((s) => s.lastError);
  const setLastError = useAppStore((s) => s.setLastError);
  const theme = useAppStore((s) => s.settings.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const getBadge = (id: AppTab): string | null => {
    if (id === 'library' && documentsCount > 0) {
      return String(documentsCount);
    }
    if (id === 'runner') {
      if (isRunning) {
        return 'Aktiv';
      }
      if (experimentsCount > 0) {
        return String(experimentsCount);
      }
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-indigo-600 text-white shadow-xs">
                <Dna className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    BioBridge
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    Bionik-Kreuzungslabor
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Beleggestützte Analogie-Synthese zwischen Biologie &amp; Technik
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div
                role="group"
                aria-label="Darstellungsmodus"
                className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-950/70"
              >
                {THEME_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = theme === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => void setTheme(opt.id)}
                      aria-pressed={active}
                      aria-label={opt.ariaLabel}
                      title={opt.ariaLabel}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="hidden md:inline">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              <CostTicker />
            </div>
          </div>

          <nav
            aria-label="Hauptnavigation"
            className="flex items-center gap-1 overflow-x-auto pb-0.5"
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const badge = getBadge(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-xs dark:bg-indigo-600 dark:text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                  {badge ? (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        item.id === 'runner' && isRunning
                          ? 'bg-emerald-500 text-white'
                          : isActive
                            ? 'bg-slate-700 text-slate-100 dark:bg-indigo-500/80 dark:text-white'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <BudgetAlert />

      {lastError ? (
        <div
          role="alert"
          className="border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-200"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <span>{lastError}</span>
            <button
              type="button"
              aria-label="Fehlermeldung schließen"
              onClick={() => setLastError(null)}
              className="rounded p-1 text-rose-600 hover:bg-rose-100 hover:text-rose-900 dark:text-rose-300 dark:hover:bg-rose-900/50 dark:hover:text-rose-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
