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
 *   • It never runs a build: each build is a real AI + sandbox run that costs money.
 *     (The optional /api/build smoke step was removed on 2026-09-25 with the
 *     legacy build engine; that endpoint now answers 410.)
 *
 * Stages model: ramp to 100 VUs, hold, ramp to peak, cool down.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

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

  sleep(1);
}
