/**
 * Where the browser test finds the stack it starts, and the guard that keeps it off the real data
 * (plan D.9b, ADR-055).
 *
 * **The ports are the test's own.** The founder's API and app hold :8000 and :3000, and the
 * lanes' verification servers sit in the 3000s and 8000s beside them; 8055 and 3055 are neither.
 * Playwright refuses to start when either is already answering, so the test can never reach an
 * API or an app it did not start — one on the real databases included. The **worker** has no port
 * to guard that way, and a second one consuming the test topics would take the upload this test
 * waits for: that collision is `make e2e`'s own pre-flight, which refuses when the test consumer
 * group already has a member.
 *
 * `127.0.0.1`, never `localhost`: macOS resolves `localhost` to `::1` first, and uvicorn listens
 * on IPv4 only (the same trap the compose file records for Kafka).
 */

export const API_PORT = 8055;
export const WEB_PORT = 3055;
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

/** Every store the stack can write to, and what makes each one the test store. */
const TEST_STORES: readonly { name: string; isTest: (value: string) => boolean; rule: string }[] = [
  { name: 'CLICKHOUSE_DB_PREFIX', isTest: (value) => value === 'test_', rule: "must be 'test_'" },
  { name: 'POSTGRES_DB', isTest: (value) => value.endsWith('_test'), rule: "must end in '_test'" },
  { name: 'S3_RAW_BUCKET', isTest: (value) => value.endsWith('-test'), rule: "must end in '-test' (raw text is forever)" },
  { name: 'KAFKA_UPLOADS_TOPIC', isTest: (value) => value.startsWith('test.'), rule: "must start with 'test.'" },
  { name: 'KAFKA_BULK_TOPIC', isTest: (value) => value.startsWith('test.'), rule: "must start with 'test.'" },
  { name: 'KAFKA_CONSUMER_GROUP', isTest: (value) => value.startsWith('test'), rule: 'must be a test group (a real one would consume real uploads)' },
  // An explicit non-zero database, not merely "not /0": a URL with no database segment at all
  // (`redis://localhost:6380`) resolves to db 0, which is the founder's real cache.
  { name: 'REDIS_URL', isTest: (value) => /\/[1-9][0-9]*$/.test(value.replace(/\/+$/, '')), rule: 'must name a logical database other than 0 (a URL with no database is db 0)' },
];

/**
 * Throw unless every store is the test one — the rules `tests/integration/conftest.py` refuses a
 * session on, checked on the environment the API and the worker inherit.
 *
 * A variable that is unset fails too: the settings would fall back to `.env` or to the real
 * defaults, and a test that uploads synthetic hands must not find out which by running.
 */
export function refuseUnlessTestEnvironment(env: Readonly<Record<string, string | undefined>>): void {
  const problems = TEST_STORES.filter(({ name, isTest }) => !isTest(env[name] ?? '')).map(({ name, rule }) => `${name} ${rule}`);
  if (problems.length === 0) return;
  throw new Error(`refusing to run the browser test against the analysis databases: ${problems.join('; ')}. Use \`make e2e\`.`);
}
