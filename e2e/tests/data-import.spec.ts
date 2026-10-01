import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * plan2 §7: a garbage-heavy CSV is validated through the Super Admin import wizard, the commit is refused
 * (above the invalid-ratio limit), and the batch is discarded — nothing reaches the data source.
 */
const INVALID_CSV = fileURLToPath(new URL('../../sampleData.invalid.csv', import.meta.url));

test('import wizard refuses a mostly-invalid file and discards it', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/login');
  await page.getByLabel('Email').fill('superadmin@selloeasy.local');
  await page.getByLabel('Password').fill('Admin@123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/platform/);

  await page.goto('/platform/data?tab=imports');
  await page.locator('input[type="file"]').setInputFiles(INVALID_CSV);
  await page.getByRole('button', { name: 'Upload & validate' }).click();

  // The worker validates asynchronously; the wizard polls until the report is ready.
  await expect(page.getByRole('alert').filter({ hasText: 'above the 20% limit' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: /^Commit \d+ rows$/ })).toBeDisabled();

  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('Discarded').first()).toBeVisible({ timeout: 15_000 });
});
