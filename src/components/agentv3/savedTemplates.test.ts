import { describe, it, expect, beforeEach } from 'vitest';
import { loadSavedTemplates, saveTemplate, removeSavedTemplate, SAVED_TEMPLATES_MAX, SAVED_TEMPLATES_KEY } from './savedTemplates';

// A tiny in-memory Storage stand-in.
function fakeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

let store: ReturnType<typeof fakeStorage>;
beforeEach(() => { store = fakeStorage(); });

describe('savedTemplates', () => {
  it('starts empty and safely handles malformed data', () => {
    expect(loadSavedTemplates(store)).toEqual([]);
    store.setItem(SAVED_TEMPLATES_KEY, 'not json');
    expect(loadSavedTemplates(store)).toEqual([]);
    store.setItem(SAVED_TEMPLATES_KEY, JSON.stringify([{ nope: 1 }]));
    expect(loadSavedTemplates(store)).toEqual([]);
  });

  it('saves a template and lists it newest-first', () => {
    saveTemplate('Todo app', 'build a todo app with categories', store, 1000);
    saveTemplate('Shop', 'build an online store', store, 2000);
    const list = loadSavedTemplates(store);
    expect(list.map((t) => t.label)).toEqual(['Shop', 'Todo app']);
    expect(list[0]).toMatchObject({ prompt: 'build an online store', savedAt: 2000 });
  });

  it('ignores a blank prompt and derives a label from the prompt when none given', () => {
    expect(saveTemplate('', '   ', store, 1)).toEqual([]);
    const prompt = 'build a fintech wallet with KYC and a transaction ledger';
    const list = saveTemplate('', prompt, store, 5);
    expect(list[0].label).toBe(prompt.slice(0, 40));
  });

  it('de-dupes by identical prompt (re-saving refreshes, never piles up)', () => {
    saveTemplate('A', 'build a crm', store, 1000);
    const after = saveTemplate('A (v2)', 'build a crm', store, 3000);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ label: 'A (v2)', savedAt: 3000 });
  });

  it('caps the list at SAVED_TEMPLATES_MAX (newest kept)', () => {
    for (let i = 0; i < SAVED_TEMPLATES_MAX + 5; i++) saveTemplate(`t${i}`, `prompt number ${i}`, store, 1000 + i);
    const list = loadSavedTemplates(store);
    expect(list).toHaveLength(SAVED_TEMPLATES_MAX);
    expect(list[0].label).toBe(`t${SAVED_TEMPLATES_MAX + 4}`); // the newest
  });

  it('removes a template by id', () => {
    saveTemplate('keep', 'prompt keep', store, 1000);
    saveTemplate('drop', 'prompt drop', store, 2000);
    const drop = loadSavedTemplates(store).find((t) => t.label === 'drop')!;
    const after = removeSavedTemplate(drop.id, store);
    expect(after.map((t) => t.label)).toEqual(['keep']);
  });
});
