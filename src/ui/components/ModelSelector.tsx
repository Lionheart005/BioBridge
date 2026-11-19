import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import {
  DEFAULT_MODEL_PRICING_CATALOG,
  MODEL_PRESETS,
  type PricingOverrideMap,
  getModelPricing,
} from '@/estimation';
import type {
  ModelAssignment,
  ModelAssignments,
  ModelRole,
  ProviderId,
  ReasoningEffort,
} from '@/core/schemas';
import { InfoPopover } from './InfoPopover';

export interface ModelSelectorProps {
  value: ModelAssignments;
  onChange: (next: ModelAssignments) => void;
  pricingOverrides?: PricingOverrideMap;
  className?: string;
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  custom: 'Custom / Ollama (Lokal)',
};

const REASONING_EFFORT_OPTIONS: Array<{
  value: '' | ReasoningEffort;
  label: string;
}> = [
  { value: '', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'extreme', label: 'Extreme' },
];

const ROLE_META: Array<{
  role: ModelRole;
  label: string;
  hint: string;
  allowedProviders: ProviderId[];
}> = [
  {
    role: 'extraction',
    label: '1. Fakten-Extraktion',
    hint: 'Liest Biologie- und Technik-Dokumente unabhängig voneinander und extrahiert strukturierte Mechanismen & Probleme mit wörtlichen Belegen.',
    allowedProviders: [
      'gemini',
      'openai',
      'anthropic',
      'deepseek',
      'openrouter',
      'custom',
    ],
  },
  {
    role: 'vision',
    label: '2. Diagramm- & Formel-Vision',
    hint: 'Analysiert erkannte Abbildungen und schwer lesbare PDF-Formeln visuell und rekonstruiert sie als Text und LaTeX.',
    allowedProviders: ['gemini', 'openai', 'anthropic', 'openrouter', 'custom'],
  },
  {
    role: 'embedding',
    label: '3. Semantisches Embedding',
    hint: 'Berechnet Vektor-Ähnlichkeiten für das schnelle Embedding-Matching zwischen biologischen Prinzipien und technischen Engpässen.',
    allowedProviders: ['gemini', 'openai', 'openrouter', 'custom'],
  },
  {
    role: 'crossing',
    label: '4. Bionische Kreuzung',
    hint: 'Entwirft die abstrakte Übertragungslogik zwischen Biologie und Technik sowie konkrete Implementierungsskizzen.',
    allowedProviders: [
      'gemini',
      'openai',
      'anthropic',
      'deepseek',
      'openrouter',
      'custom',
    ],
  },
  {
    role: 'critic',
    label: '5. Advocatus Diaboli (Gutachter)',
    hint: 'Prüft jeden Vorschlag gnadenlos auf Skalenbrüche, Beleglücken, reine Metaphern und bekannten Stand der Technik.',
    allowedProviders: [
      'gemini',
      'openai',
      'anthropic',
      'deepseek',
      'openrouter',
      'custom',
    ],
  },
];

function assignmentsMatch(a: ModelAssignments, b: ModelAssignments): boolean {
  const roles: ModelRole[] = [
    'extraction',
    'vision',
    'embedding',
    'crossing',
    'critic',
  ];
  return roles.every(
    (r) =>
      a[r].provider === b[r].provider &&
      a[r].modelId === b[r].modelId &&
      (a[r].reasoningEffort ?? undefined) ===
        (b[r].reasoningEffort ?? undefined),
  );
}

function getCatalogModelsForRole(
  provider: ProviderId,
  role: ModelRole,
) {
  return DEFAULT_MODEL_PRICING_CATALOG.filter((entry) => {
    if (entry.provider !== provider) {
      return false;
    }
    if (role === 'embedding') {
      return Boolean(entry.supportsEmbeddings) || provider === 'openrouter' || provider === 'custom';
    }
    if (role === 'vision') {
      return entry.supportsVision !== false;
    }
    return !entry.supportsEmbeddings || provider === 'custom';
  });
}

export function ModelSelector({
  value,
  onChange,
  pricingOverrides,
  className = '',
}: ModelSelectorProps) {
  const presetList = Object.values(MODEL_PRESETS);

  const updateRole = (role: ModelRole, patch: Partial<ModelAssignment>) => {
    onChange({
      ...value,
      [role]: {
        ...value[role],
        ...patch,
      },
    });
  };

  const handleProviderChange = (role: ModelRole, provider: ProviderId) => {
    const candidates = getCatalogModelsForRole(provider, role);
    const defaultModel =
      candidates[0]?.modelId ??
      (provider === 'custom'
        ? role === 'embedding'
          ? 'nomic-embed-text'
          : 'llama3.1'
        : provider === 'openrouter'
          ? 'google/gemini-4-hydrogen'
          : provider === 'deepseek'
            ? 'deepseek-v4-pro'
            : '');
    updateRole(role, { provider, modelId: defaultModel });
  };

  const crossModelActive =
    value.critic.provider !== value.crossing.provider;

  return (
    <div className={`space-y-5 ${className}`}>
      <div>
        <div className="mb-2 flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Schnellauswahl (Modell-Profile)
          </h3>
          <InfoPopover
            title="Modell-Profile"
            description="Jeder Schritt in BioBridge kann ein anderes KI-Modell nutzen. Mit diesen drei Profilen wählen Sie mit einem Klick die Balance aus Kosten und Analysetiefe."
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {presetList.map((preset) => {
            const isSelected = assignmentsMatch(value, preset.assignments);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange(preset.assignments)}
                className={`rounded-xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500 dark:border-indigo-500/80 dark:bg-indigo-950/50 dark:ring-indigo-500/80'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {preset.label}
                  </span>
                  {preset.id === 'deep-cross-model' ? (
                    <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {preset.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Rollen-Zuweisung im Detail
        </h3>
        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {ROLE_META.map((meta) => {
            const assignment = value[meta.role];
            const catalogModels = getCatalogModelsForRole(
              assignment.provider,
              meta.role,
            );
            const isInCatalog = catalogModels.some(
              (m) => m.modelId === assignment.modelId,
            );
            const showFreeText =
              assignment.provider === 'openrouter' ||
              assignment.provider === 'custom' ||
              !isInCatalog;
            const pricing = getModelPricing(
              assignment.provider,
              assignment.modelId,
              pricingOverrides,
            );

            return (
              <div key={meta.role} className="p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-md space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {meta.label}
                      </span>
                      <InfoPopover title={meta.label} description={meta.hint} />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {meta.role === 'embedding'
                        ? `Preis: $${(pricing.embeddingPer1MUsd ?? pricing.inputPer1MUsd).toFixed(3)} / 1M Tokens`
                        : `Preis: $${pricing.inputPer1MUsd.toFixed(2)} In / $${pricing.outputPer1MUsd.toFixed(2)} Out pro 1M Tokens`}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <select
                      aria-label={`${meta.label} Anbieter`}
                      value={assignment.provider}
                      onChange={(e) =>
                        handleProviderChange(
                          meta.role,
                          e.target.value as ProviderId,
                        )
                      }
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {meta.allowedProviders.map((pid) => (
                        <option key={pid} value={pid}>
                          {PROVIDER_LABELS[pid]}
                        </option>
                      ))}
                    </select>

                    {catalogModels.length > 0 ? (
                      <select
                        aria-label={`${meta.label} Modellauswahl`}
                        value={isInCatalog ? assignment.modelId : '__custom__'}
                        onChange={(e) => {
                          const nextVal = e.target.value;
                          if (nextVal !== '__custom__') {
                            updateRole(meta.role, { modelId: nextVal });
                          } else {
                            updateRole(meta.role, { modelId: '' });
                          }
                        }}
                        className="min-w-52 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        {catalogModels.map((model) => (
                          <option key={model.modelId} value={model.modelId}>
                            {model.displayName}
                          </option>
                        ))}
                        <option value="__custom__">
                          Freie Modell-ID eingeben…
                        </option>
                      </select>
                    ) : null}

                    {showFreeText ? (
                      <input
                        type="text"
                        aria-label={`${meta.label} freie Modell-ID`}
                        value={assignment.modelId}
                        onChange={(e) =>
                          updateRole(meta.role, { modelId: e.target.value })
                        }
                        placeholder={
                          assignment.provider === 'openrouter'
                            ? 'z. B. anthropic/claude-opus-5-5'
                            : assignment.provider === 'custom'
                              ? 'z. B. llama3.1:70b'
                              : 'z. B. deepseek-v4-pro'
                        }
                        className="min-w-52 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    ) : null}

                    {meta.role !== 'embedding' ? (
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <span className="shrink-0 font-medium">Denktiefe:</span>
                        <select
                          aria-label={`${meta.label} Denktiefe`}
                          value={assignment.reasoningEffort ?? ''}
                          onChange={(e) => {
                            const nextEffort = e.target.value;
                            updateRole(meta.role, {
                              reasoningEffort: nextEffort
                                ? (nextEffort as ReasoningEffort)
                                : undefined,
                            });
                          }}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        >
                          {REASONING_EFFORT_OPTIONS.map((opt) => (
                            <option key={opt.value || 'auto'} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                </div>

                {meta.role === 'critic' ? (
                  <div
                    className={`mt-2.5 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                      crossModelActive
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/60 dark:text-amber-300'
                    }`}
                  >
                    {crossModelActive ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                        <span>
                          <strong>Cross-Model aktiv:</strong> Der Gutachter (
                          {PROVIDER_LABELS[value.critic.provider]}) stammt aus
                          einer anderen Modellfamilie als die Kreuzungs-KI (
                          {PROVIDER_LABELS[value.crossing.provider]}). Das
                          reduziert Bestätigungsfehler.
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                        <span>
                          <strong>Cross-Model-Empfehlung:</strong> Kreuzung und
                          Advocatus Diaboli nutzen denselben Anbieter (
                          {PROVIDER_LABELS[value.critic.provider]}). Für
                          objektivere Kritik empfehlen wir für den Gutachter
                          einen anderen Anbieter (z. B. OpenAI, Anthropic oder
                          DeepSeek).
                        </span>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
