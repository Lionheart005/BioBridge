import { create } from 'zustand';
import type { ConnectionTestResult, ProviderCredentials } from '@/ai';
import {
  BioBridgeProjectBundleSchema,
  type BioBridgeProjectBundle,
  type CostEstimate,
  type CrossingStrategyType,
  type DistanceBand,
  type Domain,
  type ExperimentRun,
  type ExtractionCacheRecord,
  type PdfMathVisionMode,
  type PipelinePhase,
  type PromptProfile,
  type PromptSlotId,
  type ProviderId,
  type RunConfig,
  type ScoringWeights,
  type SourceDocument,
} from '@/core/schemas';
import { DEFAULT_SCORING_WEIGHTS } from '@/core/scoring/deterministicRules';
import { hashJsonStable, sha256Hex } from '@/core/utils/hash';
import {
  DEFAULT_USD_TO_EUR_RATE,
  estimateExperimentCost,
} from '@/estimation';
import type { PipelineEvent } from '@/pipeline';
import {
  DEFAULT_PROMPT_SLOTS,
  computePromptProfileHash,
  createDefaultPromptProfile,
} from '@/prompts';
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  type ThemeMode,
  buildExtractionCacheKey,
  deleteDocumentCascade,
  deleteExperimentCascade,
  getAppSettings,
  importProjectBundleIntoDb,
  listDocuments,
  listExperiments,
  listExtractionCaches,
  listPromptProfiles,
  parseProjectBundle,
  saveAppSettings,
  saveExperiment,
  savePromptProfile,
} from '@/storage';
import { PipelineWorkerClient } from '@/workers/workerClient';
import type { WorkerTransportConfig } from '@/workers/workerProtocol';

export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

export function formatEur(usdAmount: number, rate: number): string {
  const eur = usdAmount * rate;
  if (eur > 0 && eur < 0.01) {
    return `${eur.toFixed(4).replace('.', ',')} €`;
  }
  return `${eur.toFixed(2).replace('.', ',')} €`;
}

export type AppTab = 'setup' | 'library' | 'runner' | 'matrix' | 'settings';

export const API_KEYS_STORAGE_KEY = 'biobridge_api_keys_v1';
export const PROXY_TOKEN_STORAGE_KEY = 'biobridge_proxy_token_v1';
export const THEME_STORAGE_KEY = 'biobridge_theme_v1';

export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage quota errors in constrained contexts
    }
  }
  if (typeof document === 'undefined') {
    return;
  }
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', isDark);
}

export type ApiKeysMap = Partial<Record<ProviderId, ProviderCredentials>>;

export interface SetupDraft {
  name: string;
  biologyDocIds: string[];
  technologyDocIds: string[];
  outputLanguage: string;
  crossingStrategy: CrossingStrategyType;
  creativityDistance: number;
  distanceBand: DistanceBand;
  maxCandidates: number;
  includeDiagrams: boolean;
  pdfMathVisionMode: PdfMathVisionMode;
  budgetLimitUsd: number | undefined;
  weights: ScoringWeights;
}

export interface LiveProgressState {
  phase: PipelinePhase;
  completed: number;
  total: number;
  detail?: string;
}

export interface AppStoreState {
  initialized: boolean;
  activeTab: AppTab;
  documents: SourceDocument[];
  extractionCaches: ExtractionCacheRecord[];
  experiments: ExperimentRun[];
  activeExperimentId: string | null;
  settings: AppSettings;
  promptProfile: PromptProfile;
  apiKeys: ApiKeysMap;
  managedProxyAuthToken: string;
  setupDraft: SetupDraft;
  cachedDocIdsForCurrentDraft: string[];
  liveCostEstimate: CostEstimate | null;
  liveEvents: PipelineEvent[];
  liveProgress: LiveProgressState | null;
  isRunning: boolean;
  isPaused: boolean;
  ingestingFiles: boolean;
  lastError: string | null;

  initialize: () => Promise<void>;
  setActiveTab: (tab: AppTab) => void;
  setActiveExperimentId: (experimentId: string | null) => void;
  setLastError: (error: string | null) => void;
  setSetupDraft: (patch: Partial<SetupDraft>) => void;
  addDocumentToDraft: (docId: string, domain: Domain) => void;
  removeDocumentFromDraft: (docId: string, domain: Domain) => void;
  uploadFiles: (files: File[], domain: Domain) => Promise<SourceDocument[]>;
  deleteDocument: (docId: string) => Promise<void>;
  recomputeEstimate: () => Promise<void>;

  setProviderCredentials: (
    provider: ProviderId,
    creds: ProviderCredentials,
  ) => void;
  setManagedProxyAuthToken: (token: string) => void;
  switchKeyStorageMode: (mode: 'local' | 'session') => Promise<void>;
  clearAllApiKeys: () => void;

  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  updatePromptProfile: (profile: PromptProfile) => Promise<void>;
  resetPromptSlot: (slotId: PromptSlotId) => Promise<void>;
  resetAllPromptsAndSettings: () => Promise<void>;
  testProviderConnection: (
    provider: ProviderId,
    modelId: string,
  ) => Promise<ConnectionTestResult>;

  startExperiment: () => Promise<string | null>;
  pauseExperiment: (persistAsPaused?: boolean) => Promise<void>;
  resumeExperiment: () => Promise<void>;
  stopExperiment: (persistAsPaused?: boolean) => Promise<void>;
  resumePersistedExperiment: (experimentId: string) => Promise<void>;
  deleteExperiment: (experimentId: string) => Promise<void>;
  importProjectBundleFile: (jsonText: string) => Promise<string>;
  loadDemoExperiment: () => Promise<string>;
}

function getStorageByMode(mode: 'local' | 'session'): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return mode === 'local' ? window.localStorage : window.sessionStorage;
}

function readApiKeysFromStorage(mode: 'local' | 'session'): ApiKeysMap {
  const storage = getStorageByMode(mode);
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(API_KEYS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as ApiKeysMap;
  } catch {
    return {};
  }
}

function writeApiKeysToStorage(
  mode: 'local' | 'session',
  keys: ApiKeysMap,
): void {
  const storage = getStorageByMode(mode);
  if (!storage) {
    return;
  }
  try {
    if (Object.keys(keys).length === 0) {
      storage.removeItem(API_KEYS_STORAGE_KEY);
    } else {
      storage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
    }
  } catch {
    // Ignore storage quota errors in constrained contexts
  }
}

function readProxyTokenFromStorage(mode: 'local' | 'session'): string {
  const storage = getStorageByMode(mode);
  if (!storage) {
    return '';
  }
  try {
    return storage.getItem(PROXY_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeProxyTokenToStorage(
  mode: 'local' | 'session',
  token: string,
): void {
  const storage = getStorageByMode(mode);
  if (!storage) {
    return;
  }
  try {
    if (!token) {
      storage.removeItem(PROXY_TOKEN_STORAGE_KEY);
    } else {
      storage.setItem(PROXY_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function distanceBandFromCreativity(distance: number): DistanceBand {
  if (distance < 0.34) {
    return 'strict';
  }
  if (distance <= 0.67) {
    return 'balanced';
  }
  return 'exploratory';
}

function createInitialDraft(defaultLanguage = 'de'): SetupDraft {
  return {
    name: 'Neues Bionik-Kreuzungsexperiment',
    biologyDocIds: [],
    technologyDocIds: [],
    outputLanguage: defaultLanguage,
    crossingStrategy: 'embedding-hybrid',
    creativityDistance: 0.5,
    distanceBand: 'balanced',
    maxCandidates: 15,
    includeDiagrams: false,
    pdfMathVisionMode: 'auto',
    budgetLimitUsd: 2.5,
    weights: { ...DEFAULT_SCORING_WEIGHTS },
  };
}

function buildRunConfigFromState(
  draft: SetupDraft,
  settings: AppSettings,
  promptProfile: PromptProfile,
): RunConfig {
  return {
    outputLanguage: draft.outputLanguage,
    crossingStrategy: draft.crossingStrategy,
    creativityDistance: draft.creativityDistance,
    distanceBand: draft.distanceBand,
    maxCandidates: draft.maxCandidates,
    includeDiagrams: draft.includeDiagrams,
    pdfMathVisionMode: draft.pdfMathVisionMode,
    modelAssignments: settings.defaultModelAssignments,
    weights: draft.weights,
    ...(draft.budgetLimitUsd !== undefined && draft.budgetLimitUsd > 0
      ? { budgetLimitUsd: draft.budgetLimitUsd }
      : {}),
    promptProfileSnapshot: promptProfile,
  };
}

function generateId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

let workerClientSingleton: PipelineWorkerClient | null = null;
let unsubscribeWorkerEvents: (() => void) | null = null;
let unsubscribeThemeListener: (() => void) | null = null;
let initPromise: Promise<void> | null = null;
let estimateSeq = 0;

function registerSystemThemeListener(): void {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function' ||
    unsubscribeThemeListener
  ) {
    return;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (useAppStore.getState().settings.theme === 'system') {
      applyThemeToDocument('system');
    }
  };
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange);
    unsubscribeThemeListener = () => media.removeEventListener('change', onChange);
  }
}

function buildTransportConfigFromStore(): WorkerTransportConfig {
  const state = useAppStore.getState();
  const credentialsWithEndpoints: ApiKeysMap = {};

  const allProviders: ProviderId[] = [
    'gemini',
    'openai',
    'anthropic',
    'deepseek',
    'openrouter',
    'custom',
  ];
  for (const provider of allProviders) {
    const keyCreds = state.apiKeys[provider];
    const endpoint = state.settings.providerEndpoints?.[provider];
    if (keyCreds || endpoint) {
      credentialsWithEndpoints[provider] = {
        ...keyCreds,
        baseUrl: keyCreds?.baseUrl ?? endpoint?.baseUrl,
        extraHeaders: {
          ...(endpoint?.customHeaders ?? {}),
          ...(keyCreds?.extraHeaders ?? {}),
        },
      };
    }
  }

  return {
    mode: state.settings.transportMode,
    credentialsByProvider: credentialsWithEndpoints,
    managedProxyUrl: state.settings.managedProxyUrl,
    authToken: state.managedProxyAuthToken,
  };
}

function getOrCreateWorkerClient(): PipelineWorkerClient {
  if (!workerClientSingleton) {
    workerClientSingleton = new PipelineWorkerClient({
      getTransportConfig: () => buildTransportConfigFromStore(),
    });
  }
  return workerClientSingleton;
}

async function computeCachedDocIdsForConfig(
  docs: SourceDocument[],
  caches: ExtractionCacheRecord[],
  config: RunConfig,
): Promise<string[]> {
  if (docs.length === 0 || caches.length === 0) {
    return [];
  }
  const cacheKeySet = new Set(caches.map((c) => c.cacheKey));
  const extractionConfigHash = await hashJsonStable({
    extraction: config.modelAssignments.extraction,
    vision: config.modelAssignments.vision,
    includeDiagrams: config.includeDiagrams,
    pdfMathVisionMode: config.pdfMathVisionMode,
  });
  const promptHash = await computePromptProfileHash(config.promptProfileSnapshot);

  const cachedIds: string[] = [];
  for (const doc of docs) {
    const key = await buildExtractionCacheKey({
      contentHash: doc.contentHash,
      extractionConfigHash,
      promptHash,
      outputLanguage: config.outputLanguage,
    });
    if (cacheKeySet.has(key)) {
      cachedIds.push(doc.id);
    }
  }
  return cachedIds;
}

async function createDemoBundle(): Promise<BioBridgeProjectBundle> {
  const now = '2026-11-19T12:00:00.000Z';
  const promptProfile = createDefaultPromptProfile();
  promptProfile.createdAt = now;
  promptProfile.updatedAt = now;

  const bioDocId = 'demo-doc-ants-v1';
  const techDocId = 'demo-doc-server-v1';
  const expId = 'demo-exp-ants-server-v1';

  const bioPage1Text =
    'Bei der Futtersuche legen Arbeiterinnen von Lasius niger auf dem Rückweg zum Nest flüchtige Spurpheromone ab. ' +
    'Die Pheromonkonzentration auf einem Pfad verstärkt sich über positive Rückkopplung, wenn kürzere Wege häufiger pro Zeiteinheit begangen werden, ' +
    'während ungenutzte Umwege durch exponentielle Verdunstung rasch verblassen. ' +
    'Eine zentrale Steuerung durch die Königin findet bei der Wegwahl nicht statt; die Königin übernimmt ausschließlich reproduktive Aufgaben.';

  const bioPage2Text =
    'Mathematisch lässt sich die lokale Pheromon-Aktualisierung pro Kante (i,j) über Verdunstungsrate rho und abgesetzte Spurmenge Delta tau beschreiben: ' +
    'tau_ij(t+1) = (1 - rho) * tau_ij(t) + sum Delta tau_ij^k. ' +
    'Störungen durch plötzlich blockierte Pfade werden innerhalb weniger Minuten durch zufällige Erkundungsabweichungen umgangen.';

  const techPage1Text =
    'Verteilte Microservice-Cluster unterliegen unter Lastspitzen häufig dem Herdeneffekt bei statischen Health-Checks: ' +
    'Veraltete Routing-Tabellen leiten Anfragen weiterhin an überlastete Knoten, bis globale Koordinator-Instanzen mit Verzögerung eingreifen. ' +
    'Gesucht ist ein rein dezentrales, fehlertolerantes Lastverteilungs-Verfahren ohne Single Point of Failure.';

  const techPage2Text =
    'In klassischen IP- und Overlay-Netzen existieren bereits Ant-Colony-Optimization-Verfahren (ACO) für statische Routing-Tabellen, ' +
    'die jedoch bei hochfrequenten Microservice-Autoscaling-Ereignissen oft zu langsam konvergieren, wenn keine adaptive Verdunstungsrate verwendet wird.';

  const bioHash = await sha256Hex(bioPage1Text + bioPage2Text);
  const techHash = await sha256Hex(techPage1Text + techPage2Text);

  const documents: SourceDocument[] = [
    {
      id: bioDocId,
      domain: 'biology',
      fileName: 'Demo_Ameisenstaaten_Schwarmverhalten.pdf',
      mimeType: 'application/pdf',
      format: 'pdf',
      contentHash: bioHash,
      fileSizeBytes: 184200,
      pageCount: 2,
      detectedLanguage: 'de',
      stats: {
        totalChars: bioPage1Text.length + bioPage2Text.length,
        estimatedTokens: Math.ceil((bioPage1Text.length + bioPage2Text.length) / 4),
        detectedFigurePages: [1],
        detectedMathAnomalyPages: [2],
      },
      createdAt: now,
    },
    {
      id: techDocId,
      domain: 'technology',
      fileName: 'Demo_Verteilte_Serverarchitekturen.md',
      mimeType: 'text/markdown',
      format: 'md',
      contentHash: techHash,
      fileSizeBytes: 94200,
      pageCount: 2,
      detectedLanguage: 'de',
      stats: {
        totalChars: techPage1Text.length + techPage2Text.length,
        estimatedTokens: Math.ceil((techPage1Text.length + techPage2Text.length) / 4),
        detectedFigurePages: [],
        detectedMathAnomalyPages: [],
      },
      createdAt: now,
    },
  ];

  const parsedPages = [
    {
      documentId: bioDocId,
      pageNumber: 1,
      sectionPath: ['Kapitel 3: Dezentrale Wegfindung', '3.1 Pheromon-Rückkopplung'],
      rawNormalizedText: bioPage1Text,
      hasDiagram: true,
      blocks: [
        {
          id: `${bioDocId}-p1-b1`,
          type: 'paragraph' as const,
          content: bioPage1Text,
        },
      ],
    },
    {
      documentId: bioDocId,
      pageNumber: 2,
      sectionPath: ['Kapitel 3: Dezentrale Wegfindung', '3.2 Verdunstungsdynamik'],
      rawNormalizedText: bioPage2Text,
      hasMathAnomaly: true,
      blocks: [
        {
          id: `${bioDocId}-p2-b1`,
          type: 'paragraph' as const,
          content: bioPage2Text,
        },
      ],
    },
    {
      documentId: techDocId,
      pageNumber: 1,
      sectionPath: ['Abschnitt 2: Lastverteilung', '2.1 Ausfall von Koordinatoren'],
      rawNormalizedText: techPage1Text,
      blocks: [
        {
          id: `${techDocId}-p1-b1`,
          type: 'paragraph' as const,
          content: techPage1Text,
        },
      ],
    },
    {
      documentId: techDocId,
      pageNumber: 2,
      sectionPath: ['Abschnitt 2: Lastverteilung', '2.2 Bestehende Routing-Verfahren'],
      rawNormalizedText: techPage2Text,
      blocks: [
        {
          id: `${techDocId}-p2-b1`,
          type: 'paragraph' as const,
          content: techPage2Text,
        },
      ],
    },
  ];

  const citBio1 = {
    id: 'demo-cit-bio-1',
    documentId: bioDocId,
    documentTitle: 'Demo_Ameisenstaaten_Schwarmverhalten.pdf',
    pageNumber: 1,
    sectionPath: 'Kapitel 3: Dezentrale Wegfindung > 3.1 Pheromon-Rückkopplung',
    quoteOriginal:
      'Die Pheromonkonzentration auf einem Pfad verstärkt sich über positive Rückkopplung, wenn kürzere Wege häufiger pro Zeiteinheit begangen werden, während ungenutzte Umwege durch exponentielle Verdunstung rasch verblassen.',
    contextBefore:
      'Bei der Futtersuche legen Arbeiterinnen von Lasius niger auf dem Rückweg zum Nest flüchtige Spurpheromone ab.',
    contextAfter:
      'Eine zentrale Steuerung durch die Königin findet bei der Wegwahl nicht statt; die Königin übernimmt ausschließlich reproduktive Aufgaben.',
    verification: {
      status: 'VERIFIED_EXACT' as const,
      matchScore: 1,
      matchedPageNumber: 1,
      attempts: 1,
    },
  };

  const citBio2 = {
    id: 'demo-cit-bio-2',
    documentId: bioDocId,
    documentTitle: 'Demo_Ameisenstaaten_Schwarmverhalten.pdf',
    pageNumber: 2,
    sectionPath: 'Kapitel 3: Dezentrale Wegfindung > 3.2 Verdunstungsdynamik',
    quoteOriginal:
      'Störungen durch plötzlich blockierte Pfade werden innerhalb weniger Minuten durch zufällige Erkundungsabweichungen umgangen.',
    contextBefore:
      'tau_ij(t+1) = (1 - rho) * tau_ij(t) + sum Delta tau_ij^k.',
    contextAfter: '',
    verification: {
      status: 'CORRECTED_VERIFIED' as const,
      matchScore: 0.96,
      matchedPageNumber: 2,
      attempts: 2,
    },
  };

  const citBioQueen = {
    id: 'demo-cit-bio-queen',
    documentId: bioDocId,
    documentTitle: 'Demo_Ameisenstaaten_Schwarmverhalten.pdf',
    pageNumber: 1,
    sectionPath: 'Kapitel 3: Dezentrale Wegfindung > 3.1 Pheromon-Rückkopplung',
    quoteOriginal:
      'Eine zentrale Steuerung durch die Königin findet bei der Wegwahl nicht statt; die Königin übernimmt ausschließlich reproduktive Aufgaben.',
    contextBefore:
      'während ungenutzte Umwege durch exponentielle Verdunstung rasch verblassen.',
    contextAfter: '',
    verification: {
      status: 'VERIFIED_EXACT' as const,
      matchScore: 1,
      matchedPageNumber: 1,
      attempts: 1,
    },
  };

  const citTech1 = {
    id: 'demo-cit-tech-1',
    documentId: techDocId,
    documentTitle: 'Demo_Verteilte_Serverarchitekturen.md',
    pageNumber: 1,
    sectionPath: 'Abschnitt 2: Lastverteilung > 2.1 Ausfall von Koordinatoren',
    quoteOriginal:
      'Gesucht ist ein rein dezentrales, fehlertolerantes Lastverteilungs-Verfahren ohne Single Point of Failure.',
    contextBefore:
      'Veraltete Routing-Tabellen leiten Anfragen weiterhin an überlastete Knoten, bis globale Koordinator-Instanzen mit Verzögerung eingreifen.',
    contextAfter: '',
    verification: {
      status: 'VERIFIED_EXACT' as const,
      matchScore: 1,
      matchedPageNumber: 1,
      attempts: 1,
    },
  };

  const citTech2 = {
    id: 'demo-cit-tech-2',
    documentId: techDocId,
    documentTitle: 'Demo_Verteilte_Serverarchitekturen.md',
    pageNumber: 2,
    sectionPath: 'Abschnitt 2: Lastverteilung > 2.2 Bestehende Routing-Verfahren',
    quoteOriginal:
      'In klassischen IP- und Overlay-Netzen existieren bereits Ant-Colony-Optimization-Verfahren (ACO) für statische Routing-Tabellen, die jedoch bei hochfrequenten Microservice-Autoscaling-Ereignissen oft zu langsam konvergieren, wenn keine adaptive Verdunstungsrate verwendet wird.',
    contextBefore: '',
    contextAfter: '',
    verification: {
      status: 'VERIFIED_NORMALIZED' as const,
      matchScore: 0.99,
      matchedPageNumber: 2,
      attempts: 1,
    },
  };

  const mech1 = {
    id: 'demo-mech-pheromone',
    sourceDocumentIds: [bioDocId],
    title: 'Adaptive Pheromon-Spurverstärkung mit exponentieller Verdunstung',
    biologicalSystem: 'Wegameise (Lasius niger) — Kollektive Futtersuche',
    structure: 'Flüchtige chemische Spurmarker auf begangenen Wegenetz-Kanten',
    workingPrinciple:
      'Kürzere Pfade erzeugen pro Zeitintervall eine höhere Rückkehr-Frequenz und damit eine überproportionale Pheromon-Akkumulation $\\tau_{ij}(t+1) = (1-\\rho)\\tau_{ij}(t) + \\sum \\Delta \\tau_{ij}^k$, während blockierte Pfade verdunsten.',
    achievedEffect:
      'Selbstorganisierte Pfadoptimierung und Umgehung von Blockaden ohne zentrale Instanz.',
    boundaryConditions: {
      spatialScale: '1 cm – 50 m (Wegnetz der Kolonie)',
      timeScale: 'Sekunden bis wenige Minuten',
      medium: 'Gasphase / Bodenoberfläche (flüchtige Pheromone)',
      energyForm: 'Chemische Signalmoleküle & metabolische Laufenergie',
      operatingConstraints: 'Erfordert Mindest-Individuendichte und stochastische Exploration',
      faultTolerance: 'Hoch — Ausfall einzelner Arbeiterinnen ohne Funktionsverlust',
    },
    functionalAbstract:
      'Dezentrale Gewichtung konkurrierender Pfade über lokale Rückmeldung erfolgreicher Durchläufe kombiniert mit zeitlichem Vergessen ($\\rho$).',
    citations: [citBio1, citBio2],
  };

  const mech2 = {
    id: 'demo-mech-queen',
    sourceDocumentIds: [bioDocId],
    title: 'Rolle der Ameisenkönigin im Kolonie-Gefüge',
    biologicalSystem: 'Lasius niger — Kastenteilung',
    structure: 'Reproduktive Königin im Nestzentrum',
    workingPrinciple:
      'Die Königin steuert keine operativen Prozesse, sondern sichert ausschließlich die Eiablage.',
    achievedEffect: 'Langfristige Reproduktion der Kolonie ohne Kommando-Hierarchie.',
    boundaryConditions: {
      spatialScale: 'Nestkammer (Zentimeter)',
      timeScale: 'Jahre (Lebensdauer der Kolonie)',
      medium: 'Biologische Sozialstruktur',
      energyForm: 'Metabolisch',
      operatingConstraints: 'Keine operative Entscheidungsgewalt über Routen',
    },
    functionalAbstract:
      'Rein reproduktive Spezialisierung ohne zentrale Steuerungsfunktion.',
    citations: [citBioQueen],
  };

  const prob1 = {
    id: 'demo-prob-lb',
    sourceDocumentIds: [techDocId],
    title: 'Dezentrale Lastverteilung unter Autoscaling-Spitzen ohne Single Point of Failure',
    technicalDomain: 'Verteilte Serverarchitektur / Service Mesh',
    problemStatement:
      'Vermeidung von Herdeneffekten und veralteten Routing-Tabellen bei dynamisch skalierenden Microservice-Knoten.',
    coreBottleneck:
      'Zentrale Load-Balancer und langsame globale Health-Checks reagieren zu träge auf plötzliche Knoten-Überlastung.',
    targetMetrics: 'p99-Latenz < 35 ms, Konvergenzzeit nach Knotenausfall < 500 ms',
    currentApproachesAndLimits:
      'Statisches Round-Robin und klassisches ACO versagen bei schnellen Topologie-Wechseln durch Autoscaling.',
    boundaryConditions: {
      spatialScale: 'Rechenzentrum / Multi-Zone Cluster',
      timeScale: '1 ms – 500 ms (Request-Zyklus)',
      medium: 'Digitale Paketvermittlung (HTTP/gRPC)',
      energyForm: 'Elektrische Rechen- und Netzwerkleistung',
      operatingConstraints: 'Minimaler Overhead pro Request (< 0,2 ms)',
      reliabilityRequirements: '99,99 % Verfügbarkeit ohne zentralen Koordinator',
    },
    functionalNeedAbstract:
      'Lokale, gewichtete Routenwahl pro Envoy-/Sidecar-Proxy mit schnellem Vergessen veralteter Latenzwerte.',
    citations: [citTech1, citTech2],
  };

  const experiment: ExperimentRun = {
    id: expId,
    name: 'Demo: Ameisenstaat × Serverarchitektur',
    createdAt: now,
    updatedAt: now,
    status: 'COMPLETED',
    biologyDocIds: [bioDocId],
    technologyDocIds: [techDocId],
    config: {
      outputLanguage: 'de',
      crossingStrategy: 'embedding-hybrid',
      creativityDistance: 0.5,
      distanceBand: 'balanced',
      maxCandidates: 3,
      includeDiagrams: true,
      pdfMathVisionMode: 'auto',
      modelAssignments: DEFAULT_APP_SETTINGS.defaultModelAssignments,
      weights: { ...DEFAULT_SCORING_WEIGHTS },
      budgetLimitUsd: 2.5,
      promptProfileSnapshot: promptProfile,
    },
    checkpoint: {
      currentPhase: 'completed',
      completedVisionPageKeys: [],
      completedChunkKeys: [],
      completedPairKeys: [],
      completedReviewKeys: [],
    },
    costLedger: {
      totalInputTokens: 18400,
      totalOutputTokens: 5200,
      totalVisionImages: 1,
      totalCostUsd: 0.042,
      entries: [],
    },
  };

  const candidates = [
    {
      id: 'demo-cand-promising',
      experimentId: expId,
      mechanismId: mech1.id,
      problemId: prob1.id,
      strategyUsed: 'embedding-hybrid' as const,
      similarityScore: 0.84,
      distanceBand: 'balanced' as const,
      bridgeTitle:
        'Adaptive Verdunstungsgewichte für dezentrales Sidecar-Routing (Evaporative Mesh Routing)',
      abstractTransferLogic:
        'Jeder Service-Mesh-Sidecar führt für Ziel-Endpunkte ein lokales Gewicht $\\tau_{ij}$ analog zur Pheromon-Gleichung:\n\n$$\\tau_{ij}(t+1) = (1 - \\rho_{\\text{dyn}}) \\cdot \\tau_{ij}(t) + \\sum_{k=1}^{m} \\Delta \\tau_{ij}^k$$\n\nStatt fester $\\rho$-Werte skaliert $\\rho_{\\text{dyn}}$ proportional zur aktuellen Autoscaling-Änderungsrate, sodass überlastete oder entfernte Pods in unter 300 ms entwertet werden.',
      proposedImplementationSketch:
        '1. Sidecar-Proxy (z. B. Envoy WASM Filter) misst Antwortzeit erfolgreicher Requests und inkrementiert $\\Delta \\tau = 1 / \\text{Latenz}$.\n2. Periodischer Decay-Timer (alle 100 ms) multipliziert alle Gewichte mit $(1 - \\rho_{\\text{dyn}})$.\n3. Stochastische 5 %-Exploration prüft gedrosselte Pods auf Erholung.',
      keyAssumptions: [
        'Antwortzeiten erfolgreicher Requests spiegeln aktuelle Knotenauslastung hinreichend genau wider.',
        'Ein 5-%-Explorationsanteil ist für p99-SLAs tolerierbar.',
      ],
      potentialFailureModes: [
        'Bei extremer Unterlast fehlen frische Messwerte, sodass $\\tau$ auf Null abfallen kann (benötigt Basis-Floor $\\tau_{\\min}$).',
      ],
      mechanismCitationIds: [citBio1.id, citBio2.id],
      problemCitationIds: [citTech1.id],
      createdAt: now,
    },
    {
      id: 'demo-cand-known',
      experimentId: expId,
      mechanismId: mech1.id,
      problemId: prob1.id,
      strategyUsed: 'embedding-hybrid' as const,
      similarityScore: 0.78,
      distanceBand: 'balanced' as const,
      bridgeTitle: 'Klassische Ant Colony Optimization (ACO) für Routing-Tabellen',
      abstractTransferLogic:
        'Übertragung des Standard-Ameisenalgorithmus mit periodischen Probe-Paketen („Forward/Backward Ants“) zur Aktualisierung statischer Routing-Tabellen zwischen Server-Knoten.',
      proposedImplementationSketch:
        'Periodische Control-Plane-Pakete messen Round-Trip-Times und aktualisieren gewichtete Next-Hop-Wahrscheinlichkeiten.',
      keyAssumptions: ['Netzwerktopologie bleibt über mehrere Sekunden stabil.'],
      potentialFailureModes: [
        'Zusätzlicher Control-Plane-Overhead bei tausenden Microservices.',
      ],
      mechanismCitationIds: [citBio1.id],
      problemCitationIds: [citTech2.id],
      createdAt: now,
    },
    {
      id: 'demo-cand-metaphor',
      experimentId: expId,
      mechanismId: mech2.id,
      problemId: prob1.id,
      strategyUsed: 'embedding-hybrid' as const,
      similarityScore: 0.41,
      distanceBand: 'exploratory' as const,
      bridgeTitle: 'Ameisenkönigin als zentraler Master-Controller für Server-Cluster',
      abstractTransferLogic:
        'Analog zur Königin eines Ameisenstaates soll ein zentraler Master-Server alle Anfragen an Arbeiter-Server delegieren.',
      proposedImplementationSketch:
        'Ein einzelner Master-Controller verwaltet den Cluster-Zustand und weist Worker-Nodes Aufgaben zu.',
      keyAssumptions: ['Biologische Königin übernimmt zentrale Koordination.'],
      potentialFailureModes: [
        'Widerspricht sowohl dem biologischen Befund (Königin steuert keine Wege) als auch der technischen Anforderung (kein Single Point of Failure).',
      ],
      mechanismCitationIds: [citBioQueen.id],
      problemCitationIds: [citTech1.id],
      createdAt: now,
    },
  ];

  const reviews = [
    {
      candidateId: 'demo-cand-promising',
      experimentId: expId,
      criticModelUsed: 'gpt-4o (Cross-Model-Gutachter)',
      scores: {
        mechanismDepth: 3 as const,
        scalabilityAndConstraints: 2 as const,
        technicalValue: 2 as const,
        novelty: 1 as const,
        evidenceQuality: 'PASS' as const,
      },
      weightedTotalScore: 8,
      status: 'PROMISING' as const,
      scalingWarning:
        'Zeitskalen-Übergang von Minuten (Biologie) auf Millisekunden (Netzwerk) ist durch lokale Sidecar-Zähler sauber abbildbar, erfordert aber Schutz gegen Oszillation bei Burst-Last.',
      criticalCounterarguments: [
        'Ohne unteren Schwellenwert tau_min droht bei verkehrsarmen Diensten vollständiges Vergessen aller Routen.',
        'Bei plötzlichem Ausfall ganzer Availability-Zonen könnte der 5-%-Explorationsanteil kurzzeitig Fehlerquoten erhöhen.',
      ],
      openHurdles: [
        'Kalibrierung der dynamischen Verdunstungsrate rho_dyn unter realen Autoscaling-Spikes im Benchmark.',
      ],
      verdictSummary:
        'Starker, mathematisch sauber übertragener Mechanismus mit doppelter Belegkette und klarem Vorteil gegenüber starren Health-Checks.',
      createdAt: now,
    },
    {
      candidateId: 'demo-cand-known',
      experimentId: expId,
      criticModelUsed: 'gpt-4o (Cross-Model-Gutachter)',
      scores: {
        mechanismDepth: 2 as const,
        scalabilityAndConstraints: 2 as const,
        technicalValue: 0 as const,
        novelty: 0 as const,
        evidenceQuality: 'PASS' as const,
      },
      weightedTotalScore: 4,
      status: 'KNOWN_STANDARD' as const,
      knownPriorArt:
        'AntNet (Di Caro & Dorigo, 1998) und klassisches Ant Colony Routing sind seit Jahrzehnten etablierter Stand der Technik.',
      criticalCounterarguments: [
        'Keine wesentliche Neuerung gegenüber bekanntem Ant-Colony-Routing.',
        'Separate Probe-Pakete erzeugen unnötigen Netzwerklast-Overhead gegenüber passivem Piggybacking.',
      ],
      openHurdles: [
        'Differenzierung gegenüber existierenden Service-Mesh-EWMA-Load-Balancern unklar.',
      ],
      verdictSummary:
        'Fachlich korrekt, aber als klassisches ACO bereits umfassend in der Literatur bekannt (Stand der Technik).',
      createdAt: now,
    },
    {
      candidateId: 'demo-cand-metaphor',
      experimentId: expId,
      criticModelUsed: 'gpt-4o (Cross-Model-Gutachter)',
      scores: {
        mechanismDepth: 0 as const,
        scalabilityAndConstraints: 0 as const,
        technicalValue: 1 as const,
        novelty: 0 as const,
        evidenceQuality: 'PASS' as const,
      },
      weightedTotalScore: 1,
      status: 'REJECTED_METAPHOR' as const,
      scalingWarning:
        'Ein zentraler Master-Controller erzeugt exakt den Single Point of Failure, der laut Technik-Beleg verhindert werden soll.',
      criticalCounterarguments: [
        'Reine Oberflächen-Metapher: Die Quelle auf S. 1 belegt explizit, dass die Ameisenkönigin keine Wege steuert.',
        'Widerspricht dem Kernziel der dezentralen Fehlertoleranz.',
      ],
      openHurdles: ['Konzept verworfen — keine Umsetzung empfohlen.'],
      verdictSummary:
        'K.O. als irreführende Metapher: Biologisch unzutreffend und architektonisch ein Rückschritt hin zum Single Point of Failure.',
      createdAt: now,
    },
  ];

  return BioBridgeProjectBundleSchema.parse({
    schemaVersion: '1.0.0',
    exportedAt: now,
    experiment,
    documents,
    parsedPages,
    mechanisms: [mech1, mech2],
    problems: [prob1],
    candidates,
    reviews,
  });
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  initialized: false,
  activeTab: 'setup',
  documents: [],
  extractionCaches: [],
  experiments: [],
  activeExperimentId: null,
  settings: DEFAULT_APP_SETTINGS,
  promptProfile: createDefaultPromptProfile(),
  apiKeys: {},
  managedProxyAuthToken: '',
  setupDraft: createInitialDraft(),
  cachedDocIdsForCurrentDraft: [],
  liveCostEstimate: null,
  liveEvents: [],
  liveProgress: null,
  isRunning: false,
  isPaused: false,
  ingestingFiles: false,
  lastError: null,

  initialize: async () => {
    if (get().initialized) {
      return;
    }
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      try {
        const [documents, extractionCaches, experiments, rawSettings, profiles] =
          await Promise.all([
            listDocuments(),
            listExtractionCaches(),
            listExperiments(),
            getAppSettings(),
            listPromptProfiles(),
          ]);

        // Option B (managed-proxy) is currently under development and locked in V1
        const settings: AppSettings =
          rawSettings.transportMode === 'managed-proxy'
            ? await saveAppSettings({ transportMode: 'direct-byok' })
            : rawSettings;

        applyThemeToDocument(settings.theme);
        registerSystemThemeListener();

        let promptProfile = profiles[0];
        if (!promptProfile) {
          promptProfile = createDefaultPromptProfile();
          await savePromptProfile(promptProfile);
        }

        const apiKeys = readApiKeysFromStorage(settings.keyStorageMode);
        const managedProxyAuthToken = readProxyTokenFromStorage(
          settings.keyStorageMode,
        );

        const client = getOrCreateWorkerClient();
        if (unsubscribeWorkerEvents) {
          unsubscribeWorkerEvents();
        }
        unsubscribeWorkerEvents = client.onEvent((event) => {
          set((prev) => {
            const nextEvents = [...prev.liveEvents.slice(-249), event];
            let nextProgress = prev.liveProgress;
            let nextExperiments = prev.experiments;

            if (event.type === 'progress') {
              nextProgress = {
                phase: event.phase,
                completed: event.completed,
                total: event.total,
                detail: event.detail,
              };
            } else if (event.type === 'phase_changed') {
              nextProgress = {
                phase: event.phase,
                completed: 0,
                total: 1,
                detail: event.message,
              };
            } else if (event.type === 'cost_updated') {
              nextExperiments = prev.experiments.map((exp) =>
                exp.id === event.experimentId
                  ? { ...exp, costLedger: event.ledger }
                  : exp,
              );
            } else if (event.type === 'budget_stopped') {
              nextExperiments = prev.experiments.map((exp) =>
                exp.id === event.experimentId
                  ? { ...exp, status: 'BUDGET_STOPPED' }
                  : exp,
              );
            } else if (event.type === 'paused') {
              nextExperiments = prev.experiments.map((exp) =>
                exp.id === event.experimentId
                  ? { ...exp, status: 'PAUSED' }
                  : exp,
              );
            }

            return {
              liveEvents: nextEvents,
              liveProgress: nextProgress,
              experiments: nextExperiments,
            };
          });
        });

        set((prev) => ({
          initialized: true,
          documents,
          extractionCaches,
          experiments,
          activeExperimentId:
            prev.activeExperimentId ?? experiments[0]?.id ?? null,
          settings,
          promptProfile,
          apiKeys,
          managedProxyAuthToken,
          setupDraft: {
            ...prev.setupDraft,
            outputLanguage: settings.defaultOutputLanguage,
          },
        }));

        await get().recomputeEstimate();
      } catch (err) {
        set({
          initialized: true,
          lastError:
            err instanceof Error
              ? `Initialisierungsfehler: ${err.message}`
              : 'Unbekannter Fehler beim Laden der lokalen Datenbank.',
        });
      } finally {
        initPromise = null;
      }
    })();

    return initPromise;
  },

  setActiveTab: (activeTab) => set({ activeTab }),
  setActiveExperimentId: (activeExperimentId) => set({ activeExperimentId }),
  setLastError: (lastError) => set({ lastError }),

  setSetupDraft: (patch) => {
    set((prev) => {
      const nextDraft: SetupDraft = {
        ...prev.setupDraft,
        ...patch,
      };
      if (
        patch.creativityDistance !== undefined &&
        patch.distanceBand === undefined
      ) {
        nextDraft.distanceBand = distanceBandFromCreativity(
          patch.creativityDistance,
        );
      }
      return { setupDraft: nextDraft };
    });
    void get().recomputeEstimate();
  },

  addDocumentToDraft: (docId, domain) => {
    set((prev) => {
      const key = domain === 'biology' ? 'biologyDocIds' : 'technologyDocIds';
      const existing = prev.setupDraft[key];
      if (existing.includes(docId)) {
        return prev;
      }
      return {
        setupDraft: {
          ...prev.setupDraft,
          [key]: [...existing, docId],
        },
      };
    });
    void get().recomputeEstimate();
  },

  removeDocumentFromDraft: (docId, domain) => {
    set((prev) => {
      const key = domain === 'biology' ? 'biologyDocIds' : 'technologyDocIds';
      return {
        setupDraft: {
          ...prev.setupDraft,
          [key]: prev.setupDraft[key].filter((id) => id !== docId),
        },
      };
    });
    void get().recomputeEstimate();
  },

  uploadFiles: async (files, domain) => {
    if (files.length === 0) {
      return [];
    }
    set({ ingestingFiles: true, lastError: null });
    const client = getOrCreateWorkerClient();
    const addedDocs: SourceDocument[] = [];

    try {
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const result = await client.ingestDocument({
          fileName: file.name,
          mimeType: file.type,
          data: buffer,
          domain,
        });
        addedDocs.push(result.document);
      }

      const documents = await listDocuments();
      set((prev) => {
        const key = domain === 'biology' ? 'biologyDocIds' : 'technologyDocIds';
        const existingIds = new Set(prev.setupDraft[key]);
        for (const doc of addedDocs) {
          existingIds.add(doc.id);
        }
        return {
          documents,
          setupDraft: {
            ...prev.setupDraft,
            [key]: Array.from(existingIds),
          },
        };
      });

      await get().recomputeEstimate();
      return addedDocs;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Fehler beim Einlesen der Datei.';
      set({ lastError: message });
      return addedDocs;
    } finally {
      set({ ingestingFiles: false });
    }
  },

  deleteDocument: async (docId) => {
    await deleteDocumentCascade(docId);
    const [documents, extractionCaches] = await Promise.all([
      listDocuments(),
      listExtractionCaches(),
    ]);
    set((prev) => ({
      documents,
      extractionCaches,
      setupDraft: {
        ...prev.setupDraft,
        biologyDocIds: prev.setupDraft.biologyDocIds.filter(
          (id) => id !== docId,
        ),
        technologyDocIds: prev.setupDraft.technologyDocIds.filter(
          (id) => id !== docId,
        ),
      },
    }));
    await get().recomputeEstimate();
  },

  recomputeEstimate: async () => {
    const seq = ++estimateSeq;
    const state = get();
    const { setupDraft, documents, extractionCaches, settings, promptProfile } =
      state;

    const docById = new Map(documents.map((d) => [d.id, d]));
    const biologyDocs = setupDraft.biologyDocIds
      .map((id) => docById.get(id))
      .filter((d): d is SourceDocument => Boolean(d));
    const technologyDocs = setupDraft.technologyDocIds
      .map((id) => docById.get(id))
      .filter((d): d is SourceDocument => Boolean(d));

    const config = buildRunConfigFromState(setupDraft, settings, promptProfile);
    const cachedDocIds = await computeCachedDocIdsForConfig(
      [...biologyDocs, ...technologyDocs],
      extractionCaches,
      config,
    );

    if (seq !== estimateSeq) {
      return;
    }

    const estimate = estimateExperimentCost({
      biologyDocs,
      technologyDocs,
      cachedDocumentIds: cachedDocIds,
      config,
      pricingOverrides: settings.pricingOverrides,
      usdToEurRate: settings.usdToEurRate || DEFAULT_USD_TO_EUR_RATE,
    });

    set({
      cachedDocIdsForCurrentDraft: cachedDocIds,
      liveCostEstimate: estimate,
    });
  },

  setProviderCredentials: (provider, creds) => {
    set((prev) => {
      const nextKeys: ApiKeysMap = {
        ...prev.apiKeys,
        [provider]: creds,
      };
      writeApiKeysToStorage(prev.settings.keyStorageMode, nextKeys);
      return { apiKeys: nextKeys };
    });
  },

  setManagedProxyAuthToken: (token) => {
    set((prev) => {
      writeProxyTokenToStorage(prev.settings.keyStorageMode, token);
      return { managedProxyAuthToken: token };
    });
  },

  switchKeyStorageMode: async (mode) => {
    const prevMode = get().settings.keyStorageMode;
    const { apiKeys, managedProxyAuthToken } = get();
    if (prevMode !== mode) {
      writeApiKeysToStorage(mode, apiKeys);
      writeProxyTokenToStorage(mode, managedProxyAuthToken);
      const oldStorage = getStorageByMode(prevMode);
      oldStorage?.removeItem(API_KEYS_STORAGE_KEY);
      oldStorage?.removeItem(PROXY_TOKEN_STORAGE_KEY);
    }
    const updated = await saveAppSettings({ keyStorageMode: mode });
    set({ settings: updated });
  },

  clearAllApiKeys: () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(API_KEYS_STORAGE_KEY);
      window.sessionStorage.removeItem(API_KEYS_STORAGE_KEY);
      window.localStorage.removeItem(PROXY_TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(PROXY_TOKEN_STORAGE_KEY);
    }
    set({ apiKeys: {}, managedProxyAuthToken: '' });
  },

  updateSettings: async (patch) => {
    const safePatch: Partial<AppSettings> =
      patch.transportMode === 'managed-proxy'
        ? { ...patch, transportMode: 'direct-byok' }
        : patch;
    const updated = await saveAppSettings(safePatch);
    set({ settings: updated });
    await get().recomputeEstimate();
  },

  setTheme: async (theme) => {
    applyThemeToDocument(theme);
    await get().updateSettings({ theme });
  },

  updatePromptProfile: async (profile) => {
    const nextProfile: PromptProfile = {
      ...profile,
      updatedAt: new Date().toISOString(),
    };
    await savePromptProfile(nextProfile);
    set({ promptProfile: nextProfile });
    await get().recomputeEstimate();
  },

  resetPromptSlot: async (slotId) => {
    const current = get().promptProfile;
    const defaultSlot = DEFAULT_PROMPT_SLOTS[slotId];
    const nextProfile: PromptProfile = {
      ...current,
      slots: {
        ...current.slots,
        [slotId]: {
          ...defaultSlot,
          requiredVariables: [...defaultSlot.requiredVariables],
        },
      },
      updatedAt: new Date().toISOString(),
    };
    await savePromptProfile(nextProfile);
    set({ promptProfile: nextProfile });
    await get().recomputeEstimate();
  },

  resetAllPromptsAndSettings: async () => {
    const currentStorageMode = get().settings.keyStorageMode;
    const defaultProfile = createDefaultPromptProfile();
    await savePromptProfile(defaultProfile);
    const updatedSettings = await saveAppSettings({
      ...DEFAULT_APP_SETTINGS,
      keyStorageMode: currentStorageMode,
    });
    applyThemeToDocument(updatedSettings.theme);
    set({
      promptProfile: defaultProfile,
      settings: updatedSettings,
      setupDraft: {
        ...get().setupDraft,
        outputLanguage: updatedSettings.defaultOutputLanguage,
      },
    });
    await get().recomputeEstimate();
  },

  testProviderConnection: async (provider, modelId) => {
    const client = getOrCreateWorkerClient();
    return client.testConnection(
      provider,
      modelId,
      buildTransportConfigFromStore(),
    );
  },

  startExperiment: async () => {
    const state = get();
    const { setupDraft, settings, promptProfile, liveCostEstimate } = state;

    if (
      setupDraft.biologyDocIds.length === 0 ||
      setupDraft.technologyDocIds.length === 0
    ) {
      set({
        lastError:
          'Bitte fügen Sie sowohl für Biologie als auch für Technik mindestens ein Dokument hinzu.',
      });
      return null;
    }

    const now = new Date().toISOString();
    const experimentId = generateId('exp');
    const config = buildRunConfigFromState(setupDraft, settings, promptProfile);

    const run: ExperimentRun = {
      id: experimentId,
      name: setupDraft.name.trim() || 'Unbenanntes Kreuzungs-Experiment',
      createdAt: now,
      updatedAt: now,
      status: 'RUNNING',
      biologyDocIds: [...setupDraft.biologyDocIds],
      technologyDocIds: [...setupDraft.technologyDocIds],
      config,
      checkpoint: {
        currentPhase: 'idle',
        completedVisionPageKeys: [],
        completedChunkKeys: [],
        completedPairKeys: [],
        completedReviewKeys: [],
      },
      ...(liveCostEstimate ? { costEstimate: liveCostEstimate } : {}),
      costLedger: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalVisionImages: 0,
        totalCostUsd: 0,
        entries: [],
      },
    };

    await saveExperiment(run);
    const experiments = await listExperiments();

    set({
      experiments,
      activeExperimentId: experimentId,
      activeTab: 'runner',
      liveEvents: [],
      liveProgress: {
        phase: 'idle',
        completed: 0,
        total: 1,
        detail: 'Experiment wird gestartet…',
      },
      isRunning: true,
      isPaused: false,
      lastError: null,
    });

    const client = getOrCreateWorkerClient();
    void client
      .runExperiment(experimentId, {
        transportConfig: buildTransportConfigFromStore(),
        pricingOverrides: settings.pricingOverrides,
      })
      .then(async () => {
        const [refreshedExperiments, refreshedCaches] = await Promise.all([
          listExperiments(),
          listExtractionCaches(),
        ]);
        set({
          experiments: refreshedExperiments,
          extractionCaches: refreshedCaches,
          isRunning: false,
          isPaused: false,
        });
        await get().recomputeEstimate();
      })
      .catch(async (err: unknown) => {
        const refreshedExperiments = await listExperiments();
        set({
          experiments: refreshedExperiments,
          isRunning: false,
          isPaused: false,
          lastError:
            err instanceof Error
              ? err.message
              : 'Pipeline-Ausführung fehlgeschlagen.',
        });
      });

    return experimentId;
  },

  pauseExperiment: async (persistAsPaused = false) => {
    const { activeExperimentId } = get();
    if (!activeExperimentId) {
      return;
    }
    const client = getOrCreateWorkerClient();
    await client.pauseExperiment(activeExperimentId, persistAsPaused);
    set({
      isPaused: !persistAsPaused,
      ...(persistAsPaused ? { isRunning: false } : {}),
    });
    if (persistAsPaused) {
      const experiments = await listExperiments();
      set({ experiments });
    }
  },

  resumeExperiment: async () => {
    const { activeExperimentId } = get();
    if (!activeExperimentId) {
      return;
    }
    const client = getOrCreateWorkerClient();
    await client.resumeExperiment(activeExperimentId);
    set({ isPaused: false });
  },

  stopExperiment: async (persistAsPaused = false) => {
    const { activeExperimentId } = get();
    if (!activeExperimentId) {
      return;
    }
    const client = getOrCreateWorkerClient();
    await client.stopExperiment(activeExperimentId, persistAsPaused);
    const experiments = await listExperiments();
    set({
      experiments,
      isRunning: false,
      isPaused: false,
    });
  },

  resumePersistedExperiment: async (experimentId) => {
    const state = get();
    const client = getOrCreateWorkerClient();
    set({
      activeExperimentId: experimentId,
      activeTab: 'runner',
      isRunning: true,
      isPaused: false,
      lastError: null,
      liveProgress: {
        phase: 'idle',
        completed: 0,
        total: 1,
        detail: 'Experiment wird ab Checkpoint fortgesetzt…',
      },
    });

    void client
      .runExperiment(experimentId, {
        transportConfig: buildTransportConfigFromStore(),
        pricingOverrides: state.settings.pricingOverrides,
      })
      .then(async () => {
        const [refreshedExperiments, refreshedCaches] = await Promise.all([
          listExperiments(),
          listExtractionCaches(),
        ]);
        set({
          experiments: refreshedExperiments,
          extractionCaches: refreshedCaches,
          isRunning: false,
          isPaused: false,
        });
        await get().recomputeEstimate();
      })
      .catch(async (err: unknown) => {
        const refreshedExperiments = await listExperiments();
        set({
          experiments: refreshedExperiments,
          isRunning: false,
          isPaused: false,
          lastError:
            err instanceof Error
              ? err.message
              : 'Fortsetzen des Experiments fehlgeschlagen.',
        });
      });
  },

  deleteExperiment: async (experimentId) => {
    await deleteExperimentCascade(experimentId);
    const experiments = await listExperiments();
    set((prev) => ({
      experiments,
      activeExperimentId:
        prev.activeExperimentId === experimentId
          ? experiments[0]?.id ?? null
          : prev.activeExperimentId,
    }));
  },

  importProjectBundleFile: async (jsonText) => {
    const bundle = parseProjectBundle(jsonText);
    const result = await importProjectBundleIntoDb(bundle);
    const [documents, extractionCaches, experiments] = await Promise.all([
      listDocuments(),
      listExtractionCaches(),
      listExperiments(),
    ]);
    set({
      documents,
      extractionCaches,
      experiments,
      activeExperimentId: result.experimentId,
      activeTab: 'matrix',
      lastError: null,
    });
    await get().recomputeEstimate();
    return result.experimentId;
  },

  loadDemoExperiment: async () => {
    const bundle = await createDemoBundle();
    const result = await importProjectBundleIntoDb(bundle);
    const [documents, extractionCaches, experiments] = await Promise.all([
      listDocuments(),
      listExtractionCaches(),
      listExperiments(),
    ]);
    set({
      documents,
      extractionCaches,
      experiments,
      activeExperimentId: result.experimentId,
      activeTab: 'matrix',
      lastError: null,
    });
    await get().recomputeEstimate();
    return result.experimentId;
  },
}));
