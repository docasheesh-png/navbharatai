import { describe, it, expect } from 'vitest';
import { toAppChoices, MAX_APP_CHOICES } from './appList';

describe('toAppChoices — the list behind the "which app?" picker', () => {
  it('keeps one row per app, with the first (most recent) title', () => {
    // A workspace appears once per conversation, and a picker that lists the same app three times is a
    // picker the user stops trusting.
    expect(toAppChoices([
      { workspaceId: 'ws-1', title: 'Shop' },
      { workspaceId: 'ws-1', title: 'Shop (older name)' },
      { workspaceId: 'ws-2', title: 'Clinic' },
    ])).toEqual([{ id: 'ws-1', title: 'Shop' }, { id: 'ws-2', title: 'Clinic' }]);
  });

  it('drops rows the user could not identify', () => {
    // An untitled workspace is real but unnameable; a blank row is worse than no row, because the user
    // cannot tell which app they would be choosing — and this picker decides where a payment key goes.
    expect(toAppChoices([
      { workspaceId: 'ws-1', title: '' },
      { workspaceId: 'ws-2', title: '   ' },
      { workspaceId: '', title: 'No id' },
      { workspaceId: null, title: 'Also no id' },
      { workspaceId: 'ws-3', title: 'Real app' },
    ])).toEqual([{ id: 'ws-3', title: 'Real app' }]);
  });

  it('is bounded, so a long history is not a thousand-row dropdown', () => {
    const many = Array.from({ length: MAX_APP_CHOICES + 25 }, (_, i) => ({ workspaceId: `ws-${i}`, title: `App ${i}` }));
    expect(toAppChoices(many)).toHaveLength(MAX_APP_CHOICES);
  });

  it('never throws on junk, and an empty list simply hides the picker', () => {
    expect(toAppChoices(null)).toEqual([]);
    expect(toAppChoices(undefined)).toEqual([]);
    expect(toAppChoices([])).toEqual([]);
    expect(() => toAppChoices([{} as never])).not.toThrow();
  });

  it('trims whitespace so two spellings of one app are not two rows', () => {
    expect(toAppChoices([{ workspaceId: ' ws-1 ', title: ' Shop ' }])).toEqual([{ id: 'ws-1', title: 'Shop' }]);
  });
});
