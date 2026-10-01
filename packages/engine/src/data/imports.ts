import { getConfig, getStorage } from '@selloeasy/core';
import {
  and,
  dataBatches,
  dataBatchRows,
  directoryCompanies,
  directoryContacts,
  eq,
  getDb,
  inArray,
  isNull,
  marketEvents,
  sql,
  type DataBatchStats,
  type RowIssueJson,
} from '@selloeasy/db';
import { qualityGatePrompt, type LlmClient } from '@selloeasy/llm';
import { inspectFile, summarize, validateRows, type ValidatedRow } from '@selloeasy/pipeline';
import type { DataSourceType, MarketEventRecord, RawRecord } from '@selloeasy/shared';
import { writeAudit } from '../audit';
import { fanOutToOrgs } from './fanout';
import { directoryNamesByDomain, emptyUpsertStats, findExistingEvents, upsertRecord } from './upsert';

export class DataBatchError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'bad_state' | 'too_many_invalid',
  ) {
    super(message);
  }
}

const emptyStats = (): DataBatchStats => ({
  rows: 0,
  valid: 0,
  warnings: 0,
  invalid: 0,
  duplicates: 0,
  inserted: 0,
  companiesCreated: 0,
  companiesUpdated: 0,
  contactsCreated: 0,
});

/**
 * Layers beyond the pure validator (plan2 §7.2): duplicates against the data source, directory
 * name-consistency warnings, and the optional AI quality gate. Mutates rows in place.
 */
export async function enrichValidation(
  rows: ValidatedRow[],
  opts: { llm?: LlmClient; aiGate?: boolean; aiMaxCalls?: number } = {},
) {
  const db = getDb();
  const live = rows.filter((r) => r.keys && r.status !== 'DUPLICATE');
  const existing = await findExistingEvents(
    db,
    live.map((r) => r.keys!),
  );
  for (const r of live) {
    const k = r.keys!;
    const dupId =
      (k.sourceExternal && existing.bySourceExternal.get(k.sourceExternal)) ||
      existing.byUrl.get(k.sourceUrl) ||
      existing.byHash.get(k.contentHash);
    if (dupId) {
      r.status = 'DUPLICATE';
      r.issues.push({
        field: '(row)',
        code: 'duplicate_existing',
        message: `Already in the data source (event ${dupId})`,
        severity: 'error',
      });
      (r as ValidatedRow & { duplicateOf?: string }).duplicateOf = dupId;
    }
  }
  const valid = rows.filter((r) => r.record && (r.status === 'VALID' || r.status === 'WARNING'));
  const names = await directoryNamesByDomain(
    db,
    valid.map((r) => r.record!.subject_company_domain),
  );
  for (const r of valid) {
    const known = names.get(r.record!.subject_company_domain);
    if (known && known.toLowerCase() !== r.record!.subject_company_name.toLowerCase()) {
      r.issues.push({
        field: 'subject_company_name',
        code: 'company_name_differs',
        message: `Directory already has ${r.record!.subject_company_domain} as "${known}" — the existing name is kept`,
        severity: 'warning',
      });
      r.status = 'WARNING';
    }
  }
  if (opts.aiGate && opts.llm) {
    let calls = 0;
    for (let i = 0; i < valid.length && calls < (opts.aiMaxCalls ?? 10); i += 20, calls++) {
      const chunk = valid.slice(i, i + 20);
      try {
        const { data } = await opts.llm.run(qualityGatePrompt, {
          rows: chunk.map((r) => ({
            rowNumber: r.rowNumber,
            source: r.record!.source,
            title: r.record!.title,
            body: r.record!.body,
            company: r.record!.subject_company_name,
          })),
        });
        const byRow = new Map(data.results.map((x) => [x.rowNumber, x]));
        for (const r of chunk) {
          const g = byRow.get(r.rowNumber);
          if (g && g.score < 0.5) {
            r.issues.push({
              field: '(row)',
              code: 'ai_low_quality',
              message: `AI quality gate: ${g.reason} (score ${g.score})`,
              severity: 'warning',
            });
            r.status = 'WARNING';
          }
        }
      } catch {
        // The gate is advisory; an LLM failure never blocks an import.
      }
    }
  }
}

/** Worker job `import.validate`: parse + validate an uploaded file into staging rows (nothing is committed). */
export async function validateBatch(batchId: string, llm?: LlmClient): Promise<DataBatchStats> {
  const db = getDb();
  const cfg = getConfig();
  const [batch] = await db.select().from(dataBatches).where(eq(dataBatches.id, batchId));
  if (!batch) throw new DataBatchError('Batch not found', 'not_found');
  if (!batch.fileS3Key) throw new DataBatchError('Batch has no file', 'bad_state');
  await db.update(dataBatches).set({ status: 'VALIDATING', error: null }).where(eq(dataBatches.id, batchId));

  const buf = await getStorage().getObject(batch.fileS3Key);
  const file = inspectFile(buf, batch.fileName ?? 'upload', {
    maxBytes: cfg.IMPORT_MAX_MB * 1024 * 1024,
    maxRows: cfg.IMPORT_MAX_ROWS,
  });
  if (!file.ok) {
    await db.transaction(async (tx) => {
      await tx
        .update(dataBatches)
        .set({
          status: 'FAILED',
          fileIssues: file.fileIssues,
          error: file.fileIssues[0]?.message ?? 'Invalid file',
          validatedAt: new Date(),
        })
        .where(eq(dataBatches.id, batchId));
      await writeAudit(tx, {
        scope: 'PLATFORM',
        actorUserId: batch.createdBy,
        action: 'data.import_rejected',
        entityType: 'data_batch',
        entityId: batchId,
        after: { reason: file.fileIssues[0]?.code },
      });
    });
    return batch.stats;
  }

  const rows = validateRows(file.rows, { now: new Date(), maxAgeDays: cfg.DATA_MAX_AGE_DAYS });
  await enrichValidation(rows, {
    llm,
    aiGate: cfg.IMPORT_AI_GATE_ENABLED,
    aiMaxCalls: cfg.IMPORT_AI_GATE_MAX_CALLS,
  });
  const s = summarize(rows);
  const stats: DataBatchStats = { ...emptyStats(), ...s };

  await db.transaction(async (tx) => {
    await tx.delete(dataBatchRows).where(eq(dataBatchRows.batchId, batchId));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(dataBatchRows).values(
        rows.slice(i, i + 500).map((r) => ({
          batchId,
          rowNumber: r.rowNumber,
          raw: r.raw,
          normalized: (r.record as unknown as Record<string, unknown>) ?? null,
          status: r.status,
          issues: r.issues as RowIssueJson[],
          duplicateOfEventId: (r as ValidatedRow & { duplicateOf?: string }).duplicateOf ?? null,
        })),
      );
    }
    await tx
      .update(dataBatches)
      .set({ status: 'VALIDATED', format: file.format, stats, validatedAt: new Date() })
      .where(eq(dataBatches.id, batchId));
    await writeAudit(tx, {
      scope: 'PLATFORM',
      actorUserId: batch.createdBy,
      action: 'data.import_validated',
      entityType: 'data_batch',
      entityId: batchId,
      after: { ...s },
    });
  });
  return stats;
}

/** Upsert validated records in chunks of 200 (plan2 §6.2 / §7.3). Returns event id per row number. */
export async function commitRecords(
  items: { rowNumber: number; record: MarketEventRecord }[],
  meta: { batchId: string; sourceType: DataSourceType; userId: string | null },
) {
  const db = getDb();
  const stats = emptyUpsertStats();
  const inserted = new Map<number, string>();
  const tags = new Set<string>();
  for (let i = 0; i < items.length; i += 200) {
    await db.transaction(async (tx) => {
      for (const it of items.slice(i, i + 200)) {
        const id = await upsertRecord(tx, it.record, meta, stats);
        if (id) {
          inserted.set(it.rowNumber, id);
          for (const t of it.record.industry_tags) tags.add(t);
        }
      }
    });
  }
  return { stats, inserted, tags: [...tags] };
}

/** Worker job `import.commit` — refuses when the invalid share exceeds IMPORT_MAX_INVALID_RATIO (plan2 §7.1). */
export async function commitBatch(batchId: string, userId: string): Promise<DataBatchStats> {
  const db = getDb();
  const cfg = getConfig();
  const [batch] = await db.select().from(dataBatches).where(eq(dataBatches.id, batchId));
  if (!batch) throw new DataBatchError('Batch not found', 'not_found');
  if (batch.status !== 'VALIDATED' && batch.status !== 'COMMITTING')
    throw new DataBatchError(
      `Batch is ${batch.status}; only VALIDATED batches can be committed`,
      'bad_state',
    );
  assertCommittable(batch.stats, cfg.IMPORT_MAX_INVALID_RATIO);
  await db.update(dataBatches).set({ status: 'COMMITTING' }).where(eq(dataBatches.id, batchId));

  const staged = await db
    .select({
      id: dataBatchRows.id,
      rowNumber: dataBatchRows.rowNumber,
      normalized: dataBatchRows.normalized,
    })
    .from(dataBatchRows)
    .where(and(eq(dataBatchRows.batchId, batchId), inArray(dataBatchRows.status, ['VALID', 'WARNING'])))
    .orderBy(dataBatchRows.rowNumber);
  const sourceType: DataSourceType = batch.format === 'csv' ? 'CSV_IMPORT' : 'JSONL_IMPORT';
  const {
    stats: up,
    inserted,
    tags,
  } = await commitRecords(
    staged.map((r) => ({ rowNumber: r.rowNumber, record: r.normalized as unknown as MarketEventRecord })),
    { batchId, sourceType, userId },
  );
  for (const [rowNumber, eventId] of inserted) {
    await db
      .update(dataBatchRows)
      .set({ insertedEventId: eventId })
      .where(and(eq(dataBatchRows.batchId, batchId), eq(dataBatchRows.rowNumber, rowNumber)));
  }
  const stats: DataBatchStats = {
    ...batch.stats,
    inserted: up.inserted,
    duplicates: batch.stats.duplicates + up.duplicates,
    companiesCreated: up.companiesCreated,
    companiesUpdated: up.companiesUpdated,
    contactsCreated: up.contactsCreated,
  };
  await db.transaction(async (tx) => {
    await tx
      .update(dataBatches)
      .set({ status: 'COMMITTED', stats, committedBy: userId, committedAt: new Date() })
      .where(eq(dataBatches.id, batchId));
    await writeAudit(tx, {
      scope: 'PLATFORM',
      actorUserId: userId,
      action: 'data.import_committed',
      entityType: 'data_batch',
      entityId: batchId,
      after: {
        inserted: up.inserted,
        companiesCreated: up.companiesCreated,
        contactsCreated: up.contactsCreated,
      },
    });
  });
  if (batch.fanOut && up.inserted > 0) {
    const { orgIds } = await fanOutToOrgs(tags, userId);
    if (orgIds.length)
      await writeAudit(db, {
        scope: 'PLATFORM',
        actorUserId: userId,
        action: 'data.fanout_enqueued',
        entityType: 'data_batch',
        entityId: batchId,
        after: { orgs: orgIds.length },
      });
  }
  return stats;
}

export function assertCommittable(stats: DataBatchStats, maxInvalidRatio: number) {
  if (stats.rows > 0 && stats.invalid / stats.rows > maxInvalidRatio) {
    throw new DataBatchError(
      `${stats.invalid} of ${stats.rows} rows (${Math.round((stats.invalid / stats.rows) * 100)}%) are invalid — above the ${Math.round(maxInvalidRatio * 100)}% limit. Fix the file and upload it again.`,
      'too_many_invalid',
    );
  }
  if (stats.valid + stats.warnings === 0)
    throw new DataBatchError('Nothing to commit — no valid rows', 'too_many_invalid');
}

/**
 * Rollback (plan2 §7.4, ADR-0016): retract the batch's events (hidden from future org pipeline runs) and the
 * directory rows this batch created. Leads that orgs already created stay — they are tenant data.
 */
export async function rollbackBatch(batchId: string, userId: string) {
  const db = getDb();
  const [batch] = await db.select().from(dataBatches).where(eq(dataBatches.id, batchId));
  if (!batch) throw new DataBatchError('Batch not found', 'not_found');
  if (batch.status !== 'COMMITTED')
    throw new DataBatchError(
      `Only COMMITTED batches can be rolled back (batch is ${batch.status})`,
      'bad_state',
    );
  const now = new Date();
  return db.transaction(async (tx) => {
    const events = await tx
      .update(marketEvents)
      .set({ retractedAt: now })
      .where(and(eq(marketEvents.batchId, batchId), isNull(marketEvents.retractedAt)))
      .returning({ id: marketEvents.id });
    // Companies created by this batch that no other live event references.
    const companies = await tx
      .update(directoryCompanies)
      .set({ retractedAt: now })
      .where(
        and(
          eq(directoryCompanies.batchId, batchId),
          isNull(directoryCompanies.retractedAt),
          sql`not exists (select 1 from ${marketEvents} e where e.retracted_at is null and e.companies @> jsonb_build_array(jsonb_build_object('domain', ${directoryCompanies.domain})))`,
        ),
      )
      .returning({ id: directoryCompanies.id });
    const contacts = await tx
      .update(directoryContacts)
      .set({ retractedAt: now })
      .where(and(eq(directoryContacts.batchId, batchId), isNull(directoryContacts.retractedAt)))
      .returning({ id: directoryContacts.id });
    await tx
      .update(dataBatches)
      .set({ status: 'ROLLED_BACK', rolledBackAt: now })
      .where(eq(dataBatches.id, batchId));
    await writeAudit(tx, {
      scope: 'PLATFORM',
      actorUserId: userId,
      action: 'data.batch_rolled_back',
      entityType: 'data_batch',
      entityId: batchId,
      after: { events: events.length, companies: companies.length, contacts: contacts.length },
    });
    return { events: events.length, companies: companies.length, contacts: contacts.length };
  });
}

export async function discardBatch(batchId: string, userId: string) {
  const db = getDb();
  const [batch] = await db.select().from(dataBatches).where(eq(dataBatches.id, batchId));
  if (!batch) throw new DataBatchError('Batch not found', 'not_found');
  if (!['VALIDATED', 'FAILED', 'UPLOADED'].includes(batch.status))
    throw new DataBatchError(`A ${batch.status} batch cannot be discarded`, 'bad_state');
  await db.transaction(async (tx) => {
    await tx.update(dataBatches).set({ status: 'DISCARDED' }).where(eq(dataBatches.id, batchId));
    await writeAudit(tx, {
      scope: 'PLATFORM',
      actorUserId: userId,
      action: 'data.import_discarded',
      entityType: 'data_batch',
      entityId: batchId,
    });
  });
}

/** Maintenance: purge staged rows of finished batches after STAGING_RETENTION_DAYS. */
export async function purgeStagingRows(days: number): Promise<number> {
  const res = await getDb().execute(
    sql`delete from data_batch_rows r using data_batches b where r.batch_id = b.id and b.status in ('COMMITTED','DISCARDED','FAILED','ROLLED_BACK') and b.updated_at < now() - (${days} || ' days')::interval`,
  );
  return res.rowCount ?? 0;
}

export type { RawRecord };
