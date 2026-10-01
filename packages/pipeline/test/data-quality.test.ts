import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { templateCsv, TEMPLATE_V1_COLUMNS } from '@selloeasy/shared';
import { describe, expect, it } from 'vitest';
import { csvSafe, dedupeKeys, inspectFile, parseCsv, summarize, validateRows } from '../src';

const root = join(import.meta.dirname, '..', '..', '..');
const now = new Date('2026-09-28T00:00:00Z');

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines, CRLF and BOM', () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['1', '2', '3'],
    ]);
  });
  it('rejects unterminated quotes', () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(/Unterminated/);
  });
});

describe('sampleData.csv (plan2 §7.5)', () => {
  const file = inspectFile(readFileSync(join(root, 'sampleData.csv')), 'sampleData.csv');
  it('passes the file layer', () => {
    expect(file.ok).toBe(true);
    expect(file.format).toBe('csv');
    expect(file.rows).toHaveLength(10);
  });
  it('validates 10/10 rows with no errors', () => {
    const rows = validateRows(file.rows, { now });
    const s = summarize(rows);
    expect(s.invalid).toBe(0);
    expect(s.duplicates).toBe(0);
    expect(s.valid + s.warnings).toBe(10);
    expect(rows.filter((r) => r.record?.contact_name).length).toBe(7);
  });
  it('flags a second copy of the same rows as in-file duplicates', () => {
    const rows = validateRows([...file.rows, ...file.rows], { now });
    expect(summarize(rows).duplicates).toBe(10);
  });
});

describe('sampleData.invalid.csv (plan2 §7.5)', () => {
  const file = inspectFile(readFileSync(join(root, 'sampleData.invalid.csv')), 'sampleData.invalid.csv');
  const rows = validateRows(file.rows, { now });
  it('passes the file layer (problems are row-level)', () => {
    expect(file.ok).toBe(true);
    expect(file.rows).toHaveLength(13);
  });
  it('every bad-* row is INVALID with at least one error', () => {
    const bad = rows.filter((r) => String(r.raw.external_id).startsWith('bad-'));
    expect(bad).toHaveLength(12);
    for (const r of bad) {
      expect(r.status, String(r.raw.external_id)).toBe('INVALID');
      expect(r.issues.some((i) => i.severity === 'error')).toBe(true);
      expect(r.record).toBeNull();
    }
  });
  it('the one good row is kept and the file is above the 20% invalid limit', () => {
    const good = rows.filter((r) => !String(r.raw.external_id).startsWith('bad-'));
    expect(good.map((r) => r.status)).toEqual([expect.stringMatching(/^(VALID|WARNING)$/)]);
    const s = summarize(rows);
    expect(s.invalid / s.rows).toBeGreaterThan(0.2);
  });
});

describe('file layer rejects garbage', () => {
  it('rejects binary / xlsx', () => {
    expect(inspectFile(Buffer.from('PK\u0003\u0004 zip data'), 'x.xlsx').fileIssues[0]!.code).toBe('binary');
  });
  it('rejects non-UTF-8', () => {
    expect(inspectFile(Buffer.from([0x61, 0x2c, 0xff, 0xfe, 0x0a]), 'x.csv').fileIssues[0]!.code).toBe('encoding');
  });
  it('rejects unknown and missing columns', () => {
    expect(inspectFile(Buffer.from('name,email\nA,b@c.example\n'), 'x.csv').fileIssues[0]!.code).toBe('unknown_columns');
    expect(inspectFile(Buffer.from('source,title\nA,B\n'), 'x.csv').fileIssues[0]!.code).toBe('missing_columns');
  });
  it('rejects ragged rows and empty files', () => {
    expect(inspectFile(Buffer.from(''), 'x.csv').fileIssues[0]!.code).toBe('empty');
    expect(inspectFile(Buffer.from(`${TEMPLATE_V1_COLUMNS.join(',')}\na,b\n`), 'x.csv').fileIssues[0]!.code).toBe('parse');
  });
  it('accepts the downloadable template itself', () => {
    const f = inspectFile(Buffer.from(templateCsv()), 'template.csv');
    expect(f.ok).toBe(true);
  });
});

describe('row layer', () => {
  const base = inspectFile(readFileSync(join(root, 'sampleData.csv')), 'sampleData.csv').rows[0]!;
  const check = (patch: Record<string, string>) => validateRows([{ ...base, ...patch }], { now })[0]!;
  it.each([
    [{ title: '' }, 'title'],
    [{ title: 'TEST' }, 'title'],
    [{ body: 'lorem ipsum dolor sit amet '.repeat(20) }, 'body'],
    [{ title: 'TORVIA MOTORS LAUNCHES A NEW ELECTRIC SUV TODAY' }, 'title'],
    [{ industry_tags: 'Automotive|Space Mining' }, 'industry_tags'],
    [{ published_at: 'next tuesday' }, 'published_at'],
    [{ published_at: '2031-01-01' }, 'published_at'],
    [{ amount: '5000000', currency: '' }, 'currency'],
    [{ source_url: 'http://localhost/admin' }, 'source_url'],
    [{ subject_company_domain: 'gmail.com' }, 'subject_company_domain'],
    [{ subject_company_size_band: '1-50', subject_company_employees: '9000' }, 'subject_company_employees'],
    [{ contact_email: '', contact_phone: '' }, 'contact_email'],
  ])('rejects %j', (patch, field) => {
    const r = check(patch);
    expect(r.status).toBe('INVALID');
    expect(r.issues.some((i) => i.field === field && i.severity === 'error')).toBe(true);
  });
  it('warns (but keeps) on consistency issues', () => {
    const r = check({ contact_email: 'kavita@other-company.example' });
    expect(r.status).toBe('WARNING');
    expect(r.record).not.toBeNull();
  });
  it('normalises tags case-insensitively', () => {
    expect(check({ industry_tags: 'automotive|ELECTRIC VEHICLES' }).record?.industry_tags).toEqual(['Automotive', 'Electric Vehicles']);
  });
});

describe('keys & export safety', () => {
  it('dedupe keys ignore case/whitespace', () => {
    const r = { source: 'A', external_id: 'X1', source_url: 'https://a.example/1/', title: 'T', body: 'B' } as never;
    expect(dedupeKeys(r).sourceExternal).toBe('a::x1');
    expect(dedupeKeys(r).sourceUrl).toBe('https://a.example/1');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(csvSafe('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvSafe(['a', 'b'])).toBe('a|b');
  });
});
