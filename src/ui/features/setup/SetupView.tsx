import * as Dialog from '@radix-ui/react-dialog';
import * as Slider from '@radix-ui/react-slider';
import * as Switch from '@radix-ui/react-switch';
import {
  AlertTriangle,
  BookPlus,
  Check,
  Clock,
  Cpu,
  DatabaseZap,
  FileText,
  FlaskConical,
  FolderUp,
  Image as ImageIcon,
  Layers,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type {
  Domain,
  PdfMathVisionMode,
  ProviderId,
  SourceDocument,
} from '@/core/schemas';
import { PRICING_CATALOG_UPDATED_AT } from '@/estimation';
import { formatEur, formatUsd, useAppStore } from '@/state/appStore';
import { InfoPopover } from '@/ui/components/InfoPopover';

const LANGUAGE_OPTIONS = [
  { value: 'de', label: 'Deutsch (de)' },
  { value: 'en', label: 'Englisch (en)' },
  { value: 'fr', label: 'Französisch (fr)' },
  { value: 'es', label: 'Spanisch (es)' },
];

const PROVIDER_NAMES: Record<ProviderId, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  custom: 'Custom / Ollama',
};

function formatDuration(minSec: number, maxSec: number): string {
  const fmt = (sec: number) => {
    if (sec < 60) return `${sec} Sek.`;
    const min = Math.round(sec / 60);
    return `~${min} Min.`;
  };
  if (minSec === 0 && maxSec === 0) return '—';
  if (minSec === maxSec) return fmt(minSec);
  return `${fmt(minSec)} – ${fmt(maxSec)}`;
}

function getCreativityLabel(distance: number): {
  label: string;
  hint: string;
  badgeClass: string;
} {
  if (distance < 0.34) {
    return {
      label: 'Streng',
      hint: 'Priorisiert direkte, physikalisch naheliegende Analogien mit hoher Übereinstimmung.',
      badgeClass:
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80',
    };
  }
  if (distance <= 0.67) {
    return {
      label: 'Ausgewogen',
      hint: 'Balanciert solide Machbarkeit mit kreativen Transfers über Fachgrenzen hinweg.',
      badgeClass:
        'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/80',
    };
  }
  return {
    label: 'Experimentell',
    hint: 'Sucht gezielt nach weit entfernten, unkonventionellen Struktur-Analogien (höheres Risiko für Fehlübertragungen).',
    badgeClass:
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/80',
  };
}

interface DomainDropzoneProps {
  domain: Domain;
  title: string;
  subtitle: string;
  selectedDocs: SourceDocument[];
  allLibraryDocs: SourceDocument[];
  cachedDocIds: Set<string>;
  ingestingFiles: boolean;
  onUploadFiles: (files: File[], domain: Domain) => Promise<void>;
  onAddFromLibrary: (docId: string, domain: Domain) => void;
  onRemoveDoc: (docId: string, domain: Domain) => void;
}

function DomainDropzone({
  domain,
  title,
  subtitle,
  selectedDocs,
  allLibraryDocs,
  cachedDocIds,
  ingestingFiles,
  onUploadFiles,
  onAddFromLibrary,
  onRemoveDoc,
}: DomainDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isBio = domain === 'biology';
  const accentText = isBio
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-indigo-700 dark:text-indigo-400';
  const accentBg = isBio
    ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
    : 'bg-indigo-50/70 dark:bg-indigo-950/25';
  const accentBorder = isBio
    ? 'border-emerald-200 dark:border-emerald-800/70'
    : 'border-indigo-200 dark:border-indigo-800/70';
  const dragBorder = isBio
    ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-950/50'
    : 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/50';
  const badgeClasses = isBio
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
    : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300';

  const domainLibraryDocs = allLibraryDocs.filter((d) => d.domain === domain);
  const selectedIds = new Set(selectedDocs.map((d) => d.id));

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    void onUploadFiles(Array.from(fileList), domain);
  };

  return (
    <section
      aria-label={title}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badgeClasses}`}
          >
            {isBio ? 'Domäne A • Natur / Biologie' : 'Domäne B • Problem / Technik'}
          </span>
          <h2 className={`mt-1.5 text-base font-semibold ${accentText}`}>
            {title}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">{subtitle}</p>
        </div>

        <Dialog.Root open={libraryOpen} onOpenChange={setLibraryOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <BookPlus className="h-3.5 w-3.5" />
              <span>Aus Bibliothek</span>
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] dark:bg-slate-950/70" />
            <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl focus:outline-none dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <Dialog.Title className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {isBio
                    ? 'Biologie-Dokumente aus Bibliothek hinzufügen'
                    : 'Technik-Dokumente aus Bibliothek hinzufügen'}
                </Dialog.Title>
                <Dialog.Close className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {domainLibraryDocs.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    Noch keine Dokumente für diese Domäne in der lokalen
                    Bibliothek gespeichert.
                  </p>
                ) : (
                  domainLibraryDocs.map((doc) => {
                    const alreadyAdded = selectedIds.has(doc.id);
                    return (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 dark:bg-slate-800/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {doc.fileName}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {doc.format.toUpperCase()} • {doc.pageCount} Seiten •{' '}
                            {doc.stats.estimatedTokens.toLocaleString('de-DE')}{' '}
                            Tokens
                          </p>
                        </div>
                        {alreadyAdded ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            <Check className="h-3.5 w-3.5" />
                            Ausgewählt
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onAddFromLibrary(doc.id, domain)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition-colors ${
                              isBio
                                ? 'bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500'
                                : 'bg-indigo-700 hover:bg-indigo-800 dark:bg-indigo-600 dark:hover:bg-indigo-500'
                            }`}
                          >
                            Hinzufügen
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragging ? dragBorder : `${accentBorder} ${accentBg} hover:bg-opacity-100`
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.md,.markdown,.txt"
          multiple
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {ingestingFiles ? (
          <Loader2 className={`h-7 w-7 animate-spin ${accentText}`} />
        ) : (
          <Upload className={`h-7 w-7 ${accentText}`} />
        )}
        <p className="mt-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
          Dateien hierher ziehen oder klicken zum Auswählen
        </p>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          PDF, DOCX, Markdown (.md) oder Text (.txt) — auch mehrere Bücher
          gleichzeitig
        </p>
      </div>

      {selectedDocs.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {selectedDocs.map((doc) => {
            const isCached = cachedDocIds.has(doc.id);
            return (
              <li
                key={doc.id}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${accentText}`} />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {doc.fileName}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                        <span className="rounded bg-white px-1.5 py-0.5 font-medium uppercase ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                          {doc.format}
                        </span>
                        <span>{doc.pageCount} Seiten</span>
                        <span>•</span>
                        <span>Sprache: {doc.detectedLanguage.toUpperCase()}</span>
                        <span>•</span>
                        <span>
                          {doc.stats.estimatedTokens.toLocaleString('de-DE')}{' '}
                          Tokens
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`${doc.fileName} aus Experiment entfernen`}
                    onClick={() => onRemoveDoc(doc.id, domain)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-rose-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {isCached ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300">
                      <DatabaseZap className="h-3 w-3" />
                      Aus Cache: 0 Tokens / $0,00
                    </span>
                  ) : null}
                  {doc.stats.detectedFigurePages.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      <ImageIcon className="h-3 w-3 text-slate-500 dark:text-slate-400" />
                      {doc.stats.detectedFigurePages.length} Diagramm-Seiten
                    </span>
                  ) : null}
                  {doc.stats.detectedMathAnomalyPages.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-300">
                      <Sparkles className="h-3 w-3" />
                      {doc.stats.detectedMathAnomalyPages.length}{' '}
                      Formel-Anomalien
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500">
          Noch kein Dokument ausgewählt.
        </p>
      )}
    </section>
  );
}

export function SetupView() {
  const documents = useAppStore((s) => s.documents);
  const setupDraft = useAppStore((s) => s.setupDraft);
  const settings = useAppStore((s) => s.settings);
  const apiKeys = useAppStore((s) => s.apiKeys);
  const cachedDocIdsForCurrentDraft = useAppStore(
    (s) => s.cachedDocIdsForCurrentDraft,
  );
  const liveCostEstimate = useAppStore((s) => s.liveCostEstimate);
  const ingestingFiles = useAppStore((s) => s.ingestingFiles);

  const setSetupDraft = useAppStore((s) => s.setSetupDraft);
  const uploadFiles = useAppStore((s) => s.uploadFiles);
  const addDocumentToDraft = useAppStore((s) => s.addDocumentToDraft);
  const removeDocumentFromDraft = useAppStore((s) => s.removeDocumentFromDraft);
  const startExperiment = useAppStore((s) => s.startExperiment);
  const importProjectBundleFile = useAppStore((s) => s.importProjectBundleFile);
  const loadDemoExperiment = useAppStore((s) => s.loadDemoExperiment);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setLastError = useAppStore((s) => s.setLastError);

  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const [starting, setStarting] = useState(false);

  const docById = new Map(documents.map((d) => [d.id, d]));
  const bioDocs = setupDraft.biologyDocIds
    .map((id) => docById.get(id))
    .filter((d): d is SourceDocument => Boolean(d));
  const techDocs = setupDraft.technologyDocIds
    .map((id) => docById.get(id))
    .filter((d): d is SourceDocument => Boolean(d));
  const cachedSet = new Set(cachedDocIdsForCurrentDraft);

  const totalFigurePages = [...bioDocs, ...techDocs].reduce(
    (sum, d) => sum + d.stats.detectedFigurePages.length,
    0,
  );

  const creativityMeta = getCreativityLabel(setupDraft.creativityDistance);

  // Readiness check for API keys / proxy
  const missingProviders: ProviderId[] = [];
  if (settings.transportMode === 'direct-byok') {
    const neededRoles: Array<keyof typeof settings.defaultModelAssignments> = [
      'extraction',
      'crossing',
      'critic',
    ];
    if (setupDraft.includeDiagrams || setupDraft.pdfMathVisionMode !== 'off') {
      neededRoles.push('vision');
    }
    if (setupDraft.crossingStrategy === 'embedding-hybrid') {
      neededRoles.push('embedding');
    }

    const seenProviders = new Set<ProviderId>();
    for (const role of neededRoles) {
      const provider = settings.defaultModelAssignments[role].provider;
      if (seenProviders.has(provider)) continue;
      seenProviders.add(provider);
      if (provider !== 'custom') {
        const key = apiKeys[provider]?.apiKey?.trim();
        if (!key) {
          missingProviders.push(provider);
        }
      }
    }
  }
  const missingProxyUrl =
    settings.transportMode === 'managed-proxy' &&
    !settings.managedProxyUrl?.trim();

  const canStart =
    bioDocs.length > 0 &&
    techDocs.length > 0 &&
    missingProviders.length === 0 &&
    !missingProxyUrl &&
    !starting &&
    !ingestingFiles;

  const handleImportBundle = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      await importProjectBundleFile(text);
    } catch (err) {
      setLastError(
        err instanceof Error
          ? err.message
          : 'Die .biobridge.json-Datei konnte nicht importiert werden.',
      );
    }
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await startExperiment();
    } finally {
      setStarting(false);
    }
  };

  const visionModeOptions: Array<{
    id: PdfMathVisionMode;
    label: string;
  }> = [
    { id: 'auto', label: 'Automatisch' },
    { id: 'always', label: 'Immer' },
    { id: 'off', label: 'Aus' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Action & Title Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:flex-row lg:items-end lg:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div className="flex-1 space-y-1.5">
          <label
            htmlFor="experiment-name"
            className="block text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-300"
          >
            Experiment-Bezeichnung
          </label>
          <input
            id="experiment-name"
            type="text"
            value={setupDraft.name}
            onChange={(e) => setSetupDraft({ name: e.target.value })}
            placeholder="z. B. Ameisen-Schwarmverhalten × Serverarchitektur"
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={bundleInputRef}
            type="file"
            accept=".json,.biobridge.json,application/json"
            className="hidden"
            onChange={(e) => {
              void handleImportBundle(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => bundleInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <FolderUp className="h-3.5 w-3.5" />
            <span>.biobridge.json importieren</span>
          </button>
          <button
            type="button"
            onClick={() => void loadDemoExperiment()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 transition-colors hover:bg-indigo-100 dark:border-indigo-800/80 dark:bg-indigo-950/60 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Demo-Experiment laden</span>
          </button>
        </div>
      </div>

      {/* Main Split: Left Config & Dropzones, Right Sticky Pre-Flight Cost Card */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {/* Two Multi-File Dropzones */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <DomainDropzone
              domain="biology"
              title="Biologie-Quellen"
              subtitle="Sachbücher, Fachartikel oder Notizen zu biologischen Prinzipien."
              selectedDocs={bioDocs}
              allLibraryDocs={documents}
              cachedDocIds={cachedSet}
              ingestingFiles={ingestingFiles}
              onUploadFiles={async (files, d) => {
                await uploadFiles(files, d);
              }}
              onAddFromLibrary={addDocumentToDraft}
              onRemoveDoc={removeDocumentFromDraft}
            />
            <DomainDropzone
              domain="technology"
              title="Technik-Quellen"
              subtitle="Architektur-Dokumente, Patente oder Problembeschreibungen."
              selectedDocs={techDocs}
              allLibraryDocs={documents}
              cachedDocIds={cachedSet}
              ingestingFiles={ingestingFiles}
              onUploadFiles={async (files, d) => {
                await uploadFiles(files, d);
              }}
              onAddFromLibrary={addDocumentToDraft}
              onRemoveDoc={removeDocumentFromDraft}
            />
          </div>

          {/* Proactive Diagram Vision Hint */}
          {totalFigurePages > 0 && !setupDraft.includeDiagrams ? (
            <div className="flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center dark:border-amber-800/80 dark:bg-amber-950/60">
              <div className="flex items-start gap-2.5">
                <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                <p className="text-xs leading-relaxed text-amber-950 dark:text-amber-200">
                  <strong>
                    Wir haben {totalFigurePages} Seiten mit Diagrammen erkannt
                  </strong>{' '}
                  — Vision-Analyse aktivieren, damit auch Schemazeichnungen und
                  Abbildungen als Mechanismus-Quelle ausgelesen werden?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSetupDraft({ includeDiagrams: true })}
                className="shrink-0 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500"
              >
                Vision-Analyse aktivieren
              </button>
            </div>
          ) : null}

          {/* Vision & Formula Options */}
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Dokument- &amp; Formel-Analyse
            </h3>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <label
                    htmlFor="include-diagrams-switch"
                    className="text-xs font-medium text-slate-900 dark:text-slate-100"
                  >
                    Diagramme &amp; Abbildungen per Vision analysieren
                  </label>
                  <InfoPopover
                    title="Diagramm-Analyse (Vision)"
                    description="Rendert PDF-Seiten mit erkannten Grafiken als Bild und lässt eine multimodale KI beschriftete Skizzen, Funktionsprinzipien und Messgrößen extrahieren."
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Empfohlen bei reich illustrierten Biologie- oder Konstruktionsbüchern.
                </p>
              </div>
              <Switch.Root
                id="include-diagrams-switch"
                checked={setupDraft.includeDiagrams}
                onCheckedChange={(checked) =>
                  setSetupDraft({ includeDiagrams: checked })
                }
                className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full bg-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 data-[state=checked]:bg-indigo-600 dark:bg-slate-700 dark:data-[state=checked]:bg-indigo-500"
              >
                <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-xs transition-transform data-[state=checked]:translate-x-5.5" />
              </Switch.Root>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    PDF-Formel-Rekonstruktion (LaTeX)
                  </span>
                  <InfoPopover
                    title="PDF-Formel-Rekonstruktion"
                    description="PDFs verlieren beim reinen Text-Auslesen oft Brüche, Integrale oder griechische Symbole. Im Modus 'Automatisch' werden verdächtige Seiten per Vision sauber in LaTeX übersetzt."
                  />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Behebt zerschossene mathematische Gleichungen in PDF-Quellen.
                </p>
              </div>

              <div
                role="radiogroup"
                aria-label="PDF-Formel-Rekonstruktion"
                className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/70"
              >
                {visionModeOptions.map((opt) => {
                  const active = setupDraft.pdfMathVisionMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        setSetupDraft({ pdfMathVisionMode: opt.id })
                      }
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        active
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Crossing Strategy Cards */}
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Kreuzungs-Strategie
              </h3>
              <InfoPopover
                title="Wie findet BioBridge Analogien?"
                description="Beide Verfahren verbinden abstrahierte biologische Wirkprinzipien mit technischen Engpässen — unterscheiden sich aber in Skalierung und Suchbreite."
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  setSetupDraft({ crossingStrategy: 'embedding-hybrid' })
                }
                className={`rounded-xl border p-4 text-left transition-all ${
                  setupDraft.crossingStrategy === 'embedding-hybrid'
                    ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500 dark:border-indigo-500/80 dark:bg-indigo-950/40 dark:ring-indigo-500/80'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <Cpu className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    Embedding-Matching
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Schnell &amp; präzise
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  Berechnet Vektor-Ähnlichkeiten über abstrakte Funktionsbeschreibungen
                  und kreuzt gezielt die aussichtsreichsten Paare im gewählten
                  Distanzband.
                </p>
                <p className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <strong>Wann empfohlen?</strong> Bei umfangreichen
                  Sachbüchern, vielen Dokumenten und begrenztem Budget.
                </p>
              </button>

              <button
                type="button"
                onClick={() =>
                  setSetupDraft({ crossingStrategy: 'cluster-batch' })
                }
                className={`rounded-xl border p-4 text-left transition-all ${
                  setupDraft.crossingStrategy === 'cluster-batch'
                    ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500 dark:border-indigo-500/80 dark:bg-indigo-950/40 dark:ring-indigo-500/80'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    Thematisches Clustering
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Konzeptionell breit
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  Gruppiert Mechanismen und Probleme zunächst in funktionale
                  Themencluster und lässt die KI gezielt unerwartete
                  Cluster-Brücken schlagen.
                </p>
                <p className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <strong>Wann empfohlen?</strong> Wenn kein Embedding-Key
                  vorliegt oder Sie weite, unerwartete Themen-Brücken suchen.
                </p>
              </button>
            </div>
          </section>

          {/* Creativity & Search Parameters */}
          <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Suchbreite &amp; Ausgabe-Parameter
            </h3>

            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    Kreativitäts- / Analogie-Distanz:{' '}
                    {setupDraft.creativityDistance.toFixed(2)}
                  </span>
                  <InfoPopover
                    title="Analogie-Distanz"
                    description="Steuert, ob BioBridge eher naheliegende Funktions-Treffer ('Streng') oder weit entfernte Domänen-Sprünge ('Experimentell') vorschlägt."
                  />
                </div>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${creativityMeta.badgeClass}`}
                >
                  {creativityMeta.label}
                </span>
              </div>

              <Slider.Root
                value={[setupDraft.creativityDistance]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([val]) => {
                  if (val !== undefined) {
                    setSetupDraft({ creativityDistance: val });
                  }
                }}
                aria-label="Kreativitäts- und Distanz-Slider"
                className="relative flex h-5 w-full touch-none items-center select-none"
              >
                <Slider.Track className="relative h-2 grow overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <Slider.Range className="absolute h-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-amber-500" />
                </Slider.Track>
                <Slider.Thumb className="block h-5 w-5 rounded-full border-2 border-indigo-600 bg-white shadow-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-400 dark:bg-slate-100" />
              </Slider.Root>

              <div className="flex justify-between text-[11px] text-slate-400 dark:text-slate-500">
                <span>0,0 (Streng)</span>
                <span>0,5 (Ausgewogen)</span>
                <span>1,0 (Experimentell)</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {creativityMeta.hint}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-800">
              <div className="space-y-1.5">
                <label
                  htmlFor="max-candidates-input"
                  className="block text-xs font-medium text-slate-900 dark:text-slate-100"
                >
                  Maximale Kandidaten-Anzahl
                </label>
                <input
                  id="max-candidates-input"
                  type="number"
                  min={1}
                  max={100}
                  value={setupDraft.maxCandidates}
                  onChange={(e) => {
                    const next = Math.max(
                      1,
                      Math.min(100, Number(e.target.value) || 1),
                    );
                    setSetupDraft({ maxCandidates: next });
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Jeder Kandidat wird anschließend vom Advocatus Diaboli geprüft.
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="output-language-select"
                  className="block text-xs font-medium text-slate-900 dark:text-slate-100"
                >
                  Ausgabesprache der Ergebnisse
                </label>
                <select
                  id="output-language-select"
                  value={setupDraft.outputLanguage}
                  onChange={(e) =>
                    setSetupDraft({ outputLanguage: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                >
                  {LANGUAGE_OPTIONS.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Originalzitate bleiben immer unverändert in der Quellsprache.
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* Right Sticky Pre-Flight Cost Card */}
        <aside className="lg:col-span-4">
          <div className="sticky top-28 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FlaskConical className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Pre-Flight-Kostenschätzung
                </h3>
              </div>
              <InfoPopover
                title="Kosten-Vorschau"
                description="Berechnet anhand der realen Dokument-Token, bereits gecachter Wissensbasen, Vision-Seiten, gewählter Modelle und einem +20 % Puffer für Zitat-Selbstkorrektur."
              />
            </div>

            {liveCostEstimate ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    Erwartete Gesamtkosten
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {formatUsd(liveCostEstimate.total.expectedUsd)}
                    </span>
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      (
                      {formatEur(
                        liveCostEstimate.total.expectedUsd,
                        liveCostEstimate.usdToEurRate,
                      )}
                      )
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                    <span>Min: {formatUsd(liveCostEstimate.total.minUsd)}</span>
                    <span>Max: {formatUsd(liveCostEstimate.total.maxUsd)}</span>
                  </div>
                </div>

                {liveCostEstimate.cachedDocumentIds.length > 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <DatabaseZap className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                    <span>
                      <strong>
                        {liveCostEstimate.cachedDocumentIds.length} Dokument(e)
                        aus Cache:
                      </strong>{' '}
                      Extraktion kostet 0 Tokens / $0,00.
                    </span>
                  </div>
                ) : null}

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                    <span>
                      Phase 1: Vision ({liveCostEstimate.visionPageCount} S.)
                    </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {formatUsd(liveCostEstimate.phase1Vision.expectedUsd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                    <span>Phase 2: Blinde Extraktion</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {formatUsd(liveCostEstimate.phase2Extract.expectedUsd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                    <span>Phase 3: Bionische Kreuzung</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {formatUsd(liveCostEstimate.phase3Cross.expectedUsd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                    <span>Phase 4: Advocatus Diaboli</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {formatUsd(liveCostEstimate.phase4Critic.expectedUsd)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    Geschätzte Laufzeit
                  </span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {formatDuration(
                      liveCostEstimate.estimatedDurationSec.min,
                      liveCostEstimate.estimatedDurationSec.max,
                    )}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
              <label
                htmlFor="budget-limit-input"
                className="flex items-center justify-between text-xs font-medium text-slate-900 dark:text-slate-100"
              >
                <span>Hartes Budget-Limit (USD)</span>
                <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                  Optional
                </span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs font-semibold text-slate-400 dark:text-slate-500">
                  $
                </span>
                <input
                  id="budget-limit-input"
                  type="number"
                  step="0.25"
                  min={0}
                  value={setupDraft.budgetLimitUsd ?? ''}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    setSetupDraft({
                      budgetLimitUsd:
                        val === '' ? undefined : Math.max(0.01, Number(val)),
                    });
                  }}
                  placeholder="z. B. 2.50"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-7 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Pausiert den Lauf automatisch mit Checkpoint, falls das Limit
                erreicht wird.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
              <span>Preisliste Stand: {PRICING_CATALOG_UPDATED_AT}</span>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className="font-semibold text-indigo-700 hover:underline dark:text-indigo-400"
              >
                Preise &amp; Modelle
              </button>
            </div>

            {/* Readiness warnings */}
            {bioDocs.length === 0 || techDocs.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                Bitte laden Sie mindestens ein <strong>Biologie-</strong> und ein{' '}
                <strong>Technik-Dokument</strong> hoch.
              </div>
            ) : missingProxyUrl ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                  <div>
                    <p>
                      Für den Modus <strong>Managed Proxy (Option B)</strong>{' '}
                      fehlt noch die Proxy-URL.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('settings')}
                      className="mt-1 font-semibold text-amber-900 underline dark:text-amber-200"
                    >
                      In Einstellungen konfigurieren
                    </button>
                  </div>
                </div>
              </div>
            ) : missingProviders.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                  <div>
                    <p>
                      Fehlender API-Key für:{' '}
                      <strong>
                        {missingProviders
                          .map((p) => PROVIDER_NAMES[p])
                          .join(', ')}
                      </strong>
                      .
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('settings')}
                      className="mt-1 font-semibold text-amber-900 underline dark:text-amber-200"
                    >
                      API-Keys in Einstellungen hinterlegen
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <button
              type="button"
              disabled={!canStart}
              onClick={() => void handleStart()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-indigo-600 dark:hover:bg-indigo-500 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span>Kreuzungs-Experiment starten</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
