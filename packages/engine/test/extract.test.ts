import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '@selloeasy/dataset';
import { describe, expect, it } from 'vitest';
import { chunkText, extractText, sniffType, UnsupportedDocumentError } from '../src/knowledge/extract';

describe('document extraction', () => {
  it('parses the generated dataset PDFs', async () => {
    const buf = readFileSync(join(DATA_DIR, 'orgs/roadgrip-tyres/documents/brochure.pdf'));
    expect(sniffType(buf)).toBe('pdf');
    const text = await extractText(buf, 'application/pdf');
    expect(text.length).toBeGreaterThan(500);
    expect(text).toMatch(/Roadgrip/i);
  });

  it('rejects content that does not match the declared type', async () => {
    const buf = readFileSync(join(DATA_DIR, 'orgs/roadgrip-tyres/documents/brochure.pdf'));
    await expect(extractText(buf, 'text/plain')).rejects.toBeInstanceOf(UnsupportedDocumentError);
  });

  it('chunks long text with overlap', () => {
    const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40);
    const chunks = chunkText(Array.from({ length: 10 }, () => para).join('\n\n'), 200, 20);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 200 * 4 + 400)).toBe(true);
  });
});
