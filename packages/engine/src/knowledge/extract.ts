/**
 * Text extraction for uploaded documents (plan §9.2): PDF (unpdf / pdf.js), DOCX (mammoth), Markdown/plain text.
 * Magic bytes are checked before parsing — the declared content type is not trusted.
 */

export class UnsupportedDocumentError extends Error {}

export function sniffType(buf: Buffer): 'pdf' | 'zip' | 'text' | 'unknown' {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
  // Heuristic: printable UTF-8 in the first 2KB.
  const head = buf.subarray(0, 2048).toString('utf8');
  if (!/[\u0000-\u0008\u000E-\u001F]/.test(head)) return 'text';
  return 'unknown';
}

export async function extractText(buf: Buffer, declaredType: string): Promise<string> {
  const kind = sniffType(buf);
  if (kind === 'pdf') {
    if (declaredType !== 'application/pdf') throw new UnsupportedDocumentError('File content does not match declared type');
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n\n') : text;
  }
  if (kind === 'zip') {
    if (!declaredType.includes('wordprocessingml')) throw new UnsupportedDocumentError('Only .docx archives are supported');
    const mammoth = await import('mammoth');
    const res = await mammoth.extractRawText({ buffer: buf });
    return res.value;
  }
  if (kind === 'text') {
    if (!/^text\//.test(declaredType)) throw new UnsupportedDocumentError('File content does not match declared type');
    return buf.toString('utf8');
  }
  throw new UnsupportedDocumentError('Unsupported or corrupted document');
}

/** ~4 characters per token is a good-enough estimate for English text. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Split text into ~800-token chunks with ~100-token overlap on paragraph boundaries (plan §9.2).
 */
export function chunkText(text: string, targetTokens = 800, overlapTokens = 100): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const target = targetTokens * 4;
  const overlap = overlapTokens * 4;
  const paras = clean.split(/\n\n/);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (p.length > target) {
      // Very long paragraph: hard-split on sentences.
      for (const s of p.split(/(?<=[.!?])\s+/)) {
        if ((cur + ' ' + s).length > target && cur) {
          chunks.push(cur.trim());
          cur = cur.slice(-overlap);
        }
        cur += ` ${s}`;
      }
      continue;
    }
    if ((cur + '\n\n' + p).length > target && cur) {
      chunks.push(cur.trim());
      cur = cur.slice(-overlap);
    }
    cur += `\n\n${p}`;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
