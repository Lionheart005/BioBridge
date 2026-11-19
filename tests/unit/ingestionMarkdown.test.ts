import { describe, expect, it } from 'vitest';
import { ParsedPageSchema, SourceDocumentSchema } from '@/core/schemas/document.schema';
import {
  detectFormat,
  detectLanguageHeuristic,
  ingestDocument,
  parseMarkdownDocument,
} from '@/ingestion';

describe('ingestion: Markdown & language heuristics', () => {
  it('parses headings hierarchy, GFM tables, inline math, and block math into ParsedPages', () => {
    const markdown = [
      '# Kapitel 1: Grundlagen',
      '',
      'Die Energie-Masse-Beziehung lautet $E=mc^2$ im Standardmodell.',
      '',
      '## 1.1 Integralformel',
      '',
      '$$\\int_0^\\infty f(x)dx$$',
      '',
      '| Größe | Einheit | Wert |',
      '| :--- | :---: | ---: |',
      '| Auftrieb | N | 42 |',
      '| Widerstand | N | 7 |',
    ].join('\n');

    const pages = parseMarkdownDocument(markdown, 'doc-md-1');
    expect(pages.length).toBe(1);

    const page = pages[0];
    expect(ParsedPageSchema.parse(page)).toBeTruthy();
    expect(page.pageNumber).toBe(1);
    expect(page.sectionPath).toEqual(['Kapitel 1: Grundlagen']);

    const headingBlocks = page.blocks.filter((b) => b.type === 'heading');
    expect(headingBlocks.map((b) => b.content)).toEqual([
      '# Kapitel 1: Grundlagen',
      '## 1.1 Integralformel',
    ]);

    const paragraphBlock = page.blocks.find((b) => b.type === 'paragraph');
    expect(paragraphBlock?.content).toContain('$E=mc^2$');

    const formulaBlock = page.blocks.find((b) => b.type === 'formula');
    expect(formulaBlock).toBeDefined();
    expect(formulaBlock?.latex).toBe('\\int_0^\\infty f(x)dx');

    const tableBlock = page.blocks.find((b) => b.type === 'table');
    expect(tableBlock).toBeDefined();
    expect(tableBlock?.content).toContain('| Größe | Einheit | Wert |');
    expect(tableBlock?.content).toContain('| Auftrieb | N | 42 |');
  });

  it('splits large markdown documents into deterministic virtual pages with sectionPath', () => {
    const longPara = 'Dies ist ein längerer Satz über bionische Strömungsmechanik und Optimierung. '.repeat(
      40,
    );
    const md = [
      '# Abschnitt A',
      '',
      longPara,
      '',
      '# Abschnitt B',
      '',
      '## Unterabschnitt B1',
      '',
      longPara,
    ].join('\n');

    const pages = parseMarkdownDocument(md, 'doc-md-long');
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages[0].pageNumber).toBe(1);
    expect(pages[0].sectionPath).toEqual(['Abschnitt A']);
    expect(pages[1].pageNumber).toBe(2);
    expect(pages.some((p) => p.sectionPath.includes('Abschnitt B'))).toBe(true);
  });

  it('routes markdown through ingestDocument and populates SourceDocument stats and language', async () => {
    const md = [
      '# Bionik im Leichtbau',
      '',
      'Die Natur nutzt hierarchische Strukturen für maximale Stabilität bei geringem Gewicht.',
      '',
      '$$\\sigma = \\frac{F}{A}$$',
    ].join('\n');

    const result = await ingestDocument({
      fileName: 'leichtbau.md',
      domain: 'biology',
      data: md,
    });

    expect(SourceDocumentSchema.parse(result.document)).toBeTruthy();
    expect(result.document.format).toBe('md');
    expect(result.document.detectedLanguage).toBe('de');
    expect(result.document.contentHash).toHaveLength(64);
    expect(result.document.stats.totalChars).toBeGreaterThan(0);
    expect(result.document.stats.estimatedTokens).toBe(
      Math.ceil(result.document.stats.totalChars / 4),
    );
  });

  it('detects formats and languages (de, en, fr, es) accurately', () => {
    expect(detectFormat('paper.pdf')).toBe('pdf');
    expect(detectFormat('report.docx')).toBe('docx');
    expect(detectFormat('notes.markdown')).toBe('md');
    expect(detectFormat('readme.txt')).toBe('txt');

    expect(
      detectLanguageHeuristic('Der Vogel fliegt durch die Luft und nutzt die Thermik für den Auftrieb.'),
    ).toBe('de');
    expect(
      detectLanguageHeuristic('The wing structure reduces drag and improves lift efficiency in flight.'),
    ).toBe('en');
    expect(
      detectLanguageHeuristic('Les oiseaux utilisent les courants ascendants pour voler avec moins de traînée.'),
    ).toBe('fr');
    expect(
      detectLanguageHeuristic('Los ingenieros diseñaron una estructura para mejorar el rendimiento y la estabilidad.'),
    ).toBe('es');
  });
});
