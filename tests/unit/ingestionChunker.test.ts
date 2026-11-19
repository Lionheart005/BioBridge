import { describe, expect, it } from 'vitest';
import {
  DocumentChunkSchema,
  type ParsedPage,
  type SourceDocument,
} from '@/core/schemas/document.schema';
import { chunkDocumentPages } from '@/ingestion';

function buildSimulatedBook(pageCount: number): {
  document: SourceDocument;
  pages: ParsedPage[];
} {
  const documentId = 'book-350';
  const pages: ParsedPage[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const chapterIndex = Math.ceil(i / 35);
    const sectionPath = [`Kapitel ${chapterIndex}`, `Unterabschnitt ${chapterIndex}.${((i - 1) % 5) + 1}`];

    const sentences: string[] = [];
    for (let s = 1; s <= 22; s++) {
      sentences.push(
        `Seite ${i} Satz ${s}: Bionische Strukturen übertragen evolutionäre Prinzipien wie den Lotuseffekt auf technische Werkstoffe.`,
      );
    }
    const rawNormalizedText = sentences.join(' ');

    pages.push({
      documentId,
      pageNumber: i,
      sectionPath,
      rawNormalizedText,
      blocks: [
        {
          id: `${documentId}:b:${i}`,
          type: 'paragraph',
          content: rawNormalizedText,
        },
      ],
    });
  }

  const totalChars = pages.reduce((sum, p) => sum + p.rawNormalizedText.length, 0);
  const document: SourceDocument = {
    id: documentId,
    domain: 'biology',
    fileName: 'bionik-handbuch-350.pdf',
    mimeType: 'application/pdf',
    format: 'pdf',
    contentHash: 'a'.repeat(64),
    fileSizeBytes: totalChars,
    pageCount,
    detectedLanguage: 'de',
    stats: {
      totalChars,
      estimatedTokens: Math.ceil(totalChars / 4),
      detectedFigurePages: [],
      detectedMathAnomalyPages: [],
    },
    createdAt: new Date().toISOString(),
  };

  return { document, pages };
}

describe('ingestion: chunker', () => {
  it('chunks a simulated 350-page book within target/max bounds, preserving [[PAGE:N]], sentence boundaries, overlap, and < 500ms', () => {
    const { document, pages } = buildSimulatedBook(350);

    const startMs = performance.now();
    const chunks = chunkDocumentPages(document, pages, {
      targetTokens: 3800,
      maxTokens: 4500,
      overlapTokens: 250,
    });
    const elapsedMs = performance.now() - startMs;

    expect(elapsedMs).toBeLessThan(500);
    expect(chunks.length).toBeGreaterThan(20);

    const seenPages = new Set<number>();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      expect(DocumentChunkSchema.parse(chunk)).toBeTruthy();
      expect(chunk.chunkKey).toBe(`${document.id}:chunk:${i}`);
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.startPage).toBeLessThanOrEqual(chunk.endPage);
      expect(chunk.estimatedTokens).toBeLessThanOrEqual(4500);

      // Every chunk starts with a [[PAGE:N]] marker and ends at a complete sentence boundary
      expect(chunk.text).toMatch(/^\[\[PAGE:\d+\]\]/);
      expect(chunk.text.trimEnd()).toMatch(/[.!?]$/);

      // All pages between startPage and endPage have [[PAGE:N]] markers
      for (let p = chunk.startPage; p <= chunk.endPage; p++) {
        expect(chunk.text).toContain(`[[PAGE:${p}]]`);
        seenPages.add(p);
      }

      // Check overlap with previous chunk
      if (i > 0) {
        const prev = chunks[i - 1];
        expect(chunk.startPage).toBeLessThanOrEqual(prev.endPage);
        // Extract first non-marker sentence of current chunk and verify it appeared at the end of previous chunk
        const firstBodyLine = chunk.text.split('\n').find((line) => !line.startsWith('[[PAGE:'));
        expect(firstBodyLine).toBeDefined();
        const firstSentenceMatch = /^.+?[.!?](?=\s|$)/.exec(firstBodyLine ?? '');
        expect(firstSentenceMatch).not.toBeNull();
        if (firstSentenceMatch) {
          expect(prev.text).toContain(firstSentenceMatch[0]);
        }
      }
    }

    // All 350 pages are covered
    expect(seenPages.size).toBe(350);
  });

  it('prefers splitting on sectionPath changes once above soft threshold', () => {
    const doc: SourceDocument = {
      id: 'doc-sec',
      domain: 'technology',
      fileName: 'sections.md',
      mimeType: 'text/markdown',
      format: 'md',
      contentHash: 'b'.repeat(64),
      fileSizeBytes: 1000,
      pageCount: 3,
      detectedLanguage: 'en',
      stats: {
        totalChars: 1000,
        estimatedTokens: 250,
        detectedFigurePages: [],
        detectedMathAnomalyPages: [],
      },
      createdAt: new Date().toISOString(),
    };

    const makeText = (prefix: string) =>
      Array.from({ length: 12 }, (_, idx) => `${prefix} sentence number ${idx + 1}.`).join(' ');

    const pages: ParsedPage[] = [
      {
        documentId: doc.id,
        pageNumber: 1,
        sectionPath: ['Chapter 1'],
        rawNormalizedText: makeText('Alpha'),
        blocks: [],
      },
      {
        documentId: doc.id,
        pageNumber: 2,
        sectionPath: ['Chapter 2'],
        rawNormalizedText: makeText('Beta'),
        blocks: [],
      },
    ];

    const chunks = chunkDocumentPages(doc, pages, {
      targetTokens: 150,
      maxTokens: 250,
      overlapTokens: 25,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].sectionPath).toEqual(['Chapter 1']);
    expect(chunks[1].sectionPath).toEqual(['Chapter 2']);
  });
});
