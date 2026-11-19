import type {
  CostLedger,
  CriticReview,
  CrossingCandidate,
  ExperimentRun,
  ExperimentStatus,
  PipelineCheckpoint,
} from '@/core/schemas';
import { db, type BioBridgeDB } from '../db';

export async function saveExperiment(
  run: ExperimentRun,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.experiments.put(run);
}

export async function getExperiment(
  id: string,
  database: BioBridgeDB = db,
): Promise<ExperimentRun | undefined> {
  return database.experiments.get(id);
}

export async function listExperiments(database: BioBridgeDB = db): Promise<ExperimentRun[]> {
  return database.experiments.orderBy('updatedAt').reverse().toArray();
}

export async function updateCheckpoint(
  experimentId: string,
  checkpoint: PipelineCheckpoint,
  status?: ExperimentStatus,
  costLedger?: CostLedger,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.transaction('rw', database.experiments, async () => {
    const existing = await database.experiments.get(experimentId);
    if (!existing) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    const updated: ExperimentRun = {
      ...existing,
      checkpoint,
      updatedAt: new Date().toISOString(),
      ...(status !== undefined ? { status } : {}),
      ...(costLedger !== undefined ? { costLedger } : {}),
    };

    await database.experiments.put(updated);
  });
}

export async function saveCandidates(
  candidates: CrossingCandidate[],
  database: BioBridgeDB = db,
): Promise<void> {
  if (candidates.length === 0) {
    return;
  }
  await database.candidates.bulkPut(candidates);
}

export async function getCandidatesForExperiment(
  experimentId: string,
  database: BioBridgeDB = db,
): Promise<CrossingCandidate[]> {
  return database.candidates.where('experimentId').equals(experimentId).toArray();
}

export async function saveReviews(
  reviews: CriticReview[],
  database: BioBridgeDB = db,
): Promise<void> {
  if (reviews.length === 0) {
    return;
  }
  await database.reviews.bulkPut(reviews);
}

export async function getReviewsForExperiment(
  experimentId: string,
  database: BioBridgeDB = db,
): Promise<CriticReview[]> {
  return database.reviews.where('experimentId').equals(experimentId).toArray();
}

export async function deleteExperimentCascade(
  experimentId: string,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.transaction(
    'rw',
    database.experiments,
    database.candidates,
    database.reviews,
    async () => {
      await database.experiments.delete(experimentId);
      await database.candidates.where('experimentId').equals(experimentId).delete();
      await database.reviews.where('experimentId').equals(experimentId).delete();
    },
  );
}
