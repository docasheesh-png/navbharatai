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
/**
 * The BODY of the /state handler, bounded by the next route registration.
 *
 * ⚠️ Both tests below used `slice(start, start + 2200)`, and that broke twice while the route stayed
 * perfectly correct — once when the saved-records fallback was added, once when the workspace scope
 * was threaded through. A byte count is not the property under test; "inside this handler" is, and a
 * handler that grows is normal. Bounding by the next route registration cannot drift.
 */
function stateRoute(): string {
  const start = route.indexOf("'/api/domains/nbai/state'");
  expect(start).toBeGreaterThan(-1);
  const after = Math.min(
    ...[route.indexOf('app.get(', start + 10), route.indexOf('app.post(', start + 10)]
      .filter((i) => i > -1)
      .concat([route.length]),
  );
  return route.slice(start, after);
}

describe('domain state rehydration', () => {
  it('the state route is ownership-checked and assembles domain + status + zone in one answer', () => {
    const seg = stateRoute();
    expect(seg).toContain('ownsWorkspace');
    expect(seg).toContain('firebaseDomainsForWorkspace');
    expect(seg).toContain('customDomainStatusLive');
    expect(seg).toContain('zoneStatus(domain)');
  });

  it('a missing zone never hides the rest of the state — best-effort by construction', () => {
    const seg = stateRoute();
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

/**
 * DOMAIN RATE BUDGET (admin screenshot 2026-08-06: "Rate limit exceeded: max 10 builds per hour" on
 * the CONNECT page). Third instance of the same class — zip chunks, terminal keystrokes, now domains:
 * every domain route sat on the 10/hour BUILD bucket, so one live setup session killed the whole flow
 * for an hour, with a message about builds the user never ran.
 */
describe('domain ops rate budget', () => {
  it('no domain route rides the build bucket — ever again', () => {
    const fresh = readFileSync(join(__dirname, '..', 'src/server/routes/nbaiDomains.ts'), 'utf8');
    expect(fresh).not.toContain('buildRateLimiter');
    // every route in this file carries the domain-ops bucket, including status (which had NONE)
    const routes = fresh.match(/app\.(get|post)\('\/api\/domains\/nbai\//g) ?? [];
    const limited = fresh.match(/domainOpsRateLimiter\(\)/g) ?? [];
    expect(routes.length).toBeGreaterThanOrEqual(7);
    expect(limited.length).toBe(routes.length);
  });

  it('the budget fits a real setup session and names the right noun', async () => {
    const { DOMAIN_OPS_RATE } = await import('../src/server/lib/authMiddleware');
    expect(DOMAIN_OPS_RATE.authed).toBeGreaterThanOrEqual(240);
    expect(DOMAIN_OPS_RATE.noun).toBe('domain requests');
  });
});
