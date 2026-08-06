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

/**
 * REHYDRATION (admin 2026-08-06: a tab switch reloaded the page mid-flow and "sab chala gaya").
 * Every fact was durable server-side the whole time; only component memory died. The state route +
 * mount hydration make a reload land exactly where the user left off.
 */
describe('domain state rehydration', () => {
  it('the state route is ownership-checked and assembles domain + status + zone in one answer', () => {
    const seg = route.slice(route.indexOf("'/api/domains/nbai/state'"), route.indexOf("'/api/domains/nbai/state'") + 2200);
    expect(seg).toContain('ownsWorkspace');
    expect(seg).toContain('firebaseDomainsForWorkspace');
    expect(seg).toContain('customDomainStatusLive');
    expect(seg).toContain('zoneStatus(domain)');
  });

  it('a missing zone never hides the rest of the state — best-effort by construction', () => {
    const seg = route.slice(route.indexOf("'/api/domains/nbai/state'"), route.indexOf("'/api/domains/nbai/state'") + 2200);
    expect(seg).toContain('.catch(() => null)');
  });

  it('the client hydrates on mount and never clobbers what the user is typing', () => {
    const freshClient = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');
    expect(freshClient).toContain("fetch(`/api/domains/nbai/state?");
    expect(freshClient).toContain('setDomain((prev) => prev || data.domain)');
    expect(freshClient).toContain('setResult((prev) => prev ?? data.status)');
    // unmount-safe: a late response after navigation must not set state
    expect(freshClient).toContain('cancelled = true');
  });
});
