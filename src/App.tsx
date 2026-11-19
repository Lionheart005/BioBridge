import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { LibraryView } from '@/ui/features/library/LibraryView';
import { MatrixView } from '@/ui/features/matrix/MatrixView';
import { RunnerView } from '@/ui/features/runner/RunnerView';
import { SettingsView } from '@/ui/features/settings/SettingsView';
import { SetupView } from '@/ui/features/setup/SetupView';
import { AppShell } from '@/ui/layout/AppShell';

export function App() {
  const initialized = useAppStore((s) => s.initialized);
  const activeTab = useAppStore((s) => s.activeTab);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const initialize = useAppStore((s) => s.initialize);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setActiveExperimentId = useAppStore((s) => s.setActiveExperimentId);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (!initialized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-8 py-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600 dark:text-indigo-400" />
          <div className="text-center">
            <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              BioBridge wird initialisiert…
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Lokale Wissensbibliothek und Einstellungen werden geladen.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <AppShell>
      {activeTab === 'setup' ? <SetupView /> : null}
      {activeTab === 'library' ? <LibraryView /> : null}
      {activeTab === 'runner' ? <RunnerView /> : null}
      {activeTab === 'matrix' ? (
        <MatrixView
          activeExperimentId={activeExperimentId}
          onSelectExperiment={(id) => setActiveExperimentId(id)}
          onNavigateToSetup={() => setActiveTab('setup')}
        />
      ) : null}
      {activeTab === 'settings' ? <SettingsView /> : null}
    </AppShell>
  );
}
