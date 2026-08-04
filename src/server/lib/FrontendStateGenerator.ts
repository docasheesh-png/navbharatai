// Roadmap "BUILD NOW #9" — frontend GLOBAL STATE-MANAGEMENT recipe (Zustand).
//
// The audit's Frontend gap listed "state management" separately from "optimistic updates". The LOCAL
// optimistic-list piece is already covered by generate_ui_states' `useOptimisticList` (a dependency-free
// component hook). This recipe fills the OTHER, genuinely-missing half: a real GLOBAL, cross-component store
// (Zustand — the modern, tiny, boilerplate-free choice) so shared app state (cart, session, a live list)
// isn't prop-drilled or improvised. It ships a typed store + selector hooks, and — as a realistic usage
// example, not a reusable generic helper — one async action that mutates the store optimistically and ROLLS
// BACK on failure (the #1 thing hand-rolled optimistic UIs get wrong). For a purely-local optimistic list,
// prefer useOptimisticList from generate_ui_states. Frontend-only, one dependency (zustand), no env keys.
// PURE builder → the caller writes the files. Real, complete code — no TODO stubs.

export interface FrontendStateConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const STORE = `import { create } from 'zustand';

// A typed Zustand store. State + actions live together; components subscribe to ONLY the slice they use
// (see the selector hooks below) so an unrelated change never re-renders them. Replace 'Item' + the fetch
// calls with your domain + real API.
export interface Item {
  id: string;
  name: string;
}

interface ItemsState {
  items: Item[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  // OPTIMISTIC add: the item appears instantly, then we confirm with the server and ROLL BACK on failure.
  addItemOptimistic: (name: string) => Promise<void>;
  removeItem: (id: string) => void;
}

export const useItemsStore = create<ItemsState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/items');
      if (!res.ok) throw new Error('Failed to load items');
      set({ items: (await res.json()) as Item[], loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Load failed' });
    }
  },

  addItemOptimistic: async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // 1) optimistic: show it now with a temporary id
    const tempId = 'temp-' + Date.now();
    const optimistic: Item = { id: tempId, name: trimmed };
    const prev = get().items;
    set({ items: [...prev, optimistic], error: null });
    try {
      // 2) confirm with the server
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error('Save failed');
      const saved = (await res.json()) as Item;
      // 3) swap the temp row for the real one
      set({ items: get().items.map((i) => (i.id === tempId ? saved : i)) });
    } catch (e) {
      // 4) ROLL BACK to the exact previous list (never leave a phantom row on failure)
      set({ items: prev, error: e instanceof Error ? e.message : 'Save failed' });
    }
  },

  removeItem: (id: string) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));
`;

const HOOKS = `import { useItemsStore } from './useItemsStore';

// Selector hooks — subscribe to ONLY the slice you use so a component re-renders just when that slice
// changes (the idiomatic Zustand pattern; passing a selector avoids re-rendering on every store update).
export const useItems = () => useItemsStore((s) => s.items);
export const useItemsLoading = () => useItemsStore((s) => s.loading);
export const useItemsError = () => useItemsStore((s) => s.error);
export const useItemsActions = () =>
  useItemsStore((s) => ({ load: s.load, addItemOptimistic: s.addItemOptimistic, removeItem: s.removeItem }));
`;

const INSTRUCTIONS =
  'Global state management wired at src/store/useItemsStore.ts + useItems.ts (zustand) — the cross-component ' +
  'shared-state piece (for a LOCAL optimistic list, use useOptimisticList from generate_ui_states instead). ' +
  'It is a REAL typed store with ' +
  'a working OPTIMISTIC-update example: addItemOptimistic shows the new item instantly, confirms with the ' +
  'server, swaps in the saved row, and ROLLS BACK to the previous list on failure (the thing hand-rolled ' +
  'optimistic UIs get wrong). Consume via the selector hooks — const items = useItems(); const { ' +
  'addItemOptimistic } = useItemsActions(); — so a component re-renders only when its slice changes. Replace ' +
  'Item + the /api/items fetch calls with your domain + real endpoints. No env key.';

export function generateFrontendStateIntegration(): FrontendStateConfig {
  return {
    files: {
      'src/store/useItemsStore.ts': STORE,
      'src/store/useItems.ts': HOOKS,
    },
    dependencies: [{ name: 'zustand', version: '^4.5.5' }],
    instructions: INSTRUCTIONS,
  };
}
