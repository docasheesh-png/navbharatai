// AgentV3 — Plan/todo progress sync.
//
// The plan list shown above the input box is driven by `todo_updated` events. The model is told to
// keep it updated (mark items in_progress / done as it works), but it does not do so reliably —
// Haiku especially creates the plan once and never advances the statuses. The result the user sees:
// the spinner never spins and no item ever gets a green tick (the plan sits frozen at "0/N").
//
// This makes the plan progress REAL and automatic, driven by actual build activity (files written +
// the final success), so the UI always reflects honest progress regardless of whether the model
// remembers to call update_todo. Pure + dependency-free (fully unit-testable).

import type { TodoItem, TodoStatus } from './types';

/**
 * Recompute todo statuses from real build progress. Titles / ids / owners are preserved — only
 * `status` changes.
 *
 *  - `finished` → every item is `done` (a successful build means the plan was accomplished).
 *  - otherwise → the first `min(completedSteps, n-1)` items are `done`, the next is `in_progress`
 *    (the live spinner), the rest `pending`. The LAST item is never marked done until `finished`,
 *    so the plan never shows 100% before the build actually completes.
 *
 * A real `blocked` status set by the agent is preserved (it is a genuine signal, not progress).
 *
 * DONE IS NEVER DOWNGRADED (admin 2026-07-21 — "plan reset" root cause): this recompute runs after
 * every file write, and the positional math used to stomp items the AGENT had already marked done
 * (via update_todo) back to pending — the user watched their plan's green ticks vanish mid-build.
 * A done item now stays done forever; the positional progress only ever advances the rest.
 */
export function computePlanProgress(todos: TodoItem[], completedSteps: number, finished: boolean): TodoItem[] {
  const n = todos.length;
  if (n === 0) return todos;
  if (finished) {
    return todos.map((t) => (t.status === 'blocked' ? t : { ...t, status: 'done' as TodoStatus }));
  }
  const done = Math.max(0, Math.min(n - 1, Math.floor(completedSteps)));
  const out = todos.map((t, i) => {
    if (t.status === 'blocked' || t.status === 'done') return t; // never regress real progress
    const status: TodoStatus = i < done ? 'done' : i === done ? 'in_progress' : 'pending';
    return { ...t, status };
  });
  // Keep exactly one live spinner: if the positional in_progress slot landed on an already-done
  // item, move the spinner to the first still-pending item so the plan never looks stalled.
  if (!out.some((t) => t.status === 'in_progress')) {
    const next = out.findIndex((t) => t.status === 'pending');
    if (next >= 0) out[next] = { ...out[next], status: 'in_progress' };
  }
  return out;
}
