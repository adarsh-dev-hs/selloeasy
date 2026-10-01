import { getConfig, readConnectorSecret } from '@selloeasy/core';
import { loadFeed } from '@selloeasy/dataset';
import {
  and,
  dataBatches,
  dataBatchRows,
  dataConnectors,
  eq,
  getDb,
  ingestionRuns,
  type ConnectorConfigJson,
  type DataBatchStats,
  type IngestionStatsJson,
  type RowIssueJson,
} from '@selloeasy/db';
import { inspectFile, summarize, validateRows, type ValidatedRow } from '@selloeasy/pipeline';
import type { RawRecord } from '@selloeasy/shared';
import { writeAudit } from '../audit';
import { assertPublicUrl } from '../knowledge/crawl';
import { fanOutToOrgs } from './fanout';
import { commitRecords, enrichValidation } from './imports';

type ConnectorRow = typeof dataConnectors.$inferSelect;

export interface FetchResult {
  rows: RawRecord[];
  nextCursor: Record<string, unknown> | null;
  hasMore: boolean;
}

/** plan2 §6.1 — pull template-v1 records newer than the cursor. */
export interface Connector {
  fetch(connector: ConnectorRow, limit: number, now: Date): Promise<FetchResult>;
}

/**
 * DEMO_FEED: releases the bundled reserve (packages/dataset/data/feed) a few rows per run. Dates are shifted so
 * the newest feed item lands "today", keeping the relative spacing — the demo always looks like fresh news.
 */
export const demoFeedConnector: Connector = {
  async fetch(connector, limit, now) {
    const feed = loadFeed();
    const offset = Number((connector.cursor as { offset?: number } | null)?.offset ?? 0);
    const size = Math.min(limit, connector.config.batchSize ?? 10);
    const slice = feed.slice(offset, offset + size);
    const newest = feed.reduce((m, r) => Math.max(m, Date.parse(String(r.published_at))), 0);
    const shiftDays = Math.max(0, Math.floor((now.getTime() - 86_400_000 - newest) / 86_400_000));
    const rows = slice.map((r) => {
      const d = new Date(Date.parse(String(r.published_at)) + shiftDays * 86_400_000);
      return { ...r, published_at: d.toISOString().slice(0, 10) };
    });
    const next = offset + slice.length;
    return { rows, nextCursor: { offset: next, total: feed.length }, hasMore: next < feed.length };
  },
};

const HTTP_TIMEOUT_MS = 60_000;
const HTTP_MAX_BYTES = 10 * 1024 * 1024;

async function fetchCapped(
  url: string,
  headers: Record<string, string>,
): Promise<{ text: string; buf: Buffer }> {
  await assertPublicUrl(url); // SSRF guard (same as the crawler)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SelloEasyIngest/1.0', ...headers },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok || !res.body) throw new Error(`Feed responded HTTP ${res.status}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > HTTP_MAX_BYTES) {
        await reader.cancel();
        throw new Error('Feed response exceeds 10 MB');
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks);
    return { buf, text: buf.toString('utf8') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTTP_FEED: GET an https endpoint that returns CSV / JSONL / JSON (array or {items, next}) in template v1.
 * Incremental via `?<sinceParam>=<ISO>`; JSON responses may paginate with a same-host `next` URL.
 */
export const httpFeedConnector: Connector = {
  async fetch(connector, limit) {
    const cfg: ConnectorConfigJson = connector.config;
    if (!cfg.url) throw new Error('Connector has no URL');
    const headers: Record<string, string> = {};
    if (cfg.authHeader && cfg.authEnvVar) {
      const value = readConnectorSecret(cfg.authEnvVar);
      if (!value) throw new Error(`Env var ${cfg.authEnvVar} is not set`);
      headers[cfg.authHeader] = value;
    }
    const since = (connector.cursor as { since?: string } | null)?.since;
    let url: string | null = (() => {
      const u = new URL(cfg.url);
      if (since && cfg.sinceParam) u.searchParams.set(cfg.sinceParam, since);
      return u.toString();
    })();
    const rootHost = new URL(cfg.url).host;
    const rows: RawRecord[] = [];
    let pages = 0;
    while (url && rows.length < limit && pages < 20) {
      pages++;
      const { buf, text } = await fetchCapped(url, headers);
      let next: string | null = null;
      if ((cfg.format ?? 'json') === 'json') {
        const parsed = JSON.parse(text) as unknown;
        const items = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown[] }).items;
        if (!Array.isArray(items)) throw new Error('JSON feed must be an array or {items: [...]}');
        rows.push(...(items as RawRecord[]));
        const n = !Array.isArray(parsed) ? (parsed as { next?: string }).next : undefined;
        if (n) {
          const nu: URL = new URL(n, url as string);
          if (nu.host !== rootHost) throw new Error('Pagination link points to a different host');
          next = nu.toString();
        }
      } else {
        const f = inspectFile(buf, `feed.${cfg.format}`, { maxBytes: HTTP_MAX_BYTES, maxRows: 100_000 });
        if (!f.ok) throw new Error(f.fileIssues[0]?.message ?? 'Invalid feed file');
        rows.push(...f.rows);
      }
      url = next;
    }
    const taken = rows.slice(0, limit);
    const maxDate = taken.reduce<string | null>((m, r) => {
      const d = String(r.published_at ?? '');
      return !m || d > m ? d : m;
    }, since ?? null);
    return {
      rows: taken,
      nextCursor: maxDate ? { since: maxDate } : (connector.cursor ?? null),
      hasMore: rows.length > limit || !!url,
    };
  },
};

export const CONNECTORS: Record<ConnectorRow['type'], Connector> = {
  DEMO_FEED: demoFeedConnector,
  HTTP_FEED: httpFeedConnector,
};

export interface IngestionProgress {
  runId: string;
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  stage: 'fetching' | 'validating' | 'inserting' | 'fanout' | 'done' | 'failed';
  progress: number;
  stats: IngestionStatsJson;
  message?: string;
}

/**
 * Worker job `ingestion.run` (plan2 §6.2): fetch → validate (same rules as imports) → dedupe → upsert →
 * advance cursor → optional fan-out. Invalid/duplicate rows are recorded in the batch report, never inserted.
 */
export async function runIngestion(
  runId: string,
  onProgress?: (p: IngestionProgress) => void | Promise<void>,
) {
  const db = getDb();
  const cfg = getConfig();
  const [run] = await db.select().from(ingestionRuns).where(eq(ingestionRuns.id, runId));
  if (!run) throw new Error('Ingestion run not found');
  const [connector] = await db.select().from(dataConnectors).where(eq(dataConnectors.id, run.connectorId));
  if (!connector) throw new Error('Connector not found');
  const stats: IngestionStatsJson = {
    fetched: 0,
    valid: 0,
    warnings: 0,
    invalid: 0,
    duplicates: 0,
    inserted: 0,
    orgsNotified: 0,
  };
  const emit = (
    stage: IngestionProgress['stage'],
    progress: number,
    status: IngestionProgress['status'] = 'RUNNING',
    message?: string,
  ) => onProgress?.({ runId, status, stage, progress, stats: { ...stats }, message });

  const [batch] = await db
    .insert(dataBatches)
    .values({
      kind: 'INGESTION',
      status: 'VALIDATING',
      label: `${connector.name} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      format: connector.type === 'DEMO_FEED' ? 'jsonl' : (connector.config.format ?? 'json'),
      createdBy: run.triggeredBy,
      fanOut: connector.fanOut,
    })
    .returning();
  await db
    .update(ingestionRuns)
    .set({ status: 'RUNNING', startedAt: new Date(), batchId: batch!.id })
    .where(eq(ingestionRuns.id, runId));
  await writeAudit(db, {
    scope: 'PLATFORM',
    actorUserId: run.triggeredBy,
    action: 'data.ingestion_started',
    entityType: 'ingestion_run',
    entityId: runId,
    after: { connector: connector.name },
  });

  try {
    await emit('fetching', 5);
    const limit = Math.min(
      connector.config.maxRowsPerRun ?? cfg.INGESTION_MAX_ROWS_PER_RUN,
      cfg.INGESTION_MAX_ROWS_PER_RUN,
    );
    const fetched = await CONNECTORS[connector.type].fetch(connector, limit, new Date());
    stats.fetched = fetched.rows.length;
    await emit('validating', 30, 'RUNNING', `Fetched ${fetched.rows.length} rows`);

    const rows: ValidatedRow[] = validateRows(fetched.rows, {
      now: new Date(),
      maxAgeDays: cfg.DATA_MAX_AGE_DAYS,
    });
    await enrichValidation(rows);
    const s = summarize(rows);
    Object.assign(stats, {
      valid: s.valid,
      warnings: s.warnings,
      invalid: s.invalid,
      duplicates: s.duplicates,
    });
    if (rows.length) {
      await db
        .insert(dataBatchRows)
        .values(
          rows.map((r) => ({
            batchId: batch!.id,
            rowNumber: r.rowNumber,
            raw: r.raw,
            normalized: (r.record as unknown as Record<string, unknown>) ?? null,
            status: r.status,
            issues: r.issues as RowIssueJson[],
          })),
        );
    }
    await emit(
      'inserting',
      55,
      'RUNNING',
      `${s.valid + s.warnings} valid, ${s.invalid} invalid, ${s.duplicates} duplicates`,
    );

    const good = rows.filter((r) => r.record && (r.status === 'VALID' || r.status === 'WARNING'));
    const {
      stats: up,
      inserted,
      tags,
    } = await commitRecords(
      good.map((r) => ({ rowNumber: r.rowNumber, record: r.record! })),
      { batchId: batch!.id, sourceType: 'CONNECTOR', userId: run.triggeredBy },
    );
    stats.inserted = up.inserted;
    for (const [rowNumber, eventId] of inserted) {
      await db
        .update(dataBatchRows)
        .set({ insertedEventId: eventId })
        .where(and(eq(dataBatchRows.batchId, batch!.id), eq(dataBatchRows.rowNumber, rowNumber)));
    }
    const batchStats: DataBatchStats = {
      rows: s.rows,
      valid: s.valid,
      warnings: s.warnings,
      invalid: s.invalid,
      duplicates: s.duplicates + up.duplicates,
      inserted: up.inserted,
      companiesCreated: up.companiesCreated,
      companiesUpdated: up.companiesUpdated,
      contactsCreated: up.contactsCreated,
      fetched: stats.fetched,
    };
    // Cursor advances only after a successful commit → re-runs are idempotent.
    await db
      .update(dataConnectors)
      .set({ cursor: fetched.nextCursor, lastRunAt: new Date(), lastStatus: 'COMPLETED' })
      .where(eq(dataConnectors.id, connector.id));
    await db
      .update(dataBatches)
      .set({
        status: 'COMMITTED',
        stats: batchStats,
        validatedAt: new Date(),
        committedAt: new Date(),
        committedBy: run.triggeredBy,
      })
      .where(eq(dataBatches.id, batch!.id));

    if (connector.fanOut && up.inserted > 0) {
      await emit('fanout', 85, 'RUNNING', 'Notifying relevant organizations');
      stats.orgsNotified = (await fanOutToOrgs(tags, run.triggeredBy)).orgIds.length;
    }
    const status = fetched.hasMore ? 'PARTIAL' : 'COMPLETED';
    await db
      .update(ingestionRuns)
      .set({ status, stats, finishedAt: new Date() })
      .where(eq(ingestionRuns.id, runId));
    await writeAudit(db, {
      scope: 'PLATFORM',
      actorUserId: run.triggeredBy,
      action: 'data.ingestion_completed',
      entityType: 'ingestion_run',
      entityId: runId,
      after: { ...stats, connector: connector.name },
    });
    await emit(
      'done',
      100,
      status,
      fetched.rows.length === 0
        ? 'No new data — the source is up to date'
        : fetched.hasMore
          ? 'More data is available — run again to continue'
          : 'Ingestion complete',
    );
    return { status, stats };
  } catch (err) {
    const message = (err as Error).message.slice(0, 1000);
    await db
      .update(ingestionRuns)
      .set({ status: 'FAILED', error: message, stats, finishedAt: new Date() })
      .where(eq(ingestionRuns.id, runId));
    await db
      .update(dataBatches)
      .set({ status: 'FAILED', error: message })
      .where(eq(dataBatches.id, batch!.id));
    await db
      .update(dataConnectors)
      .set({ lastRunAt: new Date(), lastStatus: 'FAILED' })
      .where(eq(dataConnectors.id, connector.id));
    await writeAudit(db, {
      scope: 'PLATFORM',
      actorUserId: run.triggeredBy,
      action: 'data.ingestion_failed',
      entityType: 'ingestion_run',
      entityId: runId,
      after: { error: message },
    }).catch(() => undefined);
    await emit('failed', 100, 'FAILED', message);
    throw err;
  }
}

/** "Test connection": fetch up to 5 rows and validate without inserting anything. */
export async function testConnector(connector: ConnectorRow) {
  const fetched = await CONNECTORS[connector.type].fetch(connector, 5, new Date());
  const rows = validateRows(fetched.rows, { now: new Date(), maxAgeDays: getConfig().DATA_MAX_AGE_DAYS });
  await enrichValidation(rows);
  return {
    fetched: fetched.rows.length,
    hasMore: fetched.hasMore,
    ...summarize(rows),
    samples: rows.map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      title: String(r.raw.title ?? ''),
      issues: r.issues,
    })),
  };
}
