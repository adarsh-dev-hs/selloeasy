import { expect, test, type Page } from '@playwright/test';

/** Visual smoke pass: logs in as each persona and screenshots key pages into e2e/shots/. */
async function login(page: Page, email: string, password = 'Password@123') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|platform)/);
}

const shot = (page: Page, name: string) => page.screenshot({ path: `shots/${name}.png`, fullPage: true });

test('org admin pages', async ({ page }) => {
  await login(page, 'admin@roadgrip.local');
  for (const [path, name] of [
    ['/app/dashboard', 'dashboard'],
    ['/app/leads', 'leads'],
    ['/app/leads?view=table', 'leads-table'],
    ['/app/pipeline', 'pipeline'],
    ['/app/signals', 'signals'],
    ['/app/icps', 'icps'],
    ['/app/knowledge', 'knowledge'],
    ['/app/settings/team', 'team'],
    ['/app/settings/audit', 'audit'],
    ['/app/tasks', 'tasks'],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1').first()).toBeVisible();
    await shot(page, name);
  }
  await page.goto('/app/leads');
  await page.locator('article a').first().click();
  await page.waitForLoadState('networkidle');
  await shot(page, 'lead-detail');
  await page.getByRole('button', { name: 'Email' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'outreach-email');
});

test('super admin pages', async ({ page }) => {
  await login(page, 'superadmin@selloeasy.local', 'Admin@123');
  for (const [path, name] of [
    ['/platform', 'platform'],
    ['/platform/orgs', 'platform-orgs'],
    ['/platform/signal-templates', 'platform-templates'],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await shot(page, name);
  }
  await page.goto('/platform/orgs');
  await page.getByRole('link', { name: 'Roadgrip Tyres Ltd.' }).first().click();
  await page.waitForLoadState('networkidle');
  await shot(page, 'platform-org-detail');
});

test('public pages', async ({ page }) => {
  await page.goto('/');
  await shot(page, 'landing');
  await page.goto('/login');
  await shot(page, 'login');
  await page.goto('/docs');
  await page.waitForLoadState('networkidle');
  await shot(page, 'docs');
});
