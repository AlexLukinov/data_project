/**
 * The browser test (plan D.9b, ADR-055): sign in → add a screen name → upload a seed-corpus file
 * through `/upload` → My game counts its hands, with no dbt run and no command typed.
 *
 * **Playwright owns the three processes the flow needs**, and nothing else starts or stops them:
 * the API, a parser worker and the Nuxt app. It starts them before the test, waits for the two
 * that answer on a port, and tears all three down afterwards — after a pass, a failure or a
 * Ctrl-C — by signalling each one's whole process group. Run it as `make e2e`, which sets the test
 * environment; this file refuses to load without it.
 *
 * **Why the worker is not waited for.** It serves nothing to poll and logs nothing until a message
 * arrives, and it does not need to be ready: its consumer starts from the group's committed offset
 * (`auto.offset.reset: earliest` for a new group), so a pointer published before it joins is still
 * read. A worker that dies at start fails the test at the upload, where the page says the parser
 * is not answering and the worker's traceback is in the output above it.
 */
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { API_START_MS, ASSERT_MS, NAV_MS, SHUTDOWN_MS, TEST_TIMEOUT_MS, WEB_START_MS } from './budgets';
import { API_PORT, API_URL, WEB_PORT, WEB_URL, refuseUnlessTestEnvironment } from './stack';

const PLATFORM_DIR = fileURLToPath(new URL('../../', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../apps/web/', import.meta.url));

/** SIGTERM first, SIGKILL after; see `SHUTDOWN_MS` for why the worker needs the graceful one. */
const SHUTDOWN = { signal: 'SIGTERM', timeout: SHUTDOWN_MS } as const;

/**
 * The environment a server is started with: the test environment this process was given, plus what
 * that server needs — **checked again after the merge**. Playwright builds each child's environment
 * as `{...process.env, ...env}`, so a `POSTGRES_DB` added here would quietly outrank the guard that
 * ran on `process.env` alone. Guarding the merged result is what keeps the guard true as this list
 * grows.
 */
function serverEnv(additions: Record<string, string>): Record<string, string> {
  const merged = { ...process.env, ...additions } as Record<string, string>;
  refuseUnlessTestEnvironment(merged);
  return additions;
}

refuseUnlessTestEnvironment(process.env);

/**
 * A killed runner still reaps its servers. Playwright launches them with no SIGTERM/SIGHUP handler
 * of its own (`launchProcess` registers only `exit`, and the runner handles Ctrl-C itself), and each
 * server leads its own process group, so a `kill` or a closed terminal would otherwise leave a
 * worker consuming from the test topics for ever — the one orphan nothing detects, since the worker
 * has no port. `process.exit()` runs the `exit` handler Playwright registered, which SIGKILLs each
 * server's group; the worker then leaves its Kafka group ungracefully, which `LANDED_MS` budgets for.
 *
 * Only in the runner: this file is loaded again in every forked test worker, and those ignore
 * SIGTERM deliberately. `process.send` exists only in a forked child.
 */
if (process.send === undefined) {
  const AFTER_SIGNAL = { SIGTERM: 143, SIGHUP: 129 } as const;
  for (const [signal, code] of Object.entries(AFTER_SIGNAL)) {
    process.once(signal, () => process.exit(code));
  }
}

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: 'test-results',
  // One flow, one browser, no retry: a flaky end-to-end test is a finding, not something to hide.
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: ASSERT_MS },
  reporter: 'list',
  use: {
    baseURL: WEB_URL,
    navigationTimeout: NAV_MS,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'api',
      // `make api` pins :8000 and --reload; the founder's own API holds that port.
      command: `uv run --frozen uvicorn api.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: PLATFORM_DIR,
      // A URL, because `/health` is a real readiness answer: it round-trips ClickHouse.
      url: `${API_URL}/health`,
      env: serverEnv({ CORS_ORIGINS: JSON.stringify([WEB_URL]) }),
      reuseExistingServer: false,
      timeout: API_START_MS,
      gracefulShutdown: SHUTDOWN,
    },
    {
      name: 'worker',
      command: 'make worker',
      cwd: PLATFORM_DIR,
      gracefulShutdown: SHUTDOWN,
    },
    {
      name: 'web',
      // `make web` pins :3000, which the founder's own app holds.
      command: `npx nuxt dev --host 127.0.0.1 --port ${WEB_PORT}`,
      cwd: APP_DIR,
      // The port, not a URL: `nuxt dev` quietly moves to the next free port when this one is taken,
      // and a URL check would then wait three minutes on whatever already answers here. Checking the
      // port means anything listening is refused before Nuxt is started at all. Measured: a decoy
      // server on this port gave "Timed out waiting 180000ms" with `url`, and "is already used" here.
      port: WEB_PORT,
      env: serverEnv({ NUXT_PUBLIC_API_BASE: API_URL, NUXT_TELEMETRY_DISABLED: '1' }),
      reuseExistingServer: false,
      timeout: WEB_START_MS,
      gracefulShutdown: SHUTDOWN,
    },
  ],
});
