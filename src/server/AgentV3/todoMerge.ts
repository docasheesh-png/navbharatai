// AgentV3 — ONE continuous plan per build (admin 2026-07-21).
//
// ROOT CAUSE this closes: `update_todo` REPLACED the whole todo list, so when the model
// started a fresh sub-plan mid-build (a new, shorter list), the user's "Plan x/y" widget
// snapped from e.g. 12/12 back to 0/5 — the plan looked like it reset and restarted.
// The admin's requirement: ONE plan for the whole request; finished work never disappears;
// the plan only completes once the app is actually done.
//
// The merge keeps the model's tool contract unchanged (it still sends a full list); the
// WORKSPACE simply accumulates honestly:
//   • An incoming item that matches an existing one (same normalized title) UPDATES it in
//     place (status/owner from the incoming list — id-stable, so UI keys stay stable).
//   • A previously-DONE item absent from the incoming list is KEPT (finished work never
//     vanishes from the plan).
//   • A previously-PENDING item absent from the incoming list is DROPPED (an abandoned
//     sub-step must not inflate the denominator forever).
//   • Genuinely new items APPEND at the end, in the incoming order.
// Net effect: done-count never goes backwards, the total only grows (or shrinks by pruning
// stale pending work), and x/y progresses monotonically to completion.
//
// Matching is by TITLE, not id — models routinely restart id numbering ("1","2","3") for a
// fresh sub-plan, so id-matching would silently overwrite finished items with new ones.

import type { TodoItem } from './types';

const normTitle = (t: string): string => (t || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Merge an incoming full todo list into the existing plan (pure; see module header). */
export function mergeTodoLists(prev: TodoItem[], incoming: TodoItem[]): TodoItem[] {
  if (prev.length === 0) return [...incoming];

  const incomingByTitle = new Map<string, TodoItem>();
  for (const t of incoming) {
    const key = normTitle(t.title);
    if (!incomingByTitle.has(key)) incomingByTitle.set(key, t);
  }

  const usedIds = new Set<string>();
  const matchedKeys = new Set<string>();
  const out: TodoItem[] = [];

  for (const p of prev) {
    const key = normTitle(p.title);
    const match = incomingByTitle.get(key);
    if (match) {
      matchedKeys.add(key);
      out.push({ ...match, id: p.id }); // keep the original id → stable UI keys
      usedIds.add(p.id);
    } else if (p.status === 'done') {
      out.push(p); // finished work never disappears from the plan
      usedIds.add(p.id);
    }
    // absent + not done → dropped (stale pending step from an abandoned sub-plan)
  }

  for (const t of incoming) {
    const key = normTitle(t.title);
    if (matchedKeys.has(key)) continue;
    matchedKeys.add(key); // dedupe duplicate titles within one incoming list
    let id = t.id;
    let n = 2;
    while (usedIds.has(id)) id = `${t.id}-${n++}`; // fresh sub-plans reuse "1","2",… — keep keys unique
    usedIds.add(id);
    out.push({ ...t, id });
  }

  return out;
}
