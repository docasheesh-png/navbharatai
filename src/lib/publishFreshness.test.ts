import { describe, it, expect } from 'vitest';
import { publishFreshness, timeAgo, needsPublishDot } from './publishFreshness';

/**
 * ADMIN, 2026-08-21: "yahi (Visit se pahle) par ek button banao — Publish. Is publish se app edit
 * karne ke bad wapas publish ki jayegi."
 *
 * The button answers "how do I republish". These tests pin the half that actually keeps public sites
 * current: telling the user their live site is BEHIND their app. The signal must be real or silent —
 * a wrong "you have unpublished changes" would send people to re-publish an already-current site
 * forever, and a wrong "up to date" would leave a stale site up while promising it is not.
 */
describe('publishFreshness', () => {
  it('nothing live yet ⇒ publishing IS the missing step', () => {
    expect(publishFreshness({ live: false })).toBe('never_published');
    // Even with timestamps lying around: not live means not published, whatever the record says.
    expect(publishFreshness({ live: false, publishedAt: 100, filesSavedAt: 50 })).toBe('never_published');
  });

  it('THE CASE THAT STARTED THIS: edited after publishing ⇒ the live site is behind', () => {
    expect(publishFreshness({ live: true, publishedAt: 1_000, filesSavedAt: 2_000 })).toBe('changed');
  });

  it('published after the last edit ⇒ what visitors see is current', () => {
    expect(publishFreshness({ live: true, publishedAt: 2_000, filesSavedAt: 1_000 })).toBe('up_to_date');
  });

  it('SAME millisecond is up-to-date, not stale', () => {
    // A build saves its files and then publishes them. If a fast build lands both in one millisecond,
    // calling that "changed" would flag every quick build as needing a republish it does not need.
    expect(publishFreshness({ live: true, publishedAt: 5_000, filesSavedAt: 5_000 })).toBe('up_to_date');
  });

  it('🔒 a missing timestamp is UNKNOWN — never guessed in either direction', () => {
    // An older deployment record, or a workspace doc we could not read. The UI says nothing about
    // staleness here; inventing an answer is the exact dishonesty this module exists to avoid.
    expect(publishFreshness({ live: true, publishedAt: 1_000 })).toBe('unknown');
    expect(publishFreshness({ live: true, filesSavedAt: 1_000 })).toBe('unknown');
    expect(publishFreshness({ live: true })).toBe('unknown');
  });

  it('rejects junk timestamps rather than comparing them', () => {
    expect(publishFreshness({ live: true, publishedAt: 0, filesSavedAt: 1_000 })).toBe('unknown');
    expect(publishFreshness({ live: true, publishedAt: NaN, filesSavedAt: 1_000 })).toBe('unknown');
    expect(publishFreshness({ live: true, publishedAt: -5, filesSavedAt: 1_000 })).toBe('unknown');
  });
});

describe('timeAgo', () => {
  const now = 1_000_000_000;
  const ago = (ms: number) => timeAgo(now - ms, now);

  it('never says "0 minutes ago"', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(59_000)).toBe('just now');
  });

  it('counts in whole units and gets the singular right', () => {
    expect(ago(60_000)).toBe('1 minute ago');
    expect(ago(4 * 60_000)).toBe('4 minutes ago');
    expect(ago(60 * 60_000)).toBe('1 hour ago');
    expect(ago(5 * 60 * 60_000)).toBe('5 hours ago');
    expect(ago(24 * 60 * 60_000)).toBe('1 day ago');
    expect(ago(40 * 24 * 60 * 60_000)).toBe('1 month ago');
  });

  it('a FUTURE timestamp degrades to "just now", never a negative count', () => {
    // Two independent writes can land out of order by a few ms; "in -2 minutes" would look broken.
    expect(timeAgo(now + 10_000, now)).toBe('just now');
  });
});

/**
 * ADMIN, 2026-08-21: "aur edit karte hai, ek red dot ana chahiye — publish (*) → connect your own
 * domain (*) → publish (green)(*)."
 *
 * One rule, asked by all three surfaces, so the trail can never disagree with itself: a dot on the
 * outer button that leads to an inner screen saying everything is fine is worse than no dot at all.
 */
describe('needsPublishDot — the red dot means published-then-changed, nothing else', () => {
  it('shows for the one case it is for', () => {
    expect(needsPublishDot('changed')).toBe(true);
  });

  it('🔒 NOT for never-published — a dot that never clears is a dot people stop seeing', () => {
    // An app the user has not chosen to publish is not a problem to nag about, and nagging it
    // permanently would cost us the one case the dot exists for.
    expect(needsPublishDot('never_published')).toBe(false);
  });

  it('not when the live site is current, and not when we could not measure', () => {
    expect(needsPublishDot('up_to_date')).toBe(false);
    expect(needsPublishDot('unknown')).toBe(false);      // a dot is a claim; we do not guess claims
    expect(needsPublishDot(undefined)).toBe(false);      // older server / still loading
    expect(needsPublishDot(null)).toBe(false);
  });
});
