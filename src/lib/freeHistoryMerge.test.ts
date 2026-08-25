import { describe, it, expect } from 'vitest';
import { professionalRows, sortMergedRows } from './freeHistoryMerge';

const NOW = 1_760_000_000_000;

describe('freeHistoryMerge — one tagged list for the FREE surface', () => {
  it('an archived conversation carries its real end time; a live one carries NONE', () => {
    const rows = professionalRows([
      { id: 'teacher_ai', name: 'Teacher AI', preview: 'photosynthesis…', endedAt: NOW - 5000 },
      { id: 'lawyer_ai', name: 'Lawyer AI', preview: 'notice ka jawab…' },
    ], NOW);
    expect(rows[0]).toMatchObject({ profViewId: 'teacher_ai', profLive: false, profEndedAt: NOW - 5000 });
    expect(rows[0].lastUpdated).toBe(new Date(NOW - 5000).toISOString());
    // The live row must NOT invent a date — it renders "Ongoing" instead.
    expect(rows[1]).toMatchObject({ profViewId: 'lawyer_ai', profLive: true, lastUpdated: null });
  });

  it('row ids are namespaced so they can never collide with Firestore doc ids', () => {
    const rows = professionalRows([{ id: 'chef_ai', name: 'Chef AI', preview: 'x' }], NOW);
    expect(rows[0].id).toBe('prof:chef_ai#live');
  });

  it('a blank preview falls back to the professional name, never an empty title', () => {
    const rows = professionalRows([{ id: 'yoga_ai', name: 'Yoga AI', preview: '  ' }], NOW);
    expect(rows[0].title).toBe('Yoga AI');
  });

  it('live conversations sort FIRST, then everything else newest-first', () => {
    const merged = sortMergedRows([
      { id: 'a', lastUpdated: new Date(NOW - 1000).toISOString() },
      { id: 'live', lastUpdated: null, profLive: true },
      { id: 'b', lastUpdated: new Date(NOW - 60_000).toISOString() },
      { id: 'undated', lastUpdated: null },
    ] as any[], NOW);
    expect(merged.map((r: any) => r.id)).toEqual(['live', 'a', 'b', 'undated']);
  });
});
