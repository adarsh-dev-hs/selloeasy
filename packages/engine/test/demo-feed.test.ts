import { loadFeed } from '@selloeasy/dataset';
import type { dataConnectors } from '@selloeasy/db';
import { marketEventRecordV1, normalizeRecord } from '@selloeasy/shared';
import { describe, expect, it } from 'vitest';
import { demoFeedConnector } from '../src/data/connectors';
import { assertCommittable, DataBatchError } from '../src/data/imports';

/** DEMO_FEED connector (plan2 §6.1) — pure: reads the bundled reserve, no DB. The DB run is in apps/api tests. */

type ConnectorRow = typeof dataConnectors.$inferSelect;
const now = new Date('2026-09-28T12:00:00Z');
const DAY = 86_400_000;

function connector(
  cursor: Record<string, unknown> | null,
  config: ConnectorRow['config'] = { batchSize: 10 },
): ConnectorRow {
  return {
    id: '00000000-0000-7000-8000-000000000000',
    name: 'Demo news feed',
    type: 'DEMO_FEED',
    config,
    schedule: null,
    enabled: true,
    fanOut: false,
    cursor,
    lastRunAt: null,
    lastStatus: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

const feed = loadFeed();

describe('demoFeedConnector', () => {
  it('releases batchSize rows per run and advances the offset cursor', async () => {
    const r1 = await demoFeedConnector.fetch(connector(null), 500, now);
    expect(r1.rows).toHaveLength(10);
    expect(r1.nextCursor).toEqual({ offset: 10, total: feed.length });
    expect(r1.hasMore).toBe(true);
    expect(r1.rows.map((r) => r.external_id)).toEqual(feed.slice(0, 10).map((r) => r.external_id));

    const r2 = await demoFeedConnector.fetch(connector(r1.nextCursor), 500, now);
    expect(r2.rows.map((r) => r.external_id)).toEqual(feed.slice(10, 20).map((r) => r.external_id));
    expect(r2.nextCursor).toEqual({ offset: 20, total: feed.length });
  });

  it('respects the run limit when it is below batchSize', async () => {
    const r = await demoFeedConnector.fetch(connector(null, { batchSize: 50 }), 5, now);
    expect(r.rows).toHaveLength(5);
    expect(r.nextCursor).toMatchObject({ offset: 5 });
  });

  it('reports no more data at the end of the reserve', async () => {
    const tail = await demoFeedConnector.fetch(connector({ offset: feed.length - 3 }), 500, now);
    expect(tail.rows).toHaveLength(3);
    expect(tail.hasMore).toBe(false);
    const done = await demoFeedConnector.fetch(connector({ offset: feed.length }), 500, now);
    expect(done.rows).toHaveLength(0);
    expect(done.hasMore).toBe(false);
    expect(done.nextCursor).toEqual({ offset: feed.length, total: feed.length });
  });

  it('shifts dates so the newest item lands yesterday, keeping relative spacing', async () => {
    const all = await demoFeedConnector.fetch(connector(null, { batchSize: 100 }), 5000, now);
    expect(all.rows).toHaveLength(Math.min(100, feed.length));
    const last = await demoFeedConnector.fetch(connector({ offset: feed.length - 1 }), 5000, now);
    expect(last.rows[0]!.published_at).toBe('2026-09-27');
    const shifted = all.rows.map((r) => Date.parse(String(r.published_at)));
    const original = feed.slice(0, all.rows.length).map((r) => Date.parse(String(r.published_at)));
    const delta = shifted[0]! - original[0]!;
    expect(delta % DAY).toBe(0);
    shifted.forEach((d, i) => expect(d - original[i]!).toBe(delta));
    for (const r of all.rows) expect(Date.parse(String(r.published_at))).toBeLessThan(now.getTime());
  });

  it('never shifts dates backwards when the reserve is newer than "now"', async () => {
    const past = new Date('2000-01-01T00:00:00Z');
    const r = await demoFeedConnector.fetch(connector(null), 500, past);
    expect(r.rows.map((x) => x.published_at)).toEqual(feed.slice(0, 10).map((x) => x.published_at));
  });

  it('released rows are valid template-v1 records', async () => {
    const r = await demoFeedConnector.fetch(connector(null), 500, now);
    for (const row of r.rows) expect(marketEventRecordV1.safeParse(normalizeRecord(row)).success).toBe(true);
  });
});

describe('assertCommittable (plan2 §7.1)', () => {
  const stats = (rows: number, valid: number, invalid: number) => ({
    rows,
    valid,
    warnings: 0,
    invalid,
    duplicates: rows - valid - invalid,
    inserted: 0,
    companiesCreated: 0,
    companiesUpdated: 0,
    contactsCreated: 0,
  });
  it('allows exactly the limit and refuses above it', () => {
    expect(() => assertCommittable(stats(10, 8, 2), 0.2)).not.toThrow();
    expect(() => assertCommittable(stats(10, 7, 3), 0.2)).toThrow(DataBatchError);
  });
  it('refuses a batch with nothing to commit', () => {
    expect(() => assertCommittable(stats(10, 0, 0), 0.2)).toThrow(/Nothing to commit/);
  });
});
