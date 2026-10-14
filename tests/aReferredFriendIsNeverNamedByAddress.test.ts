import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { referralFriendLabel } from '../src/server/lib/referralFriendLabel';

/**
 * A REFERRER SEES HOW FAR A FRIEND HAS GOT — NEVER THE FRIEND'S ADDRESS (wallet redesign, 2026-10-14).
 *
 * The CLASS: a list that shows OTHER people's contact details to a user who is only entitled to know
 * their progress. The instance was `/api/referral/:userId/referred` sending `email`. The label is the
 * only identifier now, and the property that matters is that the address can NEVER be recovered from it
 * — including for the short names where the platform's self-view mask (`maskEmail`) would print it whole.
 */
describe('referralFriendLabel', () => {
  it('hides everything of a one- or two-letter name (maskEmail would print the whole address)', () => {
    expect(referralFriendLabel('b@mail.com')).toBe('•@mail.com');
    expect(referralFriendLabel('ab@mail.com')).toBe('••@mail.com');
  });

  it('reveals at most two characters, and never more than a third of the name', () => {
    expect(referralFriendLabel('abc@mail.com')).toBe('a••@mail.com');
    expect(referralFriendLabel('friend.b@mail.com')).toBe('fr••••••@mail.com');
    expect(referralFriendLabel('a.very.long.name@mail.com')).toBe('a.••••••••••••••@mail.com');
  });

  it('keeps the length honest and the domain (a friend’s provider is not who they are)', () => {
    const l = referralFriendLabel('someone@example.org');
    expect(l.endsWith('@example.org')).toBe(true);
    expect(l.split('@')[0]).toHaveLength('someone'.length);
  });

  it('names an unreadable account "A friend", never blank and never the raw value', () => {
    for (const bad of ['', '   ', null, undefined, 'no-at-sign', '@nodomain.com', 'name@']) {
      expect(referralFriendLabel(bad as string | null | undefined)).toBe('A friend');
    }
  });

  it('is never the address, for any name length', () => {
    for (let n = 1; n <= 12; n++) {
      const email = `${'x'.repeat(n)}@mail.com`;
      expect(referralFriendLabel(email)).not.toBe(email);
    }
  });
});

describe('the referred route and its consumers', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('the route answers with `label` and no `email` field', () => {
    const route = read('src/server/routes/referral.ts');
    const at = route.indexOf("'/api/referral/:userId/referred'");
    const body = route.slice(at, route.indexOf("'/api/referral/:userId/redeem'", at));
    expect(body).toContain('label: referralFriendLabel(contact.email)');
    expect(body).not.toMatch(/^\s*email:\s*contact\.email/m);
  });

  it('both screens that list friends read the label, not an address', () => {
    expect(read('src/components/ReferralEarningsSheet.tsx')).not.toMatch(/f\.email\b/);
    expect(read('src/lib/referredFriendsView.ts')).not.toMatch(/raw\.email\b/);
  });
});
