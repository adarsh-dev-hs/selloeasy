/**
 * pnpm docs:check [--changed]
 *
 * Enforces "docs must reflect code" (plan §20.4):
 * 1. Every env key in packages/shared/src/env.ts appears in .env.example AND in
 *    docs/(guide)/getting-started/environment-variables.mdx.
 * 2. Every internal /docs/... link in docs/ points to an existing page.
 * 3. Every docs folder has a meta.json and every page listed in it exists.
 * 4. With --changed (or in CI on a PR): if schema/routes/prompts/.env.example changed but nothing under
 *    docs/ changed, fail unless the commit/PR body contains [skip-docs].
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ALL_ENV_KEYS } from '../packages/shared/src/env';

const root = join(import.meta.dirname, '..');
const docsDir = join(root, 'docs');
const errors: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// 1. env keys
const envExample = readFileSync(join(root, '.env.example'), 'utf8');
const envDocPath = join(docsDir, '(guide)', 'getting-started', 'environment-variables.mdx');
const envDoc = existsSync(envDocPath) ? readFileSync(envDocPath, 'utf8') : '';
if (!envDoc) errors.push('docs/(guide)/getting-started/environment-variables.mdx is missing');
for (const key of ALL_ENV_KEYS) {
  if (!new RegExp(`^${key}=`, 'm').test(envExample)) errors.push(`.env.example is missing ${key}`);
  if (envDoc && !envDoc.includes(key)) errors.push(`environment-variables.mdx does not document ${key}`);
}

// 2 + 3. links & meta
const pages = walk(docsDir).filter((f) => /\.mdx?$/.test(f));
const slugs = new Set(
  pages
    .map(
      (p) =>
        '/docs/' +
        relative(docsDir, p)
          // Fumadocs folder groups like `(guide)/` organise the sidebar tabs but are not part of the URL.
          .replace(/(^|\/)\([^/)]+\)(?=\/)/g, '$1')
          .replace(/^\//, '')
          .replace(/\.mdx?$/, '')
          .replace(/(^|\/)index$/, '')
          .replace(/\/$/, ''),
    )
    .map((s) => s.replace(/\/$/, '')),
);
slugs.add('/docs');
for (const p of pages) {
  const text = readFileSync(p, 'utf8');
  for (const m of text.matchAll(/\]\((\/docs[^)#\s]*)(#[^)\s]*)?\)/g)) {
    const target = m[1]!.replace(/\/$/, '');
    if (!slugs.has(target)) errors.push(`${relative(root, p)}: broken link ${m[1]}`);
  }
}
for (const dir of [
  docsDir,
  ...walk(docsDir)
    .filter((f) => f.endsWith('meta.json'))
    .map((f) => join(f, '..')),
]) {
  const metaPath = join(dir, 'meta.json');
  if (!existsSync(metaPath)) {
    errors.push(`${relative(root, dir) || 'docs'}: missing meta.json`);
    continue;
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { pages?: string[] };
  for (const entry of meta.pages ?? []) {
    if (entry.startsWith('---') || entry.startsWith('[') || entry === '...') continue;
    const name = entry.replace(/^!/, '').replace(/^\.\.\./, '');
    const exists =
      existsSync(join(dir, `${name}.mdx`)) ||
      existsSync(join(dir, `${name}.md`)) ||
      existsSync(join(dir, name, 'meta.json')) ||
      existsSync(join(dir, name));
    if (!exists) errors.push(`${relative(root, metaPath)}: page "${entry}" not found`);
  }
}

// 4. docs-with-code rule
if (process.argv.includes('--changed')) {
  try {
    const base = process.env.DOCS_CHECK_BASE ?? 'origin/main';
    const diff = execSync(`git diff --name-only ${base}...HEAD`, { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const watched = diff.filter((f) =>
      /^(packages\/db\/src\/schema\/|apps\/api\/src\/modules\/|packages\/llm\/src\/prompts\/|packages\/shared\/src\/env\.ts|\.env\.example)/.test(
        f,
      ),
    );
    const docsTouched = diff.some((f) => f.startsWith('docs/'));
    const body = process.env.PR_BODY ?? execSync('git log -1 --pretty=%B', { cwd: root, encoding: 'utf8' });
    if (watched.length && !docsTouched && !body.includes('[skip-docs]')) {
      errors.push(
        `Code that requires docs changed (${watched.slice(0, 5).join(', ')}) but nothing under docs/ changed. Update docs or add [skip-docs] with a justification.`,
      );
    }
  } catch {
    console.warn('! --changed: git diff unavailable, skipping docs-with-code rule');
  }
}

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\n${errors.length} docs problem(s).`);
  process.exit(1);
}
console.log(`✓ docs OK — ${pages.length} pages, ${ALL_ENV_KEYS.length} env keys documented`);
