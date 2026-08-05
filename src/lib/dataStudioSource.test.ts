import { describe, it, expect } from 'vitest';
import { studioState, renderCell, filterRows, pageSummary } from './dataStudioSource';

describe('studioState — the badge must never call sample rows live', () => {
  it('a connected account with a database is the real thing', () => {
    const s = studioState({ connected: true, hasDatabase: true });
    expect(s).toMatchObject({ source: 'live', isRealData: true });
    expect(s.hint).toBe('');
  });

  it('connected but no database yet says so, and says where to fix it', () => {
    // Connecting without provisioning is a real, common state. Telling that user "no database"
    // without the next step strands them one click away from the fix.
    const s = studioState({ connected: true, hasDatabase: false });
    expect(s.isRealData).toBe(false);
    expect(s.label).toBe('Sample data');
    expect(s.hint).toContain('Settings → Database');
    expect(s.hint).toContain('no database has been created yet');
  });

  it('not connected shows sample data and says plainly it is not theirs', () => {
    const s = studioState({ connected: false, hasDatabase: false });
    expect(s.isRealData).toBe(false);
    expect(s.hint).toContain('not your data');
  });

  it('never labels anything "Live" unless the data is genuinely the user\'s', () => {
    for (const opts of [{ connected: false, hasDatabase: false }, { connected: true, hasDatabase: false }, { connected: false, hasDatabase: true }]) {
      const s = studioState(opts);
      expect(s.isRealData).toBe(false);
      expect(s.label.toLowerCase()).not.toContain('live');
    }
  });
});

describe('renderCell — a data browser must not blur empty and "null"', () => {
  it('marks a genuinely empty value distinctly from the text "null"', () => {
    expect(renderCell(null)).toBe('—');
    expect(renderCell(undefined)).toBe('—');
    expect(renderCell('null')).toBe('null');
  });

  it('shows jsonb / array columns as JSON rather than [object Object]', () => {
    expect(renderCell({ a: 1 })).toBe('{"a":1}');
    expect(renderCell([1, 2])).toBe('[1,2]');
  });

  it('keeps falsy scalars visible — 0 and false are data, not emptiness', () => {
    expect(renderCell(0)).toBe('0');
    expect(renderCell(false)).toBe('false');
    expect(renderCell('')).toBe('');
  });

  it('survives a value that cannot be stringified', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(renderCell(cyclic)).toBe('[unreadable]');
  });
});

describe('filterRows', () => {
  const rows = [{ id: 1, name: 'Arjun' }, { id: 2, name: 'Priya' }];

  it('matches across every column, case-insensitively', () => {
    expect(filterRows(rows, 'priya')).toHaveLength(1);
    expect(filterRows(rows, '1')).toHaveLength(1);
  });

  it('an empty query keeps every row', () => {
    expect(filterRows(rows, '')).toHaveLength(2);
    expect(filterRows(rows, '   ')).toHaveLength(2);
  });

  it('does not throw on junk input', () => {
    expect(filterRows([], 'x')).toEqual([]);
    expect(filterRows(null as never, 'x')).toEqual([]);
  });
});

describe('pageSummary — the count is an estimate and says so', () => {
  it('says "about", because the number is the planner\'s estimate, not count(*)', () => {
    expect(pageSummary({ offset: 0, shown: 50, rowEstimate: 1200 })).toBe('Showing 1–50 of about 1,200');
  });

  it('drops the total rather than printing one it cannot stand behind', () => {
    // An estimate SMALLER than what we just displayed is visibly wrong — showing it would
    // undermine every other number on the screen.
    expect(pageSummary({ offset: 0, shown: 50, rowEstimate: 10 })).toBe('Showing 1–50');
    expect(pageSummary({ offset: 0, shown: 50, rowEstimate: null })).toBe('Showing 1–50');
    expect(pageSummary({ offset: 0, shown: 50 })).toBe('Showing 1–50');
  });

  it('counts from the offset on a later page', () => {
    expect(pageSummary({ offset: 50, shown: 50, rowEstimate: 1200 })).toBe('Showing 51–100 of about 1,200');
  });

  it('an empty page says so plainly', () => {
    expect(pageSummary({ offset: 0, shown: 0, rowEstimate: 0 })).toBe('No rows');
  });
});
