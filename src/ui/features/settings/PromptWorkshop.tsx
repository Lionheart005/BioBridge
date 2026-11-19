import {
  AlertTriangle,
  CheckCircle2,
  Download,
  GitCompare,
  Lock,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  PromptProfileSchema,
  type PromptSlotId,
  type PromptTemplateSlot,
} from '@/core/schemas';
import { DEFAULT_PROMPT_SLOTS, validatePromptSlot } from '@/prompts';
import { useAppStore } from '@/state/appStore';

const SLOT_ORDER: PromptSlotId[] = [
  'extractBio',
  'extractTech',
  'visionExtract',
  'consolidate',
  'crossing',
  'cluster',
  'critic',
  'citationRepair',
];

interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

function computeLineDiff(defaultText: string, currentText: string): DiffLine[] {
  const a = defaultText.split('\n');
  const b = currentText.split('\n');
  const m = a.length;
  const n = b.length;

  // Standard LCS matrix for clean line-by-line diff
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array<number>(n + 1).fill(0),
  );

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'removed', text: a[i] });
      i += 1;
    } else {
      lines.push({ type: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < m) {
    lines.push({ type: 'removed', text: a[i] });
    i += 1;
  }
  while (j < n) {
    lines.push({ type: 'added', text: b[j] });
    j += 1;
  }
  return lines;
}

export function PromptWorkshop() {
  const promptProfile = useAppStore((s) => s.promptProfile);
  const updatePromptProfile = useAppStore((s) => s.updatePromptProfile);
  const resetPromptSlot = useAppStore((s) => s.resetPromptSlot);
  const resetAllPromptsAndSettings = useAppStore(
    (s) => s.resetAllPromptsAndSettings,
  );
  const setLastError = useAppStore((s) => s.setLastError);

  const [selectedSlotId, setSelectedSlotId] =
    useState<PromptSlotId>('extractBio');
  const [draftInstruction, setDraftInstruction] = useState<string>(
    promptProfile.slots.extractBio?.editableSystemInstruction ??
      DEFAULT_PROMPT_SLOTS.extractBio.editableSystemInstruction,
  );
  const [showDiff, setShowDiff] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const activeSlot =
    promptProfile.slots[selectedSlotId] ?? DEFAULT_PROMPT_SLOTS[selectedSlotId];
  const defaultSlot = DEFAULT_PROMPT_SLOTS[selectedSlotId];

  useEffect(() => {
    setDraftInstruction(activeSlot.editableSystemInstruction);
    setSavedFeedback(null);
  }, [selectedSlotId, activeSlot.editableSystemInstruction]);

  const draftSlot: PromptTemplateSlot = {
    ...activeSlot,
    editableSystemInstruction: draftInstruction,
  };
  const validation = validatePromptSlot(draftSlot);
  const hasUnsavedChanges =
    draftInstruction !== activeSlot.editableSystemInstruction;
  const isModifiedFromDefault =
    draftInstruction !== defaultSlot.editableSystemInstruction;

  const diffLines = showDiff
    ? computeLineDiff(defaultSlot.editableSystemInstruction, draftInstruction)
    : [];

  const handleSaveSlot = async () => {
    if (!validation.valid) {
      return;
    }
    const nextProfile = {
      ...promptProfile,
      isDefault: false,
      slots: {
        ...promptProfile.slots,
        [selectedSlotId]: {
          ...activeSlot,
          editableSystemInstruction: draftInstruction,
        },
      },
    };
    await updatePromptProfile(nextProfile);
    setSavedFeedback('Prompt gespeichert.');
  };

  const handleExportProfile = () => {
    const json = JSON.stringify(promptProfile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `biobridge-prompts-${promptProfile.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportProfile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as unknown;
      const parsed = PromptProfileSchema.parse(raw);

      for (const slotId of SLOT_ORDER) {
        const slot = parsed.slots[slotId];
        if (!slot) {
          throw new Error(`Fehlender Prompt-Slot "${slotId}" im Profil.`);
        }
        const check = validatePromptSlot(slot);
        if (!check.valid) {
          throw new Error(
            `Importierter Prompt "${slot.title}" verletzt Pflichtvariablen: ${check.missingVariables.join(', ')}`,
          );
        }
      }

      await updatePromptProfile(parsed);
      setSavedFeedback('Prompt-Profil erfolgreich importiert.');
    } catch (err) {
      setLastError(
        err instanceof Error
          ? `Prompt-Import fehlgeschlagen: ${err.message}`
          : 'Prompt-Profil konnte nicht importiert werden.',
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Prompt-Werkstatt ({promptProfile.name})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Passen Sie Fach-Instruktionen für jede Phase an. Pflicht-Variablen
            und JSON-Ausgabeverträge sind geschützt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void handleImportProfile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={handleExportProfile}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Profil exportieren</span>
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Profil importieren</span>
          </button>

          {confirmResetAll ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 dark:border-rose-800/80 dark:bg-rose-950/60">
              <span className="text-[11px] font-medium text-rose-900 dark:text-rose-200">
                Alles zurücksetzen?
              </span>
              <button
                type="button"
                onClick={() => {
                  void resetAllPromptsAndSettings();
                  setConfirmResetAll(false);
                }}
                className="rounded bg-rose-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500"
              >
                Ja
              </button>
              <button
                type="button"
                onClick={() => setConfirmResetAll(false)}
                className="rounded px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Abbrechen
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmResetAll(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Alle Prompts &amp; Einstellungen auf Standard</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split: 8 Prompts Left, Editor Right */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <aside className="space-y-1.5 lg:col-span-4">
          {SLOT_ORDER.map((slotId) => {
            const slot =
              promptProfile.slots[slotId] ?? DEFAULT_PROMPT_SLOTS[slotId];
            const def = DEFAULT_PROMPT_SLOTS[slotId];
            const isCustomized =
              slot.editableSystemInstruction !== def.editableSystemInstruction;
            const isActive = selectedSlotId === slotId;

            return (
              <button
                key={slotId}
                type="button"
                onClick={() => setSelectedSlotId(slotId)}
                className={`w-full rounded-xl border p-3 text-left transition-all ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500 dark:border-indigo-500/80 dark:bg-indigo-950/50 dark:ring-indigo-500/80'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {slot.title}
                  </span>
                  {isCustomized ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-300">
                      Angepasst
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {slot.phase}
                </p>
              </button>
            );
          })}
        </aside>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
            <div>
              <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {activeSlot.phase}
              </span>
              <h3 className="mt-1.5 text-base font-bold text-slate-900 dark:text-slate-100">
                {activeSlot.title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {activeSlot.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDiff((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  showDiff
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:border-indigo-500/80 dark:bg-indigo-950/60 dark:text-indigo-300'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <GitCompare className="h-3.5 w-3.5" />
                <span>Diff gegen Standard</span>
              </button>

              <button
                type="button"
                disabled={!isModifiedFromDefault}
                onClick={() => void resetPromptSlot(selectedSlotId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Diesen Prompt zurücksetzen</span>
              </button>
            </div>
          </div>

          {activeSlot.riskHint ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <span>
                <strong>Risiko-Hinweis:</strong> {activeSlot.riskHint}
              </span>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="prompt-instruction-editor"
                className="text-xs font-semibold text-slate-900 dark:text-slate-100"
              >
                Bearbeitbare System-Instruktion
              </label>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Pflichtvariablen:</span>
                {activeSlot.requiredVariables.map((v) => {
                  const missing = validation.missingVariables.includes(v);
                  return (
                    <code
                      key={v}
                      className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                        missing
                          ? 'bg-rose-100 font-semibold text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {`{{${v}}}`}
                    </code>
                  );
                })}
              </div>
            </div>

            <textarea
              id="prompt-instruction-editor"
              rows={11}
              value={draftInstruction}
              onChange={(e) => {
                setDraftInstruction(e.target.value);
                setSavedFeedback(null);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white p-3.5 font-mono text-xs leading-relaxed text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
            />
          </div>

          {/* Validation Errors & Warnings */}
          {!validation.valid ? (
            <div
              role="alert"
              className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-200"
            >
              <p className="font-semibold">
                Speichern blockiert: Pflicht-Platzhalter fehlen!
              </p>
              {validation.missingVariables.length > 0 ? (
                <p className="mt-1">
                  Fehlende Variablen:{' '}
                  {validation.missingVariables.map((v) => `{{${v}}}`).join(', ')}
                </p>
              ) : null}
            </div>
          ) : null}

          {validation.warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200">
              <ul className="list-disc space-y-1 pl-4">
                {validation.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Diff View */}
          {showDiff ? (
            <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                <span>Zeilenweiser Vergleich: Standard vs. Aktuell</span>
                {!isModifiedFromDefault ? (
                  <span className="text-[11px] font-normal text-emerald-700 dark:text-emerald-400">
                    Identisch mit Standard
                  </span>
                ) : null}
              </div>
              <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-2.5 font-mono text-[11px] leading-relaxed dark:border-slate-700 dark:bg-slate-950">
                {diffLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={
                      line.type === 'added'
                        ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : line.type === 'removed'
                          ? 'bg-rose-50 text-rose-900 line-through dark:bg-rose-950/50 dark:text-rose-300'
                          : 'text-slate-600 dark:text-slate-400'
                    }
                  >
                    <span className="mr-2 inline-block w-3 select-none opacity-60">
                      {line.type === 'added'
                        ? '+'
                        : line.type === 'removed'
                          ? '-'
                          : ' '}
                    </span>
                    {line.text || ' '}
                  </div>
                ))}
              </pre>
            </div>
          ) : null}

          {/* Locked Output Contract */}
          <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Lock className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              <span>
                Unveränderlicher Ausgabe-Vertrag (schreibgeschützt)
              </span>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
              {activeSlot.lockedOutputContract}
            </pre>
          </div>

          {/* Save Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-xs">
              {savedFeedback ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  {savedFeedback}
                </span>
              ) : hasUnsavedChanges ? (
                <span className="text-amber-700 dark:text-amber-400">
                  Ungespeicherte Änderungen
                </span>
              ) : (
                <span className="text-slate-400 dark:text-slate-500">
                  Alle Änderungen gespeichert
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={!validation.valid || !hasUnsavedChanges}
              onClick={() => void handleSaveSlot()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-indigo-600 dark:hover:bg-indigo-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Prompt speichern</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
