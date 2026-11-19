import { describe, expect, it } from 'vitest';
import { ParsedPageSchema, SourceDocumentSchema } from '@/core/schemas/document.schema';
import {
  detectMathAndFigures,
  ingestDocument,
  parsePdfDocument,
  reconstructPageTextLayout,
  renderPdfPageToBase64,
  stripRepeatedHeadersAndFooters,
  type PdfTextItem,
} from '@/ingestion';

function buildMinimalPdfBytes(pageStreams: string[]): Uint8Array {
  const objects: string[] = [];
  const pageObjNums: number[] = [];

  // Object 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  // Placeholder for Object 2 (Pages)
  objects.push('');
  // Object 3: Font F1
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  );

  let nextObjNum = 4;
  for (const streamBody of pageStreams) {
    const pageObjNum = nextObjNum++;
    const contentObjNum = nextObjNum++;
    pageObjNums.push(pageObjNum);

    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`,
    );
    const streamLength = new TextEncoder().encode(streamBody).byteLength;
    objects.push(
      `${contentObjNum} 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
    );
  }

  const kidsRef = pageObjNums.map((n) => `${n} 0 R`).join(' ');
  objects[1] = `2 0 obj\n<< /Type /Pages /Kids [${kidsRef}] /Count ${pageObjNums.length} >>\nendobj\n`;

  const encoder = new TextEncoder();
  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [0];
  let byteCursor = encoder.encode(chunks[0]).byteLength;

  for (const objStr of objects) {
    offsets.push(byteCursor);
    chunks.push(objStr);
    byteCursor += encoder.encode(objStr).byteLength;
  }

  const xrefOffset = byteCursor;
  const totalObjs = objects.length + 1;
  const xrefLines = [`xref\n0 ${totalObjs}\n0000000000 65535 f \n`];
  for (let i = 1; i < offsets.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  xrefLines.push(
    `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  chunks.push(xrefLines.join(''));
  return encoder.encode(chunks.join(''));
}

describe('ingestion: PDF layout, math/figure detector & pdfjs parsing', () => {
  it('reconstructs 2-column reading order strictly left column before right column', () => {
    // Interleaved Y coordinates across left column (x=50..240) and right column (x=320..520)
    const items: PdfTextItem[] = [
      { str: 'Linke Spalte Zeile 1', x: 50, y: 700, width: 180, height: 11, fontName: 'F1' },
      { str: 'Rechte Spalte Zeile 1', x: 320, y: 700, width: 180, height: 11, fontName: 'F1' },
      { str: 'Linke Spalte Zeile 2', x: 50, y: 685, width: 180, height: 11, fontName: 'F1' },
      { str: 'Rechte Spalte Zeile 2', x: 320, y: 685, width: 180, height: 11, fontName: 'F1' },
      { str: 'Linke Spalte Zeile 3', x: 50, y: 670, width: 180, height: 11, fontName: 'F1' },
      { str: 'Rechte Spalte Zeile 3', x: 320, y: 670, width: 180, height: 11, fontName: 'F1' },
    ];

    const layout = reconstructPageTextLayout(items, 595, 842);
    const idxLeft3 = layout.text.indexOf('Linke Spalte Zeile 3');
    const idxRight1 = layout.text.indexOf('Rechte Spalte Zeile 1');

    expect(idxLeft3).toBeGreaterThan(-1);
    expect(idxRight1).toBeGreaterThan(idxLeft3);
    expect(layout.lines.map((l) => l.text)).toEqual([
      'Linke Spalte Zeile 1',
      'Linke Spalte Zeile 2',
      'Linke Spalte Zeile 3',
      'Rechte Spalte Zeile 1',
      'Rechte Spalte Zeile 2',
      'Rechte Spalte Zeile 3',
    ]);
  });

  it('repairs hyphenated line breaks while preserving paragraph breaks', () => {
    const items: PdfTextItem[] = [
      { str: 'Bionische Strömungs-', x: 50, y: 700, width: 160, height: 12, fontName: 'F1' },
      { str: 'mechanik funktioniert.', x: 50, y: 686, width: 160, height: 12, fontName: 'F1' },
      // Large Y-gap (> 1.5 * 12 = 18) -> new paragraph
      { str: 'Zweiter Absatz beginnt.', x: 50, y: 650, width: 160, height: 12, fontName: 'F1' },
    ];

    const layout = reconstructPageTextLayout(items, 595, 842);
    expect(layout.text).toBe('Bionische Strömungsmechanik funktioniert.\n\nZweiter Absatz beginnt.');
  });

  it('strips repeated headers and footers in top/bottom 8% margins across >= 3 pages', () => {
    const pageHeight = 800;
    const makePage = (pageNumber: number, bodyText: string) => ({
      pageNumber,
      pageHeight,
      lines: [
        // Top 8% (>= 736)
        { text: 'Bionik Kompendium', x: 50, y: 760, width: 150, height: 10, fontName: 'F1', columnIndex: 0 },
        // Body
        { text: bodyText, x: 50, y: 500, width: 300, height: 12, fontName: 'F1', columnIndex: 0 },
        // Bottom 8% (<= 64)
        { text: String(pageNumber), x: 290, y: 30, width: 12, height: 10, fontName: 'F1', columnIndex: 0 },
      ],
    });

    const stripped = stripRepeatedHeadersAndFooters([
      makePage(1, 'Inhalt Seite Eins.'),
      makePage(2, 'Inhalt Seite Zwei.'),
      makePage(3, 'Inhalt Seite Drei.'),
      makePage(4, 'Inhalt Seite Vier.'),
    ]);

    expect(stripped).toHaveLength(4);
    expect(stripped[0].text).toBe('Inhalt Seite Eins.');
    expect(stripped[3].text).toBe('Inhalt Seite Vier.');
    for (const page of stripped) {
      expect(page.text).not.toContain('Bionik Kompendium');
    }
  });

  it('detects math anomalies (CMMI10, U+FFFD, PUA) and diagram signals (image op + Abb. 3)', () => {
    const mathFontResult = detectMathAndFigures({
      items: [
        { str: 'a', x: 10, y: 100, width: 6, height: 10, fontName: 'CMMI10' },
      ],
      operatorIds: [],
      pageText: 'Formula variable a',
    });
    expect(mathFontResult.hasMathAnomaly).toBe(true);
    expect(mathFontResult.hasDiagram).toBe(false);

    const puaReplacementResult = detectMathAndFigures({
      items: [
        { str: '\uFFFD\uE010', x: 10, y: 100, width: 10, height: 10, fontName: 'F1' },
      ],
      operatorIds: [],
      pageText: 'Broken glyph \uFFFD\uE010',
    });
    expect(puaReplacementResult.hasMathAnomaly).toBe(true);

    const diagramImageResult = detectMathAndFigures({
      items: [],
      operatorIds: [85],
      pageText: 'Siehe Abb. 3 für die Flügelgeometrie.',
      imageOpCodes: { paintImageXObject: 85, paintInlineImageXObject: 86 },
    });
    expect(diagramImageResult.hasDiagram).toBe(true);

    const vectorDiagramResult = detectMathAndFigures({
      items: [],
      operatorIds: Array.from({ length: 85 }, () => 20),
      pageText: 'Schematische Darstellung (Abb. 3).',
      imageOpCodes: { paintImageXObject: 85, paintInlineImageXObject: 86, stroke: 20 },
    });
    expect(vectorDiagramResult.hasDiagram).toBe(true);
  });

  it('parses a real minimal multi-page PDF via pdfjs-dist and ingestDocument', async () => {
    const pdfBytes = buildMinimalPdfBytes([
      'BT /F1 18 Tf 50 760 Td (Bionik Grundlagen) Tj ET\nBT /F1 11 Tf 50 720 Td (Der Lotuseffekt reinigt Oberflaechen automatisch.) Tj ET',
      'BT /F1 11 Tf 50 720 Td (Haifischhaut reduziert den Stroemungswiderstand.) Tj ET',
    ]);

    const pages = await parsePdfDocument(pdfBytes, 'doc-pdf-real');
    expect(pages).toHaveLength(2);
    for (const p of pages) {
      expect(ParsedPageSchema.parse(p)).toBeTruthy();
    }
    expect(pages[0].rawNormalizedText).toContain('Bionik Grundlagen');
    expect(pages[0].rawNormalizedText).toContain('Lotuseffekt');
    expect(pages[1].rawNormalizedText).toContain('Haifischhaut');

    const ingested = await ingestDocument({
      fileName: 'bionik-sample.pdf',
      domain: 'biology',
      data: pdfBytes,
    });
    expect(SourceDocumentSchema.parse(ingested.document)).toBeTruthy();
    expect(ingested.document.format).toBe('pdf');
    expect(ingested.document.pageCount).toBe(2);
    expect(ingested.document.detectedLanguage).toBe('de');
  });

  it('throws a clear error from renderPdfPageToBase64 when no Canvas API is available in headless Node', async () => {
    const pdfBytes = buildMinimalPdfBytes(['BT /F1 12 Tf 50 720 Td (Test) Tj ET']);
    await expect(renderPdfPageToBase64(pdfBytes, 1)).rejects.toThrow(/Canvas environment unavailable/i);
  });
});
