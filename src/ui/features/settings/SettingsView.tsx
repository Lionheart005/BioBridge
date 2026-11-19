import * as Tabs from '@radix-ui/react-tabs';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PlugZap,
  RotateCcw,
  Server,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import type { ConnectionTestResult } from '@/ai';
import type { ProviderId } from '@/core/schemas';
import {
  DEFAULT_MODEL_PRICING_CATALOG,
  DEFAULT_USD_TO_EUR_RATE,
  PRICING_CATALOG_UPDATED_AT,
  getModelPricing,
} from '@/estimation';
import { useAppStore } from '@/state/appStore';
import { InfoPopover } from '@/ui/components/InfoPopover';
import { ModelSelector } from '@/ui/components/ModelSelector';
import { PromptWorkshop } from './PromptWorkshop';

interface ProviderCardConfig {
  id: ProviderId;
  name: string;
  keyPlaceholder: string;
  defaultTestModel: string;
  supportsBaseUrl?: boolean;
  defaultBaseUrl?: string;
  corsHint?: string;
}

const PROVIDER_CARDS: ProviderCardConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    keyPlaceholder: 'AIza…',
    defaultTestModel: 'gemini-4-hydrogen',
    corsHint:
      'Google AI Studio Key (AIza…). Falls ein Gemini-4-Preview-Modell auf Ihrem Account noch nicht freigeschaltet ist, wählen Sie darunter z. B. Gemini 3.8 Flash oder Gemini 2.5 Flash.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyPlaceholder: 'sk-…',
    defaultTestModel: 'gpt-6-luna',
    supportsBaseUrl: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    keyPlaceholder: 'sk-ant-…',
    defaultTestModel: 'claude-sonnet-5-5',
    corsHint:
      'Browser-Direktzugriff erfordert den CORS-Header "anthropic-dangerous-direct-browser-access". Alternativ nutzen Sie OpenRouter.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    keyPlaceholder: 'sk-…',
    defaultTestModel: 'deepseek-flash',
    supportsBaseUrl: true,
    defaultBaseUrl: 'https://api.deepseek.com/v1',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyPlaceholder: 'sk-or-v1-…',
    defaultTestModel: 'google/gemini-4-hydrogen',
    supportsBaseUrl: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'custom',
    name: 'Custom / Lokales Ollama',
    keyPlaceholder: 'Optional (bei Ollama oft leer oder "ollama")',
    defaultTestModel: 'llama3.1',
    supportsBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434/v1',
    corsHint:
      'Für lokales Ollama im Browser muss beim Start OLLAMA_ORIGINS="*" (bzw. Ihre App-Origin) gesetzt sein.',
  },
];

function renderConnectionErrorHint(res: ConnectionTestResult): string {
  switch (res.errorKind) {
    case 'AUTH_401':
      return 'Ungültiger oder abgelaufener API-Key (401/403). Bitte Key prüfen.';
    case 'CORS_BLOCKED':
      return 'Anfrage vom Browser blockiert (CORS). Prüfen Sie die CORS-Hinweise, Basis-URL oder nutzen Sie OpenRouter / Option B.';
    case 'RATE_LIMIT_429':
      return 'Rate-Limit oder Kontingent erschöpft (HTTP 429). Bitte kurz warten oder Tarif prüfen.';
    case 'NETWORK_ERROR':
      return 'Netzwerkfehler — Endpunkt nicht erreichbar. URL und Internetverbindung prüfen.';
    default:
      return res.message;
  }
}

export function SettingsView() {
  const settings = useAppStore((s) => s.settings);
  const apiKeys = useAppStore((s) => s.apiKeys);
  const setProviderCredentials = useAppStore((s) => s.setProviderCredentials);
  const switchKeyStorageMode = useAppStore((s) => s.switchKeyStorageMode);
  const clearAllApiKeys = useAppStore((s) => s.clearAllApiKeys);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const testProviderConnection = useAppStore((s) => s.testProviderConnection);

  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [testingProvider, setTestingProvider] = useState<ProviderId | null>(
    null,
  );
  const [testResults, setTestResults] = useState<
    Partial<Record<ProviderId, ConnectionTestResult>>
  >({});

  const handleTestConnection = async (cfg: ProviderCardConfig) => {
    setTestingProvider(cfg.id);
    try {
      const assignedModel = Object.values(settings.defaultModelAssignments).find(
        (a) => a.provider === cfg.id,
      )?.modelId;
      const modelId = assignedModel?.trim() || cfg.defaultTestModel;
      const res = await testProviderConnection(cfg.id, modelId);
      setTestResults((prev) => ({ ...prev, [cfg.id]: res }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [cfg.id]: {
          ok: false,
          errorKind: 'NETWORK_ERROR',
          message:
            err instanceof Error
              ? err.message
              : 'Verbindungstest fehlgeschlagen.',
        },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  const handlePricingCellChange = (
    provider: ProviderId,
    modelId: string,
    field:
      | 'inputPer1MUsd'
      | 'outputPer1MUsd'
      | 'embeddingPer1MUsd'
      | 'visionPerImageUsd',
    rawValue: string,
  ) => {
    const num = Math.max(0, Number(rawValue) || 0);
    const key = `${provider}:${modelId}`;
    const current = getModelPricing(
      provider,
      modelId,
      settings.pricingOverrides,
    );
    const nextEntry = {
      inputPer1MUsd: current.inputPer1MUsd,
      outputPer1MUsd: current.outputPer1MUsd,
      ...(current.embeddingPer1MUsd !== undefined
        ? { embeddingPer1MUsd: current.embeddingPer1MUsd }
        : {}),
      ...(current.visionPerImageUsd !== undefined
        ? { visionPerImageUsd: current.visionPerImageUsd }
        : {}),
      [field]: num,
    };

    void updateSettings({
      pricingOverrides: {
        ...settings.pricingOverrides,
        [key]: nextEntry,
      },
    });
  };

  return (
    <Tabs.Root defaultValue="keys-models" className="space-y-5">
      <Tabs.List
        aria-label="Einstellungs-Bereiche"
        className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        <Tabs.Trigger
          value="keys-models"
          className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:data-[state=active]:bg-indigo-600 dark:data-[state=active]:text-white"
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span>1. API-Keys &amp; Modelle</span>
        </Tabs.Trigger>
        <Tabs.Trigger
          value="prompts"
          className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:data-[state=active]:bg-indigo-600 dark:data-[state=active]:text-white"
        >
          <Wrench className="h-3.5 w-3.5" />
          <span>2. Prompt-Werkstatt</span>
        </Tabs.Trigger>
        <Tabs.Trigger
          value="pricing-proxy"
          className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:data-[state=active]:bg-indigo-600 dark:data-[state=active]:text-white"
        >
          <Server className="h-3.5 w-3.5" />
          <span>3. Preisliste &amp; Option B</span>
        </Tabs.Trigger>
      </Tabs.List>

      {/* Tab 1: API Keys & Models */}
      <Tabs.Content value="keys-models" className="space-y-6">
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  API-Key-Speicher (Lokal im Browser)
                </h2>
                <InfoPopover
                  title="Sicherheit Ihrer API-Keys"
                  description="Ihre Schlüssel werden niemals in IndexedDB oder auf fremden BioBridge-Servern gespeichert. Sie verbleiben ausschließlich im gewählten Web-Storage Ihres Browsers."
                />
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Wählen Sie, ob Keys nur für die aktuelle Sitzung oder dauerhaft
                im lokalen Browser-Speicher gehalten werden.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs dark:border-slate-700 dark:bg-slate-800/70">
                <button
                  type="button"
                  onClick={() => void switchKeyStorageMode('session')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    settings.keyStorageMode === 'session'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Nur Sitzung (sessionStorage)
                </button>
                <button
                  type="button"
                  onClick={() => void switchKeyStorageMode('local')}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    settings.keyStorageMode === 'local'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Dauerhaft (localStorage)
                </button>
              </div>

              <button
                type="button"
                onClick={clearAllApiKeys}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Alle Keys löschen</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {PROVIDER_CARDS.map((cfg) => {
              const creds = apiKeys[cfg.id] ?? {};
              const endpoint = settings.providerEndpoints?.[cfg.id];
              const isRevealed = Boolean(revealedKeys[cfg.id]);
              const isTesting = testingProvider === cfg.id;
              const testRes = testResults[cfg.id];

              return (
                <div
                  key={cfg.id}
                  className="flex flex-col justify-between space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {cfg.name}
                      </h3>
                      <button
                        type="button"
                        disabled={isTesting}
                        onClick={() => void handleTestConnection(cfg)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        {isTesting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlugZap className="h-3.5 w-3.5" />
                        )}
                        <span>Verbindung testen</span>
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor={`key-${cfg.id}`}
                        className="block text-[11px] font-medium text-slate-700 dark:text-slate-300"
                      >
                        API-Key
                      </label>
                      <div className="relative">
                        <input
                          id={`key-${cfg.id}`}
                          type={isRevealed ? 'text' : 'password'}
                          autoComplete="off"
                          value={creds.apiKey ?? ''}
                          onChange={(e) =>
                            setProviderCredentials(cfg.id, {
                              ...creds,
                              apiKey: e.target.value,
                            })
                          }
                          placeholder={cfg.keyPlaceholder}
                          className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pr-9 pl-3 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                        />
                        <button
                          type="button"
                          aria-label={
                            isRevealed ? 'Key verbergen' : 'Key anzeigen'
                          }
                          onClick={() =>
                            setRevealedKeys((prev) => ({
                              ...prev,
                              [cfg.id]: !isRevealed,
                            }))
                          }
                          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                        >
                          {isRevealed ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {cfg.supportsBaseUrl ? (
                      <div className="space-y-1">
                        <label
                          htmlFor={`url-${cfg.id}`}
                          className="block text-[11px] font-medium text-slate-700 dark:text-slate-300"
                        >
                          Basis-URL (optional / Endpunkt)
                        </label>
                        <input
                          id={`url-${cfg.id}`}
                          type="url"
                          value={creds.baseUrl ?? endpoint?.baseUrl ?? ''}
                          onChange={(e) => {
                            const baseUrl = e.target.value;
                            setProviderCredentials(cfg.id, {
                              ...creds,
                              baseUrl,
                            });
                            void updateSettings({
                              providerEndpoints: {
                                ...settings.providerEndpoints,
                                [cfg.id]: {
                                  provider: cfg.id,
                                  baseUrl,
                                },
                              },
                            });
                          }}
                          placeholder={cfg.defaultBaseUrl}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                        />
                      </div>
                    ) : null}

                    {cfg.id === 'anthropic' ? (
                      <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={creds.directBrowserAccess !== false}
                          onChange={(e) =>
                            setProviderCredentials('anthropic', {
                              ...creds,
                              directBrowserAccess: e.target.checked,
                            })
                          }
                          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
                        />
                        <span>
                          Direct-Browser-Access Header aktivieren
                        </span>
                      </label>
                    ) : null}

                    {cfg.corsHint ? (
                      <p className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                        {cfg.corsHint}
                      </p>
                    ) : null}
                  </div>

                  {testRes ? (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        testRes.ok
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-300'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {testRes.ok ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-700 dark:text-rose-400" />
                        )}
                        <div>
                          <p className="font-semibold">
                            {testRes.ok
                              ? `Verbindung erfolgreich${testRes.latencyMs !== undefined ? ` (${testRes.latencyMs} ms)` : ''}`
                              : renderConnectionErrorHint(testRes)}
                          </p>
                          {!testRes.ok &&
                          testRes.message &&
                          testRes.message !== renderConnectionErrorHint(testRes) ? (
                            <p className="mt-0.5 break-words font-mono text-[11px] opacity-90">
                              {testRes.message}
                            </p>
                          ) : null}
                          {!testRes.ok && testRes.recommendation ? (
                            <p className="mt-0.5 text-[11px] opacity-90">
                              {testRes.recommendation}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <ModelSelector
            value={settings.defaultModelAssignments}
            pricingOverrides={settings.pricingOverrides}
            onChange={(next) =>
              void updateSettings({ defaultModelAssignments: next })
            }
          />
        </section>
      </Tabs.Content>

      {/* Tab 2: Prompt Workshop */}
      <Tabs.Content value="prompts">
        <PromptWorkshop />
      </Tabs.Content>

      {/* Tab 3: Pricing & Option B Proxy */}
      <Tabs.Content value="pricing-proxy" className="space-y-6">
        {/* Option B Transport Switch */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              KI-Zugriffsmodus (BYOK vs. Option B Managed Proxy)
            </h2>
            <InfoPopover
              title="Option B — Managed Pay-per-Use Proxy"
              description="Im Standardmodus (Direct BYOK) kommuniziert Ihr Browser direkt mit Ihren eigenen API-Keys. Das zentrale Option-B-Proxy-Backend befindet sich aktuell in Entwicklung."
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() =>
                void updateSettings({ transportMode: 'direct-byok' })
              }
              className="rounded-xl border border-indigo-500 bg-indigo-50/50 p-4 text-left ring-1 ring-indigo-500 transition-all dark:border-indigo-500/80 dark:bg-indigo-950/40 dark:ring-indigo-500/80"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Direct BYOK (V1 — Aktiv)
                </span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300">
                  Aktiv
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Direkte Browser-Aufrufe mit Ihren eigenen API-Schlüsseln. Keine
                Server-Zwischenstelle erforderlich.
              </p>
            </button>

            <button
              type="button"
              disabled={true}
              aria-disabled="true"
              className="cursor-not-allowed rounded-xl border border-dashed border-slate-300 bg-slate-100/80 p-4 text-left opacity-60 dark:border-slate-700 dark:bg-slate-900/50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Managed Pay-per-Use Proxy (Option B)
                </span>
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700/80 dark:bg-amber-950/60 dark:text-amber-300">
                  Unter Entwicklung
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Das zentrale Pay-per-Use-Backend befindet sich aktuell in
                Entwicklung. In V1 läuft BioBridge im Direct-BYOK-Modus; der
                Client-Adapter ist architektonisch bereits vorbereitet.
              </p>
            </button>
          </div>
        </section>

        {/* Editable Pricing Catalog */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Modell-Preisliste &amp; EUR-Wechselkurs
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Referenz-Stand: {PRICING_CATALOG_UPDATED_AT}. Sie können alle
                Preise jederzeit an aktuelle Anbieter-Tarife anpassen.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <span>USD → EUR Kurs:</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={settings.usdToEurRate}
                  onChange={(e) =>
                    void updateSettings({
                      usdToEurRate: Math.max(
                        0.01,
                        Number(e.target.value) || DEFAULT_USD_TO_EUR_RATE,
                      ),
                    })
                  }
                  className="w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>

              <button
                type="button"
                onClick={() =>
                  void updateSettings({
                    pricingOverrides: {},
                    usdToEurRate: DEFAULT_USD_TO_EUR_RATE,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Preise zurücksetzen</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300">
                  <th className="px-3 py-2.5">Anbieter</th>
                  <th className="px-3 py-2.5">Modell</th>
                  <th className="px-3 py-2.5">Input / 1M ($)</th>
                  <th className="px-3 py-2.5">Output / 1M ($)</th>
                  <th className="px-3 py-2.5">Embedding / 1M ($)</th>
                  <th className="px-3 py-2.5">Vision / Bild ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {DEFAULT_MODEL_PRICING_CATALOG.map((entry) => {
                  const effective = getModelPricing(
                    entry.provider,
                    entry.modelId,
                    settings.pricingOverrides,
                  );
                  return (
                    <tr
                      key={`${entry.provider}:${entry.modelId}`}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-3 py-2 font-medium capitalize text-slate-700 dark:text-slate-300">
                        {entry.provider}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {entry.displayName}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                          {entry.modelId}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label={`${entry.displayName} Input Preis`}
                          value={effective.inputPer1MUsd}
                          onChange={(e) =>
                            handlePricingCellChange(
                              entry.provider,
                              entry.modelId,
                              'inputPer1MUsd',
                              e.target.value,
                            )
                          }
                          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label={`${entry.displayName} Output Preis`}
                          value={effective.outputPer1MUsd}
                          onChange={(e) =>
                            handlePricingCellChange(
                              entry.provider,
                              entry.modelId,
                              'outputPer1MUsd',
                              e.target.value,
                            )
                          }
                          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {entry.supportsEmbeddings ||
                        effective.embeddingPer1MUsd !== undefined ? (
                          <input
                            type="number"
                            step="0.005"
                            min="0"
                            aria-label={`${entry.displayName} Embedding Preis`}
                            value={effective.embeddingPer1MUsd ?? 0}
                            onChange={(e) =>
                              handlePricingCellChange(
                                entry.provider,
                                entry.modelId,
                                'embeddingPer1MUsd',
                                e.target.value,
                              )
                            }
                            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          />
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {entry.supportsVision ? (
                          <input
                            type="number"
                            step="0.0001"
                            min="0"
                            aria-label={`${entry.displayName} Vision Preis`}
                            value={effective.visionPerImageUsd ?? 0}
                            onChange={(e) =>
                              handlePricingCellChange(
                                entry.provider,
                                entry.modelId,
                                'visionPerImageUsd',
                                e.target.value,
                              )
                            }
                            className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          />
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </Tabs.Content>
    </Tabs.Root>
  );
}
