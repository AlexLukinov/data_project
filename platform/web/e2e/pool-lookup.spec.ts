/**
 * The Pool, in a browser (plan F.14, ADR-062): the page is laid out as the rest of the app
 * expects, and a player is looked up through the route built for it.
 *
 * **Why this exists.** Until F.14 no test anywhere touched `/pool` — not a unit test, not this
 * suite — so a re-layout of the product's busiest screen broke nothing red, and the lookup's
 * client half could be wired to the wrong route and still look fine. The unit tests added beside
 * it mount the pages with the API mocked; what only a browser can show is that the real server
 * answers these two pages at all.
 *
 * **What it deliberately does not assert: a player who was found.** `make seed` loads three
 * hand-history files and publishes them with no `dataset`, so `ingestion/messages.py` files all of
 * them as `hero`; the test environment has **no population rows at all**, and every pool report
 * there is correctly empty. Asserting a named opponent would need population data this environment
 * has no honest way to produce — and a real screen name must never reach a fixture or a log line
 * anyway (ADR-058). So the two ends that *are* environment-independent are the ones checked: the
 * server's refusal of a name too short, which is a 400 it decides and this page never pre-empts,
 * and an answer of no matches, which proves the POST round-tripped rather than failed.
 *
 * It runs before `upload-to-report.spec.ts` (Playwright collects files alphabetically, one worker)
 * and therefore pays the dev server's first compile. It shares that run's three servers and starts
 * none of its own.
 */
import { expect, test } from '@playwright/test';
import type { Page, Response } from '@playwright/test';

import { fillSignIn, registerAccount } from './account';
import { ASSERT_MS } from './budgets';
import { API_URL } from './stack';

/** The server's own refusal, from `analysis/pool/service.py#MIN_NAME`. Nothing rewrites it. */
const TOO_SHORT = 'type at least 3 characters of a screen name';

/** Under the minimum, so the route refuses rather than answers. */
const SHORT_NAME = 'ma';

/** Over the minimum, and no screen name in any corpus: an empty answer, not an error. */
const ABSENT_NAME = 'zzqqxx';

test('the Pool lays out as the app expects, and a player is looked up through its own route', async ({ page, request }) => {
  const email = await registerAccount(request);
  await signInAt(page, email, '/pool');
  await expectPoolLaidOut(page);
  await expectRefusesTooShortName(page);
  await expectAnswersAnAbsentName(page);
});

/** Ask for a page that needs an account, be sent to sign in, and be sent back to it. */
async function signInAt(page: Page, email: string, path: string): Promise<void> {
  await test.step(`open ${path}, be sent to sign in, and land back on it`, async () => {
    await page.goto(path);
    // `middleware/auth.global.ts` sends `next: to.fullPath`; whether the slash is percent-encoded
    // is the router's business, so only the landing below is asserted exactly.
    await expect(page).toHaveURL(/\/login\?next=/);
    await fillSignIn(page, email);
    await expect(page.getByTestId('nav-account')).toHaveText(email);
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
  });
}

/**
 * The controls the help layer and the tutorial anchor on, and one standard report to open.
 *
 * `pool-presets` is the row `ControlHelp` attaches "The standard pool reports" to; it is not
 * `PresetMenu`'s `report-library`, because this page composes `PresetButton`s rather than mounting
 * that menu — which is how the loudest control here went unexplained until F.14.
 */
async function expectPoolLaidOut(page: Page): Promise<void> {
  await test.step('the pool page carries its controls', async () => {
    await expect(page.getByTestId('pool-presets')).toBeVisible();
    await expect(page.getByTestId('pool-presets').getByRole('button').first()).toBeVisible();
    await expect(page.getByTestId('dataset-locked')).toBeVisible();
    await expect(page.getByTestId('run-report')).toBeVisible();
    await expect(page.getByTestId('pool-scope')).toBeVisible();
  });
}

/** The lookup's POST, awaited so a refusal cannot be mistaken for a page that never asked. */
function lookupAnswered(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url() === `${API_URL}/v1/pool/players` && response.request().method() === 'POST',
    { timeout: ASSERT_MS },
  );
}

async function lookUp(page: Page, name: string): Promise<Response> {
  const answered = lookupAnswered(page);
  await page.getByTestId('player-name').fill(name);
  await page.getByTestId('player-search').click();
  return answered;
}

/**
 * The minimum is the server's, measured on the real pool, and checked against the *name half* of a
 * key — so the page cannot pre-empt it and does not try. The refusal has to arrive over the wire.
 */
async function expectRefusesTooShortName(page: Page): Promise<void> {
  await test.step('a name too short is refused by the server, in the server’s words', async () => {
    await page.getByRole('link', { name: 'Find a player', exact: true }).click();
    await expect(page).toHaveURL(/\/pool\/players$/);
    const response = await lookUp(page, SHORT_NAME);
    expect(response.status(), await response.text()).toBe(400);
    await expect(page.getByTestId('player-error')).toHaveText(TOO_SHORT);
    await expect(page.getByTestId('player-none')).toHaveCount(0);
  });
}

/** A name nobody has: a 200 with no rows, said as an empty answer rather than as a failure. */
async function expectAnswersAnAbsentName(page: Page): Promise<void> {
  await test.step('a name nobody has is answered, not errored', async () => {
    const response = await lookUp(page, ABSENT_NAME);
    expect(response.status(), await response.text()).toBe(200);
    await expect(page.getByTestId('player-none')).toContainText(`“${ABSENT_NAME}”`);
    await expect(page.getByTestId('player-error')).toHaveCount(0);
    await expect(page.getByTestId('player-matched')).toHaveCount(0);
  });
}
