/**
 * The Build Engines chips count TODAY, and tapping one shows its days (admin 2026-11-25). Render half; imports no server code.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EngineChain, EngineDayDetail } from './BuildEngineHealth';
import { engineDaysOf } from '../../lib/engineDays';

const body = { engineDays: { reasonText: { no_sellers_for_model: 'Surplus had no seller for this model at that moment, so this model was skipped and another tried.' }, days: [
  { day: '2026-11-25', engines: [
    { engine: 'SURPLUS', builds: 3, answered: 30, failed: 18, timedAnswers: 20, avgAnswerMs: 31_000, reasons: { no_sellers_for_model: 9, minimum_discount_not_met: 9 }, carriedBy: { ENGINE_R1: 14 } },
    { engine: 'ENGINE_R1', builds: 3, answered: 106, failed: 0, timedAnswers: 100, avgAnswerMs: 4363, reasons: {}, carriedBy: {} },
  ] },
  { day: '2026-11-24', engines: [{ engine: 'SURPLUS', builds: 6, answered: 76, failed: 40, timedAnswers: 0, avgAnswerMs: null, reasons: {}, carriedBy: {} }] },
] } };
const days = engineDaysOf(body)!;
const chain = [{ name: 'SURPLUS', model: null }, { name: 'ENGINE_R1', model: 'deepseek-v4.1-flash' }];
const names = { SURPLUS: 'Surplus', ENGINE_R1: 'Router One' };

describe('🔴 the chip says what failed TODAY, not a rolling window', () => {
  it('"18 failed today" and "OK today", and each chip is a button', () => {
    const html = renderToStaticMarkup(<EngineChain chain={chain} health={null} names={names} days={days} onPick={() => {}} />);
    expect(html).toContain('18 failed today');
    expect(html).toContain('OK today');
    expect(html).not.toMatch(/\d+ failed</);
    expect(html).toMatch(/<button[^>]*data-testid="engine-chip-SURPLUS"/);
  });
});

describe('tap an engine: its days', () => {
  const html = renderToStaticMarkup(<EngineDayDetail engine="SURPLUS" days={days} names={names} />);
  it('requests, answered, failed and average time per day', () => {
    expect(html).toContain('2026-11-25');
    expect(html).toMatch(/<td>48<\/td>/);
    expect(html).toContain('31 s');
    expect(html).toContain('2026-11-24');
    expect(html).toMatch(/<td>116<\/td>/);
  });
  it('why it failed, in words, and what the fallback did', () => {
    expect(html).toContain('9× Surplus had no seller for this model');
    expect(html).toContain('(minimum_discount_not_met)'); // an unknown code is shown as written, never dropped
    expect(html).toContain('Router One answered 14 turns instead.');
  });
  it('an unreadable day list is never "nothing ran"', () => {
    const unread = renderToStaticMarkup(<EngineDayDetail engine="SURPLUS" days={{ days: null, reasonText: {} }} names={names} />);
    expect(unread).toContain('could not be read');
    expect(unread).not.toContain('<table');
  });
});

describe('the server body is checked where it enters', () => {
  it('a malformed row is dropped, a missing list is "could not read", an older server is undefined', () => {
    expect(engineDaysOf({ engineDays: { days: [{ day: 'd', engines: [{ engine: 3 }, { engine: 'X', answered: 2, failed: 'x' }] }] } })!.days![0].engines)
      .toEqual([expect.objectContaining({ engine: 'X', requests: 2, failed: 0 })]);
    expect(engineDaysOf({ engineDays: { days: 'no' } })!.days).toBeNull();
    expect(engineDaysOf({})).toBeUndefined();
  });
});
