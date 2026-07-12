import { describe, it, expect } from 'vitest';
import { recencyDirective } from './prompts';

describe('recencyDirective — anchors chat replies to TODAY (no stale-as-current answers)', () => {
  it('embeds the given date, formatted for India', () => {
    // A fixed instant so the assertion is deterministic (2026-07-12 is a Sunday).
    const out = recencyDirective(new Date('2026-07-12T06:00:00Z'));
    expect(out).toContain('2026');
    expect(out).toContain('July');
    expect(out).toContain('12');
    // It states "today" and the India anchor.
    expect(out).toMatch(/Today's date is/i);
    expect(out).toContain('(India)');
  });

  it('instructs the model NOT to present old data as current, and to be honest about recency', () => {
    const out = recencyDirective(new Date('2026-07-12T06:00:00Z'));
    expect(out).toMatch(/OUTDATED/);
    expect(out).toMatch(/DO NOT state old information as if it is the present/i);
    expect(out).toMatch(/verify the very latest/i);
    // Names the time-sensitive classes the admin hit (sports/squads) so the model recognises them.
    expect(out.toLowerCase()).toContain('sport');
    expect(out.toLowerCase()).toContain('squad');
  });

  it('is a non-empty directive block regardless of the date passed', () => {
    expect(recencyDirective(new Date('2020-01-01T00:00:00Z')).length).toBeGreaterThan(100);
    expect(recencyDirective()).toContain("Today's date is");
  });
});
