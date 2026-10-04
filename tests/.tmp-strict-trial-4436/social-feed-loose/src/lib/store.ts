import { useCallback, useEffect, useState } from 'react';

export interface Entity { id: string; }

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function read<T>(key: string, seed: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return seed;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : seed;
  } catch {
    // A corrupted entry must never throw during render — that white-screens the whole app.
    return seed;
  }
}

/** A persistent list with create / update / remove. The seed is used only on first run. */
export function useCollection<T extends Entity>(key: string, seed: T[]) {
  const [items, setItems] = useState<T[]>(() => read<T>(key, seed));

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* quota or private mode — keep working in memory */ }
  }, [key, items]);

  const add = useCallback((item: Omit<T, 'id'>) => {
    const created = { ...(item as object), id: newId() } as T;
    setItems((list) => [created, ...list]);
    return created;
  }, []);

  const update = useCallback((id: string, patch: Partial<T>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((list) => list.filter((it) => it.id !== id));
  }, []);

  return { items, setItems, add, update, remove };
}

/** Indian-format currency, which is what these apps are actually used for. */
export function inr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
