import { describe, it, expect } from 'vitest';
import { generateFrontendStateIntegration } from './FrontendStateGenerator';

describe('generateFrontendStateIntegration', () => {
  const c = generateFrontendStateIntegration();
  const store = c.files['src/store/useItemsStore.ts'];
  const hooks = c.files['src/store/useItems.ts'];

  it('emits a typed Zustand store + selector hooks on the zustand dep', () => {
    expect(store).toContain("import { create } from 'zustand'");
    expect(store).toContain('export const useItemsStore = create<ItemsState>(');
    expect(hooks).toContain('export const useItems = () => useItemsStore((s) => s.items)');
    expect(c.dependencies).toEqual([{ name: 'zustand', version: '^4.5.5' }]);
  });

  it('ships the optimistic-update pattern DONE RIGHT — instant apply, confirm, roll back on failure', () => {
    expect(store).toContain('addItemOptimistic');
    expect(store).toContain('const prev = get().items');            // snapshot for rollback
    expect(store).toContain('set({ items: prev,');                   // ROLL BACK on failure
    expect(store).toContain("method: 'POST'");                       // confirms with the server
    expect(store).not.toMatch(/TODO|FIXME/);
  });

  it('subscribes via selectors (avoids needless re-renders)', () => {
    expect(hooks).toContain('useItemsStore((s) => s.loading)');
    expect(hooks).toContain('useItemsActions');
  });

  it('writes only src/store files and needs no env key', () => {
    expect(Object.keys(c.files).sort()).toEqual(['src/store/useItems.ts', 'src/store/useItemsStore.ts']);
    expect((c as { envKeys?: unknown }).envKeys).toBeUndefined();
    expect(c.instructions.toLowerCase()).toContain('optimistic');
  });
});
