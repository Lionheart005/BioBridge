import type { PromptTemplateSlot } from '@/core/schemas';

export class PromptCompilationError extends Error {
  readonly slotId: string;
  readonly missingVariables: string[];

  constructor(slotId: string, missingVariables: string[]) {
    super(
      `Cannot compile prompt "${slotId}": missing required variable(s): ${missingVariables.join(', ')}`,
    );
    this.name = 'PromptCompilationError';
    this.slotId = slotId;
    this.missingVariables = missingVariables;
  }
}

function replaceVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (full, varName: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, varName)) {
      return variables[varName];
    }
    return full;
  });
}

/**
 * Compiles a PromptTemplateSlot by verifying all required variables,
 * substituting {{VAR}} placeholders, and strictly appending the
 * immutable lockedOutputContract.
 */
export function compilePrompt(
  slot: PromptTemplateSlot,
  variables: Record<string, string>,
): string {
  const missing = slot.requiredVariables.filter((varName) => {
    const val = variables[varName];
    return typeof val !== 'string' || val.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new PromptCompilationError(slot.id, missing);
  }

  const compiledInstruction = replaceVariables(
    slot.editableSystemInstruction.trim(),
    variables,
  );
  const compiledContract = replaceVariables(
    slot.lockedOutputContract.trim(),
    variables,
  );

  return `${compiledInstruction}\n\n---\n\n${compiledContract}`;
}
