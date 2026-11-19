export interface XmlTextNode {
  kind: 'text';
  text: string;
}

export interface XmlElementNode {
  kind: 'element';
  name: string;
  localName: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlTextNode | XmlElementNode;

const NAMED_XML_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
};

/**
 * Decodes standard XML named and numeric character entities.
 */
export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) {
    return value;
  }
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : full;
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : full;
    }
    return NAMED_XML_ENTITIES[entity] ?? full;
  });
}

function getLocalName(name: string): string {
  const colonIdx = name.indexOf(':');
  return colonIdx === -1 ? name : name.slice(colonIdx + 1);
}

function parseAttributes(attrSource: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrSource)) !== null) {
    const key = match[1];
    const rawVal = match[2] ?? match[3] ?? '';
    const decoded = decodeXmlEntities(rawVal);
    attrs[key] = decoded;
    const localKey = getLocalName(key);
    if (!(localKey in attrs)) {
      attrs[localKey] = decoded;
    }
  }
  return attrs;
}

/**
 * Lightweight, DOM-free XML parser suitable for Web Workers and Node environments.
 */
export function parseXmlNodes(xml: string): XmlElementNode[] {
  const roots: XmlElementNode[] = [];
  const stack: XmlElementNode[] = [];
  let pos = 0;
  const len = xml.length;

  const appendNode = (node: XmlNode) => {
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else if (node.kind === 'element') {
      roots.push(node);
    }
  };

  while (pos < len) {
    const lt = xml.indexOf('<', pos);
    if (lt === -1) {
      const trailing = decodeXmlEntities(xml.slice(pos));
      if (trailing.length > 0 && stack.length > 0) {
        appendNode({ kind: 'text', text: trailing });
      }
      break;
    }

    if (lt > pos) {
      const text = decodeXmlEntities(xml.slice(pos, lt));
      if (text.length > 0 && stack.length > 0) {
        appendNode({ kind: 'text', text });
      }
    }

    // XML comment
    if (xml.startsWith('<!--', lt)) {
      const endComment = xml.indexOf('-->', lt + 4);
      pos = endComment === -1 ? len : endComment + 3;
      continue;
    }

    // Processing instruction or declaration
    if (xml.startsWith('<?', lt)) {
      const endPi = xml.indexOf('?>', lt + 2);
      pos = endPi === -1 ? len : endPi + 2;
      continue;
    }

    // CDATA section
    if (xml.startsWith('<![CDATA[', lt)) {
      const endCdata = xml.indexOf(']]>', lt + 9);
      const cdataText = endCdata === -1 ? xml.slice(lt + 9) : xml.slice(lt + 9, endCdata);
      if (cdataText.length > 0 && stack.length > 0) {
        appendNode({ kind: 'text', text: cdataText });
      }
      pos = endCdata === -1 ? len : endCdata + 3;
      continue;
    }

    // Doctype / other <! ... >
    if (xml.startsWith('<!', lt)) {
      const endBang = xml.indexOf('>', lt + 2);
      pos = endBang === -1 ? len : endBang + 1;
      continue;
    }

    // Find closing '>' outside quoted attribute values
    let gt = -1;
    let quote: '"' | "'" | null = null;
    for (let i = lt + 1; i < len; i++) {
      const ch = xml[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        gt = i;
        break;
      }
    }

    if (gt === -1) {
      break;
    }

    const rawTag = xml.slice(lt + 1, gt).trim();
    pos = gt + 1;

    if (rawTag.length === 0) {
      continue;
    }

    // Closing tag
    if (rawTag.startsWith('/')) {
      const closeName = rawTag.slice(1).trim();
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === closeName || stack[i].localName === getLocalName(closeName)) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const selfClosing = rawTag.endsWith('/');
    const tagBody = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const spaceMatch = /\s/.exec(tagBody);
    const name = spaceMatch ? tagBody.slice(0, spaceMatch.index) : tagBody;
    const attrPart = spaceMatch ? tagBody.slice(spaceMatch.index + 1) : '';

    const elem: XmlElementNode = {
      kind: 'element',
      name,
      localName: getLocalName(name),
      attrs: attrPart.length > 0 ? parseAttributes(attrPart) : {},
      children: [],
    };

    appendNode(elem);
    if (!selfClosing) {
      stack.push(elem);
    }
  }

  return roots;
}

export function findChildElements(parent: XmlElementNode, localName: string): XmlElementNode[] {
  return parent.children.filter(
    (child): child is XmlElementNode => child.kind === 'element' && child.localName === localName,
  );
}

export function findFirstChildElement(
  parent: XmlElementNode,
  localName: string,
): XmlElementNode | undefined {
  return parent.children.find(
    (child): child is XmlElementNode => child.kind === 'element' && child.localName === localName,
  );
}

export function getAttrVal(elem: XmlElementNode | undefined, attrLocalName = 'val'): string | undefined {
  if (!elem) return undefined;
  return elem.attrs[`m:${attrLocalName}`] ?? elem.attrs[`w:${attrLocalName}`] ?? elem.attrs[attrLocalName];
}

const UNICODE_MATH_TO_LATEX: Record<string, string> = {
  // Lowercase Greek
  α: '\\alpha',
  β: '\\beta',
  γ: '\\gamma',
  δ: '\\delta',
  ε: '\\epsilon',
  ϵ: '\\varepsilon',
  ζ: '\\zeta',
  η: '\\eta',
  θ: '\\theta',
  ϑ: '\\vartheta',
  ι: '\\iota',
  κ: '\\kappa',
  λ: '\\lambda',
  μ: '\\mu',
  ν: '\\nu',
  ξ: '\\xi',
  π: '\\pi',
  ϖ: '\\varpi',
  ρ: '\\rho',
  ϱ: '\\varrho',
  σ: '\\sigma',
  ς: '\\varsigma',
  τ: '\\tau',
  υ: '\\upsilon',
  φ: '\\phi',
  ϕ: '\\varphi',
  χ: '\\chi',
  ψ: '\\psi',
  ω: '\\omega',
  // Uppercase Greek
  Γ: '\\Gamma',
  Δ: '\\Delta',
  Θ: '\\Theta',
  Λ: '\\Lambda',
  Ξ: '\\Xi',
  Π: '\\Pi',
  Σ: '\\Sigma',
  Υ: '\\Upsilon',
  Φ: '\\Phi',
  Ψ: '\\Psi',
  Ω: '\\Omega',
  // Common math operators & symbols
  '∞': '\\infty',
  '≤': '\\le',
  '≥': '\\ge',
  '≠': '\\neq',
  '≈': '\\approx',
  '≡': '\\equiv',
  '±': '\\pm',
  '∓': '\\mp',
  '×': '\\times',
  '÷': '\\div',
  '·': '\\cdot',
  '⋅': '\\cdot',
  '∘': '\\circ',
  '∂': '\\partial',
  '∇': '\\nabla',
  '∈': '\\in',
  '∉': '\\notin',
  '⊂': '\\subset',
  '⊆': '\\subseteq',
  '⊃': '\\supset',
  '⊇': '\\supseteq',
  '∪': '\\cup',
  '∩': '\\cap',
  '∀': '\\forall',
  '∃': '\\exists',
  '¬': '\\neg',
  '∧': '\\land',
  '∨': '\\lor',
  '⇒': '\\Rightarrow',
  '⇔': '\\Leftrightarrow',
  '→': '\\to',
  '←': '\\leftarrow',
  '↔': '\\leftrightarrow',
  '↦': '\\mapsto',
  '√': '\\sqrt',
  '∫': '\\int',
  '∬': '\\iint',
  '∭': '\\iiint',
  '∮': '\\oint',
  '∑': '\\sum',
  '∏': '\\prod',
  '…': '\\ldots',
  '⋯': '\\cdots',
  '′': "'",
  '−': '-',
};

const NARY_OPERATOR_MAP: Record<string, string> = {
  '∫': '\\int',
  '∬': '\\iint',
  '∭': '\\iiint',
  '∮': '\\oint',
  '∑': '\\sum',
  '∏': '\\prod',
  '∐': '\\coprod',
  '⋃': '\\bigcup',
  '⋂': '\\bigcap',
};

const ACCENT_MAP: Record<string, string> = {
  '\u0302': '\\hat',
  '^': '\\hat',
  '\u0304': '\\bar',
  '\u00AF': '\\bar',
  '\u20D7': '\\vec',
  '\u2192': '\\vec',
  '\u0303': '\\tilde',
  '~': '\\tilde',
  '\u0307': '\\dot',
  '\u0308': '\\ddot',
};

function convertTextToLatex(rawText: string): string {
  let out = '';
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];
    const mapped = UNICODE_MATH_TO_LATEX[ch];
    if (mapped) {
      out += mapped;
      // Prevent merging command like \alpha with a following ASCII letter (e.g. \alphax)
      const next = rawText[i + 1];
      if (mapped.startsWith('\\') && next && /[a-zA-Z]/.test(next)) {
        out += ' ';
      }
    } else {
      out += ch;
    }
  }
  return out;
}

function escapeDelimiter(chr: string | undefined, fallback: string): string {
  if (chr === undefined) return fallback;
  if (chr === '') return '.';
  if (chr === '{' || chr === '}') return `\\${chr}`;
  return chr;
}

function joinLatexParts(parts: string[]): string {
  let result = '';
  for (const part of parts) {
    if (!part) continue;
    if (
      result.length > 0 &&
      /\\[a-zA-Z]+$/.test(result) &&
      /^[a-zA-Z]/.test(part)
    ) {
      result += ' ';
    }
    result += part;
  }
  return result;
}

/**
 * Converts a parsed OMML XML ElementNode subtree into LaTeX.
 */
export function convertOmmlNodeToLatex(node: XmlNode): string {
  if (node.kind === 'text') {
    return '';
  }

  switch (node.localName) {
    case 't':
      return convertTextToLatex(
        node.children
          .filter((c): c is XmlTextNode => c.kind === 'text')
          .map((c) => c.text)
          .join(''),
      );

    case 'r': {
      const parts = node.children
        .filter((c): c is XmlElementNode => c.kind === 'element' && c.localName === 't')
        .map((c) => convertOmmlNodeToLatex(c));
      return joinLatexParts(parts);
    }

    case 'f': {
      const num = convertChildren(findFirstChildElement(node, 'num'));
      const den = convertChildren(findFirstChildElement(node, 'den'));
      return `\\frac{${num}}{${den}}`;
    }

    case 'rad': {
      const deg = convertChildren(findFirstChildElement(node, 'deg')).trim();
      const base = convertChildren(findFirstChildElement(node, 'e'));
      return deg.length > 0 ? `\\sqrt[${deg}]{${base}}` : `\\sqrt{${base}}`;
    }

    case 'sSup': {
      const base = convertChildren(findFirstChildElement(node, 'e'));
      const sup = convertChildren(findFirstChildElement(node, 'sup'));
      return `{${base}}^{${sup}}`;
    }

    case 'sSub': {
      const base = convertChildren(findFirstChildElement(node, 'e'));
      const sub = convertChildren(findFirstChildElement(node, 'sub'));
      return `{${base}}_{${sub}}`;
    }

    case 'sSubSup': {
      const base = convertChildren(findFirstChildElement(node, 'e'));
      const sub = convertChildren(findFirstChildElement(node, 'sub'));
      const sup = convertChildren(findFirstChildElement(node, 'sup'));
      return `{${base}}_{${sub}}^{${sup}}`;
    }

    case 'sPre': {
      const sub = convertChildren(findFirstChildElement(node, 'sub'));
      const sup = convertChildren(findFirstChildElement(node, 'sup'));
      const base = convertChildren(findFirstChildElement(node, 'e'));
      return `_{${sub}}^{${sup}}{${base}}`;
    }

    case 'nary': {
      const naryPr = findFirstChildElement(node, 'naryPr');
      const chrVal = getAttrVal(naryPr ? findFirstChildElement(naryPr, 'chr') : undefined) ?? '∫';
      const op = NARY_OPERATOR_MAP[chrVal] ?? convertTextToLatex(chrVal);
      const sub = convertChildren(findFirstChildElement(node, 'sub')).trim();
      const sup = convertChildren(findFirstChildElement(node, 'sup')).trim();
      const body = convertChildren(findFirstChildElement(node, 'e')).trim();

      let out = op;
      if (sub.length > 0) out += `_{${sub}}`;
      if (sup.length > 0) out += `^{${sup}}`;
      if (body.length > 0) out += ` ${body}`;
      return out;
    }

    case 'd': {
      const dPr = findFirstChildElement(node, 'dPr');
      const beg = escapeDelimiter(
        getAttrVal(dPr ? findFirstChildElement(dPr, 'begChr') : undefined),
        '(',
      );
      const end = escapeDelimiter(
        getAttrVal(dPr ? findFirstChildElement(dPr, 'endChr') : undefined),
        ')',
      );
      const sep = getAttrVal(dPr ? findFirstChildElement(dPr, 'sepChr') : undefined) ?? '|';
      const elements = findChildElements(node, 'e').map((e) => convertChildren(e));
      const inner = elements.join(sep === ',' ? ', ' : ` ${sep} `);
      return `\\left${beg}${inner}\\right${end}`;
    }

    case 'm': {
      const rows = findChildElements(node, 'mr').map((mr) =>
        findChildElements(mr, 'e')
          .map((cell) => convertChildren(cell).trim())
          .join(' & '),
      );
      return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
    }

    case 'func': {
      const fName = convertChildren(findFirstChildElement(node, 'fName')).trim();
      const arg = convertChildren(findFirstChildElement(node, 'e')).trim();
      const cmd = /^[a-zA-Z]+$/.test(fName) ? `\\operatorname{${fName}}` : fName;
      return arg.length > 0 ? `${cmd} ${arg}` : cmd;
    }

    case 'acc': {
      const accPr = findFirstChildElement(node, 'accPr');
      const chrVal = getAttrVal(accPr ? findFirstChildElement(accPr, 'chr') : undefined) ?? '\u0302';
      const cmd = ACCENT_MAP[chrVal] ?? '\\hat';
      const base = convertChildren(findFirstChildElement(node, 'e'));
      return `${cmd}{${base}}`;
    }

    case 'bar': {
      const barPr = findFirstChildElement(node, 'barPr');
      const posVal = getAttrVal(barPr ? findFirstChildElement(barPr, 'pos') : undefined);
      const base = convertChildren(findFirstChildElement(node, 'e'));
      return posVal === 'bot' ? `\\underline{${base}}` : `\\overline{${base}}`;
    }

    case 'limLow': {
      const base = convertChildren(findFirstChildElement(node, 'e')).trim();
      const lim = convertChildren(findFirstChildElement(node, 'lim')).trim();
      return base === 'lim' ? `\\lim_{${lim}}` : `${base}_{${lim}}`;
    }

    case 'limUpp': {
      const base = convertChildren(findFirstChildElement(node, 'e')).trim();
      const lim = convertChildren(findFirstChildElement(node, 'lim')).trim();
      return `${base}^{${lim}}`;
    }

    case 'eqArr': {
      const lines = findChildElements(node, 'e').map((e) => convertChildren(e).trim());
      return `\\begin{aligned} ${lines.join(' \\\\ ')} \\end{aligned}`;
    }

    case 'oMathPara':
    case 'oMath':
    case 'e':
    case 'num':
    case 'den':
    case 'deg':
    case 'sub':
    case 'sup':
    case 'fName':
    case 'lim':
    case 'box':
    case 'groupChr':
    case 'borderBox':
      return convertChildren(node);

    // Property/metadata nodes produce no output
    case 'fPr':
    case 'radPr':
    case 'sSupPr':
    case 'sSubPr':
    case 'sSubSupPr':
    case 'sPrePr':
    case 'naryPr':
    case 'dPr':
    case 'mPr':
    case 'mrPr':
    case 'funcPr':
    case 'accPr':
    case 'barPr':
    case 'rPr':
    case 'ctrlPr':
    case 'oMathParaPr':
      return '';

    default:
      return convertChildren(node);
  }
}

function convertChildren(parent: XmlElementNode | undefined): string {
  if (!parent) return '';
  const parts: string[] = [];
  for (const child of parent.children) {
    if (child.kind === 'element') {
      parts.push(convertOmmlNodeToLatex(child));
    }
  }
  return joinLatexParts(parts);
}

/**
 * Converts an OMML XML string (e.g. <m:oMath>...</m:oMath> or <m:oMathPara>...</m:oMathPara>)
 * into a LaTeX string without any DOM dependency.
 */
export function convertOmmlXmlToLatex(ommlXml: string): string {
  const roots = parseXmlNodes(ommlXml);
  const parts = roots.map((root) => convertOmmlNodeToLatex(root));
  return joinLatexParts(parts).trim();
}
