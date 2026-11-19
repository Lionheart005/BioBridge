import { z } from 'zod';
import {
  type ITransportAdapter,
  type UsageReceipt,
  requestStructuredOutput,
} from '@/ai';
import type {
  Citation,
  ModelAssignment,
  ParsedPage,
  PromptTemplateSlot,
} from '@/core/schemas';
import { CITATION_REPAIR_PROMPT, compilePrompt } from '@/prompts';
import {
  type CitationVerificationResult,
  verifyCitationAgainstPages,
} from './citationVerifier';

export const CitationRepairDecisionSchema = z.object({
  decision: z.enum(['CORRECT_QUOTE', 'RETRACT_HALLUCINATION']),
  correctedQuoteOriginal: z.string().optional(),
  pageNumber: z.number().int().min(1).optional(),
  retractionReason: z.string().optional(),
});
export type CitationRepairDecision = z.infer<
  typeof CitationRepairDecisionSchema
>;

export interface SelfCorrectionInput {
  citation: Omit<Citation, 'contextBefore' | 'contextAfter' | 'verification'>;
  pages: ParsedPage[];
  sourceChunkText: string;
  transport: ITransportAdapter;
  modelAssignment: ModelAssignment;
  repairPromptSlot?: PromptTemplateSlot;
  maxRetries?: number;
  fuzzyThreshold?: number;
  signal?: AbortSignal;
  onUsage?: (usage: UsageReceipt) => void;
}

export interface SelfCorrectionResult {
  citation: Citation;
  corrected: boolean;
  retracted: boolean;
  attempts: number;
}

function buildFailureReasonString(result: CitationVerificationResult): string {
  const code = result.failureReason ?? 'NO_MATCH_FOUND';
  return result.failureDetails ? `${code}: ${result.failureDetails}` : code;
}

function buildRepairUserMessage(params: {
  citation: SelfCorrectionInput['citation'];
  pages: ParsedPage[];
  sourceChunkText: string;
}): string {
  const claimed = params.citation.pageNumber;
  const pageMap = new Map<number, ParsedPage>();
  for (const page of params.pages) {
    pageMap.set(page.pageNumber, page);
  }

  const relevantPages: ParsedPage[] = [];
  for (const pageNum of [claimed - 1, claimed, claimed + 1]) {
    if (pageNum >= 1) {
      const found = pageMap.get(pageNum);
      if (found) {
        relevantPages.push(found);
      }
    }
  }

  const pagesBlock =
    relevantPages.length > 0
      ? relevantPages
          .map((p) => `--- Seite ${p.pageNumber} ---\n${p.rawNormalizedText}`)
          .join('\n\n')
      : '(Keine passenden Seiten im Dokument gefunden)';

  return [
    `Dokument: ${params.citation.documentTitle} (angegebene Seite: ${claimed})`,
    '',
    '=== Source Chunk ===',
    params.sourceChunkText,
    '',
    '=== Relevante Originalseiten (N-1, N, N+1) ===',
    pagesBlock,
  ].join('\n');
}

/**
 * Verifies a citation deterministically first; if verification fails and `maxRetries >= 1`,
 * invokes the LLM self-correction loop (`CITATION_REPAIR_PROMPT`) where the model must
 * either provide an exact verbatim quote from the source text or honestly retract the hallucination.
 * Any corrected quote is re-verified deterministically before being accepted.
 */
export async function verifyCitationWithSelfCorrection(
  input: SelfCorrectionInput,
): Promise<SelfCorrectionResult> {
  const maxRetries = input.maxRetries ?? 1;

  // Step 1: Deterministic verification (attempt 1) — zero LLM cost when valid.
  const firstCheck = verifyCitationAgainstPages({
    quoteOriginal: input.citation.quoteOriginal,
    claimedPageNumber: input.citation.pageNumber,
    pages: input.pages,
    fuzzyThreshold: input.fuzzyThreshold,
  });

  if (firstCheck.verified) {
    return {
      citation: {
        ...input.citation,
        contextBefore: firstCheck.contextBefore,
        contextAfter: firstCheck.contextAfter,
        verification: {
          status: firstCheck.status,
          matchScore: firstCheck.matchScore,
          matchedPageNumber: firstCheck.matchedPageNumber,
          attempts: 1,
        },
      },
      corrected: false,
      retracted: false,
      attempts: 1,
    };
  }

  if (maxRetries < 1) {
    return {
      citation: {
        ...input.citation,
        contextBefore: '',
        contextAfter: '',
        verification: {
          status: 'FAILED_UNVERIFIED',
          matchScore: firstCheck.matchScore,
          matchedPageNumber: firstCheck.matchedPageNumber,
          attempts: 1,
        },
      },
      corrected: false,
      retracted: false,
      attempts: 1,
    };
  }

  // Step 2: Self-Correction-Loop
  const promptSlot = input.repairPromptSlot ?? CITATION_REPAIR_PROMPT;
  const userMessage = buildRepairUserMessage({
    citation: input.citation,
    pages: input.pages,
    sourceChunkText: input.sourceChunkText,
  });

  let lastCheck = firstCheck;
  let failedQuote = input.citation.quoteOriginal;
  let attempts = 1;

  for (let retry = 1; retry <= maxRetries; retry += 1) {
    if (input.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    attempts = retry + 1;
    const safeFailedQuote =
      failedQuote.trim().length > 0 ? failedQuote : '(empty quote)';
    const systemPrompt = compilePrompt(promptSlot, {
      FAILED_QUOTE: safeFailedQuote,
      FAILURE_REASON: buildFailureReasonString(lastCheck),
    });

    const structured = await requestStructuredOutput({
      transport: input.transport,
      request: {
        provider: input.modelAssignment.provider,
        modelId: input.modelAssignment.modelId,
        role: 'extraction',
        temperature: input.modelAssignment.temperature ?? 0,
        reasoningEffort: input.modelAssignment.reasoningEffort,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      },
      schema: CitationRepairDecisionSchema,
      schemaName: 'CitationRepairDecision',
      signal: input.signal,
      onUsage: input.onUsage,
    });

    const decision = structured.data;

    if (decision.decision === 'RETRACT_HALLUCINATION') {
      const reason =
        decision.retractionReason?.trim() ||
        'Model retracted unverified quote.';
      return {
        citation: {
          ...input.citation,
          contextBefore: '',
          contextAfter: '',
          verification: {
            status: 'RETRACTED_HALLUCINATION',
            matchScore: 0,
            matchedPageNumber: input.citation.pageNumber,
            attempts,
            retractionReason: reason,
          },
        },
        corrected: false,
        retracted: true,
        attempts,
      };
    }

    const candidateQuote = decision.correctedQuoteOriginal?.trim() ?? '';
    if (candidateQuote.length > 0) {
      const candidatePage = decision.pageNumber ?? input.citation.pageNumber;
      const recheck = verifyCitationAgainstPages({
        quoteOriginal: decision.correctedQuoteOriginal!,
        claimedPageNumber: candidatePage,
        pages: input.pages,
        fuzzyThreshold: input.fuzzyThreshold,
      });

      if (recheck.verified) {
        return {
          citation: {
            ...input.citation,
            quoteOriginal: decision.correctedQuoteOriginal!,
            pageNumber: recheck.matchedPageNumber,
            contextBefore: recheck.contextBefore,
            contextAfter: recheck.contextAfter,
            verification: {
              status: 'CORRECTED_VERIFIED',
              matchScore: recheck.matchScore,
              matchedPageNumber: recheck.matchedPageNumber,
              attempts,
            },
          },
          corrected: true,
          retracted: false,
          attempts,
        };
      }

      lastCheck = recheck;
      failedQuote = decision.correctedQuoteOriginal!;
    } else {
      lastCheck = {
        verified: false,
        status: 'FAILED_UNVERIFIED',
        matchScore: 0,
        matchedPageNumber: input.citation.pageNumber,
        contextBefore: '',
        contextAfter: '',
        failureReason: 'EMPTY_QUOTE',
        failureDetails:
          'Model selected CORRECT_QUOTE without providing correctedQuoteOriginal.',
      };
      failedQuote = '';
    }
  }

  return {
    citation: {
      ...input.citation,
      contextBefore: '',
      contextAfter: '',
      verification: {
        status: 'FAILED_UNVERIFIED',
        matchScore: lastCheck.matchScore,
        matchedPageNumber: lastCheck.matchedPageNumber,
        attempts,
      },
    },
    corrected: false,
    retracted: false,
    attempts,
  };
}
