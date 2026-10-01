import { defineConfig } from 'allure';

/**
 * Allure 3 report for every test layer (Vitest unit/integration + Playwright E2E).
 * Results come from the repo-root `allure-results/` (see vitest.shared.ts and e2e/playwright.config.ts).
 * `pnpm test:report` runs the suites, generates this report and serves it on ALLURE_PORT (default 5252).
 */
export default defineConfig({
  name: 'SelloEasy tests',
  resultsDir: './allure-results',
  output: './allure-report',
  // Keeps pass/fail trends across local runs (git-ignored).
  historyPath: './allure-history.jsonl',
  hideLabels: [/^_/, 'host', 'thread'],
  plugins: {
    awesome: {
      options: {
        reportName: 'SelloEasy tests',
        reportLanguage: 'en',
        groupBy: ['workspace', 'parentSuite', 'suite', 'subSuite'],
      },
    },
  },
});
