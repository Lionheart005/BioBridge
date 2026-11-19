import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProjectBundle } from '@/storage/exporters/projectBundleIo';
import {
  runCliBuildBundle,
  runCliIngest,
  runCliVerify,
} from '../../scripts/biobridge-cli';

describe('BioBridge Local CLI (Antigravity-Abo-Brücke)', () => {
  it('runs end-to-end ingest -> verify (with failure + attempt 2 retraction) -> build-bundle', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'biobridge-cli-test-'));

    try {
      const bioPath = path.join(tempRoot, 'shark_riblets.md');
      const techPath = path.join(tempRoot, 'compressor_blade.md');
      const runDir = path.join(tempRoot, 'run');

      const bioValidQuote =
        'Micro-riblets aligned with the flow reduce turbulent skin friction drag by up to eight percent in water.';
      const techValidQuote =
        'Turbulent boundary layer separation on compressor blades causes severe total pressure losses at high Reynolds numbers.';

      await writeFile(
        bioPath,
        [
          '# Shark Skin Riblets',
          '',
          bioValidQuote,
          '',
          'The dimensionless riblet spacing follows $s^+ = \\frac{s u_\\tau}{\\nu} \\approx 15$ for optimal drag reduction.',
        ].join('\n'),
        'utf-8',
      );

      await writeFile(
        techPath,
        [
          '# Compressor Blade Bottleneck',
          '',
          techValidQuote,
          '',
          'Polished smooth surfaces reach their physical drag reduction limit under high-load operation.',
        ].join('\n'),
        'utf-8',
      );

      // 1. Ingest
      const ingestResult = await runCliIngest({
        bioPaths: [bioPath],
        techPaths: [techPath],
        outDir: runDir,
      });

      expect(ingestResult.documents).toHaveLength(2);
      expect(ingestResult.manifest.bioChunks.length).toBeGreaterThanOrEqual(1);
      expect(ingestResult.manifest.techChunks.length).toBeGreaterThanOrEqual(1);

      const bioDoc = ingestResult.documents.find((d) => d.domain === 'biology')!;
      const techDoc = ingestResult.documents.find((d) => d.domain === 'technology')!;

      // 2. Verify Biology (Attempt 1: 1 valid quote + 1 too-short/invalid quote -> lands in report)
      const rawBioPath = path.join(runDir, 'raw_biology.json');
      await writeFile(
        rawBioPath,
        JSON.stringify(
          {
            mechanisms: [
              {
                id: 'mech_valid',
                title: 'Riblet Drag Reduction',
                biologicalSystem: 'Shark Placoid Scales',
                structure: 'Streamwise micro-riblets',
                workingPrinciple: 'Damping cross-flow vortices',
                achievedEffect: 'Lower turbulent skin friction',
                functionalAbstract: 'Passive surface micro-grooves suppress spanwise momentum transfer.',
                citations: [
                  {
                    id: 'cit_bio_1',
                    documentId: bioDoc.id,
                    pageNumber: 1,
                    quoteOriginal: bioValidQuote,
                  },
                ],
              },
              {
                id: 'mech_hallucinated',
                title: 'Imaginary Bioluminescence',
                biologicalSystem: 'Deep-sea tissue',
                structure: 'Reflective layer',
                workingPrinciple: 'Light emission',
                achievedEffect: 'Zero drag',
                functionalAbstract: 'Unverified mechanism for retraction test.',
                citations: [
                  {
                    id: 'cit_bio_bad',
                    documentId: bioDoc.id,
                    pageNumber: 1,
                    quoteOriginal: 'Too short',
                  },
                ],
              },
            ],
          },
          null,
          2,
        ),
        'utf-8',
      );

      const verifyBioAttempt1 = await runCliVerify({
        runDir,
        domain: 'biology',
        inputPath: rawBioPath,
        attempt: 1,
      });

      expect(verifyBioAttempt1.report.verifiedCount).toBe(1);
      expect(verifyBioAttempt1.report.failedCount).toBe(1);
      expect(verifyBioAttempt1.report.failedQuotes).toHaveLength(1);
      expect(verifyBioAttempt1.report.failedQuotes[0]?.citationId).toBe('cit_bio_bad');
      expect(verifyBioAttempt1.report.failedQuotes[0]?.nearbySourceText).toContain('[[PAGE:1]]');

      // Attempt 2: Retract the failed quote
      await writeFile(
        rawBioPath,
        JSON.stringify(
          {
            mechanisms: [
              {
                id: 'mech_valid',
                title: 'Riblet Drag Reduction',
                biologicalSystem: 'Shark Placoid Scales',
                structure: 'Streamwise micro-riblets',
                workingPrinciple: 'Damping cross-flow vortices',
                achievedEffect: 'Lower turbulent skin friction',
                functionalAbstract: 'Passive surface micro-grooves suppress spanwise momentum transfer.',
                citations: [
                  {
                    id: 'cit_bio_1',
                    documentId: bioDoc.id,
                    pageNumber: 1,
                    quoteOriginal: bioValidQuote,
                  },
                ],
              },
              {
                id: 'mech_hallucinated',
                title: 'Imaginary Bioluminescence',
                biologicalSystem: 'Deep-sea tissue',
                structure: 'Reflective layer',
                workingPrinciple: 'Light emission',
                achievedEffect: 'Zero drag',
                functionalAbstract: 'Unverified mechanism for retraction test.',
                citations: [
                  {
                    id: 'cit_bio_bad',
                    documentId: bioDoc.id,
                    pageNumber: 1,
                    quoteOriginal: 'Too short',
                    retracted: true,
                    retractionReason: 'Not supported by source text.',
                  },
                ],
              },
            ],
          },
          null,
          2,
        ),
        'utf-8',
      );

      const verifyBioAttempt2 = await runCliVerify({
        runDir,
        domain: 'biology',
        inputPath: rawBioPath,
        attempt: 2,
      });

      expect(verifyBioAttempt2.report.verifiedCount).toBe(1);
      expect(verifyBioAttempt2.report.failedCount).toBe(0);
      expect(verifyBioAttempt2.report.retractedCount).toBe(1);

      // Verify Technology
      const rawTechPath = path.join(runDir, 'raw_technology.json');
      await writeFile(
        rawTechPath,
        JSON.stringify(
          {
            problems: [
              {
                id: 'prob_1',
                title: 'Compressor Boundary Layer Loss',
                technicalDomain: 'Turbomachinery',
                problemStatement: 'High skin friction and separation losses.',
                coreBottleneck: 'Turbulent wall shear stress',
                functionalNeedAbstract: 'Reduce turbulent wall shear stress passively.',
                citations: [
                  {
                    id: 'cit_tech_1',
                    documentId: techDoc.id,
                    pageNumber: 1,
                    quoteOriginal: techValidQuote,
                  },
                ],
              },
            ],
          },
          null,
          2,
        ),
        'utf-8',
      );

      const verifyTech = await runCliVerify({
        runDir,
        domain: 'technology',
        inputPath: rawTechPath,
        attempt: 1,
      });
      expect(verifyTech.report.verifiedCount).toBe(1);

      // 3. Build Bundle (test REJECTED_METAPHOR <= 2 and RETRACTED = 0 deterministic rules)
      await writeFile(
        path.join(runDir, 'candidates.json'),
        JSON.stringify(
          {
            candidates: [
              {
                id: 'cand_metaphor',
                mechanismId: 'mech_valid',
                problemId: 'prob_1',
                bridgeTitle: 'Metaphorical Shark Efficiency',
                abstractTransferLogic: 'Poetic analogy without mechanism.',
                proposedImplementationSketch: 'Paint shark stripes on blade.',
                mechanismCitationIds: ['cit_bio_1'],
                problemCitationIds: ['cit_tech_1'],
              },
              {
                id: 'cand_retracted',
                mechanismId: 'mech_hallucinated',
                problemId: 'prob_1',
                bridgeTitle: 'Bioluminescent Blade',
                abstractTransferLogic: 'Uses retracted mechanism.',
                proposedImplementationSketch: 'N/A',
                mechanismCitationIds: ['cit_bio_bad'],
                problemCitationIds: ['cit_tech_1'],
              },
            ],
          },
          null,
          2,
        ),
        'utf-8',
      );

      await writeFile(
        path.join(runDir, 'raw_reviews.json'),
        JSON.stringify(
          {
            reviews: [
              {
                candidateId: 'cand_metaphor',
                scores: {
                  mechanismDepth: 0,
                  scalabilityAndConstraints: 3,
                  technicalValue: 2,
                  novelty: 2,
                  evidenceQuality: 'PASS',
                },
                criticalCounterarguments: ['Pure linguistic metaphor without physical transfer.'],
                verdictSummary: 'Rejected as metaphor.',
              },
              {
                candidateId: 'cand_retracted',
                scores: {
                  mechanismDepth: 3,
                  scalabilityAndConstraints: 3,
                  technicalValue: 2,
                  novelty: 2,
                  evidenceQuality: 'PASS',
                },
                criticalCounterarguments: ['Source citation was retracted.'],
                verdictSummary: 'Should be overridden to RETRACTED with score 0.',
              },
            ],
          },
          null,
          2,
        ),
        'utf-8',
      );

      const bundleResult = await runCliBuildBundle({
        runDir,
        name: 'CLI Integration Test',
        exportMd: true,
        exportCsv: true,
      });

      const bundleJson = await readFile(bundleResult.bundlePath, 'utf-8');
      const parsed = parseProjectBundle(bundleJson);

      expect(parsed.experiment.name).toBe('CLI Integration Test');
      expect(parsed.experiment.costLedger.totalCostUsd).toBe(0);
      expect(parsed.reviews).toHaveLength(2);

      const metaphorReview = parsed.reviews.find((r) => r.candidateId === 'cand_metaphor')!;
      expect(metaphorReview.status).toBe('REJECTED_METAPHOR');
      expect(metaphorReview.weightedTotalScore).toBeLessThanOrEqual(2);

      const retractedReview = parsed.reviews.find((r) => r.candidateId === 'cand_retracted')!;
      expect(retractedReview.status).toBe('RETRACTED');
      expect(retractedReview.weightedTotalScore).toBe(0);

      const mdContent = await readFile(bundleResult.markdownPath!, 'utf-8');
      const csvContent = await readFile(bundleResult.csvPath!, 'utf-8');
      expect(mdContent).toContain('CLI Integration Test');
      expect(csvContent).toContain('Metaphorical Shark Efficiency');
      expect(csvContent).toContain('REJECTED_METAPHOR');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
