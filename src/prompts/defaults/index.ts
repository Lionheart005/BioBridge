import type { PromptProfile, PromptSlotId, PromptTemplateSlot } from '@/core/schemas';
import { CITATION_REPAIR_PROMPT } from './citationRepair.prompt';
import { CLUSTER_PROMPT } from './cluster.prompt';
import { CONSOLIDATE_PROMPT } from './consolidate.prompt';
import { CRITIC_PROMPT } from './critic.prompt';
import { CROSSING_PROMPT } from './crossing.prompt';
import { EXTRACT_BIO_PROMPT } from './extractBio.prompt';
import { EXTRACT_TECH_PROMPT } from './extractTech.prompt';
import { VISION_EXTRACT_PROMPT } from './visionExtract.prompt';

export {
  EXTRACT_BIO_PROMPT,
  EXTRACT_TECH_PROMPT,
  VISION_EXTRACT_PROMPT,
  CONSOLIDATE_PROMPT,
  CROSSING_PROMPT,
  CLUSTER_PROMPT,
  CRITIC_PROMPT,
  CITATION_REPAIR_PROMPT,
};

export const DEFAULT_PROMPT_SLOTS: Record<PromptSlotId, PromptTemplateSlot> = {
  extractBio: EXTRACT_BIO_PROMPT,
  extractTech: EXTRACT_TECH_PROMPT,
  visionExtract: VISION_EXTRACT_PROMPT,
  consolidate: CONSOLIDATE_PROMPT,
  crossing: CROSSING_PROMPT,
  cluster: CLUSTER_PROMPT,
  critic: CRITIC_PROMPT,
  citationRepair: CITATION_REPAIR_PROMPT,
};

function cloneSlot(slot: PromptTemplateSlot): PromptTemplateSlot {
  return {
    ...slot,
    requiredVariables: [...slot.requiredVariables],
  };
}

export function createDefaultPromptProfile(): PromptProfile {
  const now = new Date().toISOString();
  return {
    id: 'default-biobridge-v1',
    name: 'BioBridge Standard-Profil (Wissenschaftlich Streng)',
    isDefault: true,
    slots: {
      extractBio: cloneSlot(EXTRACT_BIO_PROMPT),
      extractTech: cloneSlot(EXTRACT_TECH_PROMPT),
      visionExtract: cloneSlot(VISION_EXTRACT_PROMPT),
      consolidate: cloneSlot(CONSOLIDATE_PROMPT),
      crossing: cloneSlot(CROSSING_PROMPT),
      cluster: cloneSlot(CLUSTER_PROMPT),
      critic: cloneSlot(CRITIC_PROMPT),
      citationRepair: cloneSlot(CITATION_REPAIR_PROMPT),
    },
    createdAt: now,
    updatedAt: now,
  };
}
