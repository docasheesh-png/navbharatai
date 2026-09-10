import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { customDomainStatus } from '../src/server/lib/firebaseCustomDomain';

/**
 * www ↔ apex (ROADMAP §13, 1.2). A user connected `mitrify.com`; a friend typed `www.mitrify.com`
 * and got nothing, because to the hosting service those are two unrelated domains and we had
 * attached one. Now a connect attaches both — the apex serves, `www` redirects — and these locks
 * hold the pieces together across the route, the link store, the plan sweep and the screen.
 */
const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const routes = src('src/server/routes/nbaiDomains.ts');
const links = src('src/server/lib/firebaseDomainLink.ts');
const sweep = src('src/server/lib/hostingPlanSweep.ts');
const screen = src('src/components/agentv3/NbaiDomainConnect.tsx');
const fb = src('src/server/lib/firebaseCustomDomain.ts');

describe('🔒 the redirect is a real API field, and it is converged rather than assumed', () => {
  it('customDomainStatus passes redirectTarget through, and omits it when absent', () => {
    expect(customDomainStatus('www.x.com', { redirectTarget: 'x.com' }).redirectTarget).toBe('x.com');
    expect('redirectTarget' in customDomainStatus('x.com', {})).toBe(false);
  });

  it('attach sends redirectTarget on create AND patches an existing twin that lacks it', () => {
    // An older connect, or a plan re-attach, could leave the twin serving a second copy of the site
    // instead of redirecting. The attach converges it, with the documented updateMask.
    expect(fb).toContain("body: redirectTarget ? { redirectTarget } : {}");
    expect(fb).toContain('?updateMask=redirectTarget');
    expect(fb).toContain("{ method: 'PATCH', body: { redirectTarget } }");
  });
});

describe('🔒 every route keys on the CANONICAL host — the apex — whichever spelling arrived', () => {
  it('no route reads a domain without canonicalising it', () => {
    // A zone named www.x.com is not something a registrar delegates; the apex is the only key.
    expect(routes).not.toMatch(/(?<!canonicalHost\()normalizeDomain\(req\.(body|query)\?\.domain\)/);
    expect(routes).toContain("import { canonicalHost, alternateHost } from '../lib/domainPair';");
  });

  it('connect attaches the twin with a redirect to the canonical and links it as an alternate', () => {
    expect(routes).toContain('await attachCustomDomain(workspaceId, twin, { redirectTarget: host });');
    expect(routes).toContain('alternateOf: host });');
  });

  it('🔒 the twin is best-effort — its failure cannot turn a connected canonical into a 500', () => {
    const at = routes.indexOf('await attachCustomDomain(workspaceId, twin,');
    expect(routes.slice(at - 200, at)).toContain('try {');
    expect(routes.slice(at, at + 400)).toContain('catch (twinErr)');
  });
});

describe('🔒 ONE verdict, ONE record list — the twin rides beside, never inside', () => {
  it('the verdict is still formed once, with one serving probe (the one-source lock stands)', () => {
    expect(routes.split('checkDomainServing(host)').length - 1).toBe(1);
    expect(routes.split('verifyRecordsLive(').length - 1).toBe(1);
  });

  it("the twin's records are merged into displayRecords before the ONE live check", () => {
    const merge = routes.indexOf('...twinRecords]');
    const check = routes.indexOf('verifyRecordsLive(recordsStillPending(displayRecords))');
    expect(merge).toBeGreaterThan(-1);
    expect(merge).toBeLessThan(check);
  });

  it('both return shapes of the verdict carry `alternate`', () => {
    // The backend-pointed early return, and the ordinary one.
    expect(routes).toMatch(/serving,\n\s+alternate,\n\s+\};/);
    expect(routes).toContain('serving, publish, alternate, ...(publishBlocked ? { publishBlocked } : {}) };');
  });

  it('the automatic applier writes both spellings in one pass, and counts them honestly', () => {
    expect(routes).toContain('await applyRecords(zone.id, desiredAll);');
    expect(routes).toContain('missingFromZone(desiredAll, inZone)');
    expect(routes).toContain('desired: desiredAll.length,');
  });
});

describe('🔒 the link store knows a twin is a spelling, not a second domain', () => {
  it('persists alternateOf and skips twins in the "which domain" reader', () => {
    expect(links).toContain('alternateOf: link.alternateOf ?? null,');
    expect(links).toContain('if (data.alternateOf) return;');
  });

  it('the plan sweep re-attaches a twin WITH its redirect (or it would serve a second copy)', () => {
    expect(sweep).toContain('redirectTarget ? { redirectTarget } : undefined');
    // …and the sweep still sees twins: they must be detached on lapse like any other link. Scoped to
    // that one function's body — a file-wide regex would span into the Strict reader, which DOES skip.
    const start = links.indexOf('export async function firebaseDomainLinksForUser(');
    const end = links.indexOf('export ', start + 10);
    expect(start).toBeGreaterThan(-1);
    expect(links.slice(start, end)).not.toContain('alternateOf');
  });
});

describe('the screen', () => {
  it('names the twin under the verdict, in three honest states', () => {
    expect(screen).toContain('works too — it sends visitors here.');
    expect(screen).toContain('could not check just now.');
    expect(screen).toContain('is being set up too, so both spellings work');
  });

  it('adopts the spelling the server actually connected', () => {
    expect(screen).toContain("if (typeof data?.domain === 'string' && data.domain && data.domain !== cleanDomain) setDomain(data.domain);");
  });
});
