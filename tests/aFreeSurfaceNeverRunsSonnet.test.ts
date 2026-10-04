// Forensic audit 2026-10-04 (P1) — a free, unbilled surface never runs Claude.
//
// Repo Analyst (open to guests, charged nothing) tried Gemini, then Claude Sonnet on ANY Gemini failure —
// including a safety block a caller can trigger on purpose — so a guest could get Sonnet on our bill
// every time. The free chain never runs Sonnet/Opus (ROUTING_AND_BILLING.md).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('census: the Repo Analyst never calls Claude', () => {
  it('no file in src/server/repoAnalyst calls callClaude', () => {
    const dir = 'src/server/repoAnalyst';
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
      .filter((f) => /\bcallClaude\s*\(/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
