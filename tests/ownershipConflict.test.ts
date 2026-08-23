import { describe, it, expect } from 'vitest';
import { isSiteToken } from '../src/server/lib/cloudflareManagedDns';
import { connectStage } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * THREE DAYS OF WAITING FOR SOMETHING THAT COULD NEVER HAPPEN (admin, mitrify.com, 2026-08-23).
 *
 * The hosting service was explicit:
 *   "Custom Domain has multiple, conflicting ownership claims. There must be at most one TXT record
 *    with the `hosting-site=` prefix on the domain."   ownership: conflict · host: active · SSL: active
 *
 * Two independent failures produced those three days, and both are pinned here:
 *   1. applyRecords ADDED an ownership token per connect and never removed the old one, so connecting
 *      one domain from three apps left three claims and the service refused all of them.
 *   2. The screen had no branch for a conflict, so it printed "Waiting for your DNS records to spread
 *      across the internet" over a permanent refusal — and the admin, reasonably, waited.
 */

describe('isSiteToken — the one prefix the stale sweep is allowed to touch', () => {
  it('recognises our ownership token, quoted or not', () => {
    expect(isSiteToken('hosting-site=nbai-37038f98f790b362308d')).toBe(true);
    expect(isSiteToken('"hosting-site=nbai-709e5932ecaaf74b9c63"')).toBe(true);
    expect(isSiteToken('  HOSTING-SITE=nbai-abc  ')).toBe(true);
  });

  it('🔒 does NOT recognise anything else in a user’s zone', () => {
    // The whole safety argument for deleting these rests on this list. A TXT sweep that caught SPF or
    // DKIM would silently break the user's EMAIL — which is why the TXT branch stays add-only for
    // everything except this one prefix.
    expect(isSiteToken('v=spf1 include:_spf.google.com ~all')).toBe(false);
    expect(isSiteToken('google-site-verification=abc123')).toBe(false);
    expect(isSiteToken('v=DKIM1; k=rsa; p=MIGf...')).toBe(false);
    expect(isSiteToken('y7xukjntdfGt5_a1CCdUm9f6EVYhhG6JQDgnOg3asi8')).toBe(false); // the ACME challenge
    expect(isSiteToken('')).toBe(false);
  });
});

describe('connectStage — a conflict is a refusal, never a wait', () => {
  const base = { active: false, hostState: 'HOST_ACTIVE', sslState: 'CERT_ACTIVE' };

  it('🔒 says plainly that waiting will not help', () => {
    // The exact state from the screenshot: host and certificate fine, ownership in conflict.
    const s = connectStage({ ...base, ownershipState: 'OWNERSHIP_CONFLICT' });
    expect(s.headline).toContain('more than one ownership record');
    expect(s.note).toContain('will not fix itself');
    expect(s.tone).toBe('warn');
  });

  it('🔒 never tells the user to wait for DNS to spread', () => {
    // This is the sentence that cost the three days. It must not be reachable from a conflict.
    const s = connectStage({ ...base, ownershipState: 'OWNERSHIP_CONFLICT' });
    expect(s.headline).not.toContain('spread across the internet');
    expect(s.note).not.toContain('few hours');
  });

  it('names the one action that actually clears it', () => {
    const s = connectStage({ ...base, ownershipState: 'OWNERSHIP_CONFLICT' });
    expect(s.action).toBe('check');
    expect(s.note).toContain('Check & apply records');
  });

  it('an ordinary PENDING ownership still reads as a normal wait — the honest case is untouched', () => {
    const s = connectStage({ ...base, ownershipState: 'OWNERSHIP_PENDING', hostState: 'HOST_PENDING', sslState: 'CERT_PENDING' });
    expect(s.headline).toContain('spread across the internet');
    expect(s.note).toContain('nothing is lost');
  });

  it('and a genuinely finished domain is unaffected', () => {
    const s = connectStage({
      active: true, ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE', sslState: 'CERT_ACTIVE',
      serving: { state: 'serving', note: '' },
    });
    expect(s.headline).toContain('Live!');
  });
});
