import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isBackendPointed, backendPointedRefusal, backendPointedStage } from '../src/server/AgentV3/domainPointing';
import { connectStage } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * 🔴 THE TRAP: THE SCREEN WOULD HAVE OFFERED A BUTTON THAT TOOK THE LIVE SITE DOWN
 * (admin 2026-09-07, "ab app publish me koi problem bachi hai??").
 *
 * Once a backend deploy moves a domain to the app's own server, the STATIC host's records are
 * deliberately gone — so its ownership/host states go non-active. Every screen and route here read
 * exactly that view, so:
 *   • the connect screen decided the domain was "still connecting" and re-opened the setup block;
 *   • that block offers "Check & apply records", which applies the static host's records — an A
 *     record at the apex;
 *   • and the cross-type sweep shipped hours earlier would then DELETE the service's CNAME, because
 *     DNS forbids an A and a CNAME at one name.
 *
 * A working domain, taken down by the button the screen put in front of the user.
 */
describe('isBackendPointed — a recorded fact, never a guess', () => {
  it('matches the recorded host, ignoring case, trailing dot and scheme', () => {
    for (const host of ['mitrify.com', 'MITRIFY.com', 'mitrify.com.', 'https://mitrify.com/']) {
      expect(isBackendPointed({ backendDomain: 'mitrify.com' }, host), host).toBe(true);
    }
  });

  it('🔒 a DIFFERENT domain on the same workspace is not pointed', () => {
    // A user may connect a second domain later; one serving the backend says nothing about the other.
    expect(isBackendPointed({ backendDomain: 'mitrify.com' }, 'shop.com')).toBe(false);
  });

  it('no record ⇒ false, and nothing changes for every app that never moved a domain', () => {
    expect(isBackendPointed(null, 'mitrify.com')).toBe(false);
    expect(isBackendPointed({}, 'mitrify.com')).toBe(false);
    expect(isBackendPointed({ backendDomain: '' }, 'mitrify.com')).toBe(false);
    expect(isBackendPointed({ backendDomain: 'mitrify.com' }, '')).toBe(false);
  });
});

describe('backendPointedRefusal — names what would be LOST, not merely "no"', () => {
  it('says the site would stop loading, and that nothing was changed', () => {
    const m = backendPointedRefusal('mitrify.com');
    expect(m).toContain('mitrify.com');
    expect(m).toMatch(/stop loading/i);
    expect(m).toMatch(/nothing has been changed/i);
    // 🔒 A refusal without a way forward is a dead end — this one says how to move the domain back.
    expect(m).toMatch(/disconnect/i);
  });
});

describe('backendPointedStage — the verdict comes from whether the domain ANSWERS', () => {
  it('serving ⇒ connected, and it explains why the records are not listed as active', () => {
    const s = backendPointedStage('mitrify.com', { state: 'serving', status: 200 });
    expect(s.tone).toBe('ok');
    expect(s.headline).toMatch(/serving your app/i);
    expect(s.note).toMatch(/no longer used/i);
  });

  it('🔒 a 5xx is named as the APP failing, not the domain', () => {
    const s = backendPointedStage('mitrify.com', { state: 'error', status: 503 });
    expect(s.tone).toBe('warn');
    expect(s.note).toMatch(/app failing, not the domain/i);
  });

  it('🔒 no answer yet is never reported as broken — a first deploy takes minutes, a free plan sleeps', () => {
    const s = backendPointedStage('mitrify.com', null);
    expect(s.tone).toBe('warn');
    expect(s.note).toMatch(/could not confirm/i);
    expect(s.headline).not.toMatch(/not connected|failed/i);
  });
});

describe('🔒 connectStage — the backend verdict outranks every static-host branch', () => {
  const base = { ownershipState: 'OWNERSHIP_PENDING', hostState: 'HOST_PENDING', sslState: 'CERT_PENDING' };

  it('a live backend-pointed domain is never told it is "still connecting"', () => {
    const s = connectStage({
      ...base, active: false,
      backendPointed: true,
      backendStage: { headline: 'Connected — your domain is serving your app.', note: 'n', tone: 'ok' },
    });
    expect(s.headline).toMatch(/serving your app/i);
    expect(s.tone).toBe('ok');
  });

  it('🔒 it offers NO action — the one thing this screen could offer is the thing that must not be pressed', () => {
    const s = connectStage({
      ...base, active: false,
      backendPointed: true,
      backendStage: { headline: 'h', note: 'n', tone: 'warn' },
    });
    expect(s.action).toBe('none');
  });

  it('an ordinary domain is completely unaffected', () => {
    const s = connectStage({ ...base, active: false });
    expect(s.action).toBe('check');
  });
});

describe('🔒 the wiring — the destructive button is refused, and the screen keeps it shut', () => {
  const domains = readFileSync(join(__dirname, '..', 'src/server/routes/nbaiDomains.ts'), 'utf8');
  const chooser = readFileSync(join(__dirname, '..', 'src/components/agentv3/NbaiDomainConnect.tsx'), 'utf8');
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('🔒 the sync route refuses BEFORE it can write anything', () => {
    const syncAt = domains.indexOf("app.post('/api/domains/nbai/auto-dns/sync'");
    const guardAt = domains.indexOf('isBackendPointed(pointingRec, host)', syncAt);
    const applyAt = domains.indexOf('applyRecords(zone.id, fb.records)', syncAt);
    expect(guardAt).toBeGreaterThan(syncAt);
    expect(applyAt).toBeGreaterThan(guardAt);   // the guard is upstream of the write, not beside it
    expect(domains).toContain('backendPointedRefusal(host)');
  });

  it('the deploy records the fact the guard reads — a guess here would delete a working site', () => {
    expect(route).toContain('backendDomain: domain');
  });

  it('🔒 ONE conversation store, not two — a fact written through one must be visible through the other', () => {
    expect(route).toContain('export function getConversationStore()');
    expect(domains).toContain("import { getConversationStore } from './agentv3';");
  });

  it('the status route reports from evidence and stops reading the static host as the verdict', () => {
    expect(domains).toContain('const backendPointed = isBackendPointed(pointingRec, host)');
    expect(domains).toContain("active: serving?.state === 'serving'");
  });

  it('🔒 the setup block stays SHUT for a backend-pointed domain', () => {
    expect(chooser).toContain('shouldShowDnsSetup(result.active || result.backendPointed === true, dnsSectionOpen)');
  });
});
