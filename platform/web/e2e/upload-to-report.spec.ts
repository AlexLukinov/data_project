/**
 * Phase 1's exit criterion, in a browser (plan D.8 and D.9b, ADR-051, ADR-055): a hand-history
 * file handed to `/upload` is counted by My game's report, with no command typed after the click.
 *
 * **The flow is the founder's.** Open My game and be sent to sign in; see My game answer with no
 * hands; name the seat on the upload page; hand over a seed-corpus file; watch it land; follow its
 * link back to My game and find its hands counted.
 *
 * **Why My game is read before the upload.** A fresh account's report answers no hands, and that
 * answer is cached for five minutes. Reading it first means the count after the upload can only
 * come from the worker's writes *and* its dropping of the tenant's cached reports (ADR-051
 * decision 6) — a stale cache would keep the tile at no hands and turn this test red.
 *
 * **No dbt runs** because nothing here can run it: the stack is the API, the worker and the app,
 * and `tests/integration/test_upload_to_report.py` asserts over HTTP that the tenant's `stats_daily`
 * stays empty on this same path.
 *
 * The account is registered over the API — signing up is not the flow under test — with an email
 * no earlier run used, so the same file uploads as new every time.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page, Response } from '@playwright/test';

import { LANDED_MS, REPORT_MS } from './budgets';
import { API_URL } from './stack';

/** PokerStars cash, two hands, the uploader's seat named `Hero` and dealt cards. */
const SEED_FILE = fileURLToPath(new URL('../../seeds/hands/pokerstars/cash_6max_nl50.txt', import.meta.url));
const SEED_SITE = 'pokerstars';
const SEED_SCREEN_NAME = 'Hero';
const SEED_HANDS = 2;

/** The API's minimum is ten characters. */
const PASSWORD = 'e2e-browser-test';

/** What `MetricValue` prints where there is no number. */
const NO_NUMBER = '—';

/**
 * Every status a queue line can stop moving on. `data-status` is the queue's own state, not only the
 * server's: a file refused in the browser or a POST that failed never reaches the server at all
 * (`components/upload/UploadQueue.vue`), and each of those is a different bug from "no worker".
 */
const SETTLED = /^(completed|failed|error|refused)$/;

test('a seed file uploaded through /upload is counted by My game with no command typed', async ({ page, request }) => {
  const email = await registerAccount(request);
  await signIn(page, email);
  await expectHands(page, NO_NUMBER);
  await addScreenName(page);
  await uploadSeedFile(page);
  await followToMyGame(page);
  await expectHands(page, SEED_HANDS.toLocaleString('en-US'));
});

/**
 * A tenant of this run's own, over the API. The 500 hint is the likeliest operator error: the
 * integration suite drops the test databases when its session ends, so a `make test-all` before
 * this leaves nothing to sign in to.
 */
async function registerAccount(request: APIRequestContext): Promise<string> {
  const email = `e2e-${randomUUID()}@example.com`;
  const response = await request.post(`${API_URL}/v1/auth/register`, { data: { email, password: PASSWORD } });
  const said = await response.text();
  expect(response.status(), `${said} — a 500 here usually means the test databases are gone: run \`make seed\` (\`make test-all\` drops them)`).toBe(201);
  return email;
}

/**
 * My game's report request, awaited before its tiles are read: a tile prints "—" while the report
 * is still in flight as well, so without this the "no hands yet" step could pass on a pending page
 * and leave the server's cache unwarmed. The response is not filtered by status — a report that
 * answers 500 should fail with its own body, not as a wait that never ends.
 */
function reportRequested(page: Page): Promise<Response> {
  return page.waitForResponse((response) => response.url() === `${API_URL}/v1/reports/run` && response.request().method() === 'POST', { timeout: REPORT_MS });
}

/** Wait for the report and fail with what the server said if it refused. */
async function expectReportAnswered(pending: Promise<Response>): Promise<void> {
  const response = await pending;
  expect(response.status(), await response.text()).toBe(200);
}

async function signIn(page: Page, email: string): Promise<void> {
  await test.step('open My game, be sent to sign in, sign in', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?next=/);
    const report = reportRequested(page);
    // pages/login.vue has no data-testid on its fields or its button; these are its own labels.
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByTestId('nav-account')).toHaveText(email);
    await expectReportAnswered(report);
  });
}

async function expectHands(page: Page, shown: string): Promise<void> {
  await test.step(`My game counts ${shown} hands`, async () => {
    await expect(page.getByTestId('kpi-hands').getByTestId('metric-number')).toHaveText(shown);
  });
}

/**
 * Add the screen name, and check the list says so afterwards.
 *
 * This covers the account write path (POST, then the list read back); it is **not** why the hands
 * are counted. A PokerStars export resolves the uploader from its own `Dealt to` line when no name
 * is registered (`parser/sites/pokerstars/finalize.py#resolve_hero`, ADR-051 decision 8), so this
 * file would count either way — which is what makes the step safe to keep in the happy path.
 */
async function addScreenName(page: Page): Promise<void> {
  await test.step('name the seat on the upload page', async () => {
    // The nav links carry no data-testid (app.vue); the link's own name is the selector.
    await page.getByRole('link', { name: 'Upload', exact: true }).click();
    await expect(page.getByTestId('accounts-empty')).toBeVisible();
    await page.getByTestId('accounts-site').selectOption(SEED_SITE);
    await page.getByTestId('accounts-name').fill(SEED_SCREEN_NAME);
    await page.getByTestId('accounts-add').click();
    await expect(page.getByTestId('accounts-list')).toContainText(SEED_SCREEN_NAME);
  });
}

async function uploadSeedFile(page: Page): Promise<void> {
  await test.step('hand over a seed-corpus file and watch it land', async () => {
    await expect(page.getByTestId('upload-dataset-hero')).toBeChecked();
    await page.getByTestId('upload-files-input').setInputFiles(SEED_FILE);
    const line = page.getByTestId('upload-item');
    await expectLanded(line);
    await expect(line.getByTestId('upload-item-state')).toHaveText(`${SEED_HANDS} hands in`);
    // No warning that the hands have no seat recognised as the uploader's: My game counts them.
    await expect(line.getByTestId('upload-item-detail')).toHaveCount(0);
  });
}

/**
 * Wait until the line stops moving, then insist it stopped on `completed` — quoting the row, so a
 * failure reads as the sentence the uploader would have read.
 *
 * Two failures, two messages, deliberately: a line still `queued` after the whole budget means
 * nothing took the file (the worker), while a line that settles on `failed`, `error` or `refused`
 * settles at once and says why itself. Waiting 90 s to report "no worker took it" about a file the
 * browser refused would be a wrong diagnosis, printed with confidence.
 */
async function expectLanded(line: Locator): Promise<void> {
  await expect
    .poll(() => line.getAttribute('data-status'), {
      timeout: LANDED_MS,
      message: 'the upload line never settled — one still "queued" means no worker took the file',
    })
    .toMatch(SETTLED);
  const settled = await line.getAttribute('data-status');
  expect(settled, (await line.innerText()).replace(/\s+/g, ' ')).toBe('completed');
}

async function followToMyGame(page: Page): Promise<void> {
  await test.step("follow the file's link to My game", async () => {
    const report = reportRequested(page);
    await page.getByTestId('upload-item').getByTestId('upload-item-link').click();
    await expect(page).toHaveURL(/\/$/);
    await expectReportAnswered(report);
  });
}
