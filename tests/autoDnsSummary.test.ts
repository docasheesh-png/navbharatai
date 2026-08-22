import { describe, it, expect } from 'vitest';
import { autoDnsSummary, statusIcon, lastCheckedLabel } from '../src/components/agentv3/NbaiDomainConnect';
import { missingFromZone } from '../src/server/lib/cloudflareManagedDns';

/**
 * THE SIX-HOUR SCREEN (admin 2026-08-22). A domain sat unconnected for an afternoon while the screen
 * showed a spinning loader and the sentence "Nameservers live — 0 records applied automatically".
 * Both were misleading, and between them they hid an answer the server already had.
 */

describe('autoDnsSummary — a count of actions is not a statement of fact', () => {
  it('🔒 "0 applied" with nothing missing is SUCCESS, and must read as success', () => {
    // THE BUG. `applied` counts records CHANGED, so 0 means "already correct" just as often as it
    // means "nothing written". The old line printed the same words for both, and the admin read the
    // success case as a failure — correctly, given the wording.
    const s = autoDnsSummary({ zoneStatus: 'active', applied: 0, desired: 2, missing: [] });
    expect(s.tone).toBe('ok');
    expect(s.text).toContain('already in place');
    expect(s.text).not.toContain('0 record');
  });

  it('records genuinely missing is the ONLY case that warns, and it names them', () => {
    const s = autoDnsSummary({ zoneStatus: 'active', applied: 0, desired: 2, missing: [{ type: 'A', name: 'mitrify.com' }] });
    expect(s.tone).toBe('warn');
    expect(s.text).toContain('A mitrify.com');
  });

  it('a successful write with everything verified reports both facts', () => {
    const s = autoDnsSummary({ zoneStatus: 'active', applied: 2, desired: 2, missing: [] });
    expect(s.tone).toBe('ok');
    expect(s.text).toContain('we added 2');
  });

  it('🔒 an unreadable zone claims NEITHER verdict', () => {
    // Guessing "fine" strands a broken domain; guessing "broken" sends the user to re-add records
    // that are already correct. The honest answer is that we could not look.
    const s = autoDnsSummary({ zoneStatus: 'active', applied: 1, desired: 1, missing: null });
    expect(s.tone).toBe('info');
    expect(s.text).toContain('could not re-read');
  });

  it('an inactive zone explains that the slow step happens ONCE', () => {
    const s = autoDnsSummary({ zoneStatus: 'pending', applied: null });
    expect(s.text).toContain('only once');
  });
});

describe('missingFromZone — what is really there', () => {
  const want = [{ type: 'A', name: 'mitrify.com', value: '199.36.158.100' }];

  it('a present record is not missing (name trailing dot and case ignored)', () => {
    expect(missingFromZone(want, [{ type: 'a', name: 'MITRIFY.com.', value: '199.36.158.100' }])).toEqual([]);
  });

  it('TXT values compare unquoted — the API quotes them, the user was shown them bare', () => {
    const txt = [{ type: 'TXT', name: 'mitrify.com', value: 'hosting-site=nbai-37038f98' }];
    expect(missingFromZone(txt, [{ type: 'TXT', name: 'mitrify.com', value: '"hosting-site=nbai-37038f98"' }])).toEqual([]);
  });

  it('🔒 a PROXIED record counts as MISSING — it answers with the CDN address, not ours', () => {
    // The nastiest version of this failure: the zone looks correct to a human reading it, while the
    // hosting service's verification sweep sees a different value and waits forever.
    expect(missingFromZone(want, [{ type: 'A', name: 'mitrify.com', value: '199.36.158.100', proxied: true }])).toHaveLength(1);
  });

  it('an empty zone means everything is missing', () => {
    expect(missingFromZone(want, [])).toHaveLength(1);
  });
});

describe('statusIcon — a spinner is a promise that something is happening', () => {
  it('🔒 waiting on DNS is a CLOCK, never a spinner', () => {
    // ROOT CAUSE of "6hr se spinner ghum raha hai": the icon was chosen from the STAGE, so a pending
    // domain span forever while nothing was being requested. A spinner over a multi-hour wait makes a
    // normal wait look like a hang — and people believe the picture over the sentence beside it.
    expect(statusIcon({ tone: 'warn', checking: false })).toBe('waiting');
  });

  it('a real in-flight request IS a spinner — that is the one honest use', () => {
    expect(statusIcon({ tone: 'warn', checking: true })).toBe('busy');
    expect(statusIcon({ tone: 'ok', checking: true })).toBe('busy');
  });

  it('done is a tick', () => {
    expect(statusIcon({ tone: 'ok', checking: false })).toBe('done');
  });
});

describe('lastCheckedLabel — the honest replacement for fake motion', () => {
  const now = 1_700_000_000_000;
  it('says when we actually looked', () => {
    expect(lastCheckedLabel(now - 4 * 60_000, now)).toContain('Last checked');
  });
  it('says nothing when we never have', () => {
    expect(lastCheckedLabel(null, now)).toBe('');
    expect(lastCheckedLabel(0, now)).toBe('');
  });
});
