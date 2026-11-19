import { z } from 'zod';

export const DomainSchema = z.enum(['biology', 'technology']);
export type Domain = z.infer<typeof DomainSchema>;

export const DocumentFormatSchema = z.enum(['pdf', 'docx', 'md', 'txt']);
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;

export const ParsedBlockTypeSchema = z.enum([
  'paragraph',
  'heading',
  'table',
  'formula',
  'figure_vision',
]);
export type ParsedBlockType = z.infer<typeof ParsedBlockTypeSchema>;

export const ParsedBlockSchema = z.object({
  id: z.string().min(1),
  type: ParsedBlockTypeSchema,
  content: z.string(),
  latex: z.string().optional(),
  figureRef: z.string().optional(),
});
export type ParsedBlock = z.infer<typeof ParsedBlockSchema>;

export const ParsedPageSchema = z.object({
  documentId: z.string().min(1),
  pageNumber: z.number().int().min(1),
  sectionPath: z.array(z.string()),
  rawNormalizedText: z.string(),
  blocks: z.array(ParsedBlockSchema),
  hasDiagram: z.boolean().optional(),
  hasMathAnomaly: z.boolean().optional(),
});
export type ParsedPage = z.infer<typeof ParsedPageSchema>;

export const DocumentStatsSchema = z.object({
  totalChars: z.number().int().min(0),
  estimatedTokens: z.number().int().min(0),
  detectedFigurePages: z.array(z.number().int().min(1)),
  detectedMathAnomalyPages: z.array(z.number().int().min(1)),
});
export type DocumentStats = z.infer<typeof DocumentStatsSchema>;

export const SourceDocumentSchema = z.object({
  id: z.string().min(1),
  domain: DomainSchema,
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  format: DocumentFormatSchema,
  contentHash: z.string().min(1),
  fileSizeBytes: z.number().int().min(0),
  pageCount: z.number().int().min(1),
  detectedLanguage: z.string().min(1),
  stats: DocumentStatsSchema,
  createdAt: z.string().min(1),
});
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export const DocumentChunkSchema = z.object({
  chunkKey: z.string().min(1),
  documentId: z.string().min(1),
  domain: DomainSchema,
  chunkIndex: z.number().int().min(0),
  startPage: z.number().int().min(1),
  endPage: z.number().int().min(1),
  sectionPath: z.array(z.string()),
  text: z.string(),
  estimatedTokens: z.number().int().min(0),
});
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;
