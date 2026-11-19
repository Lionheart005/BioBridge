import { describe, expect, it } from 'vitest';
import { ingestDocument } from '@/ingestion';
import { loadEvalDatasets, runEvalSuite } from '../../eval/run-eval';

const EXPECTED_DATASET_IDS = [
  'distant_domain_calibration',
  'known_classic_aco_routing',
  'metaphor_trap_queen_master',
  'positive_ants_autoscaling',
];

describe('Calibration Eval Datasets & Mock Eval Suite', () => {
  it('loads all 4 curated eval datasets with valid structure and non-empty documents', async () => {
    const datasets = await loadEvalDatasets();
    expect(datasets).toHaveLength(4);
    expect(datasets.map((d) => d.id).sort()).toEqual(EXPECTED_DATASET_IDS);

    for (const item of datasets) {
      expect(item.name.trim().length).toBeGreaterThan(5);
      expect(item.description.trim().length).toBeGreaterThan(10);
      expect(item.biologyDocument.fileName).toMatch(/\.md$/);
      expect(item.technologyDocument.fileName).toMatch(/\.md$/);
      expect(item.biologyDocument.markdownContent.trim().length).toBeGreaterThan(800);
      expect(item.technologyDocument.markdownContent.trim().length).toBeGreaterThan(800);
      expect(item.expectations.expectedPrimaryStatuses.length).toBeGreaterThan(0);

      if (item.category === 'positive_control') {
        expect(item.biologyDocument.markdownContent).toContain('$$');
      }
    }
  });

  it('parses every dataset biology and technology document cleanly via ingestDocument', async () => {
    const datasets = await loadEvalDatasets();

    for (const item of datasets) {
      const bio = await ingestDocument({
        fileName: item.biologyDocument.fileName,
        domain: 'biology',
        data: item.biologyDocument.markdownContent,
      });
      const tech = await ingestDocument({
        fileName: item.technologyDocument.fileName,
        domain: 'technology',
        data: item.technologyDocument.markdownContent,
      });

      expect(bio.document.format).toBe('md');
      expect(bio.document.domain).toBe('biology');
      expect(bio.document.pageCount).toBeGreaterThanOrEqual(1);
      expect(bio.pages[0].rawNormalizedText.length).toBeGreaterThan(500);

      expect(tech.document.format).toBe('md');
      expect(tech.document.domain).toBe('technology');
      expect(tech.document.pageCount).toBeGreaterThanOrEqual(1);
      expect(tech.pages[0].rawNormalizedText.length).toBeGreaterThan(500);
    }
  });

  it('executes runEvalSuite({ mock: true }) end-to-end and passes all 4 calibration cases', async () => {
    const suite = await runEvalSuite({ mock: true, silent: true });

    expect(suite.mode).toBe('mock');
    expect(suite.totalCases).toBe(4);
    expect(suite.passedCases).toBe(4);
    expect(suite.passed).toBe(true);
    expect(suite.summary.avgVerificationRate).toBe(1);
    expect(suite.summary.totalCostUsd).toBeGreaterThan(0);

    const byId = new Map(suite.results.map((r) => [r.caseId, r]));

    const positive = byId.get('positive_ants_autoscaling');
    expect(positive?.passed).toBe(true);
    expect(positive?.topStatus).toBe('PROMISING');
    expect(positive?.topScore).toBeGreaterThanOrEqual(7);

    const knownClassic = byId.get('known_classic_aco_routing');
    expect(knownClassic?.passed).toBe(true);
    expect(knownClassic?.topStatus).toBe('KNOWN_STANDARD');

    const metaphorTrap = byId.get('metaphor_trap_queen_master');
    expect(metaphorTrap?.passed).toBe(true);
    expect(metaphorTrap?.topStatus).toBe('REJECTED_METAPHOR');
    expect(metaphorTrap?.topScore).toBeLessThanOrEqual(2);

    const distant = byId.get('distant_domain_calibration');
    expect(distant?.passed).toBe(true);
    expect(distant?.rejectionRate).toBeGreaterThanOrEqual(0.8);
  });
});
