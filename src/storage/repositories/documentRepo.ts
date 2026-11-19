import type { Domain, ParsedPage, SourceDocument } from '@/core/schemas';
import { db, type BioBridgeDB } from '../db';

export const PARSED_PAGE_BATCH_SIZE = 75;

/**
 * Persists parsed pages in fixed batches to prevent memory spikes during large PDF imports.
 */
export async function putPagesInBatches(
  pages: ParsedPage[],
  database: BioBridgeDB = db,
  batchSize = PARSED_PAGE_BATCH_SIZE,
): Promise<void> {
  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);
    await database.parsedPages.bulkPut(batch);
  }
}

/**
 * Saves a source document together with its parsed pages in a single transaction.
 * Deduplicates by `contentHash` to avoid unique-index ConstraintErrors and ensure idempotency.
 */
export async function saveDocumentWithPages(
  doc: SourceDocument,
  pages: ParsedPage[],
  database: BioBridgeDB = db,
): Promise<SourceDocument> {
  return database.transaction('rw', database.documents, database.parsedPages, async () => {
    const existing = await database.documents.where('contentHash').equals(doc.contentHash).first();

    if (existing) {
      if (existing.id === doc.id) {
        await database.documents.put(doc);
        if (pages.length > 0) {
          await putPagesInBatches(pages, database);
        }
        return doc;
      }

      const existingPageCount = await database.parsedPages
        .where('documentId')
        .equals(existing.id)
        .count();
      if (existingPageCount === 0 && pages.length > 0) {
        const remappedPages = pages.map((page) => ({
          ...page,
          documentId: existing.id,
        }));
        await putPagesInBatches(remappedPages, database);
      }
      return existing;
    }

    await database.documents.put(doc);
    if (pages.length > 0) {
      await putPagesInBatches(pages, database);
    }
    return doc;
  });
}

export async function getDocumentById(
  id: string,
  database: BioBridgeDB = db,
): Promise<SourceDocument | undefined> {
  return database.documents.get(id);
}

export async function getDocumentByHash(
  contentHash: string,
  database: BioBridgeDB = db,
): Promise<SourceDocument | undefined> {
  return database.documents.where('contentHash').equals(contentHash).first();
}

export async function listDocuments(
  domain?: Domain,
  database: BioBridgeDB = db,
): Promise<SourceDocument[]> {
  if (domain) {
    return database.documents
      .where('domain')
      .equals(domain)
      .reverse()
      .sortBy('createdAt');
  }
  return database.documents.orderBy('createdAt').reverse().toArray();
}

export async function getPagesForDocument(
  documentId: string,
  database: BioBridgeDB = db,
): Promise<ParsedPage[]> {
  const pages = await database.parsedPages.where('documentId').equals(documentId).toArray();
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

export async function getPageRange(
  documentId: string,
  startPage: number,
  endPage: number,
  database: BioBridgeDB = db,
): Promise<ParsedPage[]> {
  if (endPage < startPage) {
    return [];
  }
  const pages = await database.parsedPages
    .where('[documentId+pageNumber]')
    .between([documentId, startPage], [documentId, endPage], true, true)
    .toArray();
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

export async function updateParsedPage(
  page: ParsedPage,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.parsedPages.put(page);
}

export async function deleteDocumentCascade(
  documentId: string,
  database: BioBridgeDB = db,
): Promise<void> {
  await database.transaction(
    'rw',
    database.documents,
    database.parsedPages,
    database.extractionCaches,
    async () => {
      await database.documents.delete(documentId);
      await database.parsedPages.where('documentId').equals(documentId).delete();
      await database.extractionCaches.where('documentId').equals(documentId).delete();
    },
  );
}
