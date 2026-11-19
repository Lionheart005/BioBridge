import {
  CheckCircle2,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import type {
  BioBridgeProjectBundle,
  CriticReview,
  CrossingCandidate,
  ExperimentRun,
  ExtractedMechanism,
  ExtractedProblem,
  SourceDocument,
} from '@/core/schemas';
import { useAppStore } from '@/state/appStore';
import {
  exportExperimentToCsv,
  exportExperimentToMarkdown,
  exportProjectBundle,
  getPagesForDocument,
  serializeProjectBundle,
} from '@/storage';

export interface ExportMenuProps {
  experiment: ExperimentRun | null;
  documents: SourceDocument[];
  mechanisms: ExtractedMechanism[];
  problems: ExtractedProblem[];
  candidates: CrossingCandidate[];
  reviews: CriticReview[];
}

type ExportFormat = 'md' | 'csv' | 'json';

function slugifyFileName(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'experiment';
}

function formatDateIsoDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function triggerFileDownload(
  content: string,
  mimeType: string,
  filename: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ExportMenu({
  experiment,
  documents,
  mechanisms,
  problems,
  candidates,
  reviews,
}: ExportMenuProps) {
  const importProjectBundleFile = useAppStore((s) => s.importProjectBundleFile);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  async function buildValidatedBundle(
    activeExperiment: ExperimentRun,
  ): Promise<BioBridgeProjectBundle> {
    const expDocIds = new Set<string>([
      ...activeExperiment.biologyDocIds,
      ...activeExperiment.technologyDocIds,
    ]);

    const usedMechanismIds = new Set(candidates.map((c) => c.mechanismId));
    const usedProblemIds = new Set(candidates.map((c) => c.problemId));

    const scopedMechanisms = mechanisms.filter(
      (m) =>
        usedMechanismIds.has(m.id) ||
        m.sourceDocumentIds.some((docId) => expDocIds.has(docId)),
    );
    const scopedProblems = problems.filter(
      (p) =>
        usedProblemIds.has(p.id) ||
        p.sourceDocumentIds.some((docId) => expDocIds.has(docId)),
    );

    for (const mech of scopedMechanisms) {
      for (const docId of mech.sourceDocumentIds) {
        expDocIds.add(docId);
      }
    }
    for (const prob of scopedProblems) {
      for (const docId of prob.sourceDocumentIds) {
        expDocIds.add(docId);
      }
    }

    const scopedDocuments = documents.filter((doc) => expDocIds.has(doc.id));
    const docIdsToLoad = Array.from(
      new Set([
        ...expDocIds,
        ...scopedDocuments.map((d) => d.id),
      ]),
    );

    const pagesPerDoc = await Promise.all(
      docIdsToLoad.map((docId) => getPagesForDocument(docId)),
    );
    const parsedPages = pagesPerDoc.flat();

    return exportProjectBundle({
      experiment: activeExperiment,
      documents: scopedDocuments,
      parsedPages,
      mechanisms: scopedMechanisms,
      problems: scopedProblems,
      candidates,
      reviews,
    });
  }

  async function handleExport(format: ExportFormat) {
    if (!experiment) {
      return;
    }

    setExportingFormat(format);
    setFeedback(null);

    try {
      const bundle = await buildValidatedBundle(experiment);
      const baseName = `biobridge-${slugifyFileName(experiment.name)}-${formatDateIsoDay()}`;

      if (format === 'md') {
        const markdown = exportExperimentToMarkdown(bundle);
        triggerFileDownload(
          markdown,
          'text/markdown;charset=utf-8',
          `${baseName}.md`,
        );
        setFeedback({
          type: 'success',
          message: `Markdown-Bericht (${baseName}.md) heruntergeladen.`,
        });
      } else if (format === 'csv') {
        const csv = exportExperimentToCsv(bundle);
        triggerFileDownload(
          csv,
          'text/csv;charset=utf-8',
          `${baseName}.csv`,
        );
        setFeedback({
          type: 'success',
          message: `CSV-Tabelle (${baseName}.csv) heruntergeladen.`,
        });
      } else {
        const json = serializeProjectBundle(bundle);
        triggerFileDownload(
          json,
          'application/json;charset=utf-8',
          `${baseName}.biobridge.json`,
        );
        setFeedback({
          type: 'success',
          message: `Projektpaket (${baseName}.biobridge.json) heruntergeladen.`,
        });
      }
    } catch (error) {
      setFeedback({
        type: 'error',
        message:
          error instanceof Error
            ? `Export fehlgeschlagen: ${error.message}`
            : 'Export fehlgeschlagen.',
      });
    } finally {
      setExportingFormat(null);
    }
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setImporting(true);
    setFeedback(null);

    try {
      const jsonText = await file.text();
      await importProjectBundleFile(jsonText);
      setFeedback({
        type: 'success',
        message: `Projektpaket „${file.name}“ erfolgreich importiert.`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        message:
          error instanceof Error
            ? `Import fehlgeschlagen: ${error.message}`
            : 'Ungültiges BioBridge-Projektpaket.',
      });
    } finally {
      setImporting(false);
    }
  }

  const exportDisabled = !experiment || exportingFormat !== null;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void handleExport('md')}
          disabled={exportDisabled}
          title="Vollständigen Forschungsbericht mit LaTeX-Formeln & Originalzitaten als Markdown herunterladen"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {exportingFormat === 'md' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          )}
          <span>Markdown (.md)</span>
        </button>

        <button
          type="button"
          onClick={() => void handleExport('csv')}
          disabled={exportDisabled}
          title="Bewertungsmatrix als UTF-8-CSV-Tabelle für Excel/Calc herunterladen"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {exportingFormat === 'csv' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
          <span>CSV (.csv)</span>
        </button>

        <button
          type="button"
          onClick={() => void handleExport('json')}
          disabled={exportDisabled}
          title="Reproduzierbares BioBridge-Projektpaket inkl. Quelldokumenten, Zitaten und Reviews herunterladen"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {exportingFormat === 'json' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileJson className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          )}
          <span>Paket (.biobridge.json)</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.biobridge.json,application/json"
          aria-label="Projektpaket (.biobridge.json) importieren"
          onChange={(e) => void handleImportFileChange(e)}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-800 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800/80 dark:bg-indigo-950/60 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
        >
          {importing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          <span>Importieren (.biobridge.json)</span>
        </button>
      </div>

      {feedback ? (
        <div
          role="status"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
          )}
          <span>{feedback.message}</span>
        </div>
      ) : null}
    </div>
  );
}
