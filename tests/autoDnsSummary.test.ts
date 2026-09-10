import { describe, it, expect } from 'vitest';
import { autoDnsSummary, appliedCountsPhrase, statusIcon, lastCheckedLabel } from '../src/components/agentv3/NbaiDomainConnect';
import { missingFromZone } from '../src/server/lib/cloudflareManagedDns';

/**
 * THE SIX-HOUR SCREEN (admin 2026-08-22). A domain sat unconnected for an afternoon while the screen
 * showed a spinning loader and the sentence "Nameservers live — 0 records applied automatically".
 * Both were misleading, and between them they hid an answer the server already had.
 */

describe('autoDnsSummary — a count of actions is not a statement of fact', () => {
  it('🔒 "0 added, 0 removed" with nothing missing is SUCCESS, and must read as success', () => {
    // THE ORIGINAL BUG. The combined `applied` count was 0 exactly as often for "already correct" as
    // for "nothing written". The old line printed the same words for both, and the admin read the
    // success case as a failure — correctly, given the wording.
    const s = autoDnsSummary({ zoneStatus: 'active', added: 0, removed: 0, desired: 2, missing: [] });
    expect(s.tone).toBe('ok');
    expect(s.text).toContain('already in place');
    expect(s.text).not.toContain('0 record');
  });

  it('records genuinely missing is the ONLY case that warns, and it names them', () => {
    const s = autoDnsSummary({ zoneStatus: 'active', added: 0, removed: 0, desired: 2, missing: [{ type: 'A', name: 'mitrify.com' }] });
    expect(s.tone).toBe('warn');
    expect(s.text).toContain('A mitrify.com');
  });

  it('a successful write with everything verified reports both facts', () => {
    const s = autoDnsSummary({ zoneStatus: 'active', added: 2, removed: 0, desired: 2, missing: [] });
    expect(s.tone).toBe('ok');
    expect(s.text).toContain('we added 2');
  });

  /**
   * 🔒 THE ADMIN'S OWN SCREENSHOT, LITERALLY (2026-09-02): "Done — all 1 record are now in place (we
   * added 2)." One desired TXT record was written; one FOREIGN ownership token from a different app
   * was deleted as cleanup. The old single `applied` count summed both into "2", printed beside "all
   * 1 record" — a number contradicting the sentence it was in.
   *
   * `added` and `removed` now travel separately, and `added` can never exceed `desired` at the source
   * (`cloudflareManagedDns.ts`'s `ApplyRecordsResult`), so this exact contradiction cannot recur.
   */
  it('🔒 "we added 2" beside "all 1 record" can no longer happen — added and removed are told apart', () => {
    const s = autoDnsSummary({ zoneStatus: 'active', added: 1, removed: 1, desired: 1, missing: [] });
    expect(s.tone).toBe('ok');
    expect(s.text).toContain('all 1 record is now in place');
    expect(s.text).toContain('we added 1 and removed 1 unrelated record that belonged to a different app');
    // The self-contradiction, verified absent: "added" is never printed with a number exceeding "desired".
    expect(s.text).not.toMatch(/we added [2-9]/);
  });

  it('grammar agrees with the count — "record is", not "record are"', () => {
    const singular = autoDnsSummary({ zoneStatus: 'active', added: 1, removed: 0, desired: 1, missing: [] });
    expect(singular.text).toContain('all 1 record is now in place');
    const plural = autoDnsSummary({ zoneStatus: 'active', added: 2, removed: 0, desired: 2, missing: [] });
    expect(plural.text).toContain('all 2 records are now in place');
  });

  it('a missing/null desired count says "your records", never a blank or a literal 0', () => {
    const s = autoDnsSummary({ zoneStatus: 'active', added: 1, removed: 0, desired: null, missing: [] });
    expect(s.text).toContain('your records are now in place');
    expect(s.text).not.toContain('all  record'); // the old double-space-collapse hack this replaces
    expect(s.text).not.toContain('all 0 record');
  });

  it('a cleanup-only sync (0 added, something removed) is still reported, not silently zero', () => {
    const s = autoDnsSummary({ zoneStatus: 'active', added: 0, removed: 1, desired: 0, missing: [] });
    expect(s.tone).toBe('ok');
    expect(s.text).toContain('we removed 1 unrelated record that belonged to a different app');
    expect(s.text).not.toContain('we added');
  });

  it('🔒 an unreadable zone claims NEITHER verdict', () => {
    // Guessing "fine" strands a broken domain; guessing "broken" sends the user to re-add records
    // that are already correct. The honest answer is that we could not look.
    const s = autoDnsSummary({ zoneStatus: 'active', added: 1, removed: 0, desired: 1, missing: null });
    expect(s.tone).toBe('info');
    expect(s.text).toContain('could not re-read');
    expect(s.text).toContain('1 record written');
  });

  it('the unreadable-zone branch also separates written from removed', () => {
    const s = autoDnsSummary({ zoneStatus: 'active', added: 1, removed: 1, desired: 1, missing: null });
    expect(s.text).toContain('1 record written');
    expect(s.text).toContain('1 unrelated record removed');
  });

  it('an inactive zone explains that the slow step happens ONCE', () => {
    const s = autoDnsSummary({ zoneStatus: 'pending', added: null });
    expect(s.text).toContain('only once');
  });
});

describe('appliedCountsPhrase — the split that ends the self-contradiction', () => {
  it('nothing happened → nothing said', () => {
    expect(appliedCountsPhrase(0, 0)).toBe('');
  });
  it('added only', () => {
    expect(appliedCountsPhrase(3, 0)).toBe(' (we added 3)');
  });
  it('removed only, correctly pluralised', () => {
    expect(appliedCountsPhrase(0, 1)).toBe(' (we removed 1 unrelated record that belonged to a different app)');
    expect(appliedCountsPhrase(0, 2)).toBe(' (we removed 2 unrelated records that belonged to a different app)');
  });
  it('both — the exact admin scenario', () => {
    expect(appliedCountsPhrase(1, 1)).toBe(' (we added 1 and removed 1 unrelated record that belonged to a different app)');
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

/**
 * DNS FINISHED IS NOT "NOTHING LEFT TO DO" (admin 2026-09-04, *"bahut sari problem hai"*).
 *
 * The screenshot showed every record verified, ownership ACTIVE, and this line printing *"Done —
 * every record is already in place. Nothing left for you to do; your domain connects on its own from
 * here."* — while mitrify.com served "Site Not Found" and always would, because a fullstack
 * ship-whole app cannot be published to that site at all.
 *
 * This is the SAME lesson the function already learned for `ownershipState`, one level up: records
 * existing said nothing about the host accepting them; the host accepting them says nothing about
 * whether the app can ever be SERVED.
 */
describe('🔒 the DNS summary cannot promise an outcome publishing has already ruled out', () => {
  const settled = { zoneStatus: 'active' as const, desired: 3, missing: [], ownershipState: 'OWNERSHIP_ACTIVE' };
  const BLOCK = 'Your app has a server half that runs alongside its website…';

  it('withdraws "nothing left for you to do" when the app cannot be published here', () => {
    const s = autoDnsSummary({ ...settled, added: 0, removed: 0, publishBlocked: BLOCK });
    expect(s.text).not.toContain('Nothing left for you to do');
    expect(s.text).not.toContain('connects on its own');
    expect(s.text).toContain(BLOCK);          // the real blocker, verbatim
    expect(s.tone).toBe('warn');
  });

  it('still says the DNS half is genuinely finished — that part IS true', () => {
    // Understating it would send the user back to re-check records that are already perfect.
    const s = autoDnsSummary({ ...settled, added: 0, removed: 0, publishBlocked: BLOCK });
    expect(s.text).toContain('fully set up');
  });

  it('🔒 covers the just-applied path too, not only the already-in-place one', () => {
    // Both completion branches made the same promise; a fix to one would have left the other lying.
    const s = autoDnsSummary({ ...settled, added: 2, removed: 1, publishBlocked: BLOCK });
    expect(s.text).not.toContain('Nothing left for you to do');
    expect(s.text).toContain(BLOCK);
  });

  it('an unblocked app is completely unaffected', () => {
    for (const blocked of ['', '   ', null, undefined]) {
      const s = autoDnsSummary({ ...settled, added: 0, removed: 0, publishBlocked: blocked });
      expect(s.tone).toBe('ok');
      expect(s.text).toContain('Nothing left for you to do');
    }
  });
});
