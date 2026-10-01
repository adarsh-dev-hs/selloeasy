/**
 * `pnpm test:report` — run the test suites, build the Allure report and serve it on a port.
 *
 *   pnpm test:report                 # Vitest suites (all packages) → report on http://localhost:5252
 *   pnpm test:report --e2e           # + Playwright E2E (needs a running stack; BASE_URL / MAILPIT_URL as for `pnpm e2e`)
 *   pnpm test:report --no-serve      # generate only (CI) — output in ./allure-report
 *   pnpm test:report --serve-only    # just serve the last generated report
 *   ALLURE_PORT=6000 pnpm test:report
 *
 * Failing tests do not stop the report: it is generated anyway and the script exits with the test status.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = new Set(process.argv.slice(2));
const port = process.env.ALLURE_PORT ?? '5252';
const allure = join(root, 'node_modules', 'allure', 'cli.js');

function run(cmd: string, cmdArgs: string[], cwd = root): number {
  console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
  return spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: process.env }).status ?? 1;
}

let status = 0;
if (!args.has('--serve-only')) {
  rmSync(join(root, 'allure-results'), { recursive: true, force: true });
  rmSync(join(root, 'allure-report'), { recursive: true, force: true });

  // --force: a turbo cache hit would skip the tests and leave no Allure results.
  status = run('pnpm', ['turbo', 'run', 'test', '--force', '--continue']);
  if (args.has('--e2e')) status = run('pnpm', ['--filter', '@selloeasy/e2e', 'e2e']) || status;

  if (run(process.execPath, [allure, 'generate']) !== 0) process.exit(1);
  console.log(`\nAllure report: ${join(root, 'allure-report')}`);
}

if (!args.has('--no-serve')) {
  if (!existsSync(join(root, 'allure-report'))) {
    console.error('No report yet — run `pnpm test:report --no-serve` first.');
    process.exit(1);
  }
  console.log(`Serving the Allure report on http://localhost:${port} (Ctrl+C to stop)`);
  run(process.execPath, [allure, 'open', 'allure-report', '--port', port]);
}
process.exit(status);
