// Admin Home capture 2026-11-18: the Platform Load chip read "Nearly full" with 1/100 instances, CPU 22 % and
// 0 builds, because the only critical tile was "AI load: 25% unanswered" (3 of 12 requests). A rate is not a
// capacity — the chip names what is actually wrong.
import { describe, expect, it } from 'vitest';
import { chipWord } from '../src/components/admin/LoadBoard';

describe('a rate is not a fill level', () => {
  it('the real board: only the AI rate tile is critical → "Needs attention", never "Nearly full"', () => {
    expect(chipWord('critical', 2, 13, ['ai'])).toBe('Needs attention');
  });
  it('unrecovered money alone is not "Getting full"', () => {
    expect(chipWord('warn', 0, 13, ['money'])).toBe('Needs attention');
  });
  it('a capacity tile at the worst level keeps the fill word', () => {
    expect(chipWord('critical', 0, 13, ['ai', 'sandboxes'])).toBe('Nearly full');
    expect(chipWord('full', 0, 13, ['hosting'])).toBe('At the ceiling');
  });
  it('callers that pass no tiles keep today\'s words', () => {
    expect(chipWord('critical', 0, 13)).toBe('Nearly full');
    expect(chipWord('ok', 0, 13, [])).toBe('Room to spare');
  });
});
