/**
 * Server-log rows carry a DATE once the list crosses midnight (admin Monitor capture, 2026-09-14).
 * The 40 newest rows ran 13:22 → 07:54 → 01:11 → 23:04 → 22:36 with nothing saying which day was which.
 */
import { describe, it, expect } from 'vitest';
import { logEntriesSpanDays, logStamp } from '../src/components/admin/MonitorPanels';

const at = (iso: string) => new Date(iso).getTime();

describe('logEntriesSpanDays', () => {
  it('is false within one calendar day', () => {
    expect(logEntriesSpanDays([{ ts: at('2026-09-14T13:22:03') }, { ts: at('2026-09-14T07:54:16') }])).toBe(false);
  });
  it('is true the moment two entries fall on different days — the capture that found this', () => {
    expect(logEntriesSpanDays([{ ts: at('2026-09-14T01:11:46') }, { ts: at('2026-09-13T23:04:35') }])).toBe(true);
  });
  it('ignores entries without a usable timestamp, and an empty/null list spans nothing', () => {
    expect(logEntriesSpanDays([{ ts: undefined }, { ts: Number.NaN }, { ts: at('2026-09-14T10:00:00') }])).toBe(false);
    expect(logEntriesSpanDays(null)).toBe(false);
    expect(logEntriesSpanDays([])).toBe(false);
  });
});

describe('logStamp', () => {
  it('shows the time alone when the list does not span days', () => {
    expect(logStamp(at('2026-09-14T13:22:03'), false)).toBe('13:22:03');
  });
  it('prefixes the day once the list spans days', () => {
    const s = logStamp(at('2026-09-13T23:04:35'), true);
    expect(s).toMatch(/13 Sept? 23:04:35$/);
  });
  it('a missing timestamp is a placeholder, never "Invalid Date"', () => {
    expect(logStamp(undefined, true)).toBe('--:--:--');
    expect(logStamp(Number.NaN, false)).toBe('--:--:--');
  });
});
