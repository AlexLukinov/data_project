/**
 * Every clock the browser test runs on, in one place (plan D.9b, ADR-055).
 *
 * They live together because they have to **add up**: the test's own timeout must exceed the
 * budgets the steps inside it can spend, or a slow-but-honest run dies as "Test timeout exceeded"
 * instead of on the assertion that was actually waiting — and the reader loses the reason. So the
 * total is derived from the parts rather than written down beside them.
 */

/** The first navigation, where `nuxt dev` compiles the app for the browser; a cold runner is slow. */
export const NAV_MS = 120_000;

/** A single DOM expectation on a page that is already loaded. */
export const ASSERT_MS = 30_000;

/** My game's report, dev-server compilation of that page included. */
export const REPORT_MS = 60_000;

/**
 * How long an uploaded file may take to land. D.8 measured 2.8 s; the rest is for a worker joining
 * a group whose previous member was killed rather than stopped, which the broker keeps assigned for
 * its 45 s session timeout.
 */
export const LANDED_MS = 90_000;

/** Starting each server: `uv run` may still be preparing its environment; `nuxt dev` prepares the app. */
export const API_START_MS = 120_000;
export const WEB_START_MS = 180_000;

/**
 * SIGTERM before SIGKILL. The graceful signal matters for the worker: it closes its Kafka consumer
 * and leaves the group, where a killed one stays a member until the broker's session timeout and
 * holds the partition away from the next run's worker for that long.
 */
export const SHUTDOWN_MS = 15_000;

/** Slack for the steps no budget above covers — the clicks, the uploads, the browser itself. */
const SLACK_MS = 60_000;

/**
 * The whole test: one navigation, two reports, one landing, and slack. A ceiling for a hang, never
 * the thing a healthy run runs into.
 */
export const TEST_TIMEOUT_MS = NAV_MS + LANDED_MS + 2 * REPORT_MS + SLACK_MS;
