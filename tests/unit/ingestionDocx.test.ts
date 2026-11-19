import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ParsedPageSchema, SourceDocumentSchema } from '@/core/schemas/document.schema';
import { convertOmmlXmlToLatex, ingestDocument, parseDocxDocument } from '@/ingestion';

const ONE_BY_ONE_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

async function createTestDocxBytes(): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );

  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`,
  );

  zip.file('word/media/image1.png', ONE_BY_ONE_PNG_BYTES);

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Bionische Hydrodynamik</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>Widerstandsreduktion</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t xml:space="preserve">Die Reynolds-Zahl erfüllt </w:t></w:r>
      <m:oMath>
        <m:r><m:t>Re &lt; 1000 &amp; v &gt; 0</m:t></m:r>
      </m:oMath>
      <w:r><w:t xml:space="preserve"> im Test.</w:t></w:r>
    </w:p>
    <w:p>
      <m:oMathPara>
        <m:oMath>
          <m:f>
            <m:num><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:num>
            <m:den><m:rad><m:deg><m:r><m:t>3</m:t></m:r></m:deg><m:e><m:r><m:t>y</m:t></m:r></m:e></m:rad></m:den>
          </m:f>
        </m:oMath>
      </m:oMathPara>
    </w:p>
    <w:p>
      <m:oMathPara>
        <m:oMath>
          <m:nary>
            <m:naryPr><m:chr m:val="∫"/></m:naryPr>
            <m:sub><m:r><m:t>0</m:t></m:r></m:sub>
            <m:sup><m:r><m:t>∞</m:t></m:r></m:sup>
            <m:e><m:r><m:t>f(x)dx</m:t></m:r></m:e>
          </m:nary>
        </m:oMath>
      </m:oMathPara>
    </w:p>
    <w:p>
      <m:oMathPara>
        <m:oMath>
          <m:m>
            <m:mr>
              <m:e><m:r><m:t>a</m:t></m:r></m:e>
              <m:e><m:r><m:t>b</m:t></m:r></m:e>
            </m:mr>
            <m:mr>
              <m:e><m:r><m:t>c</m:t></m:r></m:e>
              <m:e><m:r><m:t>d</m:t></m:r></m:e>
            </m:mr>
          </m:m>
        </m:oMath>
      </m:oMathPara>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Parameter</w:t></m:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Wert</w:t></m:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Viskosität</w:t></m:r></w:p></w:tc>
        <w:tc><w:p><w:r><m:oMath><m:sSub><m:e><m:r><m:t>η</m:t></m:r></m:e><m:sub><m:r><m:t>0</m:t></m:r></m:sub></m:sSub></m:oMath></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p>
      <w:r>
        <w:drawing>
          <a:blip r:embed="rIdImg1"/>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p>
      <w:r><w:br w:type="page"/></w:r>
      <w:r><w:t>Zweite Seite nach Seitenumbruch.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`,
  );

  return zip.generateAsync({ type: 'uint8array' });
}

describe('ingestion: DOCX + OMML to LaTeX', () => {
  it('converts OMML elements (fraction, radical, scripts, nary, delimiters, matrix, entities) to LaTeX', () => {
    const omml = `
      <m:oMath>
        <m:f>
          <m:num><m:sSubSup><m:e><m:r><m:t>α</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSubSup></m:num>
          <m:den><m:rad><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:den>
        </m:f>
        <m:r><m:t> + </m:t></m:r>
        <m:nary>
          <m:naryPr><m:chr m:val="∑"/></m:naryPr>
          <m:sub><m:r><m:t>k=1</m:t></m:r></m:sub>
          <m:sup><m:r><m:t>n</m:t></m:r></m:sup>
          <m:e><m:d><m:e><m:r><m:t>k &lt; n</m:t></m:r></m:e></m:d></m:e>
        </m:nary>
      </m:oMath>
    `;

    const latex = convertOmmlXmlToLatex(omml);
    expect(latex).toContain('\\frac{{\\alpha}_{i}^{2}}{\\sqrt{x}}');
    expect(latex).toContain('\\sum_{k=1}^{n} \\left(k < n\\right)');
  });

  it('parses a programmatic DOCX archive with headings, OMML formulas, tables, embedded PNG, and page break', async () => {
    const docxBytes = await createTestDocxBytes();
    const { pages, extractedImages } = await parseDocxDocument(docxBytes, 'doc-docx-1');

    expect(pages.length).toBe(2);
    for (const p of pages) {
      expect(ParsedPageSchema.parse(p)).toBeTruthy();
    }

    const page1 = pages[0];
    expect(page1.sectionPath).toEqual(['Bionische Hydrodynamik']);
    expect(page1.hasDiagram).toBe(true);

    const formulas = page1.blocks.filter((b) => b.type === 'formula');
    expect(formulas.length).toBe(3);
    expect(formulas[0].latex).toBe('\\frac{{x}^{2}}{\\sqrt[3]{y}}');
    expect(formulas[1].latex).toBe('\\int_{0}^{\\infty} f(x)dx');
    expect(formulas[2].latex).toBe('\\begin{matrix} a & b \\\\ c & d \\end{matrix}');

    const paraWithInlineMath = page1.blocks.find(
      (b) => b.type === 'paragraph' && b.content.includes('$Re < 1000 & v > 0$'),
    );
    expect(paraWithInlineMath).toBeDefined();

    const tableBlock = page1.blocks.find((b) => b.type === 'table');
    expect(tableBlock).toBeDefined();
    expect(tableBlock?.content).toContain('| Parameter | Wert |');
    expect(tableBlock?.content).toContain('| Viskosität |');

    expect(extractedImages).toHaveLength(1);
    expect(extractedImages[0].pageNumber).toBe(1);
    expect(extractedImages[0].figureRef).toBe('image1.png');
    expect(extractedImages[0].mimeType).toBe('image/png');
    expect(extractedImages[0].dataBase64.length).toBeGreaterThan(10);

    expect(pages[1].rawNormalizedText).toContain('Zweite Seite nach Seitenumbruch.');
    expect(pages[1].sectionPath).toEqual(['Bionische Hydrodynamik', 'Widerstandsreduktion']);
  });

  it('ingests DOCX end-to-end via ingestDocument', async () => {
    const docxBytes = await createTestDocxBytes();
    const result = await ingestDocument({
      fileName: 'hydrodynamik.docx',
      domain: 'technology',
      data: docxBytes,
    });

    expect(SourceDocumentSchema.parse(result.document)).toBeTruthy();
    expect(result.document.format).toBe('docx');
    expect(result.document.pageCount).toBe(2);
    expect(result.document.stats.detectedFigurePages).toEqual([1]);
    expect(result.extractedImages?.length).toBe(1);
  });
});
