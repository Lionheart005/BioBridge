import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ITransportAdapter,
  type NormalizedCompletionRequest,
  type NormalizedCompletionResponse,
  type NormalizedEmbeddingRequest,
  type NormalizedEmbeddingResponse,
  TransportHttpError,
} from '@/ai';
import type {
  ExperimentRun,
  ParsedPage,
  RunConfig,
  SourceDocument,
} from '@/core/schemas';
import { ingestDocument } from '@/ingestion';
import {
  type PipelineEvent,
  PipelineOrchestrator,
} from '@/pipeline';
import { createDefaultPromptProfile } from '@/prompts';
import {
  type BioBridgeDB,
  createBioBridgeDB,
  getCandidatesForExperiment,
  getPagesForDocument,
  getReviewsForExperiment,
  saveDocumentWithPages,
  saveExperiment,
} from '@/storage';
import { createWorkerMessageHandler } from '@/workers/pipeline.worker';
import { PipelineWorkerClient } from '@/workers/workerClient';

const BIO_QUOTE_HARVESTER =
  'Harvester ant workers adjust their outgoing foraging rate based on brief antennal contact frequencies with returning food-bearing nestmates.';
const BIO_QUOTE_PHEROMONE =
  'Foraging ants deposit volatile trail pheromones along paths to food sources, causing shorter paths to accumulate higher pheromone concentration over time.';
const BIO_QUOTE_QUEEN =
  'The ant queen emits cuticular hydrocarbon pheromones that suppress worker reproduction without issuing centralized routing commands to individual foragers.';

const TECH_QUOTE_EDGE =
  'Distributed edge compute nodes experience overload spikes because centralized orchestrators suffer high control-plane latency under bursty workloads.';
const TECH_QUOTE_ROUTING =
  'Dynamic mesh networks suffer severe packet congestion when static shortest-path routing tables fail to adapt to transient link failures.';
const TECH_QUOTE_MASTER =
  'Cluster schedulers require deterministic task placement across heterogeneous worker pools while maintaining low coordination overhead.';

const BIO_DOC_TEXT = [
  '# Chapter 1: Harvester Ant Contact Regulation',
  '',
  `${BIO_QUOTE_HARVESTER} This feedback loop operates locally without global colony state awareness.`,
  '',
  '# Chapter 2: Trail Pheromone Dynamics',
  '',
  `${BIO_QUOTE_PHEROMONE} Positive feedback amplifies efficient paths while evaporation clears stale trails.`,
  '',
  '# Chapter 3: Colony Reproductive Signalling',
  '',
  `${BIO_QUOTE_QUEEN} Workers self-organize foraging independently of queen fertility cues.`,
].join('\n');

const TECH_DOC_1_TEXT = [
  '# Edge Compute Bottlenecks',
  '',
  `${TECH_QUOTE_EDGE} Local autonomous admission control could eliminate round-trip delays.`,
  '',
  '# Mesh Routing Congestion',
  '',
  `${TECH_QUOTE_ROUTING} Adaptive multipath metrics are needed under fluctuating radio links.`,
].join('\n');

const TECH_DOC_2_TEXT = [
  '# Master Scheduler Constraints',
  '',
  `${TECH_QUOTE_MASTER} Tight coupling to a single master creates single points of failure.`,
].join('\n');

interface MockCallLog {
  schemaName: string;
  role: string;
  request: NormalizedCompletionRequest;
}

interface MockBehaviorOptions {
  selfCorrectionMode?: boolean;
  failWith429Count?: number;
  visionText?: string;
}

class MockTransportAdapter implements ITransportAdapter {
  readonly mode = 'direct-byok' as const;
  readonly completionCalls: MockCallLog[] = [];
  readonly embeddingCalls: NormalizedEmbeddingRequest[] = [];
  private remaining429: number;
  private readonly selfCorrectionMode: boolean;
  private readonly visionText: string;

  constructor(options: MockBehaviorOptions = {}) {
    this.selfCorrectionMode = options.selfCorrectionMode ?? false;
    this.remaining429 = options.failWith429Count ?? 0;
    this.visionText =
      options.visionText ??
      'Diagram shows feedback loop with contact rate threshold k = 0.4 Hz.';
  }

  private getSchemaName(req: NormalizedCompletionRequest): string {
    if (req.responseFormat?.type === 'json_schema') {
      return req.responseFormat.schemaName;
    }
    return 'unknown';
  }

  private makeEmbeddingVector(text: string): number[] {
    const lower = text.toLowerCase();
    // Deterministic 4D semantic vectors so Harvester+Edge and Pheromone+Routing align closely
    if (lower.includes('contact') || lower.includes('edge') || lower.includes('admission')) {
      return [0.95, 0.2, 0.05, 0.1];
    }
    if (lower.includes('pheromone') || lower.includes('routing') || lower.includes('mesh')) {
      return [0.2, 0.95, 0.05, 0.1];
    }
    if (lower.includes('queen') || lower.includes('master') || lower.includes('scheduler')) {
      return [0.1, 0.1, 0.95, 0.1];
    }
    return [0.4, 0.4, 0.4, 0.4];
  }

  async sendEmbedding(
    req: NormalizedEmbeddingRequest,
  ): Promise<NormalizedEmbeddingResponse> {
    this.embeddingCalls.push(req);
    return {
      embeddings: req.texts.map((t) => this.makeEmbeddingVector(t)),
      provider: req.provider,
      modelId: req.modelId,
      usage: {
        inputTokens: req.texts.length * 100,
        outputTokens: 0,
      },
    };
  }

  async sendCompletion(
    req: NormalizedCompletionRequest,
  ): Promise<NormalizedCompletionResponse> {
    if (this.remaining429 > 0) {
      this.remaining429 -= 1;
      throw new TransportHttpError({
        message: 'Simulated 429 rate limit',
        errorKind: 'RATE_LIMIT_429',
        status: 429,
        retryAfterMs: 1,
        provider: req.provider,
      });
    }

    const schemaName = this.getSchemaName(req);
    this.completionCalls.push({ schemaName, role: req.role, request: req });
    const userMsg = req.messages[req.messages.length - 1]?.content ?? '';

    const wrap = (obj: unknown): NormalizedCompletionResponse => ({
      text: JSON.stringify(obj),
      provider: req.provider,
      modelId: req.modelId,
      usage: {
        inputTokens: 400,
        outputTokens: 200,
        ...(req.role === 'vision' ? { visionImages: 1 } : {}),
      },
    });

    switch (schemaName) {
      case 'VisionExtractOutput': {
        return wrap({
          pageNumber: 1,
          figures: [
            {
              figureRef: 'Fig. 1',
              captionOrTitle: 'Feedback Loop',
              mechanismOrContentSummary: this.visionText,
              keyQuantitiesAndUnits: ['0.4 Hz'],
            },
          ],
          reconstructedFormulas: [
            { contextLabel: 'Foraging Rate', latex: '$R = k \\cdot c_{in}$' },
          ],
          consolidatedPageSupplement: this.visionText,
        });
      }

      case 'ExtractBioOutput': {
        if (this.selfCorrectionMode) {
          return wrap({
            mechanisms: [
              {
                title: 'Harvester Ant Foraging Feedback',
                biologicalSystem: 'Pogonomyrmex barbatus',
                structure: 'Antennal contact network',
                workingPrinciple: 'Local contact rate modulation',
                achievedEffect: 'Adaptive foraging throughput',
                boundaryConditions: {
                  spatialScale: 'mm-m',
                  timeScale: 'seconds-minutes',
                  medium: 'terrestrial',
                  energyForm: 'metabolic',
                  operatingConstraints: 'dry desert conditions',
                },
                functionalAbstract: 'Local contact frequency admission control.',
                citations: [
                  {
                    pageNumber: 1,
                    sectionPath: 'Chapter 1',
                    // Deliberately broken short fragment -> triggers self-correction CORRECT_QUOTE
                    quoteOriginal: 'brief contact',
                  },
                ],
              },
              {
                title: 'Hallucinated Quantum Ant Mechanism',
                biologicalSystem: 'Fictional Ant',
                structure: 'Quantum antennae',
                workingPrinciple: 'Non-local entanglement',
                achievedEffect: 'Instant communication',
                boundaryConditions: {
                  spatialScale: 'nm',
                  timeScale: 'ns',
                  medium: 'vacuum',
                  energyForm: 'quantum',
                  operatingConstraints: 'none',
                },
                functionalAbstract: 'Entangled state synchronization.',
                citations: [
                  {
                    pageNumber: 1,
                    sectionPath: 'Chapter 1',
                    // Completely fabricated quote -> triggers RETRACT_HALLUCINATION
                    quoteOriginal:
                      'Ants communicate instantaneously across kilometers via quantum entangled pheromones.',
                  },
                ],
              },
            ],
          });
        }

        // Support multi-chunk book tests by matching chunk content
        const mechanisms = [];
        if (userMsg.includes('Harvester ant workers')) {
          mechanisms.push({
            title: 'Harvester Ant Contact Regulation',
            biologicalSystem: 'Pogonomyrmex barbatus',
            structure: 'Nest entrance interaction zone',
            workingPrinciple: 'Contact-rate-driven decentralized admission control',
            achievedEffect: 'Dynamic foraging rate matching food availability',
            boundaryConditions: {
              spatialScale: 'cm-m',
              timeScale: 'seconds',
              medium: 'air / solid',
              energyForm: 'chemical / mechanical',
              operatingConstraints: 'local neighborhood interaction',
            },
            functionalAbstract:
              'Decentralized admission control via local contact frequency feedback.',
            citations: [
              {
                pageNumber: 1,
                sectionPath: 'Chapter 1: Harvester Ant Contact Regulation',
                quoteOriginal: BIO_QUOTE_HARVESTER,
              },
            ],
          });
        }
        if (userMsg.includes('volatile trail pheromones')) {
          mechanisms.push({
            title: 'Pheromone Trail Reinforcement',
            biologicalSystem: 'Linepithema humile',
            structure: 'Chemotactic trail network',
            workingPrinciple: 'Positive pheromone feedback and evaporation',
            achievedEffect: 'Shortest-path convergence',
            boundaryConditions: {
              spatialScale: 'cm-m',
              timeScale: 'minutes',
              medium: 'surface',
              energyForm: 'chemical',
              operatingConstraints: 'volatile decay',
            },
            functionalAbstract:
              'Pheromone-weighted stochastic path reinforcement for routing.',
            citations: [
              {
                pageNumber: 1,
                sectionPath: 'Chapter 2: Trail Pheromone Dynamics',
                quoteOriginal: BIO_QUOTE_PHEROMONE,
              },
            ],
          });
        }
        if (userMsg.includes('ant queen emits')) {
          mechanisms.push({
            title: 'Ant Queen Fertility Signalling',
            biologicalSystem: 'Formica colony',
            structure: 'Queen cuticular hydrocarbons',
            workingPrinciple: 'Reproductive suppression signal',
            achievedEffect: 'Colony reproductive division',
            boundaryConditions: {
              spatialScale: 'mm-cm',
              timeScale: 'days',
              medium: 'contact',
              energyForm: 'biochemical',
              operatingConstraints: 'colony interior',
            },
            functionalAbstract:
              'Master queen chemical hierarchy signalling without task routing.',
            citations: [
              {
                pageNumber: 1,
                sectionPath: 'Chapter 3: Colony Reproductive Signalling',
                quoteOriginal: BIO_QUOTE_QUEEN,
              },
            ],
          });
        }
        // Generic fallback for multi-chunk synthetic pages
        if (mechanisms.length === 0 && userMsg.includes('Synthetic Biology Principle')) {
          const match = userMsg.match(
            /Synthetic Biology Principle \d+ regulates flux through membrane channels under steady osmotic pressure\./,
          );
          if (match) {
            const pageMatch = userMsg.match(/\[\[PAGE:(\d+)\]\]/);
            const pageNumber = pageMatch ? Number(pageMatch[1]) : 1;
            mechanisms.push({
              title: `Synthetic Mechanism Page ${pageNumber}`,
              biologicalSystem: 'Synthetic Organism',
              structure: 'Membrane channel',
              workingPrinciple: 'Osmotic flux regulation',
              achievedEffect: 'Pressure homeostasis',
              boundaryConditions: {
                spatialScale: 'um',
                timeScale: 'ms',
                medium: 'aqueous',
                energyForm: 'osmotic',
                operatingConstraints: 'isothermal',
              },
              functionalAbstract: `Osmotic feedback mechanism from page ${pageNumber}.`,
              citations: [
                {
                  pageNumber,
                  sectionPath: `Page ${pageNumber}`,
                  quoteOriginal: match[0],
                },
              ],
            });
          }
        }
        return wrap({ mechanisms });
      }

      case 'CitationRepairDecision': {
        const systemMsg = req.messages[0]?.content ?? '';
        if (systemMsg.includes('quantum entangled')) {
          return wrap({
            decision: 'RETRACT_HALLUCINATION',
            retractionReason: 'No quantum entanglement statement exists in source text.',
          });
        }
        return wrap({
          decision: 'CORRECT_QUOTE',
          correctedQuoteOriginal: BIO_QUOTE_HARVESTER,
          pageNumber: 1,
        });
      }

      case 'ExtractTechOutput': {
        const problems = [];
        if (userMsg.includes('Distributed edge compute nodes')) {
          problems.push({
            title: 'Decentralized Edge Autoscaling',
            technicalDomain: 'Distributed Edge Computing',
            problemStatement: 'Centralized autoscalers lag behind bursty edge loads',
            coreBottleneck: 'Control-plane coordination latency',
            targetMetrics: 'p99 latency < 20ms',
            currentApproachesAndLimits: 'Centralized control plane saturates under bursts',
            boundaryConditions: {
              spatialScale: 'distributed edge nodes',
              timeScale: 'milliseconds-seconds',
              medium: 'IP network',
              energyForm: 'electrical',
              operatingConstraints: 'bounded local bandwidth',
            },
            functionalNeedAbstract:
              'Decentralized admission control via local contact frequency feedback.',
            citations: [
              {
                pageNumber: 1,
                sectionPath: 'Edge Compute Bottlenecks',
                quoteOriginal: TECH_QUOTE_EDGE,
              },
            ],
          });
        }
        if (userMsg.includes('Dynamic mesh networks')) {
          problems.push({
            title: 'Network Packet Routing Congestion',
            technicalDomain: 'Mesh Networking',
            problemStatement: 'Static routing causes congestion on transient links',
            coreBottleneck: 'Slow path re-convergence',
            targetMetrics: 'packet loss < 1%',
            currentApproachesAndLimits: 'Static OSPF tables fail on link churn',
            boundaryConditions: {
              spatialScale: 'm-km',
              timeScale: 'ms-seconds',
              medium: 'wireless RF',
              energyForm: 'electrical',
              operatingConstraints: 'battery nodes',
            },
            functionalNeedAbstract:
              'Adaptive stochastic path routing under fluctuating network links.',
            citations: [
              {
                pageNumber: 1,
                sectionPath: 'Mesh Routing Congestion',
                quoteOriginal: TECH_QUOTE_ROUTING,
              },
            ],
          });
        }
        if (userMsg.includes('Cluster schedulers require')) {
          problems.push({
            title: 'Centralized Microservice Master Scheduling',
            technicalDomain: 'Cluster Orchestration',
            problemStatement: 'Master scheduler coordination overhead',
            coreBottleneck: 'Master node bottleneck',
            targetMetrics: '10k tasks/sec',
            currentApproachesAndLimits: 'Single master scheduler lock contention',
            boundaryConditions: {
              spatialScale: 'datacenter',
              timeScale: 'ms',
              medium: 'ethernet',
              energyForm: 'electrical',
              operatingConstraints: 'deterministic placement',
            },
            functionalNeedAbstract:
              'Master scheduler task placement hierarchy with low coordination overhead.',
            citations: [
              {
                pageNumber: 1,
                sectionPath: 'Master Scheduler Constraints',
                quoteOriginal: TECH_QUOTE_MASTER,
              },
            ],
          });
        }
        return wrap({ problems });
      }

      case 'ConsolidateMechanismsOutput': {
        const parsed = JSON.parse(userMsg) as {
          items: Array<Record<string, unknown>>;
        };
        const firstTwo = parsed.items.slice(0, 2);
        const rest = parsed.items.slice(2);
        const consolidatedItems = [
          {
            mergedFromIds: firstTwo.map((i) => i.id as string),
            canonicalItem: {
              ...firstTwo[0],
              title: 'Consolidated Osmotic Mechanism',
            },
          },
          ...rest.map((item) => ({
            mergedFromIds: [item.id as string],
            canonicalItem: item,
          })),
        ];
        return wrap({ consolidatedItems });
      }

      case 'DomainClustersOutput': {
        const parsed = JSON.parse(userMsg) as {
          domain: string;
          items: Array<{ id: string }>;
        };
        return wrap({
          clusters: [
            {
              id: `${parsed.domain}-c1`,
              label: `${parsed.domain} Group 1`,
              description: 'Primary cluster',
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
          abstractTransferLogic: `Structural transfer between ${pair.mechanism.title} and ${pair.problem.title}.`,
          proposedImplementationSketch:
            'Implement local feedback controller based on interaction rate.',
          keyAssumptions: ['Local state sampling is cheaper than global sync'],
          potentialFailureModes: ['Oscillation under extreme burst arrival'],
          mechanismCitationIds: pair.mechanism.citations.map((c) => c.citationId),
          problemCitationIds: pair.problem.citations.map((c) => c.citationId),
        }));
        return wrap({ candidates });
      }

      case 'CriticReviewOutput': {
        const parsed = JSON.parse(userMsg) as {
          hypothesis: { bridgeTitle: string };
        };
        const title = parsed.hypothesis.bridgeTitle;

        if (title.includes('Pheromone') && title.includes('Routing')) {
          return wrap({
            scores: {
              mechanismDepth: 3,
              scalabilityAndConstraints: 2,
              technicalValue: 1,
              novelty: 0,
              evidenceQuality: 'PASS',
            },
            status: 'KNOWN_STANDARD',
            knownPriorArt: 'Ant Colony Optimization (ACO) routing (Di Caro & Dorigo)',
            criticalCounterarguments: [
              'Standard ACO routing is well established in literature.',
            ],
            openHurdles: ['Pheromone convergence lag under rapid topology churn'],
            verdictSummary: 'Known biomimetic standard (ACO).',
          });
        }

        if (title.includes('Queen')) {
          return wrap({
            scores: {
              mechanismDepth: 0,
              scalabilityAndConstraints: 1,
              technicalValue: 1,
              novelty: 1,
              evidenceQuality: 'PASS',
            },
            status: 'REJECTED_METAPHOR',
            criticalCounterarguments: [
              'Ant queen does not act as a computational orchestrator; purely rhetorical metaphor.',
            ],
            openHurdles: ['No transferable control mechanism'],
            verdictSummary: 'Superficial metaphor rejected.',
          });
        }

        return wrap({
          scores: {
            mechanismDepth: 3,
            scalabilityAndConstraints: 3,
            technicalValue: 2,
            novelty: 2,
            evidenceQuality: 'PASS',
          },
          status: 'PROMISING',
          criticalCounterarguments: [
            'Requires tuning contact-window decay under heterogeneous node capacities.',
          ],
          openHurdles: ['Verify stability under correlated burst traffic'],
          verdictSummary: 'Strong mechanistic analogy with verified citations.',
        });
      }

      default:
        throw new Error(`Unhandled mock schemaName: ${schemaName}`);
    }
  }
}

function makeConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  const profile = createDefaultPromptProfile();
  return {
    outputLanguage: 'en',
    crossingStrategy: 'embedding-hybrid',
    creativityDistance: 0.5,
    distanceBand: 'balanced',
    maxCandidates: 6,
    includeDiagrams: false,
    pdfMathVisionMode: 'off',
    modelAssignments: {
      extraction: { provider: 'gemini', modelId: 'gemini-2.5-flash', temperature: 0.1 },
      vision: { provider: 'gemini', modelId: 'gemini-2.5-flash', temperature: 0.1 },
      embedding: { provider: 'openai', modelId: 'text-embedding-3-small' },
      crossing: { provider: 'gemini', modelId: 'gemini-2.5-pro', temperature: 0.4 },
      critic: { provider: 'anthropic', modelId: 'claude-3-7-sonnet-latest', temperature: 0.1 },
    },
    weights: {
      mechanismDepth: 1,
      scalabilityAndConstraints: 1,
      technicalValue: 1,
      novelty: 1,
    },
    promptProfileSnapshot: profile,
    ...overrides,
  };
}

function makeExperiment(
  id: string,
  biologyDocIds: string[],
  technologyDocIds: string[],
  config: RunConfig,
): ExperimentRun {
  const now = new Date().toISOString();
  return {
    id,
    name: `Test Experiment ${id}`,
    createdAt: now,
    updatedAt: now,
    status: 'DRAFT',
    biologyDocIds,
    technologyDocIds,
    config,
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
}

async function seedDocs(db: BioBridgeDB): Promise<{
  bioDoc: SourceDocument;
  techDoc1: SourceDocument;
  techDoc2: SourceDocument;
}> {
  const bio = await ingestDocument({
    fileName: 'harvester_ants.md',
    domain: 'biology',
    data: BIO_DOC_TEXT,
    documentId: 'doc-bio-1',
  });
  const tech1 = await ingestDocument({
    fileName: 'edge_networks.md',
    domain: 'technology',
    data: TECH_DOC_1_TEXT,
    documentId: 'doc-tech-1',
  });
  const tech2 = await ingestDocument({
    fileName: 'master_schedulers.md',
    domain: 'technology',
    data: TECH_DOC_2_TEXT,
    documentId: 'doc-tech-2',
  });

  const bioDoc = await saveDocumentWithPages(bio.document, bio.pages, db);
  const techDoc1 = await saveDocumentWithPages(tech1.document, tech1.pages, db);
  const techDoc2 = await saveDocumentWithPages(tech2.document, tech2.pages, db);
  return { bioDoc, techDoc1, techDoc2 };
}

describe('End-to-End 5-Phase Pipeline & Web Worker Integration', () => {
  let db: BioBridgeDB;
  let dbCounter = 0;

  beforeEach(() => {
    dbCounter += 1;
    db = createBioBridgeDB(`biobridge_e2e_${Date.now()}_${dbCounter}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('1. executes full 5-phase run with embedding-hybrid (asymmetric 1 bio x 2 tech) and enforces critic verdicts & isolation', async () => {
    const { bioDoc, techDoc1, techDoc2 } = await seedDocs(db);
    const transport = new MockTransportAdapter();
    const events: PipelineEvent[] = [];

    const exp = makeExperiment(
      'exp-embedding-1',
      [bioDoc.id],
      [techDoc1.id, techDoc2.id],
      makeConfig({ crossingStrategy: 'embedding-hybrid', maxCandidates: 9 }),
    );
    await saveExperiment(exp, db);

    const orchestrator = new PipelineOrchestrator({
      db,
      transport,
      sleep: async () => {},
      onEvent: (e) => events.push(e),
    });

    const result = await orchestrator.run(exp.id);
    expect(result.status).toBe('COMPLETED');
    expect(result.checkpoint.currentPhase).toBe('completed');
    expect(result.costLedger.totalCostUsd).toBeGreaterThan(0);

    // Embeddings were invoked
    expect(transport.embeddingCalls.length).toBeGreaterThan(0);

    // Strict domain isolation in Phase 2
    const bioCalls = transport.completionCalls.filter(
      (c) => c.schemaName === 'ExtractBioOutput',
    );
    const techCalls = transport.completionCalls.filter(
      (c) => c.schemaName === 'ExtractTechOutput',
    );
    expect(bioCalls.length).toBe(1);
    expect(techCalls.length).toBe(2);
    expect(bioCalls[0].request.messages[1].content).not.toContain('edge compute');
    for (const tc of techCalls) {
      expect(tc.request.messages[1].content).not.toContain('Harvester ant');
    }

    // Strict critic isolation (fresh 2-message conversation using critic model)
    const criticCalls = transport.completionCalls.filter(
      (c) => c.schemaName === 'CriticReviewOutput',
    );
    expect(criticCalls.length).toBeGreaterThan(0);
    for (const cc of criticCalls) {
      expect(cc.request.messages).toHaveLength(2);
      expect(cc.request.provider).toBe('anthropic');
      expect(cc.request.modelId).toBe('claude-3-7-sonnet-latest');
    }

    const candidates = await getCandidatesForExperiment(exp.id, db);
    const reviews = await getReviewsForExperiment(exp.id, db);
    expect(candidates.length).toBe(9);
    expect(reviews.length).toBe(9);

    const promising = reviews.find(
      (r) =>
        r.status === 'PROMISING' &&
        candidates
          .find((c) => c.id === r.candidateId)
          ?.bridgeTitle.includes('Harvester Ant') &&
        candidates
          .find((c) => c.id === r.candidateId)
          ?.bridgeTitle.includes('Edge Autoscaling'),
    );
    expect(promising).toBeDefined();
    expect(promising!.weightedTotalScore).toBeGreaterThanOrEqual(7);

    const knownStandard = reviews.find(
      (r) =>
        r.status === 'KNOWN_STANDARD' &&
        candidates
          .find((c) => c.id === r.candidateId)
          ?.bridgeTitle.includes('Pheromone') &&
        candidates
          .find((c) => c.id === r.candidateId)
          ?.bridgeTitle.includes('Routing'),
    );
    expect(knownStandard).toBeDefined();
    expect(knownStandard!.scores.novelty).toBe(0);

    const rejectedMetaphor = reviews.find((r) => r.status === 'REJECTED_METAPHOR');
    expect(rejectedMetaphor).toBeDefined();
    expect(rejectedMetaphor!.weightedTotalScore).toBeLessThanOrEqual(2);

    expect(events.some((e) => e.type === 'completed')).toBe(true);
    expect(events.some((e) => e.type === 'citation_verified')).toBe(true);
  });

  it('2. executes full 5-phase run with cluster-batch and makes 0 embedding API calls', async () => {
    const { bioDoc, techDoc1, techDoc2 } = await seedDocs(db);
    const transport = new MockTransportAdapter();

    const exp = makeExperiment(
      'exp-cluster-1',
      [bioDoc.id],
      [techDoc1.id, techDoc2.id],
      makeConfig({
        crossingStrategy: 'cluster-batch',
        distanceBand: 'exploratory',
        maxCandidates: 4,
      }),
    );
    await saveExperiment(exp, db);

    const orchestrator = new PipelineOrchestrator({
      db,
      transport,
      sleep: async () => {},
    });

    const result = await orchestrator.run(exp.id);
    expect(result.status).toBe('COMPLETED');
    expect(transport.embeddingCalls).toHaveLength(0);

    const candidates = await getCandidatesForExperiment(exp.id, db);
    const reviews = await getReviewsForExperiment(exp.id, db);
    expect(candidates.length).toBe(4);
    expect(reviews.length).toBe(4);
    expect(candidates.every((c) => c.strategyUsed === 'cluster-batch')).toBe(true);
  });

  it('3. reuses cached biology extraction with 0 Phase 2 extraction calls on second experiment', async () => {
    const { bioDoc, techDoc1, techDoc2 } = await seedDocs(db);
    const transport1 = new MockTransportAdapter();

    const exp1 = makeExperiment(
      'exp-cache-1',
      [bioDoc.id],
      [techDoc1.id],
      makeConfig({ maxCandidates: 3 }),
    );
    await saveExperiment(exp1, db);
    await new PipelineOrchestrator({
      db,
      transport: transport1,
      sleep: async () => {},
    }).run(exp1.id);

    // Second experiment reuses bioDoc (and tests techDoc2)
    const transport2 = new MockTransportAdapter();
    const exp2 = makeExperiment(
      'exp-cache-2',
      [bioDoc.id],
      [techDoc2.id],
      makeConfig({ maxCandidates: 3 }),
    );
    await saveExperiment(exp2, db);
    const res2 = await new PipelineOrchestrator({
      db,
      transport: transport2,
      sleep: async () => {},
    }).run(exp2.id);

    expect(res2.status).toBe('COMPLETED');
    const bioExtractCallsInRun2 = transport2.completionCalls.filter(
      (c) => c.schemaName === 'ExtractBioOutput',
    );
    expect(bioExtractCallsInRun2).toHaveLength(0);
    const techExtractCallsInRun2 = transport2.completionCalls.filter(
      (c) => c.schemaName === 'ExtractTechOutput',
    );
    expect(techExtractCallsInRun2).toHaveLength(1);
  });

  it('4. performs end-to-end self-correction (CORRECTED_VERIFIED) and enforces RETRACTED with score 0 in Phase 4', async () => {
    const { bioDoc, techDoc2 } = await seedDocs(db);
    const transport = new MockTransportAdapter({ selfCorrectionMode: true });
    const citationEvents: Extract<PipelineEvent, { type: 'citation_verified' }>[] =
      [];

    const exp = makeExperiment(
      'exp-self-correct',
      [bioDoc.id],
      [techDoc2.id],
      makeConfig({
        crossingStrategy: 'cluster-batch',
        maxCandidates: 2,
      }),
    );
    await saveExperiment(exp, db);

    const result = await new PipelineOrchestrator({
      db,
      transport,
      sleep: async () => {},
      onEvent: (e) => {
        if (e.type === 'citation_verified') {
          citationEvents.push(e);
        }
      },
    }).run(exp.id);

    expect(result.status).toBe('COMPLETED');
    expect(
      citationEvents.some((e) => e.status === 'CORRECTED_VERIFIED'),
    ).toBe(true);
    expect(
      citationEvents.some((e) => e.status === 'RETRACTED_HALLUCINATION'),
    ).toBe(true);

    const candidates = await getCandidatesForExperiment(exp.id, db);
    const reviews = await getReviewsForExperiment(exp.id, db);
    expect(reviews).toHaveLength(2);

    const retractedReview = reviews.find((r) => {
      const cand = candidates.find((c) => c.id === r.candidateId);
      return cand?.bridgeTitle.includes('Quantum Ant');
    });
    expect(retractedReview).toBeDefined();
    expect(retractedReview!.status).toBe('RETRACTED');
    expect(retractedReview!.weightedTotalScore).toBe(0);
    expect(retractedReview!.scores.evidenceQuality).toBe('KO');

    const repairedReview = reviews.find((r) => {
      const cand = candidates.find((c) => c.id === r.candidateId);
      return cand?.bridgeTitle.includes('Harvester Ant');
    });
    expect(repairedReview).toBeDefined();
    expect(repairedReview!.status).toBe('PROMISING');
    expect(repairedReview!.weightedTotalScore).toBeGreaterThanOrEqual(7);
  });

  it('5. pauses after Chunk 1 as PAUSED, resumes in a brand new PipelineOrchestrator skipping completed chunks, and consolidates multi-chunk book', async () => {
    // Build a multi-chunk biology book (> 1 chunk and > 4 items) to test both resume and consolidation
    const pages: ParsedPage[] = Array.from({ length: 14 }, (_, idx) => {
      const p = idx + 1;
      const filler = `Detailed physiological observation paragraph on page ${p}. `.repeat(
        45,
      );
      return {
        documentId: 'doc-bio-book',
        pageNumber: p,
        sectionPath: [`Chapter ${Math.ceil(p / 3)}`],
        rawNormalizedText: `Synthetic Biology Principle ${p} regulates flux through membrane channels under steady osmotic pressure.\n\n${filler}`,
        blocks: [
          {
            id: `b-${p}`,
            type: 'paragraph',
            content: `Synthetic Biology Principle ${p} regulates flux through membrane channels under steady osmotic pressure.`,
          },
        ],
      };
    });

    const bookDoc: SourceDocument = {
      id: 'doc-bio-book',
      domain: 'biology',
      fileName: 'big_bio_book.pdf',
      mimeType: 'application/pdf',
      format: 'pdf',
      contentHash: 'hash-big-bio-book',
      fileSizeBytes: 60_000,
      pageCount: pages.length,
      detectedLanguage: 'en',
      stats: {
        totalChars: pages.reduce((s, p) => s + p.rawNormalizedText.length, 0),
        estimatedTokens: 15_000,
        detectedFigurePages: [],
        detectedMathAnomalyPages: [],
      },
      createdAt: new Date().toISOString(),
    };
    await saveDocumentWithPages(bookDoc, pages, db);

    const tech = await ingestDocument({
      fileName: 'edge_networks.md',
      domain: 'technology',
      data: TECH_DOC_1_TEXT,
      documentId: 'doc-tech-resume',
    });
    await saveDocumentWithPages(tech.document, tech.pages, db);

    const transport1 = new MockTransportAdapter();
    const exp = makeExperiment(
      'exp-resume-1',
      [bookDoc.id],
      [tech.document.id],
      makeConfig({ crossingStrategy: 'cluster-batch', maxCandidates: 4 }),
    );
    await saveExperiment(exp, db);

    const orchestrator1 = new PipelineOrchestrator({
      db,
      transport: transport1,
      sleep: async () => {},
      onEvent: (event) => {
        if (
          event.type === 'progress' &&
          event.phase === 'phase2_extract' &&
          event.completed === 1
        ) {
          orchestrator1.requestStopAsPaused();
        }
      },
    });

    const pausedRun = await orchestrator1.run(exp.id);
    expect(pausedRun.status).toBe('PAUSED');
    expect(pausedRun.checkpoint.currentPhase).toBe('phase2_extract');
    expect(pausedRun.checkpoint.completedChunkKeys).toEqual([
      `${bookDoc.id}:chunk:0`,
    ]);

    const callsInRun1 = transport1.completionCalls.filter(
      (c) => c.schemaName === 'ExtractBioOutput',
    ).length;
    expect(callsInRun1).toBe(1);

    // Instantiate a completely new orchestrator to resume
    const transport2 = new MockTransportAdapter();
    const orchestrator2 = new PipelineOrchestrator({
      db,
      transport: transport2,
      sleep: async () => {},
    });

    const completedRun = await orchestrator2.run(exp.id);
    expect(completedRun.status).toBe('COMPLETED');
    expect(completedRun.checkpoint.currentPhase).toBe('completed');

    // Chunk 0 must NOT be re-processed in Run 2
    const chunk0Reprocessed = transport2.completionCalls.some(
      (c) =>
        c.schemaName === 'ExtractBioOutput' &&
        c.request.messages[1].content.includes('Chunk 1/'),
    );
    expect(chunk0Reprocessed).toBe(false);

    // Book consolidation ran because > 1 chunk and > 4 mechanisms
    const consolidateCalls = transport2.completionCalls.filter(
      (c) => c.schemaName === 'ConsolidateMechanismsOutput',
    );
    expect(consolidateCalls.length).toBe(1);

    const reviews = await getReviewsForExperiment(exp.id, db);
    expect(reviews.length).toBe(4);
  });

  it('6. stops safely with BUDGET_STOPPED and saved checkpoint when budgetLimitUsd is exceeded', async () => {
    const { bioDoc, techDoc1 } = await seedDocs(db);
    const transport = new MockTransportAdapter();
    const events: PipelineEvent[] = [];

    const exp = makeExperiment(
      'exp-budget-stop',
      [bioDoc.id],
      [techDoc1.id],
      makeConfig({
        budgetLimitUsd: 0.00005, // Exceeded right after first extraction call
      }),
    );
    await saveExperiment(exp, db);

    const orchestrator = new PipelineOrchestrator({
      db,
      transport,
      sleep: async () => {},
      onEvent: (e) => events.push(e),
    });

    const result = await orchestrator.run(exp.id);
    expect(result.status).toBe('BUDGET_STOPPED');
    expect(result.costLedger.totalCostUsd).toBeGreaterThanOrEqual(0.00005);
    expect(result.checkpoint.completedChunkKeys.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === 'budget_stopped')).toBe(true);
  });

  it('7. recovers automatically from 429 rate limit errors during pipeline execution', async () => {
    const { bioDoc, techDoc2 } = await seedDocs(db);
    const transport = new MockTransportAdapter({ failWith429Count: 2 });

    const exp = makeExperiment(
      'exp-429-retry',
      [bioDoc.id],
      [techDoc2.id],
      makeConfig({ crossingStrategy: 'cluster-batch', maxCandidates: 2 }),
    );
    await saveExperiment(exp, db);

    const orchestrator = new PipelineOrchestrator({
      db,
      transport,
      maxRetries: 3,
      baseBackoffMs: 1,
      sleep: async () => {},
    });

    const result = await orchestrator.run(exp.id);
    expect(result.status).toBe('COMPLETED');
    const reviews = await getReviewsForExperiment(exp.id, db);
    expect(reviews.length).toBe(2);
  });

  it('8. executes Phase 1b vision enrichment (and skips null page images gracefully) and works via PipelineWorkerClient & worker handler', async () => {
    const { bioDoc, techDoc2 } = await seedDocs(db);
    const bioPages = await getPagesForDocument(bioDoc.id, db);
    await db.parsedPages.put({
      ...bioPages[0],
      hasDiagram: true,
    });

    const transport = new MockTransportAdapter({
      visionText: 'Vision discovered antennal contact rate k = 0.4 Hz.',
    });

    const exp = makeExperiment(
      'exp-vision-worker',
      [bioDoc.id],
      [techDoc2.id],
      makeConfig({
        includeDiagrams: true,
        crossingStrategy: 'cluster-batch',
        maxCandidates: 2,
      }),
    );
    await saveExperiment(exp, db);

    const client = new PipelineWorkerClient({
      db,
      transport,
      sleep: async () => {},
      forceMainThread: true,
      pageImageProvider: async (docId) =>
        docId === bioDoc.id
          ? { mimeType: 'image/png', dataBase64: 'AAAA' }
          : null,
    });

    const workerEvents: PipelineEvent[] = [];
    const unsubscribe = client.onEvent((e) => workerEvents.push(e));

    const result = await client.runExperiment(exp.id);
    unsubscribe();
    client.dispose();

    expect(result.status).toBe('COMPLETED');
    expect(result.checkpoint.completedVisionPageKeys).toContain(`${bioDoc.id}:p:1`);
    const updatedPages = await getPagesForDocument(bioDoc.id, db);
    expect(updatedPages[0].blocks.some((b) => b.type === 'figure_vision')).toBe(
      true,
    );
    expect(updatedPages[0].rawNormalizedText).toContain(
      'Vision discovered antennal contact rate k = 0.4 Hz.',
    );
    expect(workerEvents.some((e) => e.type === 'completed')).toBe(true);

    // Also verify createWorkerMessageHandler RPC protocol roundtrip
    const outbound: unknown[] = [];
    const handler = createWorkerMessageHandler({
      db,
      postMessage: (msg) => outbound.push(msg),
      transportFactory: async () => transport,
    });
    await handler({
      requestId: 'req-1',
      type: 'INGEST_DOCUMENT',
      payload: {
        fileName: 'worker_test.md',
        domain: 'technology',
        data: '# Worker\n\nSimple worker ingestion test document with enough text.',
      },
    });
    expect(outbound).toHaveLength(1);
    expect((outbound[0] as { type: string }).type).toBe('RPC_RESULT');
  });
});
