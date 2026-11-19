import 'fake-indexeddb/auto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DirectBrowserTransport } from '../src/ai/transports/directBrowserTransport';
import type {
  CriticReview,
  CrossingCandidate,
  CrossingStrategyType,
  ExperimentRun,
  ModelAssignments,
  ProviderId,
  RunConfig,
  VerdictStatus,
} from '../src/core/schemas';
import { isCitationVerified } from '../src/core/scoring/deterministicRules';
import { ingestDocument } from '../src/ingestion/ingestionRouter';
import { PipelineOrchestrator } from '../src/pipeline/orchestrator';
import { createDefaultPromptProfile } from '../src/prompts';
import {
  createBioBridgeDB,
  getCandidatesForExperiment,
  getReviewsForExperiment,
  saveDocumentWithPages,
  saveExperiment,
} from '../src/storage';

export type EvalCategory =
  | 'positive_control'
  | 'known_classic'
  | 'metaphor_trap'
  | 'distant_domain_calibration';

export interface EvalCase {
  id: string;
  name: string;
  category: EvalCategory;
  description: string;
  biologyDocument: { fileName: string; markdownContent: string };
  technologyDocument: { fileName: string; markdownContent: string };
  expectations: {
    expectedPrimaryStatuses: VerdictStatus[];
    minTopScore?: number;
    maxTopScore?: number;
    expectedNovelty?: 0 | 1 | 2;
    expectedMechanismDepth?: 0 | 1 | 2 | 3;
    minRejectionRate?: number;
  };
}

export interface EvalCaseResult {
  caseId: string;
  name: string;
  category: EvalCategory;
  passed: boolean;
  failureReasons: string[];
  candidateCount: number;
  reviewCount: number;
  statusDistribution: Record<string, number>;
  topScore: number;
  topStatus: VerdictStatus | 'NONE';
  verificationRate: number;
  retractionRate: number;
  rejectionRate: number;
  costUsd: number;
  durationMs: number;
}

export interface EvalSuiteResult {
  mode: 'mock' | 'live';
  provider: ProviderId;
  strategy: CrossingStrategyType;
  passed: boolean;
  totalCases: number;
  passedCases: number;
  results: EvalCaseResult[];
  summary: {
    avgVerificationRate: number;
    avgRetractionRate: number;
    avgRejectionRate: number;
    totalCostUsd: number;
    totalDurationMs: number;
  };
}

export interface RunEvalOptions {
  mock?: boolean;
  datasetDir?: string;
  caseFilter?: string[];
  provider?: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  extractionModel?: string;
  crossingModel?: string;
  criticModel?: string;
  embeddingModel?: string;
  strategy?: CrossingStrategyType;
  silent?: boolean;
}

const REJECTED_STATUSES: ReadonlySet<VerdictStatus> = new Set([
  'REJECTED_METAPHOR',
  'REJECTED_SCALING',
  'REJECTED_EVIDENCE',
  'RETRACTED',
]);

const DEFAULT_DATASET_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'datasets',
);

const PROVIDER_DEFAULT_MODELS: Record<ProviderId, ModelAssignments> = {
  gemini: {
    extraction: { provider: 'gemini', modelId: 'gemini-2.5-flash', temperature: 0.1 },
    vision: { provider: 'gemini', modelId: 'gemini-2.5-flash', temperature: 0.1 },
    embedding: { provider: 'gemini', modelId: 'text-embedding-004' },
    crossing: { provider: 'gemini', modelId: 'gemini-2.5-pro', temperature: 0.4 },
    critic: { provider: 'gemini', modelId: 'gemini-2.5-pro', temperature: 0.1 },
  },
  openai: {
    extraction: { provider: 'openai', modelId: 'gpt-4o-mini', temperature: 0.1 },
    vision: { provider: 'openai', modelId: 'gpt-4o-mini', temperature: 0.1 },
    embedding: { provider: 'openai', modelId: 'text-embedding-3-small' },
    crossing: { provider: 'openai', modelId: 'gpt-4o', temperature: 0.4 },
    critic: { provider: 'openai', modelId: 'gpt-4o', temperature: 0.1 },
  },
  anthropic: {
    extraction: { provider: 'anthropic', modelId: 'claude-3-5-haiku-latest', temperature: 0.1 },
    vision: { provider: 'anthropic', modelId: 'claude-3-5-haiku-latest', temperature: 0.1 },
    embedding: { provider: 'openai', modelId: 'text-embedding-3-small' },
    crossing: { provider: 'anthropic', modelId: 'claude-3-7-sonnet-latest', temperature: 0.4 },
    critic: { provider: 'anthropic', modelId: 'claude-3-7-sonnet-latest', temperature: 0.1 },
  },
  deepseek: {
    extraction: { provider: 'deepseek', modelId: 'deepseek-flash', temperature: 0.1 },
    vision: { provider: 'gemini', modelId: 'gemini-4-hydrogen', temperature: 0.1 },
    embedding: { provider: 'openai', modelId: 'text-embedding-3-small' },
    crossing: { provider: 'deepseek', modelId: 'deepseek-v4-pro', temperature: 0.4 },
    critic: { provider: 'deepseek', modelId: 'deepseek-v4-pro', temperature: 0.1 },
  },
  openrouter: {
    extraction: { provider: 'openrouter', modelId: 'google/gemini-2.5-flash', temperature: 0.1 },
    vision: { provider: 'openrouter', modelId: 'google/gemini-2.5-flash', temperature: 0.1 },
    embedding: { provider: 'openrouter', modelId: 'openai/text-embedding-3-small' },
    crossing: { provider: 'openrouter', modelId: 'google/gemini-2.5-flash', temperature: 0.4 },
    critic: { provider: 'openrouter', modelId: 'anthropic/claude-3.7-sonnet', temperature: 0.1 },
  },
  custom: {
    extraction: { provider: 'custom', modelId: 'llama3.1', temperature: 0.1 },
    vision: { provider: 'custom', modelId: 'llama3.1', temperature: 0.1 },
    embedding: { provider: 'custom', modelId: 'nomic-embed-text' },
    crossing: { provider: 'custom', modelId: 'llama3.1', temperature: 0.4 },
    critic: { provider: 'custom', modelId: 'llama3.1', temperature: 0.1 },
  },
};

/**
 * Loads and parses all curated EvalCase JSON fixtures from disk.
 */
export async function loadEvalDatasets(
  datasetDir = DEFAULT_DATASET_DIR,
): Promise<EvalCase[]> {
  const entries = await readdir(datasetDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const datasets: EvalCase[] = [];
  for (const fileName of jsonFiles) {
    const raw = await readFile(path.join(datasetDir, fileName), 'utf-8');
    datasets.push(JSON.parse(raw) as EvalCase);
  }
  return datasets;
}

function findPageNumberForQuote(chunkMessage: string, quote: string): number {
  const quoteIdx = chunkMessage.indexOf(quote);
  if (quoteIdx === -1) {
    return 1;
  }
  const prefix = chunkMessage.slice(0, quoteIdx);
  const matches = Array.from(prefix.matchAll(/\[\[PAGE:(\d+)\]\]/g));
  if (matches.length === 0) {
    return 1;
  }
  return Number(matches[matches.length - 1][1]);
}

function makeSemanticEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  if (
    lower.includes('antennal') ||
    lower.includes('contact') ||
    lower.includes('edge') ||
    lower.includes('autoscal') ||
    lower.includes('standby')
  ) {
    return [0.95, 0.22, 0.08, 0.1];
  }
  if (
    lower.includes('pheromone') &&
    (lower.includes('evaporat') || lower.includes('trail') || lower.includes('shortest'))
  ) {
    return [0.22, 0.94, 0.08, 0.1];
  }
  if (lower.includes('routing') || lower.includes('packet') || lower.includes('forwarding')) {
    return [0.2, 0.95, 0.08, 0.1];
  }
  if (lower.includes('queen') || lower.includes('kubernetes') || lower.includes('control plane')) {
    return [0.1, 0.1, 0.95, 0.15];
  }
  if (
    lower.includes('turgor') ||
    lower.includes('pilobolus') ||
    lower.includes('buller') ||
    lower.includes('mycelial') ||
    lower.includes('tax') ||
    lower.includes('audit')
  ) {
    return [0.35, 0.35, 0.35, 0.8];
  }
  return [0.4, 0.4, 0.4, 0.4];
}

/**
 * Creates a deterministic OpenAI-compatible fetchFn so DirectBrowserTransport
 * executes the full HTTP adapter, No-Web-Search guard, JSON parsing, and
 * citation verification offline without calling any external API.
 */
function createDeterministicMockFetch(): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const rawBody = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(rawBody) as Record<string, unknown>;

    const makeJsonResponse = (payload: unknown): Response =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.endsWith('/embeddings')) {
      const texts = Array.isArray(body.input) ? (body.input as string[]) : [];
      return makeJsonResponse({
        data: texts.map((text, index) => ({
          index,
          embedding: makeSemanticEmbedding(text),
        })),
        usage: {
          prompt_tokens: Math.max(10, texts.length * 60),
          total_tokens: Math.max(10, texts.length * 60),
        },
      });
    }

    const responseFormat = body.response_format as
      | { json_schema?: { name?: string } }
      | undefined;
    const schemaName = responseFormat?.json_schema?.name ?? 'unknown';
    const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;
    const userMsg = messages[messages.length - 1]?.content ?? '';

    const wrapOpenAICompletion = (obj: unknown): Response =>
      makeJsonResponse({
        choices: [
          {
            message: { content: JSON.stringify(obj) },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: Math.max(250, Math.ceil(userMsg.length / 4)),
          completion_tokens: 220,
        },
      });

    switch (schemaName) {
      case 'ExtractBioOutput': {
        const mechanisms = [];

        if (userMsg.includes('Harvester ant workers adjust their outgoing foraging rate')) {
          const quote =
            'Harvester ant workers adjust their outgoing foraging rate based solely on brief antennal contact frequencies with returning food-bearing nestmates inside the entrance chamber.';
          mechanisms.push({
            title: 'Harvester Ant Contact-Rate Foraging Regulation',
            biologicalSystem: 'Pogonomyrmex barbatus',
            structure: 'Nest entrance interaction chamber and antennal chemoreceptors',
            workingPrinciple:
              'Leaky temporal integration of local antennal contact frequency against heterogeneous worker thresholds without central control',
            achievedEffect:
              'Self-limiting demand-driven recruitment and automatic shutdown on resource drop',
            boundaryConditions: {
              spatialScale: 'cm-m (nest entrance to foraging trail)',
              timeScale: 'seconds-minutes (10-20s leaky window)',
              medium: 'physical tactile / cuticular hydrocarbon cues',
              energyForm: 'metabolic / mechanical',
              operatingConstraints: 'purely local sensing, no global colony state',
            },
            functionalAbstract:
              'Decentralized sigmoidal activation using leaky integration of local positive-feedback contact rates and heterogeneous thresholds.',
            citations: [
              {
                pageNumber: findPageNumberForQuote(userMsg, quote),
                sectionPath: 'Local Contact Rate Sensing and Leaky Integration',
                quoteOriginal: quote,
              },
            ],
          });
        }

        if (userMsg.includes('shorter branch between the nest and food')) {
          const quote =
            'Because ants traveling along a shorter branch between the nest and food complete round trips faster than ants traversing a longer detour, the shorter branch receives fresh pheromone deposits at a higher rate per unit time.';
          mechanisms.push({
            title: 'Ant Trail Pheromone Reinforcement and Volatile Evaporation',
            biologicalSystem: 'Linepithema humile',
            structure: "Pavan's gland chemotactic trail network",
            workingPrinciple:
              'Autocatalytic pheromone deposition combined with first-order exponential evaporation decay',
            achievedEffect: 'Shortest-path convergence with forgetting of depleted trails',
            boundaryConditions: {
              spatialScale: 'cm-m',
              timeScale: 'minutes',
              medium: 'volatile chemical trail on substrate',
              energyForm: 'chemical',
              operatingConstraints: 'evaporation constant rho clears stale paths',
            },
            functionalAbstract:
              'Stochastic path reinforcement coupled with exponential pheromone evaporation to track dynamic shortest paths.',
            citations: [
              {
                pageNumber: findPageNumberForQuote(userMsg, quote),
                sectionPath: 'Positive Feedback in Path Selection',
                quoteOriginal: quote,
              },
            ],
          });
        }

        if (userMsg.includes('ant queen emits non-volatile cuticular hydrocarbon pheromones')) {
          const quote =
            'The ant queen emits non-volatile cuticular hydrocarbon pheromones that suppress worker ovary development without directing task execution or spatial routing.';
          mechanisms.push({
            title: 'Ant Queen Reproductive Fertility Signalling',
            biologicalSystem: 'Formica / Solenopsis colony',
            structure: 'Queen cuticular hydrocarbon glands',
            workingPrinciple:
              'Honest physiological fertility cue suppressing worker reproduction; zero task or routing commands',
            achievedEffect: 'Reproductive division of labor without centralized scheduling',
            boundaryConditions: {
              spatialScale: 'mm-m (colony interior)',
              timeScale: 'hours-days',
              medium: 'contact cuticular hydrocarbons',
              energyForm: 'biochemical',
              operatingConstraints: 'reproductive cue only; does not schedule worker tasks',
            },
            functionalAbstract:
              'Decentralized colony with an egg-laying queen emitting fertility primer pheromones rather than centralized task orchestration.',
            citations: [
              {
                pageNumber: findPageNumberForQuote(userMsg, quote),
                sectionPath: 'Cuticular Hydrocarbon Primer Pheromones',
                quoteOriginal: quote,
              },
            ],
          });
        }

        if (userMsg.includes('Pilobolus crystallinus')) {
          const q1 =
            'Water influx across the semipermeable membrane elevates internal hydrostatic turgor pressure until it reaches a critical rupture threshold of approximately 0.55 MPa.';
          const q2 =
            "Condensation of a spherical Buller's drop at the hilar appendix combined with a liquid film on the spore face triggers sudden coalescence once a geometric volume threshold is crossed.";
          const q3 =
            'Below the fruiting bodies, the subterranean hyphal network redistributes cytoplasmic water and carbon toward emerging primordia only when ambient substrate moisture exceeds a physiological gating threshold.';

          mechanisms.push(
            {
              title: 'Pilobolus Osmotic Turgor Rupture Launch',
              biologicalSystem: 'Pilobolus crystallinus sporangiophore',
              structure: 'Subsporangial vesicle and abscission ring',
              workingPrinciple:
                'Osmotic water influx builds hydrostatic turgor to 0.55 MPa rupture threshold for ballistic launch',
              achievedEffect: 'High-acceleration phototropic sporangium ejection',
              boundaryConditions: {
                spatialScale: '100 um - 2 m',
                timeScale: 'milliseconds (launch) / hours (charging)',
                medium: 'aqueous cytoplasm / air',
                energyForm: 'osmotic-elastic potential energy',
                operatingConstraints: 'requires semipermeable cell wall and turgor pressure',
              },
              functionalAbstract:
                'Hydrostatic pressure accumulation crossing a mechanical wall-failure threshold for ballistic particle distribution.',
              citations: [
                {
                  pageNumber: findPageNumberForQuote(userMsg, q1),
                  sectionPath: 'Turgor-Driven Sporangial Launch in Pilobolus',
                  quoteOriginal: q1,
                },
              ],
            },
            {
              title: "Buller's Drop Surface-Tension Ballistospore Catapult",
              biologicalSystem: 'Basidiomycete ballistospore',
              structure: 'Hilar appendix and spore face film',
              workingPrinciple:
                'Surface free energy release upon droplet coalescence shifts center of mass',
              achievedEffect: 'Detachment across laminar air boundary layer',
              boundaryConditions: {
                spatialScale: '1-20 um',
                timeScale: 'microseconds',
                medium: 'humid air boundary layer',
                energyForm: 'capillary surface tension',
                operatingConstraints: 'high relative humidity required for condensation',
              },
              functionalAbstract:
                'Capillary droplet coalescence converting surface tension threshold into mechanical detachment impulse.',
              citations: [
                {
                  pageNumber: findPageNumberForQuote(userMsg, q2),
                  sectionPath: "Buller's Drop Surface-Tension Catapult",
                  quoteOriginal: q2,
                },
              ],
            },
            {
              title: 'Mycelial Network Moisture Threshold Gating',
              biologicalSystem: 'Subterranean fungal mycelium',
              structure: 'Interconnected hyphal network and spore surface receptors',
              workingPrinciple:
                'Cytoplasmic water redistribution and receptor-mediated germination screening',
              achievedEffect: 'Prevents premature spore germination in dry substrates',
              boundaryConditions: {
                spatialScale: 'mm-m',
                timeScale: 'hours-days',
                medium: 'soil substrate',
                energyForm: 'chemical / osmotic',
                operatingConstraints: 'biological receptor binding and moisture gating',
              },
              functionalAbstract:
                'Resource distribution network gated by ambient moisture thresholds and chemical germination screening.',
              citations: [
                {
                  pageNumber: findPageNumberForQuote(userMsg, q3),
                  sectionPath: 'Mycelial Network Moisture Gating and Germination Screening',
                  quoteOriginal: q3,
                },
              ],
            },
          );
        }

        return wrapOpenAICompletion({ mechanisms });
      }

      case 'ExtractTechOutput': {
        const problems = [];

        if (userMsg.includes('intermittent WAN links')) {
          const quote =
            'Under bursty local sensor workloads and intermittent WAN links experiencing 400 ms to 2500 ms round-trip latency or complete network partitions, centralized edge autoscalers suffer severe control-plane lag and split-brain oscillation.';
          problems.push({
            title: 'Decentralized Edge Cluster Autoscaling Under Partitions',
            technicalDomain: 'Distributed Edge Computing',
            problemStatement:
              'Centralized autoscalers fail under bursty local workloads and WAN partitions, while naive local thresholds cause synchronized thrashing',
            coreBottleneck:
              'Need decentralized standby replica activation from local peer receipts without global consensus',
            targetMetrics: 'zero split-brain thrashing, sub-second local reaction under WAN drop',
            currentApproachesAndLimits:
              'Central HPA suffers 400-2500ms lag; naive local PID wakes all standby nodes simultaneously',
            boundaryConditions: {
              spatialScale: 'cluster-local LAN (10-100 edge nodes)',
              timeScale: 'milliseconds-seconds',
              medium: 'IP local network',
              energyForm: 'electrical / thermal envelope',
              operatingConstraints: 'intermittent WAN, strict thermal budget, no global master',
            },
            functionalNeedAbstract:
              'Decentralized sigmoidal standby activation driven by leaky integration of local peer job-completion contact rates.',
            citations: [
              {
                pageNumber: findPageNumberForQuote(userMsg, quote),
                sectionPath: 'Architectural Bottlenecks of Centralized Control Planes',
                quoteOriginal: quote,
              },
            ],
          });
        }

        if (userMsg.includes('static shortest-path routing tables oscillate')) {
          const quote =
            'When traffic surges or links experience intermittent packet loss, static shortest-path routing tables oscillate or concentrate all flows onto congested bottleneck links until slow global routing convergence completes.';
          problems.push({
            title: 'Adaptive Packet Routing in Dynamic Telecom Networks',
            technicalDomain: 'Telecommunication Packet Networks',
            problemStatement:
              'Static shortest-path routing oscillates and overflows buffers under transient congestion and link failures',
            coreBottleneck: 'Slow global convergence and stale routing table weights',
            targetMetrics: 'low packet jitter, rapid detour adaptation',
            currentApproachesAndLimits:
              'Link-state global flooding lags behind fast traffic bursts',
            boundaryConditions: {
              spatialScale: 'WAN / multi-hop mesh',
              timeScale: 'milliseconds-seconds',
              medium: 'packet-switched links',
              energyForm: 'electrical / optical',
              operatingConstraints: 'local router forwarding tables, asynchronous probes',
            },
            functionalNeedAbstract:
              'Probabilistic next-hop routing updated by lightweight probes with exponential decay of stale link weights.',
            citations: [
              {
                pageNumber: findPageNumberForQuote(userMsg, quote),
                sectionPath: 'Failure Modes of Static Shortest-Path Routing',
                quoteOriginal: quote,
              },
            ],
          });
        }

        if (userMsg.includes('centralized master control plane becomes a severe throughput')) {
          const quote =
            'As cluster sizes exceed five thousand nodes or tens of thousands of short-lived batch jobs per minute, the centralized master control plane becomes a severe throughput and latency bottleneck.';
          problems.push({
            title: 'Kubernetes Master Control-Plane Scheduling Bottleneck',
            technicalDomain: 'Container Cluster Orchestration',
            problemStatement:
              'Centralized master control plane (kube-apiserver/etcd/scheduler) saturates at high node and pod churn',
            coreBottleneck: 'Centralized Raft write serialization and scheduler queue contention',
            targetMetrics: '> 10k pods/min scheduling throughput',
            currentApproachesAndLimits:
              'Single logical master control plane creates single point of contention',
            boundaryConditions: {
              spatialScale: 'datacenter (> 5000 nodes)',
              timeScale: 'milliseconds-seconds',
              medium: 'datacenter RPC / etcd Raft',
              energyForm: 'electrical',
              operatingConstraints: 'authoritative state consistency and pod binding',
            },
            functionalNeedAbstract:
              'Scaling centralized master orchestration and authoritative scheduling across thousands of worker nodes.',
            citations: [
              {
                pageNumber: findPageNumberForQuote(userMsg, quote),
                sectionPath: 'Scalability and Single-Point-of-Control Bottlenecks',
                quoteOriginal: quote,
              },
            ],
          });
        }

        if (userMsg.includes('Municipal tax offices administering local trade tax')) {
          const q1 =
            'Current administrative statutes rely on rigid gross-revenue threshold tiers that trigger mandatory external tax audits once declared turnover crosses a fixed euro cutoff.';
          const q2 =
            'Once an audit case is opened, physical and electronic tax dossiers traverse a multi-stage administrative distribution network linking assessment clerks, legal compliance reviewers, and field audit teams.';

          problems.push(
            {
              title: 'Statutory Revenue Threshold Cliffs in Municipal Tax Audits',
              technicalDomain: 'Municipal Tax & Audit Law',
              problemStatement:
                'Fixed statutory euro turnover thresholds create audit backlog cliffs and uneven fiscal scrutiny',
              coreBottleneck: 'Rigid statutory legal cutoffs and limited auditor staffing',
              targetMetrics: 'fair audit coverage within statutory deadlines',
              currentApproachesAndLimits: 'Deterministic euro cutoff rules miss below-threshold anomalies',
              boundaryConditions: {
                spatialScale: 'municipal jurisdiction',
                timeScale: 'fiscal quarters / statutory years',
                medium: 'legal tax filings and statutory statutes',
                energyForm: 'administrative labor',
                operatingConstraints: 'must comply with municipal tax statutes and equal-treatment law',
              },
              functionalNeedAbstract:
                'Threshold-based audit screening and statutory selection rules in municipal tax administration.',
              citations: [
                {
                  pageNumber: findPageNumberForQuote(userMsg, q1),
                  sectionPath: 'Statutory Revenue Thresholds in Audit Selection',
                  quoteOriginal: q1,
                },
              ],
            },
            {
              title: 'Inter-Departmental Tax Dossier Distribution Network',
              technicalDomain: 'Administrative Legal Workflow',
              problemStatement:
                'Tax dossier distribution across assessment, legal review, and field audit teams suffers appeal bottlenecks',
              coreBottleneck: 'Statutory objection deadlines and manual legal compliance screening',
              targetMetrics: 'timely appeal resolution within statutory deadlines',
              currentApproachesAndLimits:
                'Rule-based pre-assessment screening triggers excessive formal appeals',
              boundaryConditions: {
                spatialScale: 'municipal bureaucracy',
                timeScale: 'weeks-months',
                medium: 'legal case dossiers',
                energyForm: 'human legal review',
                operatingConstraints: 'formal administrative procedure codes and objection deadlines',
              },
              functionalNeedAbstract:
                'Administrative distribution network and automated compliance screening under statutory legal deadlines.',
              citations: [
                {
                  pageNumber: findPageNumberForQuote(userMsg, q2),
                  sectionPath: 'Inter-Departmental Dossier Distribution Network',
                  quoteOriginal: q2,
                },
              ],
            },
          );
        }

        return wrapOpenAICompletion({ problems });
      }

      case 'DomainClustersOutput': {
        const parsed = JSON.parse(userMsg) as {
          domain: string;
          items: Array<{ id: string }>;
        };
        return wrapOpenAICompletion({
          clusters: [
            {
              id: `${parsed.domain}-c1`,
              label: `${parsed.domain} Cluster`,
              description: 'All extracted items',
              memberIds: parsed.items.map((i) => i.id),
            },
          ],
        });
      }

      case 'CrossingCandidatesOutput': {
        const parsed = JSON.parse(userMsg) as {
          pairs: Array<{
            mechanism: {
              mechanismId: string;
              title: string;
              citations: Array<{ citationId: string }>;
            };
            problem: {
              problemId: string;
              title: string;
              citations: Array<{ citationId: string }>;
            };
          }>;
        };

        const candidates = parsed.pairs.map((pair) => ({
          mechanismId: pair.mechanism.mechanismId,
          problemId: pair.problem.problemId,
          bridgeTitle: `${pair.mechanism.title} -> ${pair.problem.title}`,
          abstractTransferLogic: `Mapped operating logic from ${pair.mechanism.title} onto ${pair.problem.title}.`,
          proposedImplementationSketch:
            'Apply the extracted threshold/feedback structure to the target technical constraint.',
          keyAssumptions: ['Local state variables map to target system metrics'],
          potentialFailureModes: ['Domain constraint mismatch or oscillation under burst load'],
          mechanismCitationIds: pair.mechanism.citations.map((c) => c.citationId),
          problemCitationIds: pair.problem.citations.map((c) => c.citationId),
        }));
        return wrapOpenAICompletion({ candidates });
      }

      case 'CriticReviewOutput': {
        const parsed = JSON.parse(userMsg) as {
          hypothesis: { bridgeTitle: string };
        };
        const title = parsed.hypothesis.bridgeTitle;

        if (title.includes('Harvester Ant') && title.includes('Edge Cluster')) {
          return wrapOpenAICompletion({
            scores: {
              mechanismDepth: 3,
              scalabilityAndConstraints: 3,
              technicalValue: 2,
              novelty: 2,
              evidenceQuality: 'PASS',
            },
            status: 'PROMISING',
            criticalCounterarguments: [
              'Heterogeneous activation thresholds must be re-tuned if workload job durations vary by orders of magnitude across edge nodes.',
            ],
            openHurdles: [
              'Verify stability against correlated packet-loss bursts on local wireless peer links.',
            ],
            verdictSummary:
              'Formalizable sigmoidal contact-rate integrator directly solves WAN-partitioned edge autoscaling without central coordination.',
          });
        }

        if (title.includes('Pheromone') && title.includes('Packet Routing')) {
          return wrapOpenAICompletion({
            scores: {
              mechanismDepth: 3,
              scalabilityAndConstraints: 2,
              technicalValue: 2,
              novelty: 0,
              evidenceQuality: 'PASS',
            },
            status: 'KNOWN_STANDARD',
            knownPriorArt:
              'AntNet and Ant Colony Optimization (ACO) adaptive network routing (Di Caro & Dorigo, 1998)',
            criticalCounterarguments: [
              'Probe packet overhead can worsen congestion during severe link saturation if probe rates are not throttled.',
            ],
            openHurdles: [
              'Already standard prior art in swarm-based routing literature; zero incremental novelty.',
            ],
            verdictSummary:
              'Mechanistically valid but well-established prior art (ACO / AntNet routing).',
          });
        }

        if (title.includes('Queen') && title.includes('Kubernetes')) {
          return wrapOpenAICompletion({
            scores: {
              mechanismDepth: 0,
              scalabilityAndConstraints: 1,
              technicalValue: 1,
              novelty: 1,
              evidenceQuality: 'PASS',
            },
            status: 'REJECTED_METAPHOR',
            criticalCounterarguments: [
              'Biological source explicitly states the ant queen emits reproductive fertility signals and does NOT schedule or route tasks; equating her with a Kubernetes master node is a false anthropomorphic metaphor.',
            ],
            openHurdles: ['No transferable scheduling or consensus mechanism exists in the biology text.'],
            verdictSummary:
              'Rejected superficial metaphor: biological queen is not a central scheduler.',
          });
        }

        // Distant domain calibration (Fungal spores vs Municipal tax law)
        return wrapOpenAICompletion({
          scores: {
            mechanismDepth: 0,
            scalabilityAndConstraints: 0,
            technicalValue: 0,
            novelty: 1,
            evidenceQuality: 'PASS',
          },
          status: 'REJECTED_METAPHOR',
          scalingWarning:
            'Physical osmotic turgor rupture and capillary coalescence have no causal or legal equivalence to statutory tax thresholds.',
          criticalCounterarguments: [
            'Shared words such as "threshold", "distribution", "network", and "screening" are purely homonymous across fungal biomechanics and municipal tax statutes.',
          ],
          openHurdles: ['No formalizable causal isomorphism between biological and legal domains.'],
          verdictSummary:
            'Superficial lexical parallel rejected; no transferable structural mechanism.',
        });
      }

      default:
        throw new Error(`Unhandled mock OpenAI schemaName: ${schemaName}`);
    }
  };
}

function buildConfigForCase(
  evalCase: EvalCase,
  assignments: ModelAssignments,
  strategy: CrossingStrategyType,
): RunConfig {
  const maxCandidates =
    evalCase.category === 'distant_domain_calibration' ? 6 : 3;

  return {
    outputLanguage: 'en',
    crossingStrategy: strategy,
    creativityDistance: 0.5,
    distanceBand: 'balanced',
    maxCandidates,
    includeDiagrams: false,
    pdfMathVisionMode: 'off',
    modelAssignments: assignments,
    weights: {
      mechanismDepth: 1,
      scalabilityAndConstraints: 1,
      technicalValue: 1,
      novelty: 1,
    },
    promptProfileSnapshot: createDefaultPromptProfile(),
  };
}

function evaluateCaseExpectations(
  evalCase: EvalCase,
  candidates: CrossingCandidate[],
  reviews: CriticReview[],
): {
  passed: boolean;
  failureReasons: string[];
  topScore: number;
  topStatus: VerdictStatus | 'NONE';
  rejectionRate: number;
  statusDistribution: Record<string, number>;
} {
  const statusDistribution: Record<string, number> = {};
  for (const r of reviews) {
    statusDistribution[r.status] = (statusDistribution[r.status] ?? 0) + 1;
  }

  const sortedReviews = [...reviews].sort(
    (a, b) => b.weightedTotalScore - a.weightedTotalScore,
  );
  const topReview = sortedReviews[0];
  const topScore = topReview?.weightedTotalScore ?? 0;
  const topStatus: VerdictStatus | 'NONE' = topReview?.status ?? 'NONE';

  const rejectedCount = reviews.filter((r) => REJECTED_STATUSES.has(r.status)).length;
  const rejectionRate = reviews.length > 0 ? rejectedCount / reviews.length : 0;

  const failureReasons: string[] = [];
  const { expectations } = evalCase;

  if (reviews.length === 0 || candidates.length === 0) {
    failureReasons.push('No crossing candidates or critic reviews were produced.');
  } else {
    if (
      expectations.expectedPrimaryStatuses.length > 0 &&
      !expectations.expectedPrimaryStatuses.includes(topReview.status)
    ) {
      failureReasons.push(
        `Top verdict status "${topReview.status}" not in expected [${expectations.expectedPrimaryStatuses.join(', ')}].`,
      );
    }

    if (
      expectations.minTopScore !== undefined &&
      topScore < expectations.minTopScore
    ) {
      failureReasons.push(
        `Top score ${topScore} < minTopScore ${expectations.minTopScore}.`,
      );
    }

    if (
      expectations.maxTopScore !== undefined &&
      topScore > expectations.maxTopScore
    ) {
      failureReasons.push(
        `Top score ${topScore} > maxTopScore ${expectations.maxTopScore}.`,
      );
    }

    if (
      expectations.expectedNovelty !== undefined &&
      topReview.scores.novelty !== expectations.expectedNovelty
    ) {
      failureReasons.push(
        `Top review novelty ${topReview.scores.novelty} !== expected ${expectations.expectedNovelty}.`,
      );
    }

    if (
      expectations.expectedMechanismDepth !== undefined &&
      topReview.scores.mechanismDepth !== expectations.expectedMechanismDepth
    ) {
      failureReasons.push(
        `Top review mechanismDepth ${topReview.scores.mechanismDepth} !== expected ${expectations.expectedMechanismDepth}.`,
      );
    }

    if (
      expectations.minRejectionRate !== undefined &&
      rejectionRate < expectations.minRejectionRate
    ) {
      failureReasons.push(
        `Rejection rate ${(rejectionRate * 100).toFixed(1)}% < minRejectionRate ${(expectations.minRejectionRate * 100).toFixed(1)}%.`,
      );
    }
  }

  return {
    passed: failureReasons.length === 0,
    failureReasons,
    topScore,
    topStatus,
    rejectionRate,
    statusDistribution,
  };
}

function resolveLiveAssignments(
  provider: ProviderId,
  options: RunEvalOptions,
): ModelAssignments {
  const base = PROVIDER_DEFAULT_MODELS[provider];
  const clone: ModelAssignments = {
    extraction: { ...base.extraction },
    vision: { ...base.vision },
    embedding: { ...base.embedding },
    crossing: { ...base.crossing },
    critic: { ...base.critic },
  };

  if (options.extractionModel) {
    clone.extraction.modelId = options.extractionModel;
  }
  if (options.crossingModel) {
    clone.crossing.modelId = options.crossingModel;
  }
  if (options.criticModel) {
    clone.critic.modelId = options.criticModel;
  }
  if (options.embeddingModel) {
    clone.embedding.modelId = options.embeddingModel;
  }
  return clone;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width - 1) + ' ' : text.padEnd(width, ' ');
}

function printCalibrationReport(suite: EvalSuiteResult): void {
  const line = '='.repeat(108);
  const sub = '-'.repeat(108);
  console.log(`\n${line}`);
  console.log(
    `BioBridge Calibration Eval Report | Mode: ${suite.mode.toUpperCase()} | Provider: ${suite.provider} | Strategy: ${suite.strategy}`,
  );
  console.log(line);
  console.log(
    [
      padRight('Case ID', 28),
      padRight('Status Distribution', 24),
      padRight('Top', 6),
      padRight('Verif.', 8),
      padRight('Retr.', 8),
      padRight('Rej.', 8),
      padRight('Cost ($)', 11),
      padRight('Result', 8),
    ].join(' | '),
  );
  console.log(sub);

  for (const res of suite.results) {
    const dist = Object.entries(res.statusDistribution)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    console.log(
      [
        padRight(res.caseId, 28),
        padRight(dist || 'NONE', 24),
        padRight(res.topScore.toFixed(1), 6),
        padRight(formatPercent(res.verificationRate), 8),
        padRight(formatPercent(res.retractionRate), 8),
        padRight(formatPercent(res.rejectionRate), 8),
        padRight(res.costUsd.toFixed(5), 11),
        padRight(res.passed ? 'PASS' : 'FAIL', 8),
      ].join(' | '),
    );
    if (!res.passed) {
      for (const reason of res.failureReasons) {
        console.log(`   -> FAIL: ${reason}`);
      }
    }
  }

  console.log(sub);
  console.log(
    `Summary: ${suite.passedCases}/${suite.totalCases} passed | Avg Verification: ${formatPercent(suite.summary.avgVerificationRate)} | Avg Retraction: ${formatPercent(suite.summary.avgRetractionRate)} | Avg Rejection: ${formatPercent(suite.summary.avgRejectionRate)} | Total Cost: $${suite.summary.totalCostUsd.toFixed(5)} | Duration: ${suite.summary.totalDurationMs} ms`,
  );
  console.log(`${line}\n`);
}

/**
 * Executes the BioBridge calibration evaluation suite end-to-end against
 * fake-indexeddb, ingestDocument, PipelineOrchestrator, and DirectBrowserTransport.
 */
export async function runEvalSuite(
  options: RunEvalOptions = {},
): Promise<EvalSuiteResult> {
  const isMock = options.mock ?? false;
  const provider: ProviderId = options.provider ?? (isMock ? 'openai' : 'gemini');
  const strategy: CrossingStrategyType =
    options.strategy ??
    (provider === 'anthropic' || provider === 'custom'
      ? 'cluster-batch'
      : 'embedding-hybrid');

  const assignments = resolveLiveAssignments(provider, options);

  const transport = new DirectBrowserTransport({
    getCredentials: () => ({
      apiKey: isMock ? 'mock-eval-key' : options.apiKey,
      baseUrl: options.baseUrl,
    }),
    ...(isMock ? { fetchFn: createDeterministicMockFetch() } : {}),
  });

  let datasets = await loadEvalDatasets(options.datasetDir);
  if (options.caseFilter && options.caseFilter.length > 0) {
    const allowed = new Set(options.caseFilter);
    datasets = datasets.filter((d) => allowed.has(d.id));
  }

  const results: EvalCaseResult[] = [];
  const db = createBioBridgeDB(`biobridge_eval_${Date.now()}`);

  try {
    for (const evalCase of datasets) {
      const startedAt = Date.now();
      const bio = await ingestDocument({
        fileName: evalCase.biologyDocument.fileName,
        domain: 'biology',
        data: evalCase.biologyDocument.markdownContent,
        documentId: `eval-bio-${evalCase.id}`,
      });
      const tech = await ingestDocument({
        fileName: evalCase.technologyDocument.fileName,
        domain: 'technology',
        data: evalCase.technologyDocument.markdownContent,
        documentId: `eval-tech-${evalCase.id}`,
      });

      const bioDoc = await saveDocumentWithPages(bio.document, bio.pages, db);
      const techDoc = await saveDocumentWithPages(tech.document, tech.pages, db);

      const now = new Date().toISOString();
      const expId = `eval-exp-${evalCase.id}-${Date.now()}`;
      const experiment: ExperimentRun = {
        id: expId,
        name: evalCase.name,
        createdAt: now,
        updatedAt: now,
        status: 'DRAFT',
        biologyDocIds: [bioDoc.id],
        technologyDocIds: [techDoc.id],
        config: buildConfigForCase(evalCase, assignments, strategy),
        checkpoint: {
          currentPhase: 'idle',
          completedVisionPageKeys: [],
          completedChunkKeys: [],
          completedPairKeys: [],
          completedReviewKeys: [],
        },
        costLedger: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalVisionImages: 0,
          totalCostUsd: 0,
          entries: [],
        },
      };
      await saveExperiment(experiment, db);

      const orchestrator = new PipelineOrchestrator({
        db,
        transport,
        ...(isMock ? { sleep: async () => {} } : {}),
      });

      const completedRun = await orchestrator.run(expId);
      const candidates = await getCandidatesForExperiment(expId, db);
      const reviews = await getReviewsForExperiment(expId, db);

      // Compute citation verification & retraction rates from cached extraction items
      const caches = await db.extractionCaches.toArray();
      const relevantDocIds = new Set([bioDoc.id, techDoc.id]);
      const allCitations = caches
        .filter((c) => relevantDocIds.has(c.documentId) && !c.cacheKey.startsWith('interim:'))
        .flatMap((c) => [
          ...(c.mechanisms ?? []).flatMap((m) => m.citations),
          ...(c.problems ?? []).flatMap((p) => p.citations),
        ]);

      const verifiedCount = allCitations.filter(isCitationVerified).length;
      const retractedCount = allCitations.filter(
        (c) => c.verification.status === 'RETRACTED_HALLUCINATION',
      ).length;

      const verificationRate =
        allCitations.length > 0 ? verifiedCount / allCitations.length : 0;
      const retractionRate =
        allCitations.length > 0 ? retractedCount / allCitations.length : 0;

      const evaluation = evaluateCaseExpectations(evalCase, candidates, reviews);
      const durationMs = Date.now() - startedAt;

      results.push({
        caseId: evalCase.id,
        name: evalCase.name,
        category: evalCase.category,
        passed: evaluation.passed,
        failureReasons: evaluation.failureReasons,
        candidateCount: candidates.length,
        reviewCount: reviews.length,
        statusDistribution: evaluation.statusDistribution,
        topScore: evaluation.topScore,
        topStatus: evaluation.topStatus,
        verificationRate,
        retractionRate,
        rejectionRate: evaluation.rejectionRate,
        costUsd: completedRun.costLedger.totalCostUsd,
        durationMs,
      });
    }
  } finally {
    await db.delete();
  }

  const passedCases = results.filter((r) => r.passed).length;
  const count = Math.max(1, results.length);
  const suite: EvalSuiteResult = {
    mode: isMock ? 'mock' : 'live',
    provider,
    strategy,
    passed: passedCases === results.length && results.length > 0,
    totalCases: results.length,
    passedCases,
    results,
    summary: {
      avgVerificationRate:
        results.reduce((s, r) => s + r.verificationRate, 0) / count,
      avgRetractionRate:
        results.reduce((s, r) => s + r.retractionRate, 0) / count,
      avgRejectionRate:
        results.reduce((s, r) => s + r.rejectionRate, 0) / count,
      totalCostUsd: results.reduce((s, r) => s + r.costUsd, 0),
      totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
    },
  };

  if (!options.silent) {
    printCalibrationReport(suite);
  }

  return suite;
}

function printHelp(): void {
  console.log(`
BioBridge Kalibrierungs-Eval-Harness / Calibration Eval Runner

Verwendung / Usage:
  npm run eval -- --mock                 Offline-Lauf gegen deterministischen Mock-Transport (kein API-Key nötig)
  npm run eval -- --help                 Diese Hilfe anzeigen

Live-API-Modus (ohne --mock) / Live API Mode:
  Setze folgende Umgebungsvariablen / Set these environment variables:
    BIOBRIDGE_PROVIDER           gemini | openai | anthropic | openrouter (Standard: gemini)
    BIOBRIDGE_API_KEY            API-Schlüssel für den gewählten Provider (Pflicht ohne --mock)
    BIOBRIDGE_EXTRACTION_MODEL   Optional: Modell-ID für Phase 2 Extraktion
    BIOBRIDGE_CROSSING_MODEL     Optional: Modell-ID für Phase 3 Kreuzung
    BIOBRIDGE_CRITIC_MODEL       Optional: Modell-ID für Phase 4 Advocatus Diaboli
    BIOBRIDGE_EMBEDDING_MODEL    Optional: Modell-ID für Embeddings (Phase 3A)
    BIOBRIDGE_STRATEGY           Optional: embedding-hybrid | cluster-batch
    BIOBRIDGE_BASE_URL           Optional: Benutzerdefinierte Basis-URL (z. B. für Ollama)
`);
}

function parseProviderEnv(raw?: string): ProviderId {
  const val = (raw ?? 'gemini').trim().toLowerCase();
  if (
    val === 'gemini' ||
    val === 'openai' ||
    val === 'anthropic' ||
    val === 'openrouter' ||
    val === 'custom'
  ) {
    return val;
  }
  throw new Error(
    `Ungültiger BIOBRIDGE_PROVIDER "${raw}". Erlaubt: gemini | openai | anthropic | openrouter | custom.`,
  );
}

function parseStrategyEnv(raw?: string): CrossingStrategyType | undefined {
  if (!raw || !raw.trim()) {
    return undefined;
  }
  const val = raw.trim().toLowerCase();
  if (val === 'embedding-hybrid' || val === 'cluster-batch') {
    return val;
  }
  throw new Error(
    `Ungültige BIOBRIDGE_STRATEGY "${raw}". Erlaubt: embedding-hybrid | cluster-batch.`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const isMock = args.includes('--mock');
  const caseFilter: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--case' && args[i + 1]) {
      caseFilter.push(args[i + 1]);
      i += 1;
    }
  }

  if (isMock) {
    const suite = await runEvalSuite({
      mock: true,
      ...(caseFilter.length > 0 ? { caseFilter } : {}),
    });
    process.exit(suite.passed ? 0 : 1);
  }

  const apiKey = process.env.BIOBRIDGE_API_KEY?.trim();
  const provider = parseProviderEnv(process.env.BIOBRIDGE_PROVIDER);
  if (!apiKey && provider !== 'custom') {
    console.error(`
[BioBridge Eval] Fehler: BIOBRIDGE_API_KEY ist nicht gesetzt.
Ohne "--mock" benötigt das Eval-Harness einen echten API-Key.

DE: Setze z. B. in PowerShell:
    $env:BIOBRIDGE_PROVIDER="gemini"
    $env:BIOBRIDGE_API_KEY="dein-api-key"
    npm run eval
    Oder führe für den kostenlosen Offline-Test aus:
    npm run eval -- --mock

EN: Set BIOBRIDGE_PROVIDER and BIOBRIDGE_API_KEY before running live eval,
    or run "npm run eval -- --mock" for deterministic offline verification.
`);
    process.exit(1);
  }

  const suite = await runEvalSuite({
    mock: false,
    provider,
    apiKey,
    baseUrl: process.env.BIOBRIDGE_BASE_URL?.trim() || undefined,
    extractionModel: process.env.BIOBRIDGE_EXTRACTION_MODEL?.trim() || undefined,
    crossingModel: process.env.BIOBRIDGE_CROSSING_MODEL?.trim() || undefined,
    criticModel: process.env.BIOBRIDGE_CRITIC_MODEL?.trim() || undefined,
    embeddingModel: process.env.BIOBRIDGE_EMBEDDING_MODEL?.trim() || undefined,
    strategy: parseStrategyEnv(process.env.BIOBRIDGE_STRATEGY),
    ...(caseFilter.length > 0 ? { caseFilter } : {}),
  });
  process.exit(suite.passed ? 0 : 1);
}

const isEntryPoint =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error('[BioBridge Eval] Fataler Fehler / Fatal error:', err);
    process.exit(1);
  });
}
