import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { recordsStillPending } from '../src/server/lib/domainDnsRecords';
import { connectStage, visitTone } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * THREE SCREENSHOTS, ONE DOMAIN, ONE MINUTE (admin 2026-09-07, mitrify.com):
 *   1. amber "needs its server part deployed first" — and above it, "TXT _acme-challenge not visible
 *      yet … nothing is wrong", beside `SSL: active`;
 *   2. green "Connected, with HTTPS … press Publish once", with a Publish button that can only refuse;
 *   3. the domain itself: Firebase's "Site Not Found" — under a bright green "Visit mitrify.com".
 *
 * Four defects, each with its own root, none of them "the backend is not deployed" (which is true, and
 * which the screen should have said ONCE, consistently, with a way to do it).
 */
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('🔒 ONE verdict source — the connect route returns what the status route returns', () => {
  const route = src('src/server/routes/nbaiDomains.ts');

  it('both routes form the verdict through the same function', () => {
    expect(route).toContain('async function formDomainVerdict(');
    expect(route).toContain('res.json(await formDomainVerdict(workspaceId, host, status));');
    expect(route).toContain('const verdict = await formDomainVerdict(workspaceId, host, status);');
    expect(route).toContain('res.json({ ...verdict, autoDns:');
  });

  it('🔒 the bare-status shape that produced the second, contradictory verdict is gone', () => {
    expect(route).not.toContain('res.json({ ...status, displayRecords, autoDns:');
  });

  it('🔒 exactly one serving probe and one DNS check exist — a second copy is how two truths come back', () => {
    expect(route.split('checkDomainServing(host)').length - 1).toBe(1);
    expect(route.split('verifyRecordsLive(').length - 1).toBe(1);
  });

  it('the backend-pointed early return and the publish-block gate survived the move intact', () => {
    // Anchors other suites pin, kept here too so a future refactor sees them together.
    expect(route).toContain("active: serving?.state === 'serving'");
    expect(route).toContain("if (serving?.state !== 'serving') {");
    expect(route).toContain('...(publishBlocked ? { publishBlocked } : {})');
  });
});

describe('recordsStillPending — a record the host already accepted is not re-checked in DNS', () => {
  const acmeDone = { type: 'TXT', name: '_acme-challenge.mitrify.com', value: 'tok', done: true };
  const aPending = { type: 'A', name: 'mitrify.com', value: '1.2.3.4', done: false };

  it('🔒 THE SCREENSHOT: an accepted certificate-challenge record is excluded once done', () => {
    expect(recordsStillPending([acmeDone, aPending])).toEqual([aPending]);
  });

  it('a pending record is checked; an older shape with no flag is still checked', () => {
    expect(recordsStillPending([{ type: 'A', name: 'x', value: 'y' }])).toHaveLength(1);
    expect(recordsStillPending([aPending])).toEqual([aPending]);
  });

  it('nothing pending ⇒ nothing checked ⇒ no sentence to show (the box disappears on a finished domain)', () => {
    expect(recordsStillPending([acmeDone])).toEqual([]);
    expect(recordsStillPending(null)).toEqual([]);
    expect(recordsStillPending(undefined)).toEqual([]);
  });

  it('the status route hands the check ONLY the pending records', () => {
    expect(src('src/server/routes/nbaiDomains.ts')).toContain('verifyRecordsLive(recordsStillPending(displayRecords))');
  });
});

describe('🔒 visitTone — green is earned by evidence, never by "connected"', () => {
  it('seen serving ⇒ live', () => {
    expect(visitTone({ serving: { state: 'serving' } })).toBe('live');
  });

  it('🔒 THE SCREENSHOT: a server app with nothing deployed is never painted green', () => {
    expect(visitTone({ publishBlocked: 'needs its server', serving: { state: 'nothing_published' } })).toBe('muted');
    expect(visitTone({ publishBlocked: 'needs its server', serving: { state: 'serving' } })).toBe('muted');
  });

  it('an error page, no probe, or an unknown probe ⇒ muted', () => {
    expect(visitTone({ serving: { state: 'error' } })).toBe('muted');
    expect(visitTone({ serving: { state: 'unknown' } })).toBe('muted');
    expect(visitTone({ serving: null })).toBe('muted');
    expect(visitTone({})).toBe('muted');
  });

  it('a backend-pointed domain follows the backend verdict', () => {
    expect(visitTone({ backendPointed: true, backendStage: { tone: 'ok' } })).toBe('live');
    expect(visitTone({ backendPointed: true, backendStage: { tone: 'warn' } })).toBe('muted');
  });

  it('the screen paints the link from visitTone and never withholds it', () => {
    const screen = src('src/components/agentv3/NbaiDomainConnect.tsx');
    expect(screen).toContain('const tone = visitTone(result);');
    expect(screen).toContain("{tone === 'live' ? 'Visit' : 'Open'} {cleanDomain}");
  });
});

describe('🔒 the server-app verdict carries a way to do the one thing that is left', () => {
  const base = { active: true, ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE', sslState: 'CERT_ACTIVE' };

  it('connectStage names the deploy-backend action for a blocked publish', () => {
    const s = connectStage({ ...base, publishBlocked: 'Your app has a server half…' });
    expect(s.action).toBe('deploy-backend');
    expect(s.tone).toBe('warn');
    expect(s.action).not.toBe('publish');   // the dead button stays gone
  });

  it('the screen renders the button and the sheet wires it to the view that holds the controls', () => {
    const screen = src('src/components/agentv3/NbaiDomainConnect.tsx');
    const chooser = src('src/components/agentv3/HostingChooser.tsx');
    expect(screen).toContain("stage.action === 'deploy-backend' && onDeployBackend && (");
    // The prop must actually reach the component — declared on the interface AND destructured. CI
    // caught exactly this gap on the first push (tsc: "Cannot find name 'onDeployBackend'").
    expect(screen).toMatch(/onUnpublish, onDeployBackend \}: NbaiDomainConnectProps\)/);
    expect(screen).toContain('Go to Deploy backend');
    expect(chooser).toContain("onDeployBackend={() => setView('choose')}");
  });
});
