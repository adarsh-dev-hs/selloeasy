import { fileURLToPath } from 'node:url';

/**
 * Shared Vitest reporters: console output plus Allure results in the repo-root `allure-results/`
 * (`pnpm test:report` turns them into a report served on a port — see /docs/getting-started/local-development).
 * Each package tags its results with a `workspace` label; `allurerc.mjs` groups the report by it.
 */
export const ALLURE_RESULTS_DIR = fileURLToPath(new URL('./allure-results', import.meta.url));

export function reporters(pkg: string) {
  return [
    'default',
    [
      'allure-vitest/reporter',
      {
        resultsDir: ALLURE_RESULTS_DIR,
        globalLabels: [
          { name: 'workspace', value: pkg },
          { name: 'layer', value: 'unit/integration' },
        ],
      },
    ],
  ] as const;
}
