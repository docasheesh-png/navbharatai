import { describe, it, expect } from 'vitest';
import { reportLabel, toPickerItem, pickerItems, PICKER_LABEL_MAX } from './reportPicker';

describe('reportLabel — the row is named by the USER, not by us', () => {
  it('collapses a multi-line prompt into one readable line', () => {
    expect(reportLabel('add a dark mode\n\n  toggle to settings')).toBe('add a dark mode toggle to settings');
  });

  it('truncates long prompts with an ellipsis, never mid-run of whitespace', () => {
    const label = reportLabel('x'.repeat(300));
    expect(label.length).toBe(PICKER_LABEL_MAX);
    expect(label.endsWith('…')).toBe(true);
  });

  it('keeps a prompt that already fits, byte for byte', () => {
    expect(reportLabel('fix the login button')).toBe('fix the login button');
  });

  it('says "Untitled build" instead of inventing one — an edit turn can carry no prompt', () => {
    expect(reportLabel('')).toBe('Untitled build');
    expect(reportLabel(undefined)).toBe('Untitled build');
    expect(reportLabel('   \n ')).toBe('Untitled build');
  });
});

describe('toPickerItem — a picker row must not become a peek at the report', () => {
  // The build report is ADMIN-ONLY (admin 2026-07-29): the user submits it, never reads it. A row
  // may therefore only carry what the user already watched happen.
  it('carries exactly when / what-they-asked / did-it-work, and nothing else', () => {
    const item = toPickerItem({ id: 'b1', startedAt: 10, endedAt: 20, ok: true, prompt: 'build a todo app' });
    expect(Object.keys(item).sort()).toEqual(['endedAt', 'id', 'label', 'ok', 'startedAt']);
    expect(item.label).toBe('build a todo app');
  });

  it('drops our analysis of the build — summary, root cause, counts never reach a row', () => {
    const item = toPickerItem({
      id: 'b1', startedAt: 10, prompt: 'p',
      // Fields that live on the real history entry and must NOT survive the strip.
      summary: 'Provider GLM failed, Claude repaired it',
      rootCause: 'kimi-k2.7 returned an empty tool call',
      counts: { total: 9, errors: 3, warnings: 6, autoResolved: 1, unresolved: 2 },
    } as never);
    expect(JSON.stringify(item)).not.toMatch(/GLM|Claude|kimi|rootCause|summary|counts/i);
  });

  it('is a construction, not a spread — a NEW field on the source cannot leak through', () => {
    // This is the whole point of building the object field by field: the next person to add a field
    // to the history entry does not accidentally publish it to users.
    const item = toPickerItem({ id: 'b1', startedAt: 1, someFutureProviderField: 'claude-opus-4-8' } as never);
    expect(JSON.stringify(item)).not.toContain('claude-opus');
  });
});

describe('pickerItems — the list the user actually chooses from', () => {
  it('orders newest first, so the build just now is the first row', () => {
    const items = pickerItems([
      { id: 'old', startedAt: 100, prompt: 'first' },
      { id: 'new', startedAt: 300, prompt: 'third' },
      { id: 'mid', startedAt: 200, prompt: 'second' },
    ]);
    expect(items.map((i) => i.id)).toEqual(['new', 'mid', 'old']);
  });

  it('never offers a row that cannot be submitted', () => {
    // The id is what the submit call sends back; a row without one would silently report the WRONG build.
    expect(pickerItems([{ id: '', startedAt: 1 }, { startedAt: 2 } as never, { id: 'ok', startedAt: 3 }]))
      .toHaveLength(1);
  });

  it('keeps one row per build even if the history repeats an id', () => {
    const items = pickerItems([{ id: 'b', startedAt: 2, prompt: 'newer' }, { id: 'b', startedAt: 1, prompt: 'older' }]);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('newer');
  });

  it('an empty or absent history is an empty list, never a throw', () => {
    expect(pickerItems([])).toEqual([]);
    expect(pickerItems(null)).toEqual([]);
    expect(pickerItems(undefined)).toEqual([]);
  });
});
