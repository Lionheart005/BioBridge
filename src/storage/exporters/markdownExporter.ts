import type {
  BioBridgeProjectBundle,
  Citation,
  CrossingCandidate,
  CriticReview,
  ExtractedMechanism,
  ExtractedProblem,
} from '@/core/schemas';

interface RankedCandidate {
  rank: number;
  candidate: CrossingCandidate;
  review?: CriticReview;
  mechanism?: ExtractedMechanism;
  problem?: ExtractedProblem;
}

function rankCandidates(bundle: BioBridgeProjectBundle): RankedCandidate[] {
  const reviewByCandidateId = new Map<string, CriticReview>(
    bundle.reviews.map((review) => [review.candidateId, review]),
  );
  const mechanismById = new Map<string, ExtractedMechanism>(
    bundle.mechanisms.map((mechanism) => [mechanism.id, mechanism]),
  );
  const problemById = new Map<string, ExtractedProblem>(
    bundle.problems.map((problem) => [problem.id, problem]),
  );

  const sorted = [...bundle.candidates].sort((a, b) => {
    const scoreA = reviewByCandidateId.get(a.id)?.weightedTotalScore ?? -1;
    const scoreB = reviewByCandidateId.get(b.id)?.weightedTotalScore ?? -1;
    return scoreB - scoreA;
  });

  return sorted.map((candidate, index) => ({
    rank: index + 1,
    candidate,
    review: reviewByCandidateId.get(candidate.id),
    mechanism: mechanismById.get(candidate.mechanismId),
    problem: problemById.get(candidate.problemId),
  }));
}

function resolveCitations(
  citationIds: string[],
  fallbackCitations: Citation[] | undefined,
): Citation[] {
  if (!fallbackCitations || fallbackCitations.length === 0) {
    return [];
  }
  const byId = new Map(fallbackCitations.map((citation) => [citation.id, citation]));
  const matched = citationIds
    .map((id) => byId.get(id))
    .filter((citation): citation is Citation => citation !== undefined);
  return matched.length > 0 ? matched : [fallbackCitations[0]];
}

function formatCitationBlock(label: string, citation: Citation): string {
  const lines: string[] = [
    `#### ${label}: ${citation.documentTitle} (S. ${citation.pageNumber})`,
    `- **Abschnitt:** ${citation.sectionPath || '—'}`,
    `- **Verifikation:** \`${citation.verification.status}\` (Score: ${citation.verification.matchScore.toFixed(2)}, geprüfte Seite: ${citation.verification.matchedPageNumber})`,
    '',
    `> "${citation.quoteOriginal}"`,
  ];

  if (citation.quoteTranslation) {
    lines.push(`> *Übersetzung:* ${citation.quoteTranslation}`);
  }

  return lines.join('\n');
}

function sanitizeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function exportExperimentToMarkdown(bundle: BioBridgeProjectBundle): string {
  const { experiment } = bundle;
  const ranked = rankCandidates(bundle);
  const lines: string[] = [];

  lines.push(`# BioBridge Bericht: ${experiment.name}`);
  lines.push('');
  lines.push('## Experiment-Metadaten');
  lines.push('');
  lines.push(`- **Experiment-ID:** \`${experiment.id}\``);
  lines.push(`- **Status:** \`${experiment.status}\``);
  lines.push(`- **Erstellt am:** ${experiment.createdAt}`);
  lines.push(`- **Aktualisiert am:** ${experiment.updatedAt}`);
  lines.push(`- **Ausgabesprache:** ${experiment.config.outputLanguage}`);
  lines.push(
    `- **Crossing-Strategie:** ${experiment.config.crossingStrategy} (Distanzband: ${experiment.config.distanceBand}, Kreativität: ${experiment.config.creativityDistance})`,
  );
  lines.push(
    `- **Dokumente:** ${bundle.documents.length} (${experiment.biologyDocIds.length} Biologie, ${experiment.technologyDocIds.length} Technik)`,
  );
  lines.push('');

  lines.push('## Kostenübersicht');
  lines.push('');
  const ledger = experiment.costLedger;
  const eurRate = experiment.config.modelAssignments
    ? bundle.experiment.costEstimate?.usdToEurRate
    : undefined;
  const costEurSuffix =
    eurRate !== undefined ? ` (~${(ledger.totalCostUsd * eurRate).toFixed(4)} EUR)` : '';
  lines.push(`- **Gesamtkosten:** $${ledger.totalCostUsd.toFixed(4)} USD${costEurSuffix}`);
  lines.push(`- **Input-Tokens:** ${ledger.totalInputTokens}`);
  lines.push(`- **Output-Tokens:** ${ledger.totalOutputTokens}`);
  lines.push(`- **Vision-Bilder:** ${ledger.totalVisionImages}`);
  lines.push('');

  lines.push('## Übersichtstabelle');
  lines.push('');
  if (ranked.length === 0) {
    lines.push('*Keine Crossing-Kandidaten vorhanden.*');
  } else {
    lines.push(
      '| Rang | Titel | Status | Gesamtscore | Mechanismus | Skalierung | Nutzwert | Neuheit | Evidenz |',
    );
    lines.push('| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const item of ranked) {
      const review = item.review;
      const status = review ? review.status : 'UNREVIEWED';
      const total = review ? review.weightedTotalScore.toFixed(2) : '—';
      const mech = review ? String(review.scores.mechanismDepth) : '—';
      const scale = review ? String(review.scores.scalabilityAndConstraints) : '—';
      const val = review ? String(review.scores.technicalValue) : '—';
      const nov = review ? String(review.scores.novelty) : '—';
      const ev = review ? review.scores.evidenceQuality : '—';
      lines.push(
        `| ${item.rank} | ${sanitizeTableCell(item.candidate.bridgeTitle)} | ${status} | ${total} | ${mech}/3 | ${scale}/3 | ${val}/2 | ${nov}/2 | ${ev} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Detailanalyse der Kandidaten');
  lines.push('');

  for (const item of ranked) {
    const { candidate, review, mechanism, problem } = item;
    lines.push(`### ${item.rank}. ${candidate.bridgeTitle}`);
    lines.push('');
    lines.push(
      `- **Kandidaten-ID:** \`${candidate.id}\` | **Strategie:** \`${candidate.strategyUsed}\`${candidate.similarityScore !== undefined ? ` | **Ähnlichkeit:** ${candidate.similarityScore.toFixed(3)}` : ''}`,
    );
    if (review) {
      lines.push(
        `- **Bewertung:** \`${review.status}\` — **Gesamtscore: ${review.weightedTotalScore.toFixed(2)} / 10** (Critic-Modell: \`${review.criticModelUsed}\`)`,
      );
    }
    lines.push('');

    lines.push('#### Biologischer Mechanismus & Technisches Problem');
    lines.push('');
    if (mechanism) {
      lines.push(`- **Biologie:** ${mechanism.title} (*${mechanism.biologicalSystem}*)`);
      lines.push(`  - *Funktionsabstrakt:* ${mechanism.functionalAbstract}`);
    } else {
      lines.push(`- **Biologie-ID:** \`${candidate.mechanismId}\``);
    }
    if (problem) {
      lines.push(`- **Technik:** ${problem.title} (*${problem.technicalDomain}*)`);
      lines.push(`  - *Engpass:* ${problem.coreBottleneck}`);
      lines.push(`  - *Bedarfsabstrakt:* ${problem.functionalNeedAbstract}`);
    } else {
      lines.push(`- **Technik-ID:** \`${candidate.problemId}\``);
    }
    lines.push('');

    const bioCitations = resolveCitations(candidate.mechanismCitationIds, mechanism?.citations);
    for (const citation of bioCitations) {
      lines.push(formatCitationBlock('Biologie-Zitat', citation));
      lines.push('');
    }

    const techCitations = resolveCitations(candidate.problemCitationIds, problem?.citations);
    for (const citation of techCitations) {
      lines.push(formatCitationBlock('Technik-Zitat', citation));
      lines.push('');
    }

    lines.push('#### Übertragungslogik & Implementierungsskizze');
    lines.push('');
    lines.push(candidate.abstractTransferLogic);
    lines.push('');
    lines.push(candidate.proposedImplementationSketch);
    lines.push('');

    if (candidate.keyAssumptions.length > 0) {
      lines.push('**Zentrale Annahmen:**');
      for (const assumption of candidate.keyAssumptions) {
        lines.push(`- ${assumption}`);
      }
      lines.push('');
    }

    if (candidate.potentialFailureModes.length > 0) {
      lines.push('**Mögliche Fehlermodi:**');
      for (const mode of candidate.potentialFailureModes) {
        lines.push(`- ${mode}`);
      }
      lines.push('');
    }

    if (review) {
      lines.push('#### Advocatus-Diaboli-Gutachten');
      lines.push('');
      lines.push(
        `- **Detail-Scores:** Mechanismus-Tiefe ${review.scores.mechanismDepth}/3, Skalierung ${review.scores.scalabilityAndConstraints}/3, Technischer Nutzwert ${review.scores.technicalValue}/2, Neuheit ${review.scores.novelty}/2, Evidenz ${review.scores.evidenceQuality}`,
      );
      lines.push(`- **Kurzurteil:** ${review.verdictSummary}`);
      if (review.scalingWarning) {
        lines.push(`- **Skalierungswarnung:** ${review.scalingWarning}`);
      }
      if (review.knownPriorArt) {
        lines.push(`- **Bekannter Stand der Technik:** ${review.knownPriorArt}`);
      }
      lines.push('');
      lines.push('**Kritische Gegenargumente:**');
      for (const arg of review.criticalCounterarguments) {
        lines.push(`- ${arg}`);
      }
      if (review.openHurdles.length > 0) {
        lines.push('');
        lines.push('**Offene Hürden:**');
        for (const hurdle of review.openHurdles) {
          lines.push(`- ${hurdle}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}
