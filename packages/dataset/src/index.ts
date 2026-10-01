import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  companyFixture,
  eventFixture,
  goldFixture,
  orgFixture,
  signalTemplateFixture,
  type CompanyFixture,
  type EventFixture,
  type GoldFixture,
  type OrgFixture,
  type SignalTemplateFixture,
} from './schema';

export * from './schema';

/**
 * Loader for the synthetic dataset (plan §17). Every record here is fictional;
 * domains/emails use the reserved `.example` TLD.
 */
export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readDir<T>(dir: string, schema: z.ZodType<T>): T[] {
  const full = join(DATA_DIR, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => {
      const parsed = z.array(schema).safeParse(readJson(join(full, f)));
      if (!parsed.success) {
        throw new Error(`Invalid dataset file ${dir}/${f}:\n${z.prettifyError(parsed.error)}`);
      }
      return parsed.data;
    });
}

export function loadSignalTemplates(): SignalTemplateFixture[] {
  return readDir('signal-templates', signalTemplateFixture);
}

export function loadCompanies(): CompanyFixture[] {
  return readDir('companies', companyFixture);
}

export function loadEvents(): EventFixture[] {
  return readDir('events', eventFixture);
}

export function loadGold(): GoldFixture[] {
  return readDir('eval', goldFixture);
}

export interface LoadedOrg extends OrgFixture {
  dir: string;
}

export function loadOrgs(): LoadedOrg[] {
  const base = join(DATA_DIR, 'orgs');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((slug) => {
      const dir = join(base, slug);
      const parsed = orgFixture.safeParse(readJson(join(dir, 'org.json')));
      if (!parsed.success) throw new Error(`Invalid org fixture ${slug}:\n${z.prettifyError(parsed.error)}`);
      return { ...parsed.data, dir };
    });
}

export function readOrgDocument(org: LoadedOrg, file: string): string {
  return readFileSync(join(org.dir, 'documents', file), 'utf8');
}

export function orgDocumentPdfPath(org: LoadedOrg, file: string): string {
  return join(org.dir, 'documents', file.replace(/\.md$/, '.pdf'));
}

/**
 * Demo news feed reserve (plan2 §6.1 DEMO_FEED): template-v1 records NOT loaded by the seed, released a few at
 * a time by the demo connector so "Run ingestion" visibly pulls new data. Sorted oldest → newest.
 */
export function loadFeed(): Record<string, unknown>[] {
  const dir = join(DATA_DIR, 'feed');
  if (!existsSync(dir)) return [];
  const rows = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .flatMap((f) =>
      readFileSync(join(dir, f), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Record<string, unknown>),
    );
  return rows.sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)) || String(a.external_id).localeCompare(String(b.external_id)));
}

/** Downloadable import samples (copies of the repo-root sampleData*.csv; kept identical by a unit test). */
export const SAMPLES_DIR = join(DATA_DIR, 'samples');
