import { describe, expect, it } from 'vitest';
import { PromptProfileSchema, PromptSlotIdSchema } from '@/core/schemas';
import {
  DEFAULT_PROMPT_SLOTS,
  PromptCompilationError,
  compilePrompt,
  computePromptProfileHash,
  createDefaultPromptProfile,
  validatePromptSlot,
} from '@/prompts';

describe('Default System Prompts, Compiler & Validator', () => {
  it('provides all 8 default prompt slots and validates every slot cleanly', () => {
    const slotIds = PromptSlotIdSchema.options;
    expect(slotIds).toHaveLength(8);

    for (const slotId of slotIds) {
      const slot = DEFAULT_PROMPT_SLOTS[slotId];
      expect(slot).toBeDefined();
      const validation = validatePromptSlot(slot);
      expect(validation.valid).toBe(true);
      expect(validation.missingVariables).toEqual([]);
      expect(validation.warnings).toEqual([]);
    }

    const profile = createDefaultPromptProfile();
    expect(() => PromptProfileSchema.parse(profile)).not.toThrow();
  });

  it('compiles prompts with variables and preserves lockedOutputContract verbatim', () => {
    const compiledBio = compilePrompt(DEFAULT_PROMPT_SLOTS.extractBio, {
      OUTPUT_LANGUAGE: 'Deutsch',
      DOCUMENT_TITLE: 'Ameisenkolonien Kap. 4',
    });

    expect(compiledBio).toContain('Deutsch');
    expect(compiledBio).toContain('Ameisenkolonien Kap. 4');
    expect(compiledBio).toContain('VERBINDLICHER AUSGABE-VERTRAG');
    expect(compiledBio).toContain('"mechanisms"');

    const compiledCritic = compilePrompt(DEFAULT_PROMPT_SLOTS.critic, {
      OUTPUT_LANGUAGE: 'English',
    });
    expect(compiledCritic).toContain('70–90 %');
    expect(compiledCritic).toContain('criticalCounterarguments');
    expect(compiledCritic).toContain('English');

    const compiledRepair = compilePrompt(DEFAULT_PROMPT_SLOTS.citationRepair, {
      FAILED_QUOTE: 'Ants use magic.',
      FAILURE_REASON: 'TOO_SHORT_FRAGMENT',
    });
    expect(compiledRepair).toContain('CORRECT_QUOTE');
    expect(compiledRepair).toContain('RETRACT_HALLUCINATION');
    expect(compiledRepair).toContain('Ants use magic.');
  });

  it('detects missing variables in validatePromptSlot and compilePrompt', () => {
    const brokenSlot = {
      ...DEFAULT_PROMPT_SLOTS.cluster,
      editableSystemInstruction:
        'Ordne in {{OUTPUT_LANGUAGE}} für Domäne {{DOMAIN}}.',
    };

    const validation = validatePromptSlot(brokenSlot);
    expect(validation.valid).toBe(false);
    expect(validation.missingVariables).toEqual(['TARGET_CLUSTERS']);

    expect(() =>
      compilePrompt(DEFAULT_PROMPT_SLOTS.cluster, {
        OUTPUT_LANGUAGE: 'Deutsch',
        DOMAIN: 'Biologie',
      }),
    ).toThrow(PromptCompilationError);
  });

  it('computes a deterministic prompt profile hash that changes when instructions change', async () => {
    const profileA = createDefaultPromptProfile();
    const profileB = createDefaultPromptProfile();

    const hashA = await computePromptProfileHash(profileA);
    const hashB = await computePromptProfileHash(profileB);
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);

    profileB.slots.critic!.editableSystemInstruction += '\nExtra strictness.';
    const hashModified = await computePromptProfileHash(profileB);
    expect(hashModified).not.toBe(hashA);
  });
});
