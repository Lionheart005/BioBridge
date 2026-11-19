import { z } from 'zod';

export const PromptSlotIdSchema = z.enum([
  'extractBio',
  'extractTech',
  'visionExtract',
  'consolidate',
  'crossing',
  'cluster',
  'critic',
  'citationRepair',
]);
export type PromptSlotId = z.infer<typeof PromptSlotIdSchema>;

export const PromptTemplateSlotSchema = z.object({
  id: PromptSlotIdSchema,
  title: z.string().min(1),
  description: z.string(),
  phase: z.string().min(1),
  riskHint: z.string(),
  editableSystemInstruction: z.string().min(1),
  lockedOutputContract: z.string().min(1),
  requiredVariables: z.array(z.string()),
});
export type PromptTemplateSlot = z.infer<typeof PromptTemplateSlotSchema>;

export const PromptProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isDefault: z.boolean(),
  slots: z.record(PromptSlotIdSchema, PromptTemplateSlotSchema),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type PromptProfile = z.infer<typeof PromptProfileSchema>;
