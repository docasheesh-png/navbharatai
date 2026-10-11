/**
 * THE LOAD TEST ONLY READS, AND THE SCALE DOC STATES THE REAL CEILING (performance audit 2026-10-11, F18).
 *
 * `loadtest/build-stream.k6.js` POSTed analytics events and error reports — both WRITE (the product funnel, Cloud
 * Error Reporting) — so a run against production polluted the admin's own views. And `docs/SCALABILITY.md` said
 * `max-instances=10` a month after `cloudbuild.yaml` raised it to 100.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const k6 = readFileSync('loadtest/build-stream.k6.js', 'utf8');

describe('the load test', () => {
  it('🔒 sends no write — no POST, PUT, PATCH or DELETE', () => {
    const code = k6.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/http\.(post|put|patch|del|request)\(/);
  });

  it('never names a write route', () => {
    const code = k6.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/\/api\/(analytics\/event|logs\/error|build|agentv3)/);
  });
});

describe('the scale doc', () => {
  it('🔒 does not state an instance ceiling that disagrees with the deploy config', () => {
    const doc = readFileSync('docs/SCALABILITY.md', 'utf8');
    const cfg = readFileSync('cloudbuild.yaml', 'utf8');
    const real = cfg.match(/_MAX_INSTANCES:\s*'(\d+)'/)?.[1];
    expect(real).toBeTruthy();
    for (const m of doc.matchAll(/max-instances=(\d+)/g)) expect(m[1], 'docs/SCALABILITY.md').toBe(real);
  });
});
