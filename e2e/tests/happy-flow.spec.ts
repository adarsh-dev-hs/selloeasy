import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Plan §25 happy flow, end to end, against a running stack (web + api + worker + Mailpit):
 * Super Admin creates org → invite email (Mailpit) → admin accepts → onboarding → activate →
 * pipeline run → leads (6/page) → AI email sent (Mailpit) → WON → dashboard + audit reflect it.
 */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const stamp = Date.now().toString(36);
const adminEmail = `owner-${stamp}@e2e.local`;
const orgName = `E2E Motors ${stamp}`;

async function mailpitLink(request: APIRequestContext, to: string, pattern: RegExp): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = await (await request.get(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json();
      const m = String(msg.Text).match(pattern);
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No email for ${to}`);
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|platform)/);
}

test('happy flow: onboard an org and convert a lead', async ({ page, request, baseURL }) => {
  test.setTimeout(240_000);

  // 1. Super Admin creates the org → invite email goes to Mailpit.
  await login(page, 'superadmin@selloeasy.local', 'Admin@123');
  await page.goto('/platform/orgs');
  await page.getByRole('button', { name: /new organization/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/name/i).first().fill(orgName);
  await dialog.getByLabel(/industry/i).selectOption('AUTOMOTIVE');
  await dialog.getByLabel(/admin email/i).fill(adminEmail);
  await dialog.getByRole('button', { name: /create/i }).click();
  await expect(dialog.getByText(/invite/i).first()).toBeVisible();
  const link = await mailpitLink(request, adminEmail, /https?:\/\/\S+\/accept-invite\?token=[\w-]+/);
  const path = new URL(link).pathname + new URL(link).search;

  // 2. Admin accepts the invite.
  await page.context().clearCookies();
  await page.goto(path);
  await page.getByLabel('Full name').fill('Erin E2E');
  await page.getByLabel('Password', { exact: true }).fill('Welcome@2026');
  await page.getByLabel('Confirm password').fill('Welcome@2026');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL(/\/app\/onboarding/);

  // 3. Onboarding essentials through the API (UI steps are covered by the screenshot pass).
  const api = page.request;
  const ok = async (p: Promise<import('@playwright/test').APIResponse>) => {
    const r = await p;
    expect(r.ok(), `${r.status()} ${await r.text()}`).toBeTruthy();
    return r;
  };
  await ok(
    api.patch(`${baseURL}/api/v1/org`, {
      data: {
        description: 'We make EV and passenger car tyres for OEMs and fleets across India.',
        hq: 'Pune, India',
        regions: ['India'],
        companySize: '1001-5000',
      },
    }),
  );
  await ok(
    api.post(`${baseURL}/api/v1/org/products`, {
      data: {
        name: 'VoltRide EV tyre',
        category: 'EV tyres',
        description: 'Low rolling resistance tyres for electric vehicles and fleets.',
        targetSegments: ['Automotive', 'Electric Vehicles'],
      },
    }),
  );
  const gen = await (await ok(api.post(`${baseURL}/api/v1/org/profile/generate`))).json();
  await expect
    .poll(
      async () => (await (await api.get(`${baseURL}/api/v1/org/profile/jobs/${gen.jobId}`)).json()).state,
      { timeout: 60_000 },
    )
    .toBe('completed');
  const signals = await (await api.get(`${baseURL}/api/v1/signals`)).json();
  expect(signals.length).toBeGreaterThan(0); // industry templates cloned at org creation

  // 4. Activate from the wizard's review step → first pipeline run.
  await page.goto('/app/onboarding?step=review');
  // Retry until the confirm dialog is open (the wizard may still be settling its data after navigation).
  await expect(async () => {
    await page.getByRole('button', { name: 'Activate organization' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Activate & start run' }).click();
  await page.waitForURL(/\/app\/pipeline/);
  await expect
    .poll(async () => (await (await api.get(`${baseURL}/api/v1/pipeline/runs`)).json()).items[0]?.status, {
      timeout: 120_000,
    })
    .toMatch(/COMPLETED|PARTIAL/);

  // 5. Leads grid: 6 per page.
  await page.goto('/app/leads');
  await expect(page.locator('article')).toHaveCount(6);
  await page.locator('article a').first().click();
  await page.waitForURL(/\/app\/leads\/.+/);

  // 6. AI-drafted email → sent → arrives in Mailpit.
  const outreach = page.getByRole('dialog');
  await expect(async () => {
    await page.getByRole('button', { name: 'Email', exact: true }).click();
    await expect(outreach).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await expect(outreach.getByLabel('Subject')).not.toHaveValue('');
  const to = await outreach.getByLabel('To', { exact: true }).inputValue();
  await outreach.getByRole('button', { name: /send email/i }).click();
  await expect(outreach).toBeHidden();
  await mailpitLink(request, to, /Best regards/);

  // 7. Mark as WON.
  await page.getByLabel('Stage').selectOption('WON');
  await page
    .getByRole('dialog')
    .getByLabel(/deal value/i)
    .fill('2500000');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/Won ·/)).toBeVisible();

  // 8. Dashboard and audit log reflect it.
  const dash = await (await api.get(`${baseURL}/api/v1/dashboard`)).json();
  expect(dash.summary.converted).toBeGreaterThanOrEqual(1);
  expect(dash.summary.approached).toBeGreaterThanOrEqual(1);
  await page.goto('/app/settings/audit');
  await expect(page.getByText('lead.stage_changed').first()).toBeVisible();
  await expect(page.getByText('outreach.email_sent').first()).toBeVisible();
});
