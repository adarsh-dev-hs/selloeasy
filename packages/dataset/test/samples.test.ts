import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marketEventRecordV1, normalizeRecord, TEMPLATE_V1_COLUMNS } from '@selloeasy/shared';
import { describe, expect, it } from 'vitest';
import { loadEvents, loadFeed, SAMPLES_DIR } from '../src';

/**
 * plan2 §7.5 / §6.1: the downloadable samples must stay byte-identical to the repo-root copies, and the
 * DEMO_FEED reserve must be valid template-v1 data that does not overlap the seeded events.
 * (Row-level validation of the CSV samples — which needs the CSV parser in @selloeasy/pipeline — lives in
 * packages/pipeline/test/data-quality.test.ts; pipeline depends on dataset, so the reverse import would cycle.)
 */

const root = join(import.meta.dirname, '..', '..', '..');

describe('import samples', () => {
  it.each(['sampleData.csv', 'sampleData.invalid.csv'])(
    '%s is byte-identical to the repo-root copy',
    (name) => {
      const bundled = readFileSync(join(SAMPLES_DIR, name));
      const rootCopy = readFileSync(join(root, name));
      expect(bundled.equals(rootCopy)).toBe(true);
    },
  );

  it('both samples use the template v1 header', () => {
    for (const name of ['sampleData.csv', 'sampleData.invalid.csv']) {
      const header = readFileSync(join(SAMPLES_DIR, name), 'utf8').replace(/^﻿/, '').split(/\r?\n/)[0]!;
      for (const col of header.split(',')) expect(TEMPLATE_V1_COLUMNS, `${name}: ${col}`).toContain(col);
    }
  });
});

describe('DEMO_FEED reserve (loadFeed)', () => {
  const feed = loadFeed();

  it('has enough rows for several demo runs', () => {
    expect(feed.length).toBeGreaterThanOrEqual(20);
  });

  it('every row passes marketEventRecordV1', () => {
    for (const row of feed) {
      const r = marketEventRecordV1.safeParse(normalizeRecord(row));
      expect(
        r.success,
        `${String(row.external_id)}: ${r.success ? '' : JSON.stringify(r.error.issues)}`,
      ).toBe(true);
    }
  });

  it('is sorted oldest → newest with unique external ids and urls', () => {
    const dates = feed.map((r) => String(r.published_at));
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(feed.map((r) => r.external_id)).size).toBe(feed.length);
    expect(new Set(feed.map((r) => r.source_url)).size).toBe(feed.length);
  });

  it('does not overlap the seeded events or the import samples', () => {
    const seededIds = new Set(loadEvents().map((e) => e.externalId));
    const seededUrls = new Set(loadEvents().map((e) => e.url));
    const samples = readFileSync(join(SAMPLES_DIR, 'sampleData.csv'), 'utf8');
    for (const r of feed) {
      expect(seededIds.has(String(r.external_id))).toBe(false);
      expect(seededUrls.has(String(r.source_url))).toBe(false);
      expect(samples).not.toContain(String(r.source_url));
    }
  });
});
