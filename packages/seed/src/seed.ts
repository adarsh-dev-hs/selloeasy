import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getConfig, getStorage, hashPassword, sha256, slugify, type Logger } from '@selloeasy/core';
import {
  loadCompanies,
  loadEvents,
  loadOrgs,
  loadSignalTemplates,
  orgDocumentPdfPath,
  readOrgDocument,
  type LoadedOrg,
} from '@selloeasy/dataset';
import {
  and,
  dataBatches,
  dataConnectors,
  isNull,
  activities,
  auditLogs,
  directoryCompanies,
  directoryContacts,
  eq,
  getDb,
  icps,
  invitations,
  leads,
  marketEvents,
  memberships,
  organizations,
  orgProfiles,
  orgSources,
  outreachMessages,
  pipelineRuns,
  plans,
  policies,
  products,
  signals,
  signalTemplates,
  sql,
  tasks,
  users,
  contacts,
  accounts,
} from '@selloeasy/db';
import { cloneTemplatesForOrg, processSource, runPipeline, storeChunks } from '@selloeasy/engine';
import { contentHashOf } from '@selloeasy/pipeline';
import { LlmClient } from '@selloeasy/llm';
import type { LeadStage, OrgRole } from '@selloeasy/shared';

export const DEMO_PASSWORD = 'Password@123';
/** Deterministic dev-only invite token for the onboarding demo org (printed in README). */
export const DEMO_INVITE_TOKEN = 'demo-invite-voltedge-mobility-2026-local-only';

const DAY = 86_400_000;

/** Deterministic PRNG so every seed produces the same demo history. */
function rng(seed: string) {
  let h = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

async function upsertUser(email: string, name: string, password: string, isSuperAdmin = false) {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (existing) return existing;
  const [u] = await db
    .insert(users)
    .values({ email: email.toLowerCase(), name, passwordHash: await hashPassword(password), isSuperAdmin })
    .returning();
  return u!;
}

async function seedGlobal(log: Logger) {
  const db = getDb();
  const cfg = getConfig();
  const sa = await upsertUser(cfg.SUPERADMIN_EMAIL, 'Platform Admin', cfg.SUPERADMIN_PASSWORD, true);
  log.info({ email: sa.email }, 'Super admin ready');

  const templates = loadSignalTemplates();
  for (const t of templates) {
    await db
      .insert(signalTemplates)
      .values({
        industry: t.industry,
        key: t.key,
        name: t.name,
        description: t.description,
        matchInstructions: t.matchInstructions,
        defaultKeywords: t.defaultKeywords,
        defaultWeight: t.defaultWeight,
      })
      .onConflictDoNothing();
  }
  log.info({ count: templates.length }, 'Signal templates');

  const companies = loadCompanies();
  const companyByKey = new Map<string, { name: string; domain: string }>();
  for (const c of companies) {
    companyByKey.set(c.key, { name: c.name, domain: c.domain });
    const [row] = await db
      .insert(directoryCompanies)
      .values({
        key: c.key,
        name: c.name,
        domain: c.domain,
        industry: c.industry,
        hqCountry: c.hqCountry,
        sizeBand: c.sizeBand,
        employees: c.employees,
        description: c.description,
        synthetic: true,
      })
      .onConflictDoNothing()
      .returning({ id: directoryCompanies.id });
    if (row && c.contacts.length) {
      await db.insert(directoryContacts).values(
        c.contacts.map((p) => ({
          companyId: row.id,
          name: p.name,
          title: p.title,
          persona: p.persona,
          seniority: p.seniority,
          email: p.email,
          phone: p.phone,
          whatsapp: p.whatsapp,
          linkedinUrl: p.linkedinUrl,
          synthetic: true,
        })),
      );
    }
  }
  log.info({ count: companies.length }, 'Company directory');

  const now = Date.now();
  const events = loadEvents();
  let inserted = 0;
  for (const e of events) {
    const r = rng(e.externalId);
    const publishedAt = new Date(now - e.publishedDaysAgo * DAY - Math.floor(r() * 10) * 3600_000);
    const res = await db
      .insert(marketEvents)
      .values({
        externalId: e.externalId,
        source: e.source,
        url: e.url,
        title: e.title,
        body: e.body,
        publishedAt,
        industryTags: e.industryTags,
        companies: e.companies.map((c) => ({
          name: companyByKey.get(c.key)?.name ?? c.key,
          domain: companyByKey.get(c.key)?.domain,
          role: c.role,
        })),
        region: e.region,
        amount: e.amount,
        currency: e.currency,
        synthetic: true,
        hash: sha256(`dataset:${e.externalId}`),
      })
      .onConflictDoNothing()
      .returning({ id: marketEvents.id });
    inserted += res.length;
  }
  log.info({ total: events.length, inserted }, 'Market events');
  await ensureSeedProvenance(sa.id, log);
  return sa;
}

async function seedOrgKnowledge(org: LoadedOrg, orgId: string, log: Logger) {
  const db = getDb();
  const storage = getStorage();
  await db.insert(products).values(
    org.products.map((p) => ({
      orgId,
      name: p.name,
      category: p.category,
      description: p.description,
      targetSegments: p.targetSegments,
      priceNotes: p.priceNotes,
      visibility: p.visibility,
    })),
  );
  await db.insert(plans).values(
    org.plans.map((p) => ({ orgId, name: p.name, pricing: p.pricing, features: p.features, visibility: p.visibility })),
  );
  await db.insert(policies).values(
    org.policies.map((p) => ({ orgId, title: p.title, type: p.type, body: p.body, visibility: p.visibility })),
  );

  // Website: .example domains are not reachable, so we store a snapshot of the org description
  // instead of crawling (documented limitation).
  const [web] = await db
    .insert(orgSources)
    .values({ orgId, type: 'WEBSITE', title: `${new URL(org.websiteUrl).hostname} (snapshot)`, url: org.websiteUrl, visibility: 'PUBLIC', status: 'PROCESSING' })
    .returning();
  const webText = `${org.name}\n\n${org.description}\n\n${org.profile.summary}`;
  await storeChunks(db, orgId, web!.id, webText);
  await db.update(orgSources).set({ status: 'READY', bytes: Buffer.byteLength(webText) }).where(eq(orgSources.id, web!.id));

  // Documents go through the real storage → parse → chunk path.
  for (const d of org.documents) {
    const isPdf = d.asPdf;
    const body = isPdf ? readFileSync(orgDocumentPdfPath(org, d.file)) : Buffer.from(readOrgDocument(org, d.file));
    const contentType = isPdf ? 'application/pdf' : 'text/markdown';
    const fileName = isPdf ? d.file.replace(/\.md$/, '.pdf') : d.file;
    const [src] = await db
      .insert(orgSources)
      .values({
        orgId,
        type: isPdf ? 'PDF' : 'DOC',
        title: d.title,
        visibility: d.visibility,
        contentType,
        status: 'PENDING',
        bytes: body.byteLength,
      })
      .returning();
    const key = `orgs/${orgId}/sources/${src!.id}/${fileName}`;
    await storage.putObject(key, body, contentType);
    await db.update(orgSources).set({ s3Key: key }).where(eq(orgSources.id, src!.id));
    try {
      await processSource(src!.id);
    } catch (err) {
      log.warn({ err: (err as Error).message, doc: d.file }, 'Document processing failed');
    }
  }

  await db.insert(orgProfiles).values({
    orgId,
    summary: org.profile.summary,
    valueProps: org.profile.valueProps,
    differentiators: org.profile.differentiators,
    targetIndustries: org.profile.targetIndustries,
    geographies: org.profile.geographies,
    personas: org.profile.personas,
    generatedByModel: 'seed',
  });

  const icpRows = await db
    .insert(icps)
    .values(
      org.icps.map((i) => ({
        orgId,
        name: i.name,
        description: i.description,
        source: 'AI_SUGGESTED' as const,
        criteria: {
          industries: i.criteria.industries,
          companySize: i.criteria.companySize,
          revenueBand: i.criteria.revenueBand,
          geographies: i.criteria.geographies,
          personas: i.criteria.personas,
          painPoints: i.criteria.painPoints,
          keywords: i.criteria.keywords,
        },
      })),
    )
    .returning({ id: icps.id });

  await cloneTemplatesForOrg(db, orgId, org.industry);
  await db.insert(signals).values(
    org.customSignals.map((s) => ({
      orgId,
      icpId: s.icpIndex !== undefined ? (icpRows[s.icpIndex]?.id ?? null) : null,
      name: s.name,
      description: s.description,
      matchInstructions: s.matchInstructions,
      keywords: s.keywords,
      negativeKeywords: s.negativeKeywords,
      weight: s.weight,
      source: 'CUSTOM' as const,
    })),
  );
}

const STAGE_PLAN: { stage: LeadStage; share: number }[] = [
  { stage: 'NEW', share: 0.34 },
  { stage: 'CONTACTED', share: 0.2 },
  { stage: 'ENGAGED', share: 0.12 },
  { stage: 'MEETING_SCHEDULED', share: 0.1 },
  { stage: 'QUALIFIED', share: 0.07 },
  { stage: 'PROPOSAL', share: 0.05 },
  { stage: 'WON', share: 0.07 },
  { stage: 'LOST', share: 0.05 },
];
const STAGE_ORDER: LeadStage[] = ['NEW', 'CONTACTED', 'ENGAGED', 'MEETING_SCHEDULED', 'QUALIFIED', 'PROPOSAL', 'WON'];

/**
 * Simulated CRM history so dashboards and the audit trail are meaningful on first boot.
 * Higher-scored leads progress further; everything is deterministic per org.
 */
async function simulateCrm(orgId: string, slug: string, team: { id: string; name: string; role: OrgRole }[]) {
  const db = getDb();
  const r = rng(`crm:${slug}`);
  const orgLeads = await db
    .select({ id: leads.id, accountId: leads.accountId, primaryContactId: leads.primaryContactId, score: leads.scoreTotal, firstSignalAt: leads.firstSignalAt })
    .from(leads)
    .where(eq(leads.orgId, orgId))
    .orderBy(sql`${leads.scoreTotal} desc`);
  const sellers = team.filter((t) => t.role === 'SDR' || t.role === 'SALES_MANAGER');
  const owners = sellers.length ? sellers : team;
  const now = Date.now();

  // Assign stages: sort a shuffled copy biased by score.
  const ranked = orgLeads
    .map((l, i) => ({ l, key: i / orgLeads.length + r() * 0.35 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.l);
  const stages: LeadStage[] = [];
  for (const p of [...STAGE_PLAN].reverse()) {
    const n = Math.round(p.share * orgLeads.length);
    for (let i = 0; i < n; i++) stages.push(p.stage);
  }
  // Best-ranked leads get the most advanced stages; LOST sprinkled among mid-ranked.
  const advanced = stages.filter((s) => s !== 'LOST' && s !== 'NEW');
  const lost = stages.filter((s) => s === 'LOST');

  for (let i = 0; i < ranked.length; i++) {
    const lead = ranked[i]!;
    let stage: LeadStage = 'NEW';
    if (i < advanced.length) stage = advanced[i]!;
    else if (i < advanced.length + lost.length) stage = 'LOST';
    const owner = stage === 'NEW' && r() < 0.5 ? null : owners[Math.floor(r() * owners.length)]!;
    const [contact] = lead.primaryContactId
      ? await db.select().from(contacts).where(eq(contacts.id, lead.primaryContactId))
      : [];
    const [account] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, lead.accountId));
    const signalTime = lead.firstSignalAt?.getTime() ?? now - 30 * DAY;
    let t = Math.min(now - DAY, signalTime + (1 + Math.floor(r() * 5)) * DAY);
    const acts: (typeof activities.$inferInsert)[] = [];
    const audits: (typeof auditLogs.$inferInsert)[] = [];
    let firstTouchAt: Date | null = null;

    if (owner) {
      acts.push({ orgId, leadId: lead.id, actorUserId: owner.id, type: 'ASSIGNMENT', subject: `Assigned to ${owner.name}`, occurredAt: new Date(t) });
    }
    const pathEnd = stage === 'LOST' ? STAGE_ORDER.indexOf(STAGE_ORDER[1 + Math.floor(r() * 3)]!) : STAGE_ORDER.indexOf(stage);
    for (let s = 1; s <= pathEnd; s++) {
      const target = STAGE_ORDER[s]!;
      t = Math.min(now - 3600_000, t + (1 + Math.floor(r() * 6)) * DAY);
      const at = new Date(t);
      if (target === 'CONTACTED') {
        const channel = r() < 0.6 ? 'EMAIL' : r() < 0.5 ? 'CALL' : 'WHATSAPP';
        firstTouchAt = at;
        if (channel === 'EMAIL' && contact?.email) {
          const subject = `${account?.name ?? 'Your team'}: quick idea`;
          acts.push({ orgId, leadId: lead.id, actorUserId: owner?.id, type: 'EMAIL', direction: 'OUTBOUND', subject, body: 'First-touch email referencing the recent announcement.', metadata: { to: contact.email }, occurredAt: at });
          await db.insert(outreachMessages).values({ orgId, leadId: lead.id, contactId: contact.id, channel: 'email', to: contact.email, subject, body: 'First-touch email referencing the recent announcement.', status: 'SENT', sentBy: owner?.id, sentAt: at, providerMessageId: `seed-${lead.id.slice(0, 8)}` });
        } else if (channel === 'CALL') {
          acts.push({ orgId, leadId: lead.id, actorUserId: owner?.id, type: 'CALL', direction: 'OUTBOUND', subject: 'Discovery call', body: 'Intro call, asked for a follow-up deck.', metadata: { outcome: 'CONNECTED', durationMin: 12 }, occurredAt: at });
        } else {
          acts.push({ orgId, leadId: lead.id, actorUserId: owner?.id, type: 'WHATSAPP', direction: 'OUTBOUND', body: 'Intro message via WhatsApp.', metadata: { to: contact?.whatsapp }, occurredAt: at });
        }
      } else if (target === 'MEETING_SCHEDULED') {
        acts.push({ orgId, leadId: lead.id, actorUserId: owner?.id, type: 'MEETING', direction: 'OUTBOUND', subject: 'Discovery meeting booked', metadata: { meetingAt: new Date(t + 3 * DAY).toISOString(), via: 'calendly' }, occurredAt: at });
      } else if (target === 'ENGAGED') {
        acts.push({ orgId, leadId: lead.id, actorUserId: owner?.id, type: 'NOTE', body: 'Prospect replied — interested, asked for pricing overview.', occurredAt: at });
      }
      acts.push({ orgId, leadId: lead.id, actorUserId: owner?.id, type: 'STAGE_CHANGE', subject: `${STAGE_ORDER[s - 1]} → ${target}`, metadata: { from: STAGE_ORDER[s - 1], to: target }, occurredAt: at });
      audits.push({ scope: 'ORG', orgId, actorUserId: owner?.id, actorRole: owner?.role, action: 'lead.stage_changed', entityType: 'lead', entityId: lead.id, before: { stage: STAGE_ORDER[s - 1] }, after: { stage: target }, occurredAt: at });
    }
    if (stage === 'LOST') {
      t = Math.min(now - 3600_000, t + 4 * DAY);
      acts.push({ orgId, leadId: lead.id, actorUserId: owner?.id, type: 'STAGE_CHANGE', subject: '→ LOST', metadata: { to: 'LOST', reason: 'Chose incumbent vendor' }, occurredAt: new Date(t) });
    }
    if (acts.length) await db.insert(activities).values(acts);
    if (audits.length) await db.insert(auditLogs).values(audits);
    if (owner && (stage === 'CONTACTED' || stage === 'ENGAGED' || stage === 'NEW')) {
      await db.insert(tasks).values({ orgId, leadId: lead.id, assigneeUserId: owner.id, createdBy: owner.id, title: stage === 'NEW' ? 'Research account and send first touch' : 'Follow up on intro', dueAt: new Date(now + (Math.floor(r() * 7) - 2) * DAY) });
    }
    const lastAt = acts.length ? acts[acts.length - 1]!.occurredAt! : null;
    await db
      .update(leads)
      .set({
        stage,
        ownerUserId: owner?.id ?? null,
        firstTouchAt,
        lastActivityAt: lastAt,
        stageChangedAt: lastAt ?? undefined,
        lostReason: stage === 'LOST' ? 'Chose incumbent vendor' : null,
        wonValue: stage === 'WON' ? Math.round((20 + r() * 180) * 1000) : null,
      })
      .where(eq(leads.id, lead.id));
  }
}

export async function seedOrg(org: LoadedOrg, superAdminId: string, log: Logger, mockLlm: LlmClient) {
  const db = getDb();
  const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, org.slug));
  if (existing) {
    log.info({ slug: org.slug }, 'Org exists — skipping');
    return;
  }
  const activatedAt = new Date(Date.now() - 200 * DAY);
  const [o] = await db
    .insert(organizations)
    .values({
      name: org.name,
      slug: org.slug,
      industry: org.industry,
      status: 'ACTIVE',
      websiteUrl: org.websiteUrl,
      hq: org.hq,
      regions: org.regions,
      companySize: org.companySize,
      description: org.description,
      settings: { leadVisibility: 'ALL', timezone: 'Asia/Kolkata', senderName: org.name },
      activatedAt,
    })
    .returning();
  const orgId = o!.id;

  const team: { id: string; name: string; role: OrgRole }[] = [];
  for (const u of org.users) {
    const user = await upsertUser(u.email, u.name, DEMO_PASSWORD);
    await db
      .update(users)
      .set({ calendlyUrl: `https://calendly.com/${slugify(u.name)}-${org.slug.split('-')[0]}/20min` })
      .where(eq(users.id, user.id));
    await db.insert(memberships).values({ userId: user.id, orgId, role: u.role }).onConflictDoNothing();
    team.push({ id: user.id, name: u.name, role: u.role });
  }
  await db.insert(auditLogs).values([
    { scope: 'PLATFORM', orgId, actorUserId: superAdminId, actorRole: 'SUPER_ADMIN', action: 'org.created', entityType: 'organization', entityId: orgId, after: { name: org.name, industry: org.industry }, occurredAt: activatedAt },
    { scope: 'PLATFORM', orgId, actorUserId: superAdminId, actorRole: 'SUPER_ADMIN', action: 'invite.sent', entityType: 'invitation', after: { email: org.users[0]!.email, role: 'ORG_ADMIN' }, occurredAt: activatedAt },
  ]);

  await seedOrgKnowledge(org, orgId, log);

  const [run] = await db.insert(pipelineRuns).values({ orgId, trigger: 'ONBOARDING', status: 'QUEUED' }).returning();
  const { stats } = await runPipeline({ llm: mockLlm, orgId, runId: run!.id, maxLlmCalls: 1000, recordEvaluations: false });
  await simulateCrm(orgId, org.slug, team);
  log.info({ slug: org.slug, leads: stats.leadsCreated, matched: stats.matched }, 'Org seeded');
}

/** One org left in INVITED state to demo onboarding end-to-end (plan §17.3). */
async function seedInvitedOrg(superAdminId: string, log: Logger) {
  const db = getDb();
  const slug = 'voltedge-mobility';
  const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
  if (existing) return;
  const [o] = await db
    .insert(organizations)
    .values({ name: 'Voltedge Mobility', slug, industry: 'AUTOMOTIVE', status: 'INVITED', websiteUrl: 'https://voltedge-mobility.example' })
    .returning();
  const cfg = getConfig();
  const token = cfg.APP_ENV === 'local' ? DEMO_INVITE_TOKEN : undefined;
  if (token) {
    await db.insert(invitations).values({
      orgId: o!.id,
      email: 'admin@voltedge.local',
      role: 'ORG_ADMIN',
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 30 * DAY),
      invitedBy: superAdminId,
    });
    log.info({ link: `${cfg.WEB_URL}/accept-invite?token=${token}` }, 'Demo onboarding invite');
  }
  await db.insert(auditLogs).values({ scope: 'PLATFORM', orgId: o!.id, actorUserId: superAdminId, actorRole: 'SUPER_ADMIN', action: 'org.created', entityType: 'organization', entityId: o!.id, after: { name: 'Voltedge Mobility' } });
}

export async function runSeed(log: Logger) {
  const cfg = getConfig();
  await getStorage().ensureBucket();
  const sa = await seedGlobal(log);
  if (!cfg.SEED_DEMO_DATA) {
    log.info('SEED_DEMO_DATA=false — skipping demo orgs');
    return;
  }
  // Seed always uses the deterministic mock LLM: fast, free, reproducible (ADR-0008).
  const mockLlm = new LlmClient({ mode: 'mock', timeoutMs: 1000, maxConcurrency: 4, cacheTtlSeconds: 0 });
  for (const org of loadOrgs()) await seedOrg(org, sa.id, log, mockLlm);
  await seedInvitedOrg(sa.id, log);
  const [{ n }] = (await getDb().select({ n: sql<number>`count(*)::int` }).from(leads)) as [{ n: number }];
  log.info({ leads: n }, 'Seed complete');
}



/**
 * Platform data source provenance (plan2 §5): put seed rows in one "Initial synthetic dataset" batch, backfill
 * content_hash (import dedupe against seed events) and register the demo-feed connector. Idempotent.
 */
async function ensureSeedProvenance(superAdminId: string, log: Logger) {
  const db = getDb();
  let [batch] = await db.select().from(dataBatches).where(eq(dataBatches.kind, 'SEED')).limit(1);
  if (!batch) {
    [batch] = await db
      .insert(dataBatches)
      .values({ kind: 'SEED', status: 'COMMITTED', label: 'Initial synthetic dataset', format: 'json', createdBy: superAdminId, committedBy: superAdminId, committedAt: new Date(), validatedAt: new Date(), fanOut: false })
      .returning();
  }
  const b = batch!;
  await db.update(marketEvents).set({ batchId: b.id }).where(and(eq(marketEvents.sourceType, 'SEED'), isNull(marketEvents.batchId)));
  await db.update(directoryCompanies).set({ batchId: b.id }).where(and(eq(directoryCompanies.sourceType, 'SEED'), isNull(directoryCompanies.batchId)));
  await db.update(directoryContacts).set({ batchId: b.id }).where(and(eq(directoryContacts.sourceType, 'SEED'), isNull(directoryContacts.batchId)));
  const missing = await db.select({ id: marketEvents.id, title: marketEvents.title, body: marketEvents.body }).from(marketEvents).where(isNull(marketEvents.contentHash));
  for (const e of missing) await db.update(marketEvents).set({ contentHash: contentHashOf(e.title, e.body) }).where(eq(marketEvents.id, e.id));
  const [{ n: events }] = (await db.select({ n: sql<number>`count(*)::int` }).from(marketEvents).where(eq(marketEvents.batchId, b.id))) as [{ n: number }];
  const [{ n: companies }] = (await db.select({ n: sql<number>`count(*)::int` }).from(directoryCompanies).where(eq(directoryCompanies.batchId, b.id))) as [{ n: number }];
  const [{ n: contacts }] = (await db.select({ n: sql<number>`count(*)::int` }).from(directoryContacts).where(eq(directoryContacts.batchId, b.id))) as [{ n: number }];
  await db
    .update(dataBatches)
    .set({ stats: { rows: events, valid: events, warnings: 0, invalid: 0, duplicates: 0, inserted: events, companiesCreated: companies, companiesUpdated: 0, contactsCreated: contacts } })
    .where(eq(dataBatches.id, b.id));
  await db
    .insert(dataConnectors)
    .values({ name: 'Demo news feed', type: 'DEMO_FEED', config: { batchSize: 10 }, enabled: true, fanOut: true, createdBy: superAdminId })
    .onConflictDoNothing();
  log.info({ batchId: b.id, events, hashesBackfilled: missing.length }, 'Data source provenance ready');
}
