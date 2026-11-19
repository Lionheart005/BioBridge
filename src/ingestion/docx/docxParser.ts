import JSZip from 'jszip';
import type { ParsedBlock, ParsedPage } from '@/core/schemas/document.schema';
import {
  convertOmmlNodeToLatex,
  findChildElements,
  findFirstChildElement,
  getAttrVal,
  parseXmlNodes,
  type XmlElementNode,
  type XmlTextNode,
} from './ommlToLatex';

const DEFAULT_VIRTUAL_PAGE_CHAR_LIMIT = 3500;
const MIN_CHARS_BEFORE_H1_PAGE_BREAK = 400;

export interface ExtractedEmbeddedImage {
  pageNumber: number;
  figureRef: string;
  mimeType: string;
  dataBase64: string;
}

export interface DocxParseResult {
  pages: ParsedPage[];
  extractedImages: ExtractedEmbeddedImage[];
}

export interface DocxParseOptions {
  virtualPageCharLimit?: number;
}

interface PendingDocxItem {
  block?: ParsedBlock;
  sectionPath: string[];
  isTopLevelHeading: boolean;
  explicitPageBreakBefore?: boolean;
  imageRefs?: string[];
}

interface PendingImageRecord {
  figureRef: string;
  mimeType: string;
  dataBase64: string;
}

function inferImageMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  return 'application/octet-stream';
}

function resolveMediaZipPath(target: string): string {
  let clean = target.replace(/\\/g, '/').replace(/^\/+/, '');
  while (clean.startsWith('../')) {
    clean = clean.slice(3);
  }
  if (!clean.startsWith('word/')) {
    clean = `word/${clean}`;
  }
  return clean;
}

function detectHeadingDepth(styleVal: string | undefined): number | null {
  if (!styleVal) return null;
  const trimmed = styleVal.trim();
  if (/^title$/i.test(trimmed)) return 1;
  if (/^subtitle$/i.test(trimmed)) return 2;
  const match = /(?:heading|berschrift)\s*([1-6])$/i.exec(trimmed);
  if (match) {
    return Number.parseInt(match[1], 10);
  }
  return null;
}

function collectTextNodes(elem: XmlElementNode): string {
  let out = '';
  for (const child of elem.children) {
    if (child.kind === 'text') {
      out += (child as XmlTextNode).text;
    } else if (child.localName === 't' || child.localName === 'delText') {
      out += collectTextNodes(child);
    } else if (child.localName === 'tab') {
      out += '\t';
    } else if (child.localName === 'br') {
      const brType = getAttrVal(child, 'type');
      if (brType !== 'page') {
        out += '\n';
      }
    } else {
      out += collectTextNodes(child);
    }
  }
  return out;
}

function collectImageRelIds(node: XmlElementNode, out: string[]): void {
  if (node.localName === 'blip') {
    const embed = node.attrs['r:embed'] ?? node.attrs['embed'] ?? node.attrs['r:link'];
    if (embed) out.push(embed);
  } else if (node.localName === 'imagedata') {
    const relId = node.attrs['r:id'] ?? node.attrs['id'];
    if (relId) out.push(relId);
  }
  for (const child of node.children) {
    if (child.kind === 'element') {
      collectImageRelIds(child, out);
    }
  }
}

function hasPageBreakInRun(runElem: XmlElementNode): boolean {
  for (const child of runElem.children) {
    if (child.kind !== 'element') continue;
    if (child.localName === 'lastRenderedPageBreak') {
      return true;
    }
    if (child.localName === 'br' && getAttrVal(child, 'type') === 'page') {
      return true;
    }
  }
  return false;
}

function extractInlineTextFromRun(runElem: XmlElementNode): string {
  let out = '';
  for (const child of runElem.children) {
    if (child.kind !== 'element') continue;
    if (child.localName === 't') {
      out += child.children
        .filter((c): c is XmlTextNode => c.kind === 'text')
        .map((c) => c.text)
        .join('');
    } else if (child.localName === 'tab') {
      out += ' ';
    } else if (child.localName === 'br') {
      if (getAttrVal(child, 'type') !== 'page') {
        out += '\n';
      }
    } else if (child.localName === 'sym') {
      const ch = getAttrVal(child, 'char');
      if (ch) out += ch;
    }
  }
  return out;
}

function extractParagraphPlainOrInlineMath(pElem: XmlElementNode): string {
  let text = '';
  for (const child of pElem.children) {
    if (child.kind !== 'element') continue;
    if (child.localName === 'r') {
      text += extractInlineTextFromRun(child);
    } else if (child.localName === 'hyperlink') {
      for (const hChild of child.children) {
        if (hChild.kind === 'element' && hChild.localName === 'r') {
          text += extractInlineTextFromRun(hChild);
        }
      }
    } else if (child.localName === 'oMath') {
      const latex = convertOmmlNodeToLatex(child).trim();
      if (latex.length > 0) {
        text += `$${latex}$`;
      }
    } else if (child.localName === 'oMathPara') {
      const innerMath = findFirstChildElement(child, 'oMath') ?? child;
      const latex = convertOmmlNodeToLatex(innerMath).trim();
      if (latex.length > 0) {
        text += `$$${latex}$$`;
      }
    }
  }
  return text.trim();
}

function extractTableMarkdown(tblElem: XmlElementNode): string {
  const rows = findChildElements(tblElem, 'tr');
  if (rows.length === 0) return '';

  const matrix: string[][] = [];
  let maxCols = 0;

  for (const row of rows) {
    const cells = findChildElements(row, 'tc');
    const rowValues = cells.map((cell) => {
      const cellParagraphs = findChildElements(cell, 'p');
      const joined =
        cellParagraphs.length > 0
          ? cellParagraphs.map((p) => extractParagraphPlainOrInlineMath(p)).filter(Boolean).join(' ')
          : collectTextNodes(cell).trim();
      return joined.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
    });
    maxCols = Math.max(maxCols, rowValues.length);
    matrix.push(rowValues);
  }

  if (maxCols === 0) return '';

  const formatRow = (vals: string[]): string => {
    const padded: string[] = [];
    for (let i = 0; i < maxCols; i++) {
      padded.push(vals[i] ?? '');
    }
    return `| ${padded.join(' | ')} |`;
  };

  const sep = `| ${Array.from({ length: maxCols }, () => '---').join(' | ')} |`;
  const lines = [formatRow(matrix[0]), sep];
  for (let i = 1; i < matrix.length; i++) {
    lines.push(formatRow(matrix[i]));
  }
  return lines.join('\n');
}

/**
 * Parses a DOCX archive (ArrayBuffer or Uint8Array) into ParsedPages and extracted embedded images.
 */
export async function parseDocxDocument(
  data: ArrayBuffer | Uint8Array,
  documentId: string,
  options?: DocxParseOptions,
): Promise<DocxParseResult> {
  const virtualPageCharLimit = options?.virtualPageCharLimit ?? DEFAULT_VIRTUAL_PAGE_CHAR_LIMIT;
  const zip = await JSZip.loadAsync(data);

  const documentXmlFile = zip.file('word/document.xml');
  if (!documentXmlFile) {
    throw new Error('Invalid DOCX archive: missing word/document.xml');
  }
  const documentXml = await documentXmlFile.async('string');

  // Parse relationships (word/_rels/document.xml.rels) for image references
  const relIdToPath = new Map<string, string>();
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    const relRoots = parseXmlNodes(relsXml);
    for (const root of relRoots) {
      for (const rel of findChildElements(root, 'Relationship')) {
        const id = rel.attrs['Id'];
        const target = rel.attrs['Target'];
        if (id && target) {
          relIdToPath.set(id, resolveMediaZipPath(target));
        }
      }
    }
  }

  // Preload media files from word/media/*
  const mediaByPath = new Map<string, PendingImageRecord>();
  const mediaEntries = Object.keys(zip.files)
    .filter((name) => name.startsWith('word/media/') && !zip.files[name].dir)
    .sort();

  for (const mediaPath of mediaEntries) {
    const file = zip.file(mediaPath);
    if (!file) continue;
    const dataBase64 = await file.async('base64');
    const fileName = mediaPath.slice('word/media/'.length);
    mediaByPath.set(mediaPath, {
      figureRef: fileName,
      mimeType: inferImageMimeType(mediaPath),
      dataBase64,
    });
  }

  const docRoots = parseXmlNodes(documentXml);
  const docElem = docRoots.find((r) => r.localName === 'document') ?? docRoots[0];
  const bodyElem = docElem ? findFirstChildElement(docElem, 'body') : undefined;

  const pendingItems: PendingDocxItem[] = [];
  const sectionStack: Array<{ depth: number; title: string }> = [];
  let blockCounter = 0;
  const usedMediaPaths = new Set<string>();

  const nextBlockId = (): string => {
    blockCounter += 1;
    return `${documentId}:b:${blockCounter}`;
  };

  const currentSectionPath = (): string[] => sectionStack.map((s) => s.title);

  if (bodyElem) {
    for (const child of bodyElem.children) {
      if (child.kind !== 'element') continue;

      if (child.localName === 'tbl') {
        const tableMd = extractTableMarkdown(child);
        if (tableMd.length > 0) {
          pendingItems.push({
            block: {
              id: nextBlockId(),
              type: 'table',
              content: tableMd,
            },
            sectionPath: currentSectionPath(),
            isTopLevelHeading: false,
          });
        }
        continue;
      }

      if (child.localName !== 'p') continue;

      const pPr = findFirstChildElement(child, 'pPr');
      const pStyle = pPr ? findFirstChildElement(pPr, 'pStyle') : undefined;
      const headingDepth = detectHeadingDepth(getAttrVal(pStyle, 'val'));

      let textBuffer = '';
      let pendingBreak = false;
      const pImagePaths: string[] = [];

      const flushTextBuffer = () => {
        const trimmed = textBuffer.trim();
        textBuffer = '';
        if (trimmed.length === 0) return;

        if (headingDepth !== null) {
          while (
            sectionStack.length > 0 &&
            sectionStack[sectionStack.length - 1].depth >= headingDepth
          ) {
            sectionStack.pop();
          }
          sectionStack.push({ depth: headingDepth, title: trimmed });
          const hashes = '#'.repeat(headingDepth);
          pendingItems.push({
            block: {
              id: nextBlockId(),
              type: 'heading',
              content: `${hashes} ${trimmed}`,
            },
            sectionPath: currentSectionPath(),
            isTopLevelHeading: headingDepth === 1,
            explicitPageBreakBefore: pendingBreak,
          });
        } else {
          pendingItems.push({
            block: {
              id: nextBlockId(),
              type: 'paragraph',
              content: trimmed,
            },
            sectionPath: currentSectionPath(),
            isTopLevelHeading: false,
            explicitPageBreakBefore: pendingBreak,
          });
        }
        pendingBreak = false;
      };

      for (const pChild of child.children) {
        if (pChild.kind !== 'element') continue;

        if (pChild.localName === 'lastRenderedPageBreak') {
          flushTextBuffer();
          pendingBreak = true;
          continue;
        }

        if (pChild.localName === 'r') {
          if (hasPageBreakInRun(pChild)) {
            flushTextBuffer();
            pendingBreak = true;
          }
          textBuffer += extractInlineTextFromRun(pChild);

          const relIds: string[] = [];
          collectImageRelIds(pChild, relIds);
          for (const relId of relIds) {
            const mediaPath = relIdToPath.get(relId);
            if (mediaPath && mediaByPath.has(mediaPath)) {
              pImagePaths.push(mediaPath);
              usedMediaPaths.add(mediaPath);
            }
          }
          continue;
        }

        if (pChild.localName === 'hyperlink') {
          for (const hChild of pChild.children) {
            if (hChild.kind === 'element' && hChild.localName === 'r') {
              textBuffer += extractInlineTextFromRun(hChild);
            }
          }
          continue;
        }

        if (pChild.localName === 'oMathPara') {
          flushTextBuffer();
          const innerMath = findFirstChildElement(pChild, 'oMath') ?? pChild;
          const latex = convertOmmlNodeToLatex(innerMath).trim();
          if (latex.length > 0) {
            pendingItems.push({
              block: {
                id: nextBlockId(),
                type: 'formula',
                content: `$$${latex}$$`,
                latex,
              },
              sectionPath: currentSectionPath(),
              isTopLevelHeading: false,
              explicitPageBreakBefore: pendingBreak,
            });
            pendingBreak = false;
          }
          continue;
        }

        if (pChild.localName === 'oMath') {
          const latex = convertOmmlNodeToLatex(pChild).trim();
          if (latex.length > 0) {
            // Check if paragraph only holds this inline math
            const hasOtherText = textBuffer.trim().length > 0;
            const remainingSiblings = child.children
              .slice(child.children.indexOf(pChild) + 1)
              .some(
                (sib) =>
                  sib.kind === 'element' &&
                  ((sib.localName === 'r' && extractInlineTextFromRun(sib).trim().length > 0) ||
                    sib.localName === 'oMath'),
              );
            if (!hasOtherText && !remainingSiblings && headingDepth === null) {
              pendingItems.push({
                block: {
                  id: nextBlockId(),
                  type: 'formula',
                  content: `$${latex}$`,
                  latex,
                },
                sectionPath: currentSectionPath(),
                isTopLevelHeading: false,
                explicitPageBreakBefore: pendingBreak,
              });
              pendingBreak = false;
            } else {
              textBuffer += `$${latex}$`;
            }
          }
        }
      }

      flushTextBuffer();

      if (pImagePaths.length > 0) {
        pendingItems.push({
          sectionPath: currentSectionPath(),
          isTopLevelHeading: false,
          explicitPageBreakBefore: pendingBreak,
          imageRefs: pImagePaths,
        });
        pendingBreak = false;
      } else if (pendingBreak) {
        pendingItems.push({
          sectionPath: currentSectionPath(),
          isTopLevelHeading: false,
          explicitPageBreakBefore: true,
        });
      }
    }
  }

  // Group into ParsedPage[]
  const pages: ParsedPage[] = [];
  const extractedImages: ExtractedEmbeddedImage[] = [];

  let currentBlocks: ParsedBlock[] = [];
  let currentChars = 0;
  let currentPageSectionPath: string[] = [];
  let currentHasDiagram = false;

  const flushPage = () => {
    if (currentBlocks.length === 0 && !currentHasDiagram) return;
    pages.push({
      documentId,
      pageNumber: pages.length + 1,
      sectionPath: currentPageSectionPath,
      rawNormalizedText: currentBlocks.map((b) => b.content).join('\n\n'),
      blocks: currentBlocks,
      ...(currentHasDiagram ? { hasDiagram: true } : {}),
    });
    currentBlocks = [];
    currentChars = 0;
    currentPageSectionPath = [];
    currentHasDiagram = false;
  };

  for (const item of pendingItems) {
    const blockChars = item.block ? item.block.content.length : 0;
    const hasContentOnCurrentPage = currentBlocks.length > 0 || currentHasDiagram;
    const shouldBreakForExplicit = Boolean(item.explicitPageBreakBefore) && hasContentOnCurrentPage;
    const shouldBreakForHeading =
      item.isTopLevelHeading && currentChars >= MIN_CHARS_BEFORE_H1_PAGE_BREAK;
    const shouldBreakForSize =
      currentBlocks.length > 0 && currentChars + blockChars > virtualPageCharLimit;

    if (shouldBreakForExplicit || shouldBreakForHeading || shouldBreakForSize) {
      flushPage();
    }

    if (currentBlocks.length === 0 && !currentHasDiagram) {
      currentPageSectionPath = [...item.sectionPath];
    }

    if (item.block) {
      currentBlocks.push(item.block);
      currentChars += blockChars + (currentBlocks.length > 1 ? 2 : 0);
    }

    if (item.imageRefs && item.imageRefs.length > 0) {
      currentHasDiagram = true;
      const targetPageNumber = pages.length + 1;
      for (const mediaPath of item.imageRefs) {
        const record = mediaByPath.get(mediaPath);
        if (record) {
          extractedImages.push({
            pageNumber: targetPageNumber,
            figureRef: record.figureRef,
            mimeType: record.mimeType,
            dataBase64: record.dataBase64,
          });
        }
      }
    }
  }

  flushPage();

  if (pages.length === 0) {
    pages.push({
      documentId,
      pageNumber: 1,
      sectionPath: [],
      rawNormalizedText: '',
      blocks: [],
    });
  }

  // Fallback for any media files in word/media/* not referenced via document.xml.rels
  for (const [mediaPath, record] of mediaByPath.entries()) {
    if (!usedMediaPaths.has(mediaPath)) {
      pages[0].hasDiagram = true;
      extractedImages.push({
        pageNumber: 1,
        figureRef: record.figureRef,
        mimeType: record.mimeType,
        dataBase64: record.dataBase64,
      });
    }
  }

  return { pages, extractedImages };
}
