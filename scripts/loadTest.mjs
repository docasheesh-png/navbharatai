#!/usr/bin/env node
// P-TQA.3 — Dependency-free load / stress tester (k6-style), runs with plain `node` (Node 22 global
// fetch — no k6 binary, no npm dependency). Fires `vus` concurrent virtual users for `duration`
// seconds against a target URL, then prints latency percentiles + error rate + throughput and exits
// non-zero if the p95 / error-rate thresholds are breached (so it can gate a nightly CI job).
//
// Usage:
//   node scripts/loadTest.mjs --url http://localhost:8080/api/live --vus 50 --duration 30 \
//        --p95 2000 --error-rate 0.01
//
// The statistics core is the unit-tested src/server/lib/loadTestStats.ts (compiled here inline as a
// tiny copy to keep this script dependency- and build-free).

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const url = arg('url', 'http://localhost:8080/api/live');
const vus = parseInt(arg('vus', '20'), 10);
const durationS = parseInt(arg('duration', '10'), 10);
const p95Limit = parseInt(arg('p95', '2000'), 10);
const errLimit = parseFloat(arg('error-rate', '0.01'));

function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((Math.max(0, Math.min(100, p)) / 100) * s.length));
  return s[rank - 1];
}

async function main() {
  if (typeof fetch !== 'function') {
    console.error('This load tester requires Node 18+ (global fetch).');
    process.exit(2);
  }
  console.log(`[load] ${vus} VUs × ${durationS}s → ${url}`);
  const latencies = [];
  let errors = 0;
  const deadline = Date.now() + durationS * 1000;
  const startedAt = Date.now();

  async function virtualUser() {
    while (Date.now() < deadline) {
      const t0 = Date.now();
      try {
        const res = await fetch(url, { method: 'GET' });
        const ms = Date.now() - t0;
        if (res.ok) latencies.push(ms);
        else errors++;
        // Drain the body so the socket frees up.
        await res.arrayBuffer().catch(() => {});
      } catch {
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, vus) }, () => virtualUser()));
  const durationMs = Date.now() - startedAt;

  const ok = latencies.length;
  const count = ok + errors;
  const seconds = durationMs / 1000;
  const summary = {
    count,
    errors,
    errorRate: count > 0 ? errors / count : 0,
    throughputRps: seconds > 0 ? Math.round((count / seconds) * 100) / 100 : 0,
    meanMs: ok > 0 ? Math.round((latencies.reduce((s, v) => s + v, 0) / ok) * 100) / 100 : 0,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: ok > 0 ? Math.max(...latencies) : 0,
  };

  console.log('[load] results:', JSON.stringify(summary, null, 2));

  const failures = [];
  if (summary.p95Ms > p95Limit) failures.push(`p95 ${summary.p95Ms}ms > ${p95Limit}ms`);
  if (summary.errorRate > errLimit) failures.push(`error rate ${(summary.errorRate * 100).toFixed(2)}% > ${(errLimit * 100).toFixed(2)}%`);

  if (failures.length > 0) {
    console.error('[load] THRESHOLD FAIL:', failures.join('; '));
    process.exit(1);
  }
  console.log('[load] thresholds OK ✅');
}

main().catch((e) => {
  console.error('[load] error:', e);
  process.exit(2);
});
