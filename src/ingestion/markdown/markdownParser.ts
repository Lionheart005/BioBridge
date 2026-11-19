import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { toString as mdastToString } from 'mdast-util-to-string';
import type {} from 'mdast-util-math';
import type {
  Blockquote,
  Code,
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
} from 'mdast';
import type { ParsedBlock, ParsedPage } from '@/core/schemas/document.schema';

const DEFAULT_VIRTUAL_PAGE_CHAR_LIMIT = 3500;
const MIN_CHARS_BEFORE_H1_PAGE_BREAK = 400;

interface SectionStackEntry {
  depth: number;
  title: string;
}

interface PendingBlockItem {
  block: ParsedBlock;
  sectionPath: string[];
  isTopLevelHeading: boolean;
}

export interface MarkdownParseOptions {
  virtualPageCharLimit?: number;
}

function serializePhrasing(nodes: PhrasingContent[], rawSource: string): string {
  return nodes
    .map((node) => serializePhrasingNode(node, rawSource))
    .join('');
}

function serializePhrasingNode(node: PhrasingContent, rawSource: string): string {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'inlineCode':
      return `\`${node.value}\``;
    case 'inlineMath': {
      // Preserve single ($...$) vs double ($$...$$) delimiters if present in source
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start === 'number' && typeof end === 'number') {
        const rawSlice = rawSource.slice(start, end);
        if (rawSlice.startsWith('$$') && rawSlice.endsWith('$$')) {
          return `$$${node.value}$$`;
        }
      }
      return `$${node.value}$`;
    }
    case 'emphasis':
      return `*${serializePhrasing(node.children, rawSource)}*`;
    case 'strong':
      return `**${serializePhrasing(node.children, rawSource)}**`;
    case 'delete':
      return `~~${serializePhrasing(node.children, rawSource)}~~`;
    case 'link': {
      const label = serializePhrasing(node.children, rawSource);
      return `[${label}](${node.url})`;
    }
    case 'image':
      return node.alt ? `![${node.alt}](${node.url})` : `![](${node.url})`;
    case 'break':
      return '\n';
    default:
      return mdastToString(node);
  }
}

function serializeTableCell(cell: TableCell, rawSource: string): string {
  return serializePhrasing(cell.children, rawSource)
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function serializeTable(table: Table, rawSource: string): string {
  const rows = table.children;
  if (rows.length === 0) {
    return '';
  }
  const colCount = rows.reduce((max, row) => Math.max(max, row.children.length), 0);
  if (colCount === 0) {
    return '';
  }

  const formatRow = (cells: TableCell[]): string => {
    const padded: string[] = [];
    for (let i = 0; i < colCount; i++) {
      const cell = cells[i];
      padded.push(cell ? serializeTableCell(cell, rawSource) : '');
    }
    return `| ${padded.join(' | ')} |`;
  };

  const alignRow = (): string => {
    const separators: string[] = [];
    for (let i = 0; i < colCount; i++) {
      const align = table.align?.[i];
      if (align === 'left') separators.push(':---');
      else if (align === 'center') separators.push(':---:');
      else if (align === 'right') separators.push('---:');
      else separators.push('---');
    }
    return `| ${separators.join(' | ')} |`;
  };

  const lines: string[] = [formatRow(rows[0].children), alignRow()];
  for (let i = 1; i < rows.length; i++) {
    lines.push(formatRow(rows[i].children));
  }
  return lines.join('\n');
}

function serializeListItem(item: ListItem, ordered: boolean, index: number, rawSource: string): string {
  const prefix = ordered ? `${index + 1}. ` : '- ';
  const checkedPrefix =
    typeof item.checked === 'boolean' ? (item.checked ? '[x] ' : '[ ] ') : '';
  const parts: string[] = [];

  for (const child of item.children) {
    if (child.type === 'paragraph') {
      parts.push(serializePhrasing(child.children, rawSource).trim());
    } else if (child.type === 'list') {
      const nested = serializeList(child, rawSource)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      parts.push(nested);
    } else {
      parts.push(mdastToString(child).trim());
    }
  }

  const first = parts[0] ?? '';
  const rest = parts.slice(1);
  return [`${prefix}${checkedPrefix}${first}`, ...rest].join('\n');
}

function serializeList(list: List, rawSource: string): string {
  const start = list.start ?? 1;
  return list.children
    .map((item, idx) => serializeListItem(item, Boolean(list.ordered), start - 1 + idx, rawSource))
    .join('\n');
}

function serializeBlockquote(blockquote: Blockquote, rawSource: string): string {
  const innerParts: string[] = [];
  for (const child of blockquote.children) {
    if (child.type === 'paragraph') {
      innerParts.push(serializePhrasing(child.children, rawSource).trim());
    } else {
      innerParts.push(mdastToString(child).trim());
    }
  }
  return innerParts
    .join('\n\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function extractStandaloneInlineMath(
  paragraph: Paragraph,
  rawSource: string,
): { latex: string; wrapped: string } | null {
  const nonEmptyChildren = paragraph.children.filter(
    (child) => !(child.type === 'text' && child.value.trim() === ''),
  );
  if (nonEmptyChildren.length !== 1) {
    return null;
  }
  const sole = nonEmptyChildren[0];
  if (sole.type !== 'inlineMath') {
    return null;
  }
  const latex = sole.value.trim();
  const wrapped = serializePhrasingNode(sole, rawSource);
  return { latex, wrapped };
}

function buildPagesFromPendingBlocks(
  documentId: string,
  items: PendingBlockItem[],
  virtualPageCharLimit: number,
): ParsedPage[] {
  if (items.length === 0) {
    return [
      {
        documentId,
        pageNumber: 1,
        sectionPath: [],
        rawNormalizedText: '',
        blocks: [],
      },
    ];
  }

  const pages: ParsedPage[] = [];
  let currentBlocks: ParsedBlock[] = [];
  let currentChars = 0;
  let currentPageSectionPath: string[] = [];

  const flushPage = () => {
    if (currentBlocks.length === 0) return;
    pages.push({
      documentId,
      pageNumber: pages.length + 1,
      sectionPath: currentPageSectionPath,
      rawNormalizedText: currentBlocks.map((b) => b.content).join('\n\n'),
      blocks: currentBlocks,
    });
    currentBlocks = [];
    currentChars = 0;
    currentPageSectionPath = [];
  };

  for (const item of items) {
    const blockChars = item.block.content.length;
    const shouldBreakForHeading =
      item.isTopLevelHeading && currentChars >= MIN_CHARS_BEFORE_H1_PAGE_BREAK;
    const shouldBreakForSize =
      currentBlocks.length > 0 && currentChars + blockChars > virtualPageCharLimit;

    if (shouldBreakForHeading || shouldBreakForSize) {
      flushPage();
    }

    if (currentBlocks.length === 0) {
      currentPageSectionPath = [...item.sectionPath];
    }
    currentBlocks.push(item.block);
    currentChars += blockChars + (currentBlocks.length > 1 ? 2 : 0);
  }

  flushPage();
  return pages;
}

/**
 * Parses a Markdown document (with GFM tables and LaTeX math) into deterministic virtual ParsedPages.
 */
export function parseMarkdownDocument(
  markdownText: string,
  documentId: string,
  options?: MarkdownParseOptions,
): ParsedPage[] {
  const virtualPageCharLimit = options?.virtualPageCharLimit ?? DEFAULT_VIRTUAL_PAGE_CHAR_LIMIT;
  const normalizedInput = markdownText.replace(/\r\n?/g, '\n');

  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
  const tree = processor.parse(normalizedInput) as Root;

  const sectionStack: SectionStackEntry[] = [];
  const pending: PendingBlockItem[] = [];
  let blockCounter = 0;

  const nextBlockId = (): string => {
    blockCounter += 1;
    return `${documentId}:b:${blockCounter}`;
  };

  const currentSectionPath = (): string[] => sectionStack.map((entry) => entry.title);

  const pushRootContent = (node: RootContent): void => {
    switch (node.type) {
      case 'heading': {
        const heading = node as Heading;
        const headingText = mdastToString(heading).trim();
        while (
          sectionStack.length > 0 &&
          sectionStack[sectionStack.length - 1].depth >= heading.depth
        ) {
          sectionStack.pop();
        }
        if (headingText.length > 0) {
          sectionStack.push({ depth: heading.depth, title: headingText });
        }
        const hashes = '#'.repeat(heading.depth);
        pending.push({
          block: {
            id: nextBlockId(),
            type: 'heading',
            content: `${hashes} ${headingText}`.trim(),
          },
          sectionPath: currentSectionPath(),
          isTopLevelHeading: heading.depth === 1,
        });
        break;
      }
      case 'math': {
        const latex = node.value.trim();
        pending.push({
          block: {
            id: nextBlockId(),
            type: 'formula',
            content: `$$${latex}$$`,
            latex,
          },
          sectionPath: currentSectionPath(),
          isTopLevelHeading: false,
        });
        break;
      }
      case 'paragraph': {
        const standaloneMath = extractStandaloneInlineMath(node, normalizedInput);
        if (standaloneMath) {
          pending.push({
            block: {
              id: nextBlockId(),
              type: 'formula',
              content: standaloneMath.wrapped,
              latex: standaloneMath.latex,
            },
            sectionPath: currentSectionPath(),
            isTopLevelHeading: false,
          });
          break;
        }
        const text = serializePhrasing(node.children, normalizedInput).trim();
        if (text.length > 0) {
          pending.push({
            block: {
              id: nextBlockId(),
              type: 'paragraph',
              content: text,
            },
            sectionPath: currentSectionPath(),
            isTopLevelHeading: false,
          });
        }
        break;
      }
      case 'table': {
        const markdownTable = serializeTable(node, normalizedInput);
        if (markdownTable.length > 0) {
          pending.push({
            block: {
              id: nextBlockId(),
              type: 'table',
              content: markdownTable,
            },
            sectionPath: currentSectionPath(),
            isTopLevelHeading: false,
          });
        }
        break;
      }
      case 'list': {
        const listText = serializeList(node, normalizedInput).trim();
        if (listText.length > 0) {
          pending.push({
            block: {
              id: nextBlockId(),
              type: 'paragraph',
              content: listText,
            },
            sectionPath: currentSectionPath(),
            isTopLevelHeading: false,
          });
        }
        break;
      }
      case 'blockquote': {
        const quoteText = serializeBlockquote(node, normalizedInput).trim();
        if (quoteText.length > 0) {
          pending.push({
            block: {
              id: nextBlockId(),
              type: 'paragraph',
              content: quoteText,
            },
            sectionPath: currentSectionPath(),
            isTopLevelHeading: false,
          });
        }
        break;
      }
      case 'code': {
        const codeNode = node as Code;
        const lang = codeNode.lang ? codeNode.lang : '';
        const content = `\`\`\`${lang}\n${codeNode.value}\n\`\`\``;
        pending.push({
          block: {
            id: nextBlockId(),
            type: 'paragraph',
            content,
          },
          sectionPath: currentSectionPath(),
          isTopLevelHeading: false,
        });
        break;
      }
      case 'thematicBreak': {
        pending.push({
          block: {
            id: nextBlockId(),
            type: 'paragraph',
            content: '---',
          },
          sectionPath: currentSectionPath(),
          isTopLevelHeading: false,
        });
        break;
      }
      default: {
        const fallback = mdastToString(node).trim();
        if (fallback.length > 0) {
          pending.push({
            block: {
              id: nextBlockId(),
              type: 'paragraph',
              content: fallback,
            },
            sectionPath: currentSectionPath(),
            isTopLevelHeading: false,
          });
        }
        break;
      }
    }
  };

  for (const child of tree.children) {
    pushRootContent(child);
  }

  return buildPagesFromPendingBlocks(documentId, pending, virtualPageCharLimit);
}

/**
 * Parses plain text into deterministic virtual ParsedPages split on blank lines.
 */
export function parsePlainTextDocument(
  plainText: string,
  documentId: string,
  options?: MarkdownParseOptions,
): ParsedPage[] {
  const virtualPageCharLimit = options?.virtualPageCharLimit ?? DEFAULT_VIRTUAL_PAGE_CHAR_LIMIT;
  const normalized = plainText.replace(/\r\n?/g, '\n').trim();
  if (normalized.length === 0) {
    return buildPagesFromPendingBlocks(documentId, [], virtualPageCharLimit);
  }

  const paragraphs = normalized.split(/\n{2,}/);
  const pending: PendingBlockItem[] = [];
  let blockCounter = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length === 0) continue;
    blockCounter += 1;
    pending.push({
      block: {
        id: `${documentId}:b:${blockCounter}`,
        type: 'paragraph',
        content: trimmed,
      },
      sectionPath: [],
      isTopLevelHeading: false,
    });
  }

  return buildPagesFromPendingBlocks(documentId, pending, virtualPageCharLimit);
}
