import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  pickCheckRoutes, buildFingerprint, regressedRoutes, regressionMessage,
  encodeFingerprint, decodeFingerprint, fingerprintWorkspaceKey, routeFingerprintEnabled,
  MAX_CHECK_ROUTES,
} from '../src/server/AgentV3/RouteFingerprint';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

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

describe('WHERE DID THE TIME GO — a quiet minute is now described, not guessed at', () => {
  /**
   * AUTOPSY d6deaaf0: five consecutive heartbeats all pointed at the SAME narration line from minute 1,
   * and a 153-second window plus an 8m46s read-only survey had nothing to explain them. A heartbeat
   * could only name a TOOL — but the long stretches of a build (import, database provisioning,
   * `npm install`, dev-server boot, preview verification) are not tool calls, so the report literally
   * could not answer "where did the time go?". Nothing was recording it.
   */
  it('the heartbeat names the ACTIVE PHASE instead of a stale last-activity line', () => {
    let now = 0;
    const d = new BuildDiagnostics({ buildId: 'b1', now: () => now });
    d.enterPhase('installing dependencies and starting your app');
    now = 130_000;
    d.heartbeat();
    const hb = d.report().issues.filter((i) => i.code === 'HEARTBEAT').pop();
    expect(hb?.message).toContain('installing dependencies and starting your app');
    expect(hb?.message).toMatch(/130s so far/);
    expect(hb?.message).not.toContain('last: starting');
  });

  it('closing a phase records how long it took, so the timeline shows the minutes', () => {
    let now = 0;
    const d = new BuildDiagnostics({ buildId: 'b1', now: () => now });
    d.enterPhase('creating the database tables');
    now = 95_000;
    d.exitPhase();
    const timing = d.report().issues.find((i) => i.code === 'PHASE_TIMING');
    expect(timing?.message).toBe('⏳ creating the database tables took 1m 35s.');
  });

  it('a sub-3s step is not written to the timeline — that would be noise, not signal', () => {
    let now = 0;
    const d = new BuildDiagnostics({ buildId: 'b1', now: () => now });
    d.enterPhase('quick step');
    now = 1_000;
    d.exitPhase();
    expect(d.report().issues.some((i) => i.code === 'PHASE_TIMING')).toBe(false);
  });

  it('a forgotten exitPhase can never freeze the heartbeat on a stale label', () => {
    let now = 0;
    const d = new BuildDiagnostics({ buildId: 'b1', now: () => now });
    d.enterPhase('first');
    now = 10_000;
    d.enterPhase('second');   // supersedes rather than nesting
    now = 20_000;
    d.heartbeat();
    const hb = d.report().issues.filter((i) => i.code === 'HEARTBEAT').pop();
    expect(hb?.message).toContain('second');
    expect(hb?.message).not.toContain('first');
    // …and the superseded phase still contributed its timing to the record.
    expect(d.report().issues.some((i) => i.code === 'PHASE_TIMING' && i.message.includes('first'))).toBe(true);
  });

  it('an in-flight TOOL still wins — a named tool is more specific than a phase', () => {
    let now = 0;
    const d = new BuildDiagnostics({ buildId: 'b1', now: () => now });
    d.enterPhase('some phase');
    d.ingestEvent({ type: 'tool_call', agent: 'frontend', callId: 'c1', tool: 'write_file', ts: 1 } as any);
    now = 30_000;
    d.heartbeat();
    expect(d.report().issues.filter((i) => i.code === 'HEARTBEAT').pop()?.message).toContain('in-flight: write_file');
  });

  it('the long stretches of an import are actually marked', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("enterPhase?.('creating the database tables')");
    expect(route).toContain("enterPhase?.('installing dependencies and starting your app')");
    expect(route).toContain("enterPhase?.('checking the live preview')");
  });
});
