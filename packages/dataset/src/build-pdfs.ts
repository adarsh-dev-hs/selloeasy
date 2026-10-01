import { writeFileSync } from 'node:fs';
import { loadOrgs, orgDocumentPdfPath, readOrgDocument } from './index';

/**
 * Renders the dataset's markdown documents (asPdf: true) into simple text PDFs so the seed exercises
 * the real upload → PDF-parse → chunk path. Dependency-free minimal PDF 1.4 writer (Helvetica, A4).
 * Run: `pnpm --filter @selloeasy/dataset build:pdfs` (outputs are committed).
 */

const ASCII: Record<string, string> = {
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '₹': 'INR ',
  '€': 'EUR ',
  '•': '-',
  '×': 'x',
  '→': '->',
  '≥': '>=',
  '≤': '<=',
  ' ': ' ',
};

function toAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, (c) => ASCII[c] ?? '');
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

interface Line {
  text: string;
  size: number;
  bold: boolean;
}

function mdToLines(md: string): Line[] {
  const out: Line[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = toAscii(raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1'));
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      out.push({ text: '', size: 11, bold: false });
      out.push({ text: h[2]!, size: h[1]!.length === 1 ? 18 : h[1]!.length === 2 ? 14 : 12, bold: true });
      continue;
    }
    if (/^\|?\s*-{3,}/.test(line)) continue;
    const text = line.replace(/^\s*[-*]\s+/, '  - ').replace(/\|/g, '  ');
    const max = 92;
    if (text.length <= max) {
      out.push({ text, size: 11, bold: false });
      continue;
    }
    let cur = '';
    for (const word of text.split(' ')) {
      if ((cur + ' ' + word).trim().length > max) {
        out.push({ text: cur, size: 11, bold: false });
        cur = `    ${word}`;
      } else cur = cur ? `${cur} ${word}` : word;
    }
    if (cur) out.push({ text: cur, size: 11, bold: false });
  }
  return out;
}

export function renderPdf(title: string, md: string): Buffer {
  const lines = mdToLines(md);
  const pageHeight = 842;
  const top = 800;
  const bottom = 60;
  const pages: string[] = [];
  let y = top;
  let stream = '';
  const flush = () => {
    pages.push(stream);
    stream = '';
    y = top;
  };
  for (const l of lines) {
    const lh = l.size + 5;
    if (y - lh < bottom) flush();
    y -= lh;
    if (l.text) stream += `BT /${l.bold ? 'F2' : 'F1'} ${l.size} Tf 50 ${y} Td (${esc(l.text)}) Tj ET\n`;
  }
  if (stream || pages.length === 0) flush();

  const objects: string[] = [];
  const add = (s: string) => objects.push(s) - 1 + 1; // 1-based object number
  const catalog = add('');
  const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const info = add(`<< /Title (${esc(toAscii(title))}) /Producer (SelloEasy dataset) /Subject (Synthetic demo document) >>`);
  const pageIds: number[] = [];
  for (const content of pages) {
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 ${pageHeight}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let n = 0;
  for (const org of loadOrgs()) {
    for (const d of org.documents.filter((x) => x.asPdf)) {
      writeFileSync(orgDocumentPdfPath(org, d.file), renderPdf(d.title, readOrgDocument(org, d.file)));
      n++;
    }
  }
  console.log(`Rendered ${n} PDFs`);
}
