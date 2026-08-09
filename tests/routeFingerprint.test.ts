import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  pickCheckRoutes, buildFingerprint, regressedRoutes, regressionMessage,
  encodeFingerprint, decodeFingerprint, fingerprintWorkspaceKey, routeFingerprintEnabled,
  MAX_CHECK_ROUTES,
} from '../src/server/AgentV3/RouteFingerprint';

/**
 * ADMIN 2026-08-09, after Green Guard shipped: "jo jo bacha hai usko bhi smart fix karo."
 *
 * THE HOLE: Green Guard decided "green" by opening ONE url — the home page. An edit that left the home
 * page rendering while breaking /admin ended the turn GREEN, so the broken state became the new last
 * known good and the guard protected the damage. This closes it by remembering WHICH pages worked.
 *
 * The two properties that make it safe rather than noisy:
 *   • the sample is SMALL and DETERMINISTIC (same routes every turn, so two records are comparable);
 *   • the comparison is ASYMMETRIC — only losing a page we watched WORKING counts as a regression.
 */

describe('the sample — small, visitable, and the same every time', () => {
  it('leads with the home page, then the shallowest routes alphabetically', () => {
    const routes = ['/settings/billing/invoices', '/orders', '/', '/about', '/admin/users'];
    expect(pickCheckRoutes(routes)).toEqual(['/', '/about', '/orders', '/admin/users', '/settings/billing/invoices']);
  });

  it('drops what is not a visitable PAGE', () => {
    const routes = [
      '/api/users',              // an endpoint, not a screen
      '/graphql', '/healthz', '/_next/static/x', '/favicon.ico',
      '/users/:id', '/blog/*', '/x/(group)/y', '/opt/{id}',   // no real value to substitute
      'relative/page',           // not an address we can open
      '/good',
    ];
    expect(pickCheckRoutes(routes)).toEqual(['/good']);
  });

  it('is bounded and deterministic — the same input always yields the same sample', () => {
    const many = Array.from({ length: 200 }, (_, i) => `/p${String(i).padStart(3, '0')}`);
    const a = pickCheckRoutes(many);
    expect(a).toHaveLength(MAX_CHECK_ROUTES);
    expect(pickCheckRoutes(many)).toEqual(a);
    expect(pickCheckRoutes(many, 2)).toEqual(a.slice(0, 2));
  });

  it('normalises trailing slashes so the same page is never watched twice', () => {
    expect(pickCheckRoutes(['/about/', '/about'])).toEqual(['/about']);
    expect(pickCheckRoutes(['/'])).toEqual(['/']); // the root keeps its slash
  });

  it('survives junk without throwing', () => {
    expect(pickCheckRoutes([])).toEqual([]);
    expect(pickCheckRoutes(undefined as any)).toEqual([]);
    expect(pickCheckRoutes([null as any, 42 as any, '/ok'])).toEqual(['/ok']);
  });
});

describe('the comparison — only losing a page we watched WORKING counts', () => {
  const before = buildFingerprint([
    { route: '/', rendered: true },
    { route: '/admin', rendered: true },
    { route: '/beta', rendered: false }, // never worked — not recorded
  ], 1_000);

  it('records only what genuinely rendered, sorted for a comparable record', () => {
    expect(before.ok).toEqual(['/', '/admin']);
    expect(before.at).toBe(1_000);
  });

  it('THE CAUGHT BUG: home still fine, /admin broken ⇒ regression', () => {
    const broken = regressedRoutes(before, [{ route: '/', rendered: true }, { route: '/admin', rendered: false }]);
    expect(broken).toEqual(['/admin']);
    expect(regressionMessage(broken)).toMatch(/broke 1 page that worked before \(\/admin\)/);
    expect(regressionMessage(broken)).toMatch(/home page still loaded/);
  });

  it('a page that NEVER worked is not held against this turn (needs a login, seed data, or does not exist)', () => {
    expect(regressedRoutes(before, [{ route: '/beta', rendered: false }])).toEqual([]);
  });

  it('an UNCHECKED page is never reported as broken — an unmeasured thing is not a failure', () => {
    expect(regressedRoutes(before, [{ route: '/', rendered: true }])).toEqual([]);
  });

  it('no previous fingerprint ⇒ nothing to regress against (the first green turn is never punished)', () => {
    expect(regressedRoutes(null, [{ route: '/', rendered: false }])).toEqual([]);
    expect(regressedRoutes({ ok: [], at: 0 }, [{ route: '/', rendered: false }])).toEqual([]);
  });

  it('everything still working ⇒ no regressions', () => {
    expect(regressedRoutes(before, [{ route: '/', rendered: true }, { route: '/admin', rendered: true }])).toEqual([]);
  });
});

describe('storage — its own key, and a corrupt record degrades to "no fingerprint"', () => {
  it('round-trips', () => {
    const fp = buildFingerprint([{ route: '/', rendered: true }], 5);
    expect(decodeFingerprint(encodeFingerprint(fp))).toEqual(fp);
  });

  it('never throws on junk — a bad record must not break a build', () => {
    expect(decodeFingerprint(null)).toBeNull();
    expect(decodeFingerprint({})).toBeNull();
    expect(decodeFingerprint({ 'fingerprint.json': 'not json' })).toBeNull();
    expect(decodeFingerprint({ 'fingerprint.json': '{"nope":1}' })).toBeNull();
  });

  it('lives OUTSIDE the snapshot, so a restore never writes it into the user\'s app', () => {
    expect(fingerprintWorkspaceKey('ws1')).toBe('ws1::greenmeta');
    expect(fingerprintWorkspaceKey('ws1')).not.toBe('ws1::green');
  });

  it('has its own kill switch — the extra page visits can be stopped alone', () => {
    expect(routeFingerprintEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(routeFingerprintEnabled({ AGENTV3_ROUTE_FINGERPRINT: 'off' } as any)).toBe(false);
  });
});

describe('WIRING — the check runs on a green turn and can veto that green', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const at = route.indexOf('── ROUTE FINGERPRINT');
  const seg = route.slice(at, at + 5000);

  it('is wired where the turn has already been judged green', () => {
    expect(at).toBeGreaterThan(-1);
    expect(seg).toContain('pickCheckRoutes(');
    expect(seg).toContain('regressedRoutes(');
  });

  it('a regression VETOES green, so Green Guard restores instead of protecting the damage', () => {
    expect(seg).toContain('previewGreen = false');
    expect(seg).toContain('ROUTE_REGRESSION');
  });

  it('only runs on an already-green turn — a failing build pays nothing extra', () => {
    expect(seg).toContain('previewGreen && routeFingerprintEnabled()');
  });

  it('the fingerprint is written under its OWN key, never into the snapshot', () => {
    expect(seg).toContain('fingerprintWorkspaceKey(workspaceId)');
    expect(seg).not.toContain('greenWorkspaceKey(workspaceId), encodeFingerprint');
  });
});
