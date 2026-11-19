import type { PromptProfile, PromptTemplateSlot } from '@/core/schemas';
import { hashJsonStable } from '@/core/utils/hash';

export interface PromptValidationResult {
  valid: boolean;
  missingVariables: string[];
  warnings: string[];
}

export function validatePromptSlot(
  slot: PromptTemplateSlot,
): PromptValidationResult {
  const missingVariables: string[] = [];
  const warnings: string[] = [];

  for (const requiredVar of slot.requiredVariables) {
    const token = `{{${requiredVar}}}`;
    if (!slot.editableSystemInstruction.includes(token)) {
      missingVariables.push(requiredVar);
    }
  }

  const trimmedInstruction = slot.editableSystemInstruction.trim();
  const trimmedContract = slot.lockedOutputContract.trim();

  if (trimmedInstruction.length === 0) {
    warnings.push('Die System-Instruktion darf nicht leer sein.');
  } else if (trimmedInstruction.length < 40) {
    warnings.push(
      'Die System-Instruktion ist sehr kurz; fachliche Leitplanken könnten fehlen.',
    );
  }

  if (trimmedContract.length === 0) {
    warnings.push('Der unveränderliche Ausgabe-Vertrag (lockedOutputContract) fehlt.');
  }

  const foundPlaceholders = new Set<string>();
  const placeholderRegex = /\{\{([A-Z0-9_]+)\}\}/g;
  let match = placeholderRegex.exec(slot.editableSystemInstruction);
  while (match !== null) {
    foundPlaceholders.add(match[1]);
    match = placeholderRegex.exec(slot.editableSystemInstruction);
  }

  const requiredSet = new Set(slot.requiredVariables);
  for (const placeholder of foundPlaceholders) {
    if (!requiredSet.has(placeholder)) {
      warnings.push(
        `Unbekannter Platzhalter "{{${placeholder}}}" wird möglicherweise zur Laufzeit nicht ersetzt.`,
      );
    }
  }

  const valid =
    missingVariables.length === 0 &&
    trimmedInstruction.length > 0 &&
    trimmedContract.length > 0;

  return {
    valid,
    missingVariables,
    warnings,
  };
}

/**
 * Computes a deterministic SHA-256 hash over the prompt profile's slots
 * so extraction caches invalidate whenever prompt instructions or contracts change.
 */
export async function computePromptProfileHash(
  profile: PromptProfile,
): Promise<string> {
  const canonicalSlots = Object.fromEntries(
    Object.entries(profile.slots)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([slotId, slot]) => [
        slotId,
        {
          id: slot.id,
          editableSystemInstruction: slot.editableSystemInstruction,
          lockedOutputContract: slot.lockedOutputContract,
          requiredVariables: [...slot.requiredVariables].sort(),
        },
      ]),
  );

  return hashJsonStable(canonicalSlots);
}
