import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running stack: `docker compose up` (BASE_URL=http://localhost:3000, default)
 * or local dev servers (BASE_URL=http://localhost:3100). Mailpit for invite emails at MAILPIT_URL.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    // Same results dir as the Vitest suites, so `pnpm test:report` shows unit + API + E2E in one report.
    [
      'allure-playwright',
      {
        resultsDir: '../allure-results',
        globalLabels: [
          { name: 'workspace', value: '@selloeasy/e2e' },
          { name: 'layer', value: 'e2e' },
        ],
      },
    ],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
