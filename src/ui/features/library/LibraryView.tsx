import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  DatabaseZap,
  FileText,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type {
  Domain,
  ExtractedMechanism,
  ExtractedProblem,
  ExtractionCacheRecord,
  SourceDocument,
} from '@/core/schemas';
import { useAppStore } from '@/state/appStore';
import { CitationBadge } from '@/ui/components/CitationBadge';
import { MathText } from '@/ui/components/MathText';

type DomainFilter = 'all' | Domain;

function getCachesForDocument(
  doc: SourceDocument,
  caches: ExtractionCacheRecord[],
): ExtractionCacheRecord[] {
  return caches.filter(
    (c) =>
      c.documentId === doc.id ||
      (c.contentHash === doc.contentHash && c.domain === doc.domain),
  );
}

function MechanismCard({ mech }: { mech: ExtractedMechanism }) {
  return (
    <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 dark:border-emerald-800/80 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            {mech.biologicalSystem}
          </span>
          <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            {mech.title}
          </h4>
        </div>
      </div>
      <div className="text-xs">
        <MathText content={mech.workingPrinciple} />
      </div>
      <div className="rounded-lg border border-emerald-100 bg-white/80 p-2.5 text-[11px] text-slate-700 dark:border-emerald-900/60 dark:bg-slate-900/70 dark:text-slate-300">
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          Wirkung:{' '}
        </span>
        <MathText
          content={mech.achievedEffect}
          className="inline text-[11px]"
        />
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
        <span className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          Raum: {mech.boundaryConditions.spatialScale || '—'}
        </span>
        <span className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          Zeit: {mech.boundaryConditions.timeScale || '—'}
        </span>
        <span className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          Medium: {mech.boundaryConditions.medium || '—'}
        </span>
      </div>
      {mech.citations.length > 0 ? (
        <div className="space-y-1.5 border-t border-emerald-200/60 pt-2 dark:border-emerald-800/60">
          {mech.citations.map((cit) => (
            <div
              key={cit.id}
              className="rounded-lg border border-slate-200 bg-white p-2 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-600 dark:text-slate-400">
                  S. {cit.pageNumber}
                  {cit.sectionPath ? ` • ${cit.sectionPath}` : ''}
                </span>
                <CitationBadge verification={cit.verification} />
              </div>
              <p className="text-slate-700 italic dark:text-slate-300">
                „{cit.quoteOriginal}“
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProblemCard({ prob }: { prob: ExtractedProblem }) {
  return (
    <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3.5 dark:border-indigo-800/80 dark:bg-indigo-950/30">
      <div>
        <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
          {prob.technicalDomain}
        </span>
        <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
          {prob.title}
        </h4>
      </div>
      <div className="text-xs">
        <MathText content={prob.problemStatement} />
      </div>
      <div className="rounded-lg border border-indigo-100 bg-white/80 p-2.5 text-[11px] text-slate-700 dark:border-indigo-900/60 dark:bg-slate-900/70 dark:text-slate-300">
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          Kern-Engpass:{' '}
        </span>
        <MathText
          content={prob.coreBottleneck}
          className="inline text-[11px]"
        />
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
        <span className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          Raum: {prob.boundaryConditions.spatialScale || '—'}
        </span>
        <span className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          Zeit: {prob.boundaryConditions.timeScale || '—'}
        </span>
        <span className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
          Ziel: {prob.targetMetrics || '—'}
        </span>
      </div>
      {prob.citations.length > 0 ? (
        <div className="space-y-1.5 border-t border-indigo-200/60 pt-2 dark:border-indigo-800/60">
          {prob.citations.map((cit) => (
            <div
              key={cit.id}
              className="rounded-lg border border-slate-200 bg-white p-2 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-600 dark:text-slate-400">
                  S. {cit.pageNumber}
                  {cit.sectionPath ? ` • ${cit.sectionPath}` : ''}
                </span>
                <CitationBadge verification={cit.verification} />
              </div>
              <p className="text-slate-700 italic dark:text-slate-300">
                „{cit.quoteOriginal}“
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LibraryView() {
  const documents = useAppStore((s) => s.documents);
  const extractionCaches = useAppStore((s) => s.extractionCaches);
  const setupDraft = useAppStore((s) => s.setupDraft);
  const addDocumentToDraft = useAppStore((s) => s.addDocumentToDraft);
  const removeDocumentFromDraft = useAppStore((s) => s.removeDocumentFromDraft);
  const deleteDocument = useAppStore((s) => s.deleteDocument);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  const [filter, setFilter] = useState<DomainFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDocIds, setExpandedDocIds] = useState<Record<string, boolean>>(
    {},
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const selectedBio = new Set(setupDraft.biologyDocIds);
  const selectedTech = new Set(setupDraft.technologyDocIds);

  const filteredDocs = documents.filter((doc) => {
    if (filter !== 'all' && doc.domain !== filter) {
      return false;
    }
    if (
      searchQuery.trim() &&
      !doc.fileName.toLowerCase().includes(searchQuery.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const toggleExpanded = (docId: string) => {
    setExpandedDocIds((prev) => ({
      ...prev,
      [docId]: !prev[docId],
    }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Lokale Wissensbibliothek
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Alle hochgeladenen Sachbücher, Fachartikel und zwischengespeicherten
            Wissensextraktionen (IndexedDB).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Dokument suchen…"
              className="rounded-lg border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs dark:border-slate-700 dark:bg-slate-800/70">
            {(
              [
                { id: 'all', label: 'Alle' },
                { id: 'biology', label: 'Biologie' },
                { id: 'technology', label: 'Technik' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  filter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredDocs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <BookOpen className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-500" />
          <h2 className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Keine Dokumente gefunden
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Laden Sie im Bereich „Setup &amp; Upload“ Dokumente hoch oder laden
            Sie das Demo-Experiment.
          </p>
          <button
            type="button"
            onClick={() => setActiveTab('setup')}
            className="mt-4 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
          >
            Zum Setup &amp; Upload
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDocs.map((doc) => {
            const isBio = doc.domain === 'biology';
            const isInDraft = isBio
              ? selectedBio.has(doc.id)
              : selectedTech.has(doc.id);
            const docCaches = getCachesForDocument(doc, extractionCaches);
            const latestCache = docCaches[0];
            const mechanisms = latestCache?.mechanisms ?? [];
            const problems = latestCache?.problems ?? [];
            const extractedCount = mechanisms.length + problems.length;
            const expanded = Boolean(expandedDocIds[doc.id]);

            return (
              <article
                key={doc.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                        isBio
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/80 dark:bg-indigo-950/60 dark:text-indigo-300'
                      }`}
                    >
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isBio
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                              : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300'
                          }`}
                        >
                          {isBio ? 'Biologie' : 'Technik'}
                        </span>
                        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {doc.fileName}
                        </h3>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="uppercase">{doc.format}</span>
                        <span>•</span>
                        <span>{doc.pageCount} Seiten</span>
                        <span>•</span>
                        <span>
                          {doc.stats.estimatedTokens.toLocaleString('de-DE')}{' '}
                          Tokens
                        </span>
                        <span>•</span>
                        <span>Sprache: {doc.detectedLanguage.toUpperCase()}</span>
                        {extractedCount > 0 ? (
                          <>
                            <span>•</span>
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                              <DatabaseZap className="h-3.5 w-3.5" />
                              {extractedCount}{' '}
                              {isBio ? 'Mechanismen' : 'Probleme'} gecacht
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {extractedCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(doc.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        <span>Wissensbasis ({extractedCount})</span>
                      </button>
                    ) : null}

                    {isInDraft ? (
                      <button
                        type="button"
                        onClick={() =>
                          removeDocumentFromDraft(doc.id, doc.domain)
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Im aktuellen Experiment</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addDocumentToDraft(doc.id, doc.domain)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>In Experiment übernehmen</span>
                      </button>
                    )}

                    {confirmDeleteId === doc.id ? (
                      <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 dark:border-rose-800/80 dark:bg-rose-950/60">
                        <span className="text-[11px] font-medium text-rose-800 dark:text-rose-200">
                          Wirklich löschen?
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            void deleteDocument(doc.id);
                            setConfirmDeleteId(null);
                          }}
                          className="rounded bg-rose-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500"
                        >
                          Ja
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Nein
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`${doc.fileName} löschen`}
                        onClick={() => setConfirmDeleteId(doc.id)}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:text-slate-500 dark:hover:border-rose-800 dark:hover:bg-rose-950/60 dark:hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {expanded && extractedCount > 0 ? (
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        Aus Cache ({latestCache.outputLanguage.toUpperCase()},{' '}
                        {new Date(latestCache.createdAt).toLocaleDateString(
                          'de-DE',
                        )}
                        )
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {mechanisms.map((mech) => (
                        <MechanismCard key={mech.id} mech={mech} />
                      ))}
                      {problems.map((prob) => (
                        <ProblemCard key={prob.id} prob={prob} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
