// THE ADMIN'S TAB BAR — "kaha kaam abhi karna hai" (admin 2026-09-17).
//
// Nine tabs, nothing on them saying which one was on fire, so the admin opened each page in turn to
// find out. The counters answer that at a glance.
//
// 🔴 EVERY TEST HERE EXISTS FOR ONE RULE: **`null` IS NOT `0`.** On this bar a zero is a promise —
// "I looked, and there is no work here" — and the admin acts on it by NOT opening the page. Every
// source behind these numbers can fail (a Firestore read, a Google API, an instance that just
// booted), and a failure that silently became a calm zero would be the second absolute rule's
// forbidden state: a status indicator that does not reflect real state.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatBadge, badgeNeedsAttention, badgesFromPayload, groupIndian, NO_BADGE, BADGE_HINTS,
} from '../src/lib/adminTabBadges';

describe('🔴 an unmeasured badge renders NOTHING — never a zero', () => {
  it('a null value renders no badge at all', () => {
    expect(formatBadge({ value: null, tone: 'attention' })).toBeNull();
    expect(formatBadge(NO_BADGE)).toBeNull();
    expect(formatBadge(null)).toBeNull();
    expect(formatBadge(undefined)).toBeNull();
  });

  it('a MEASURED zero still renders — "I looked and there is nothing" is real news', () => {
    expect(formatBadge({ value: 0, tone: 'attention' })).toBe('0');
  });

  it('a NaN or an Infinity is unmeasured, not a number', () => {
    expect(formatBadge({ value: NaN, tone: 'neutral' })).toBeNull();
    expect(formatBadge({ value: Infinity, tone: 'neutral' })).toBeNull();
  });

  it('a whole unreadable payload leaves every badge blank', () => {
    for (const b of Object.values(badgesFromPayload({}))) expect(formatBadge(b)).toBeNull();
    for (const b of Object.values(badgesFromPayload(null))) expect(formatBadge(b)).toBeNull();
    // An older server mid-deploy that knows nothing about this route answers with junk, and the bar
    // must look exactly as it does today rather than throw or invent.
    for (const b of Object.values(badgesFromPayload('not json'))) expect(formatBadge(b)).toBeNull();
    for (const b of Object.values(badgesFromPayload({ users: 'broken' }))) expect(formatBadge(b)).toBeNull();
  });
});

describe('the pair — and the half that survives when the other cannot be read', () => {
  it('renders as value/total', () => {
    expect(formatBadge({ value: 54, of: 1538, tone: 'neutral' })).toBe('54/1538');
  });

  it('⚠️ an unmeasured TOTAL still shows the numerator', () => {
    // "54 people came today" answers the admin's question on its own. Withholding it because the
    // lifetime total failed to load would throw away the half that matters.
    expect(formatBadge({ value: 54, of: null, tone: 'neutral' })).toBe('54');
    expect(formatBadge({ value: 54, tone: 'neutral' })).toBe('54');
  });

  it('…but a denominator ALONE says nothing about today, so it shows nothing', () => {
    expect(formatBadge({ value: null, of: 1538, tone: 'neutral' })).toBeNull();
  });

  it('money reads in rupees, grouped the Indian way', () => {
    expect(formatBadge({ value: 350, of: 8575, tone: 'neutral', money: true })).toBe('₹350/₹8,575');
    expect(groupIndian(100000)).toBe('1,00,000');
    expect(groupIndian(12345678)).toBe('1,23,45,678');
    expect(groupIndian(999)).toBe('999');
    expect(groupIndian(0)).toBe('0');
  });
});

describe('colour means WORK IS WAITING, and nothing else', () => {
  it('an attention badge above zero is hot', () => {
    expect(badgeNeedsAttention({ value: 4, tone: 'attention' })).toBe(true);
  });

  it('🔒 zero work waiting is NOT hot — colouring it would train the admin to ignore colour', () => {
    expect(badgeNeedsAttention({ value: 0, tone: 'attention' })).toBe(false);
  });

  it('healthy activity is never hot however large', () => {
    expect(badgeNeedsAttention({ value: 99999, tone: 'neutral' })).toBe(false);
  });

  it('an unmeasured badge is never hot', () => {
    expect(badgeNeedsAttention({ value: null, tone: 'attention' })).toBe(false);
    expect(badgeNeedsAttention(null)).toBe(false);
  });
});

describe('the payload mapping matches what the server sends', () => {
  const payload = {
    monitor: { needsAttention: 4 },
    users: { activeToday: 54, total: 1538 },
    engines: { usedToday: 5, configured: 9 },
    revenue: { todayInr: 350, totalInr: 8575 },
    reports: { unopened: 2, open: 7 },
    userreports: { unopened: 1, open: 3 },
    apkreports: { unopened: 0, open: 6 },
  };

  it('renders exactly the examples the admin asked for', () => {
    const b = badgesFromPayload(payload);
    expect(formatBadge(b.monitor)).toBe('4');
    expect(formatBadge(b.users)).toBe('54/1538');
    expect(formatBadge(b.engines)).toBe('5/9');
    expect(formatBadge(b.revenue)).toBe('₹350/₹8,575');
    expect(formatBadge(b.reports)).toBe('2/7');
    expect(formatBadge(b.userreports)).toBe('1/3');
    expect(formatBadge(b.apkreports)).toBe('0/6');
  });

  it('the to-do badges are hot and the activity badges are not', () => {
    const b = badgesFromPayload(payload);
    expect(badgeNeedsAttention(b.monitor)).toBe(true);
    expect(badgeNeedsAttention(b.reports)).toBe(true);
    expect(badgeNeedsAttention(b.userreports)).toBe(true);
    expect(badgeNeedsAttention(b.apkreports)).toBe(false); // 0 unopened — genuinely nothing waiting
    expect(badgeNeedsAttention(b.users)).toBe(false);
    expect(badgeNeedsAttention(b.engines)).toBe(false);
    expect(badgeNeedsAttention(b.revenue)).toBe(false);
  });

  it('a partially-readable payload badges only the halves that were measured', () => {
    // The server guards each source separately, so this is the shape a real Firestore hiccup sends.
    const b = badgesFromPayload({ users: { activeToday: 54 }, reports: { open: 7 } });
    expect(formatBadge(b.users)).toBe('54');
    expect(formatBadge(b.reports)).toBeNull(); // no unopened count ⇒ nothing to claim
    expect(formatBadge(b.revenue)).toBeNull();
  });

  it('every badge carries a sentence saying what its two numbers mean', () => {
    for (const key of Object.keys(badgesFromPayload(payload))) {
      expect((BADGE_HINTS as Record<string, string>)[key]).toBeTruthy();
    }
  });
});

describe('the wiring — the bar reads the pure rule, and cannot invent a zero on a failed fetch', () => {
  const dash = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');

  it('the tab bar renders through formatBadge, not by reading the payload itself', () => {
    expect(dash).toContain('const text = formatBadge(badge);');
    expect(dash).toContain('badgeNeedsAttention(badge)');
  });

  it('🔒 a FAILED fetch sets null, never an empty-payload set of measured-nothing badges', () => {
    const start = dash.indexOf('const fetchTabBadges =');
    expect(start).toBeGreaterThan(0);
    // ⚠️ COMMENTS STRIPPED FIRST. The guard's own comment explains why `badgesFromPayload({})` is
    // wrong here, and an assertion that cannot tell an explanation from the code it warns against
    // fails on the very comment that documents it — which is how a test starts punishing clarity.
    const block = dash.slice(start, dash.indexOf('}, [adminToken]);', start))
      .replace(/\/\/.*$/gm, '');
    expect(block).toContain('setTabBadges(null)');
    expect(block).not.toContain('badgesFromPayload({})');
  });

  it('the bar loads once for the whole dashboard, not per tab', () => {
    // The point is seeing where the work is WITHOUT opening anything; a badge that appeared only
    // after you visited the page would answer a question nobody has.
    expect(dash).toContain('useEffect(() => { void fetchTabBadges(); }, [fetchTabBadges]);');
  });
});
