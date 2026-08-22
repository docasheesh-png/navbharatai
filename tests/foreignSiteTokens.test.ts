import { describe, it, expect } from 'vitest';
import { isForeignSiteToken, dropForeignSiteTokens, mergeStableRecords } from '../src/server/lib/domainDnsRecords';
import { recordBadge } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * THE mitrify.com SCREENSHOT (admin 2026-08-22). One domain, three apps, and a screen that told the
 * user to add records belonging to apps they were not looking at — then badged two of them "Verified"
 * although nothing had ever verified them.
 *
 * The real values from that screenshot are used verbatim, because the point of a regression test is
 * to encode the failure that actually happened.
 */

const THIS_SITE = 'nbai-37038f98f790b362308d';
const OTHER_A = 'nbai-709e5932ecaaf74b9c63';
const OTHER_B = 'nbai-dd4fe67881426b5f258a';

const tok = (site: string) => ({ type: 'TXT', name: 'mitrify.com', value: `hosting-site=${site}` });
const A_RECORD = { type: 'A', name: 'mitrify.com', value: '199.36.158.100' };
const ACME = { type: 'TXT', name: '_acme-challenge', value: 'y7xukjntdfGt5_a1CCdUm9f6EVYhhG6JQDgnOg3asi8' };

describe('isForeignSiteToken — whose ownership token is this', () => {
  it('another app’s token is foreign', () => {
    expect(isForeignSiteToken(`hosting-site=${OTHER_A}`, THIS_SITE)).toBe(true);
  });

  it('this app’s own token is NOT foreign', () => {
    expect(isForeignSiteToken(`hosting-site=${THIS_SITE}`, THIS_SITE)).toBe(false);
  });

  it('🔒 anything it cannot positively identify is KEPT', () => {
    // The failure mode to fear is the opposite one: hiding the single record the user must add.
    // So every uncertain case keeps the record — a non-token, an unparseable token, no site id.
    expect(isForeignSiteToken('199.36.158.100', THIS_SITE)).toBe(false);
    expect(isForeignSiteToken('hosting-site=', THIS_SITE)).toBe(false);
    expect(isForeignSiteToken(`hosting-site=${OTHER_A}`, '')).toBe(false);
    expect(isForeignSiteToken(undefined, THIS_SITE)).toBe(false);
  });

  it('quotes and case do not fool it — the API quotes TXT values', () => {
    expect(isForeignSiteToken(`"hosting-site=${OTHER_A}"`, THIS_SITE)).toBe(true);
    expect(isForeignSiteToken(`HOSTING-SITE=${THIS_SITE.toUpperCase()}`, THIS_SITE)).toBe(false);
  });
});

describe('dropForeignSiteTokens — the mitrify.com list, cleaned', () => {
  it('keeps this app’s records and drops the two that belong elsewhere', () => {
    const stored = [tok(THIS_SITE), tok(OTHER_A), ACME, tok(OTHER_B), A_RECORD];
    const kept = dropForeignSiteTokens(stored, THIS_SITE);
    expect(kept).toHaveLength(3);
    expect(kept.map((r) => r.value)).toEqual([`hosting-site=${THIS_SITE}`, ACME.value, A_RECORD.value]);
  });

  it('🔒 never drops a NON-token record, whatever the site id', () => {
    expect(dropForeignSiteTokens([A_RECORD, ACME], THIS_SITE)).toHaveLength(2);
  });

  it('with no site id known, the list is untouched', () => {
    const stored = [tok(THIS_SITE), tok(OTHER_A)];
    expect(dropForeignSiteTokens(stored, '')).toHaveLength(2);
  });
});

describe('the whole path: filter then merge — what the screen would now show', () => {
  it('the foreign tokens are gone, and the app’s own pending records still say pending', () => {
    // The exact situation in the screenshot: 5 stored, 2 genuinely still needed for THIS app.
    const stored = [tok(THIS_SITE), tok(OTHER_A), ACME, tok(OTHER_B), A_RECORD];
    const pending = [A_RECORD, tok(THIS_SITE)];
    const rows = mergeStableRecords(dropForeignSiteTokens(stored, THIS_SITE), pending);

    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.value.includes(OTHER_A))).toBe(false);
    expect(rows.some((r) => r.value.includes(OTHER_B))).toBe(false);
    // Still-needed first, and the ACME the service stopped asking for is the only finished one.
    expect(rows.filter((r) => !r.done).map((r) => r.type)).toEqual(['A', 'TXT']);
    expect(rows.filter((r) => r.done).map((r) => r.value)).toEqual([ACME.value]);
  });
});

describe('recordBadge — "Verified" is a claim, not a synonym for "finished"', () => {
  const seenCheck = { checks: [{ type: 'TXT', name: '_acme-challenge', expected: ACME.value, seen: true }] };

  it('a record our resolver actually saw is Verified', () => {
    expect(recordBadge(ACME, seenCheck)).toBe('Verified');
  });

  it('🔒 a record nothing looked at is "Added", never "Verified"', () => {
    // This is the exact overclaim from the screenshot: not-currently-requested was rendered as
    // confirmed-working. Absent evidence, the honest word is the weaker one.
    expect(recordBadge(A_RECORD, seenCheck)).toBe('Added');
    expect(recordBadge(ACME, null)).toBe('Added');
    expect(recordBadge(ACME, { checks: [] })).toBe('Added');
  });

  it('a record our resolver looked for and did NOT see is not Verified either', () => {
    expect(recordBadge(ACME, { checks: [{ type: 'TXT', name: '_acme-challenge', expected: ACME.value, seen: false }] })).toBe('Added');
  });

  it('matching survives quoting and a trailing dot', () => {
    expect(recordBadge(ACME, { checks: [{ type: 'txt', name: '_acme-challenge.', expected: `"${ACME.value}"`, seen: true }] })).toBe('Verified');
  });
});
