/**
 * Phase 7.2 — Load test (k6).
 *
 * Real, runnable capacity baseline for NavBharatAI Pro. Run with:
 *   k6 run -e BASE_URL=https://your-staging-url loadtest/build-stream.k6.js
 *
 * IMPORTANT — what this does and does NOT hit (rewritten 2026-10-11, performance audit F18):
 *   • READ-ONLY endpoints only: the liveness probe, the deep health probe and the app shell. Nothing
 *     here writes to Firestore, spends AI credit, or leaves a record anyone has to clean up.
 *   • It used to POST /api/analytics/event and /api/logs/error. Those WRITE: every analytics event
 *     lands in the product funnel, and every error post is a real entry in Cloud Error Reporting — a
 *     load test against production filled the admin's error view with "loadtest" and skewed the
 *     funnel. Both are also limited per address now (a quiet 204 past it), so from one machine they
 *     would measure the limiter, not the server.
 *   • It never runs a build: each build is a real AI + sandbox run that costs money.
 *   • Point it at STAGING. Even read-only, 300 virtual users against production is real traffic.
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
  // 1. Liveness — the cheapest route the server has; measures the HTTP path itself.
  const live = http.get(`${BASE_URL}/api/live`);
  check(live, { 'live 200': (r) => r.status === 200 });

  // 2. Deep health — reads process state and the dependency checks; still no database write.
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { 'health 200': (r) => r.status === 200 });

  // 3. The app shell — the static path every visitor hits first.
  const shell = http.get(`${BASE_URL}/`);
  check(shell, { 'shell 200': (r) => r.status === 200 });

  sleep(1);
}
