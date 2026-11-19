import type {
  DocumentFormat,
  Domain,
  ParsedPage,
  SourceDocument,
} from '@/core/schemas/document.schema';
import { sha256Hex } from '@/core/utils/hash';
import type { ExtractedEmbeddedImage } from './docx/docxParser';

export type { ExtractedEmbeddedImage };

export interface IngestFileInput {
  fileName: string;
  mimeType?: string;
  data: ArrayBuffer | Uint8Array | string;
  domain: Domain;
  documentId?: string;
}

export interface IngestedDocumentResult {
  document: SourceDocument;
  pages: ParsedPage[];
  extractedImages?: ExtractedEmbeddedImage[];
}

const DEFAULT_MIME_BY_FORMAT: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown',
  txt: 'text/plain',
};

const LANGUAGE_STOPWORDS: Record<'de' | 'en' | 'fr' | 'es', Set<string>> = {
  de: new Set([
    'der',
    'die',
    'das',
    'und',
    'zu',
    'den',
    'von',
    'mit',
    'ist',
    'für',
    'auf',
    'nicht',
    'eine',
    'ein',
    'einer',
    'einem',
    'einen',
    'als',
    'auch',
    'sich',
    'bei',
    'oder',
    'durch',
    'wird',
    'werden',
    'sind',
    'des',
    'dem',
    'im',
    'aus',
    'über',
    'nach',
    'wie',
  ]),
  en: new Set([
    'the',
    'and',
    'of',
    'to',
    'is',
    'for',
    'with',
    'that',
    'as',
    'on',
    'are',
    'by',
    'this',
    'from',
    'or',
    'an',
    'be',
    'which',
    'at',
    'not',
    'have',
    'has',
    'was',
    'were',
    'it',
    'its',
    'can',
    'into',
    'their',
    'between',
  ]),
  fr: new Set([
    'le',
    'les',
    'des',
    'et',
    'une',
    'est',
    'pour',
    'dans',
    'que',
    'qui',
    'par',
    'sur',
    'avec',
    'pas',
    'au',
    'aux',
    'sont',
    'du',
    'ce',
    'cette',
    'ces',
    'plus',
    'mais',
    'ou',
    'comme',
    'être',
    'nous',
    'vous',
    'ils',
  ]),
  es: new Set([
    'el',
    'los',
    'las',
    'del',
    'y',
    'una',
    'para',
    'con',
    'por',
    'que',
    'se',
    'al',
    'como',
    'su',
    'sus',
    'son',
    'más',
    'pero',
    'entre',
    'sobre',
    'este',
    'esta',
    'estos',
    'desde',
    'sin',
    'cuando',
    'donde',
    'también',
  ]),
};

/**
 * Detects the document format from file extension and/or MIME type.
 */
export function detectFormat(fileName: string, mimeType?: string): DocumentFormat {
  const lowerName = fileName.trim().toLowerCase();
  const lowerMime = (mimeType ?? '').trim().toLowerCase();

  if (lowerName.endsWith('.pdf') || lowerMime === 'application/pdf') {
    return 'pdf';
  }
  if (
    lowerName.endsWith('.docx') ||
    lowerMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown') ||
    lowerMime === 'text/markdown' ||
    lowerMime === 'text/x-markdown'
  ) {
    return 'md';
  }
  if (lowerName.endsWith('.txt') || lowerMime === 'text/plain') {
    return 'txt';
  }

  return 'txt';
}

/**
 * Heuristically detects the primary language ('de', 'en', 'fr', 'es') using
 * frequent function words. Falls back to 'en'.
 */
export function detectLanguageHeuristic(text: string): string {
  const tokens = text.toLowerCase().match(/\p{L}+/gu);
  if (!tokens || tokens.length === 0) {
    return 'en';
  }

  const scores: Record<'de' | 'en' | 'fr' | 'es', number> = {
    de: 0,
    en: 0,
    fr: 0,
    es: 0,
  };

  for (const token of tokens) {
    if (LANGUAGE_STOPWORDS.de.has(token)) scores.de += 1;
    if (LANGUAGE_STOPWORDS.en.has(token)) scores.en += 1;
    if (LANGUAGE_STOPWORDS.fr.has(token)) scores.fr += 1;
    if (LANGUAGE_STOPWORDS.es.has(token)) scores.es += 1;
  }

  let bestLang: 'de' | 'en' | 'fr' | 'es' = 'en';
  let bestScore = scores.en;

  for (const lang of ['de', 'fr', 'es'] as const) {
    if (scores[lang] > bestScore) {
      bestScore = scores[lang];
      bestLang = lang;
    }
  }

  return bestScore > 0 ? bestLang : 'en';
}

function toUint8Array(data: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data);
}

function toUtf8Text(data: ArrayBuffer | Uint8Array | string, rawBytes: Uint8Array): string {
  if (typeof data === 'string') {
    return data;
  }
  return new TextDecoder('utf-8').decode(rawBytes);
}

function generateDocumentId(contentHash: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `doc_${contentHash.slice(0, 16)}`;
}

/**
 * Ingests a document of format PDF, DOCX, Markdown, or plain text into a normalized
 * SourceDocument + ParsedPage[] (+ optional extracted embedded images).
 */
export async function ingestDocument(
  input: IngestFileInput,
): Promise<IngestedDocumentResult> {
  const rawBytes = toUint8Array(input.data);
  const contentHash = await sha256Hex(rawBytes);
  const documentId = input.documentId ?? generateDocumentId(contentHash);
  const format = detectFormat(input.fileName, input.mimeType);
  const mimeType =
    input.mimeType && input.mimeType.trim().length > 0
      ? input.mimeType.trim()
      : DEFAULT_MIME_BY_FORMAT[format];

  let pages: ParsedPage[];
  let extractedImages: ExtractedEmbeddedImage[] | undefined;

  switch (format) {
    case 'md': {
      const text = toUtf8Text(input.data, rawBytes);
      const { parseMarkdownDocument } = await import('./markdown/markdownParser');
      pages = parseMarkdownDocument(text, documentId);
      break;
    }
    case 'txt': {
      const text = toUtf8Text(input.data, rawBytes);
      const { parsePlainTextDocument } = await import('./markdown/markdownParser');
      pages = parsePlainTextDocument(text, documentId);
      break;
    }
    case 'docx': {
      const { parseDocxDocument } = await import('./docx/docxParser');
      const docxResult = await parseDocxDocument(rawBytes, documentId);
      pages = docxResult.pages;
      if (docxResult.extractedImages.length > 0) {
        extractedImages = docxResult.extractedImages;
      }
      break;
    }
    case 'pdf': {
      const { parsePdfDocument } = await import('./pdf/pdfParser');
      pages = await parsePdfDocument(rawBytes, documentId);
      break;
    }
  }

  if (pages.length === 0) {
    pages = [
      {
        documentId,
        pageNumber: 1,
        sectionPath: [],
        rawNormalizedText: '',
        blocks: [],
      },
    ];
  }

  const totalChars = pages.reduce((sum, page) => sum + page.rawNormalizedText.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  const detectedFigurePages = pages
    .filter((page) => Boolean(page.hasDiagram))
    .map((page) => page.pageNumber);
  const detectedMathAnomalyPages = pages
    .filter((page) => Boolean(page.hasMathAnomaly))
    .map((page) => page.pageNumber);

  const languageSample = pages
    .map((page) => page.rawNormalizedText)
    .join(' ')
    .slice(0, 12000);
  const detectedLanguage = detectLanguageHeuristic(languageSample);

  const document: SourceDocument = {
    id: documentId,
    domain: input.domain,
    fileName: input.fileName,
    mimeType,
    format,
    contentHash,
    fileSizeBytes: rawBytes.byteLength,
    pageCount: pages.length,
    detectedLanguage,
    stats: {
      totalChars,
      estimatedTokens,
      detectedFigurePages,
      detectedMathAnomalyPages,
    },
    createdAt: new Date().toISOString(),
  };

  return {
    document,
    pages,
    ...(extractedImages ? { extractedImages } : {}),
  };
}
