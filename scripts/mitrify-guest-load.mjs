#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

// Operator-only runner. No Firebase session/cookies and no gateway credential.
// Its control token authorizes only numbered slots in an expiring server campaign.
export async function runGuestLoadTest({ target, token }, report = console.log) {
  const url = new URL(target);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))
    || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
    || typeof token !== 'string' || token.length < 32 || token.length > 512) throw new Error('Invalid test configuration.');
  url.pathname = '/api/v1/chat/mitrify-guest-test';
  const reports = [];
  for (const batch of [10, 100, 1000]) {
    let release; const barrier = new Promise(resolve => { release = resolve; });
    const started = []; let active = 0; let peakClientPending = 0;
    const calls = Array.from({ length: batch }, (_, slot) => barrier.then(async () => {
      const start = performance.now(); started.push(start); peakClientPending = Math.max(peakClientPending, ++active);
      try {
        const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(65_000),
          headers: { 'Content-Type': 'application/json', 'X-Mitrify-Test-Token': token }, body: JSON.stringify({ batch, slot }) });
        // Bound response memory; never print server error strings or response content.
        const reader = response.body?.getReader(); let size = 0; const parts = [];
        if (reader) for (;;) { const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error('Response too large.'); }
          parts.push(item.value);
        }
        let completed = false;
        try { completed = response.ok && JSON.parse(Buffer.concat(parts).toString()).completed === true; } catch { /* invalid response */ }
        return { status: response.status, completed, ms: performance.now() - start };
      } catch { return { status: 0, completed: false, ms: performance.now() - start }; }
      finally { active--; }
    }));
    const begin = performance.now(); release(); const results = await Promise.all(calls);
    const times = results.map(r => r.ms).sort((a, b) => a - b);
    const summary = { batch, completed: results.filter(r => r.completed).length,
      statuses: results.reduce((counts, r) => { counts[r.status] = (counts[r.status] || 0) + 1; return counts; }, {}),
      launchSpreadMs: Math.round(Math.max(...started) - Math.min(...started)), peakClientPending,
      elapsedMs: Math.round(performance.now() - begin), p50Ms: Math.round(times[Math.ceil(batch * .5) - 1]),
      p95Ms: Math.round(times[Math.ceil(batch * .95) - 1]) };
    reports.push(summary); report(JSON.stringify(summary));
    // Authentication/configuration/admission failures must not trigger larger batches.
    if (results.some(r => [401, 403, 409, 503].includes(r.status))) break;
  }
  return reports;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.env.MITRIFY_GUEST_TEST_TARGET;
  const token = process.env.MITRIFY_GUEST_TEST_TOKEN;
  if (!target || !token) { console.error('Set the test target and control token securely in the environment.'); process.exitCode = 1; }
  else try {
    const reports = await runGuestLoadTest({ target, token });
    if (reports.length !== 3 || reports.some(r => r.completed !== r.batch)) process.exitCode = 1;
  } catch { console.error('The controlled guest test could not run.'); process.exitCode = 1; }
}
