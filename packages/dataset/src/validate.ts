import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompanies, loadEvents, loadGold, loadOrgs, loadSignalTemplates } from './index';

/** Cross-reference validation for the dataset: `pnpm --filter @selloeasy/dataset validate`. */
const errors: string[] = [];
const warn: string[] = [];

const templates = loadSignalTemplates();
const companies = loadCompanies();
const events = loadEvents();
const gold = loadGold();
const orgs = loadOrgs();

const dup = <T>(items: T[], keyOf: (t: T) => string, label: string) => {
  const seen = new Set<string>();
  for (const i of items) {
    const k = keyOf(i);
    if (seen.has(k)) errors.push(`Duplicate ${label}: ${k}`);
    seen.add(k);
  }
};

dup(templates, (t) => `${t.industry}/${t.key}`, 'signal template');
dup(companies, (c) => c.key, 'company key');
dup(companies, (c) => c.domain, 'company domain');
dup(events, (e) => e.externalId, 'event externalId');
dup(orgs, (o) => o.slug, 'org slug');
dup(
  orgs.flatMap((o) => o.users),
  (u) => u.email,
  'user email',
);

const companyKeys = new Set(companies.map((c) => c.key));
for (const e of events) {
  for (const c of e.companies) if (!companyKeys.has(c.key)) errors.push(`Event ${e.externalId} references unknown company ${c.key}`);
  if (!e.companies.some((c) => c.role === 'subject')) errors.push(`Event ${e.externalId} has no subject company`);
}

for (const o of orgs) {
  if (!o.users.some((u) => u.role === 'ORG_ADMIN')) errors.push(`Org ${o.slug} has no ORG_ADMIN user`);
  for (const d of o.documents) {
    if (!existsSync(join(o.dir, 'documents', d.file))) errors.push(`Org ${o.slug} missing document ${d.file}`);
  }
  for (const s of o.customSignals) {
    if (s.icpIndex !== undefined && s.icpIndex >= o.icps.length) errors.push(`Org ${o.slug} signal ${s.name} bad icpIndex`);
  }
  const industryTemplates = templates.filter((t) => t.industry === o.industry);
  if (industryTemplates.length < 5) errors.push(`Industry ${o.industry} has only ${industryTemplates.length} templates`);
}

const eventIds = new Set(events.map((e) => e.externalId));
for (const g of gold) {
  if (!eventIds.has(g.eventExternalId)) errors.push(`Gold references unknown event ${g.eventExternalId}`);
  const org = orgs.find((o) => o.slug === g.orgSlug);
  if (!org) {
    errors.push(`Gold references unknown org ${g.orgSlug}`);
    continue;
  }
  const names = new Set([
    ...templates.filter((t) => t.industry === org.industry).map((t) => t.name),
    ...org.customSignals.map((s) => s.name),
  ]);
  for (const s of g.expectedSignals) if (!names.has(s)) errors.push(`Gold ${g.eventExternalId}/${g.orgSlug}: unknown signal "${s}"`);
}

const perIndustry = new Map<string, number>();
for (const e of events) perIndustry.set(e.externalId.slice(0, 3), (perIndustry.get(e.externalId.slice(0, 3)) ?? 0) + 1);
for (const [k, n] of perIndustry) if (n < 40) warn.push(`Event prefix ${k} has only ${n} events`);

console.log(
  `templates=${templates.length} companies=${companies.length} contacts=${companies.reduce((a, c) => a + c.contacts.length, 0)} events=${events.length} gold=${gold.length} orgs=${orgs.length}`,
);
for (const w of warn) console.warn(`WARN ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  process.exit(1);
}
console.log('Dataset OK');
