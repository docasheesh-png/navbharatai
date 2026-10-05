// Forensic audit 2026-10-04 (P1) — one caller's bad request never benches a provider for everyone.
//
// Every failure opened the provider-wide breaker (shared across instances, escalating to minutes). An
// oversized prompt's 400 benched the FREE leader for every user and pushed all free chat onto paid
// rungs; a script could keep it there. Only a provider-health failure opens the breaker now.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isProviderHealthFailure } from '../src/server/AI/Router/AIRouter';

const err = (message: string, status?: number) => Object.assign(new Error(message), status === undefined ? {} : { status });

describe('the provider\'s health — opens the breaker', () => {
  for (const [label, e] of [
    ['429 rate limit', err('Too many requests', 429)],
    ['quota message', err('429 quota exceeded')],
    ['503 overloaded', err('overloaded', 503)],
    ['500', err('internal', 500)],
    ['timeout', err('Request timeout')],
    ['network', err('fetch failed')],
    ['dead key 401', err('invalid api key', 401)],
    ['empty answer', err('GLM: empty')],
  ] as const) {
    it(label, () => { expect(isProviderHealthFailure(e)).toBe(true); });
  }
});

describe('this request only — leaves the breaker closed', () => {
  for (const [label, e] of [
    ['400 status', err('bad', 400)],
    ['413 status', err('too large', 413)],
    ['context length in text', err('400 This model\'s maximum context length is 128000 tokens')],
    ['prompt too long', err('prompt is too long')],
    ['invalid request', err('Invalid request: messages[0] malformed')],
    ['content policy', err('blocked by content policy')],
  ] as const) {
    it(label, () => { expect(isProviderHealthFailure(e)).toBe(false); });
  }
});

describe('census: every catch in the router goes through the health check', () => {
  it('no catch block opens the breaker directly from a raw error', () => {
    const src = readFileSync('src/server/AI/Router/AIRouter.ts', 'utf8');
    expect(src).not.toMatch(/setCooldown\(\w+\.name, cooldownSeconds\((?:err|error)\)\)/);
    expect((src.match(/noteProviderFailure\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
