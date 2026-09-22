/**
 * An account of this run's own, for any browser test that needs to be signed in.
 *
 * Registering over the API rather than through `/register` is deliberate: signing up is its own
 * flow, tested where it belongs, and a test that goes through it to reach something else fails for
 * two reasons at once. The email is fresh every run, so nothing a previous run left behind — an
 * upload, a screen name, a saved report — can make this run pass or fail.
 */
import { randomUUID } from 'node:crypto';

import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { API_URL } from './stack';

/** The API's minimum is ten characters. */
export const PASSWORD = 'e2e-browser-test';

/**
 * A tenant of this run's own, over the API. The 500 hint is the likeliest operator error: the
 * integration suite drops the test databases when its session ends, so a `make test-all` before
 * this leaves nothing to sign in to.
 */
export async function registerAccount(request: APIRequestContext): Promise<string> {
  const email = `e2e-${randomUUID()}@example.com`;
  const response = await request.post(`${API_URL}/v1/auth/register`, { data: { email, password: PASSWORD } });
  const said = await response.text();
  expect(response.status(), `${said} — a 500 here usually means the test databases are gone: run \`make seed\` (\`make test-all\` drops them)`).toBe(201);
  return email;
}

/**
 * Fill in the sign-in form and submit it. The caller decides how it got to `/login` and where it
 * expects to land: the redirect back to whatever was asked for is part of what a test may be
 * checking, so it is not swallowed here.
 */
export async function fillSignIn(page: Page, email: string): Promise<void> {
  // pages/login.vue has no data-testid on its fields or its button; these are its own labels.
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
