// The platform-wide daily ceiling on images the FREE tier gets from a PAID engine.
//
// PR #3234 recorded it as the next thing to build: a per-user cap (3/day) bounds one account, and at
// 10,000 users a bad hour at the free provider was 30,000 paid images with nothing to stop it — at a
// price the rate card does not carry. A COUNT, because a rupee figure would be invented; fails
// CLOSED, because opening paid rungs on a counter nobody can read is the unbounded bill itself.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IMAGE_FREE_PAID_DAILY_CAP_DEFAULT, imageFreePaidDailyCap, utcDay, decideFreePaid, FREE_PAID_CAP_MESSAGE,
} from '../src/server/lib/imageFreePaidBudget';

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const LEAKS = [/gemini/i, /grok/i, /pollinations/i, /vertex/i, /claude/i, /\d+ ?(images|a day)/i];

describe('the cap is read like every cap in this repo', () => {
  it('defaults to 300, and an UNREADABLE value falls back to the default — never to unlimited', () => {
    expect(imageFreePaidDailyCap(env({}))).toBe(IMAGE_FREE_PAID_DAILY_CAP_DEFAULT);
    expect(imageFreePaidDailyCap(env({ AI_IMAGE_FREE_PAID_DAILY_CAP: '20%' }))).toBe(IMAGE_FREE_PAID_DAILY_CAP_DEFAULT);
    expect(imageFreePaidDailyCap(env({ AI_IMAGE_FREE_PAID_DAILY_CAP: '-5' }))).toBe(IMAGE_FREE_PAID_DAILY_CAP_DEFAULT);
    expect(imageFreePaidDailyCap(env({ AI_IMAGE_FREE_PAID_DAILY_CAP: 'unlimited' }))).toBe(IMAGE_FREE_PAID_DAILY_CAP_DEFAULT);
  });

  it('a number is honoured, 0 means "never a paid engine for free users", and only the word off lifts it', () => {
    expect(imageFreePaidDailyCap(env({ AI_IMAGE_FREE_PAID_DAILY_CAP: ' 50 ' }))).toBe(50);
    expect(imageFreePaidDailyCap(env({ AI_IMAGE_FREE_PAID_DAILY_CAP: '0' }))).toBe(0);
    expect(imageFreePaidDailyCap(env({ AI_IMAGE_FREE_PAID_DAILY_CAP: 'OFF' }))).toBe(Number.POSITIVE_INFINITY);
  });

  it('the day is the SERVER clock in UTC', () => {
    expect(utcDay(Date.UTC(2026, 8, 21, 23, 59, 59))).toBe('2026-09-21');
    expect(utcDay(Date.UTC(2026, 8, 22, 0, 0, 1))).toBe('2026-09-22');
  });
});

describe('🔒 the decision', () => {
  it('allows under the cap, refuses at it', () => {
    expect(decideFreePaid(0, 300)).toEqual({ allow: true, used: 0, cap: 300 });
    expect(decideFreePaid(299, 300).allow).toBe(true);
    expect(decideFreePaid(300, 300)).toEqual({ allow: false, reason: 'cap-reached', used: 300, cap: 300 });
  });

  it('a cap of zero refuses before any read; an UNREADABLE counter refuses (fails closed)', () => {
    expect(decideFreePaid(null, 0)).toEqual({ allow: false, reason: 'cap-zero', used: 0, cap: 0 });
    expect(decideFreePaid(null, 300)).toEqual({ allow: false, reason: 'unreadable', used: 0, cap: 300 });
  });

  it('the refusal is branded, names no engine and no number', () => {
    for (const leak of LEAKS) expect(FREE_PAID_CAP_MESSAGE).not.toMatch(leak);
    expect(FREE_PAID_CAP_MESSAGE).toMatch(/NavBharatAI/);
    expect(FREE_PAID_CAP_MESSAGE).toMatch(/try again/);
  });
});

describe('🔒 SOURCE — one reader, after the user\'s own allowance, and the count moves on delivery', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/imageGen.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const free = route.slice(route.indexOf("app.post('/api/image/generate'"), route.indexOf("app.post(\n"));

  it('allowPaidRung asks the platform budget AFTER the per-user gate and BEFORE any paid rung', () => {
    const gateCall = free.indexOf("gateToolAction(account.uid, account.email, 'image')");
    const budget = free.indexOf('await imageFreePaidBudget.decide()');
    const firstPaid = Math.min(...['runImageEdit(', 'geminiImageConfigured() && !editing', 'grokImageKey()'].map((k) => free.indexOf(k)).filter((i) => i > 0));
    expect(gateCall).toBeGreaterThan(0);
    expect(budget).toBeGreaterThan(gateCall);
    expect(budget).toBeLessThan(firstPaid);
    expect(free).toMatch(/res\.status\(503\)\.json\(\{ error: FREE_PAID_CAP_MESSAGE, code: 'free_paid_cap' \}\)/);
  });

  it('the count is recorded inside deliver(), only for a PAID rung, never for the free provider', () => {
    const deliver = free.slice(free.indexOf('const deliver = ('), free.indexOf('let sawRefusal'));
    expect(deliver).toMatch(/if \(paidRung && gate && gate\.allow && !gate\.isFreeListed\) void imageFreePaidBudget\.record\(\);/);
    expect(free.split('imageFreePaidBudget.record(').length).toBe(2);
  });
});
