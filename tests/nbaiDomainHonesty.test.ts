import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * CUSTOM-DOMAIN FAILURES NAME THEMSELVES (admin 2026-08-06: mitrify.in — a valid domain — got
 * "check the spelling" for every attempt, on every website). Two rules, both learned the hard way on
 * the terminal: a validated input is never blamed for a server-side failure, and an ownership-checked
 * route carries its sanitized REAL reason so the next screenshot is a diagnosis, not a mystery.
 */
const route = readFileSync(join(__dirname, '..', 'src/server/routes/nbaiDomains.ts'), 'utf8');
const client = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');

describe('custom-domain error honesty', () => {
  it('the connect failure carries the sanitized real reason beside the classified message', () => {
    expect(route).toContain('detail: sanitizeDomainErrorDetail(err)');
    // And the raw text still reaches the server log for full forensics.
    expect(route).toContain("console.error(`[HTTP 500] nbai domain connect:");
  });

  it('the client shows the owner the detail, dim, under the human message', () => {
    expect(client).toContain('errorDetail');
    expect(client).toContain('data.detail');
    expect(client).toMatch(/\{errorDetail && /);
  });

  it('a retry clears the stale detail with the stale error', () => {
    expect(client).toContain('setError(null); setErrorDetail(null);');
  });
});
