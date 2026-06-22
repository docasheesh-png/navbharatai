/**
 * Phase 7.2 — Load test (k6).
 *
 * Real, runnable capacity baseline for NavBharatAI Pro. Run with:
 *   k6 run -e BASE_URL=https://your-staging-url loadtest/build-stream.k6.js
 *
 * IMPORTANT — what this does and does NOT hit:
 *   • It load-tests the LIGHTWEIGHT read/ingest endpoints (health, analytics,
 *     pagespeed-less paths) to establish HTTP/Cloud Run concurrency capacity
 *     (p50/p95 latency, error rate) WITHOUT spending real AI credits.
 *   • It does NOT hammer /api/build-stream by default: each build is a real AI +
 *     sandbox run that costs money and needs provider keys. Load-testing real
 *     builds must be done against a STAGING deploy with a mocked AI provider
 *     (set ENABLE_BUILD_LOAD=1 to include a single smoke build per VU iteration).
 *
 * Stages model: ramp to 100 VUs, hold, ramp to peak, cool down.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const ENABLE_BUILD_LOAD = __ENV.ENABLE_BUILD_LOAD === '1';

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // warm up
    { duration: '1m', target: 100 },   // 100 concurrent users
    { duration: '2m', target: 100 },   // hold
    { duration: '1m', target: 300 },   // peak burst
    { duration: '1m', target: 0 },     // cool down
  ],
  thresholds: {
    // Launch gate: p95 < 1s for lightweight endpoints, <1% errors.
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // 1. Analytics ingest — represents the steady-state write load.
  const analytics = http.post(
    `${BASE_URL}/api/analytics/event`,
    JSON.stringify({ event: 'loadtest_ping', ts: Date.now() }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(analytics, { 'analytics 204': (r) => r.status === 204 });

  // 2. Error-log ingest — best-effort 204 path.
  const logs = http.post(
    `${BASE_URL}/api/logs/error`,
    JSON.stringify({ message: 'loadtest', ts: Date.now() }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(logs, { 'logs 204': (r) => r.status === 204 });

  // 3. Optional: a single real build smoke (STAGING + mocked AI only).
  if (ENABLE_BUILD_LOAD) {
    const build = http.post(
      `${BASE_URL}/api/build`,
      JSON.stringify({ prompt: 'build a hello world react app', preview: false }),
      { headers: { 'Content-Type': 'application/json' }, timeout: '120s' },
    );
    check(build, { 'build responded': (r) => r.status === 200 || r.status === 429 });
  }

  sleep(1);
}
