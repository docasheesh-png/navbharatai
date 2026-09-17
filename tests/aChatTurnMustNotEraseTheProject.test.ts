import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';

/**
 * 🔴 ONE PLANNER CHAT TURN COULD DELETE A WORKSPACE'S ENTIRE MEMORY (found 2026-09-17).
 *
 * The Planner/Advisor role-chat lane did this, under a comment claiming it persisted *"exactly like
 * the plain-chat lane"*:
 *
 *     const mem = getWorkspaceMemory(roleWorkspaceId);
 *     mem.recordRequest(prompt);
 *     void saveWorkspaceMemory(roleWorkspaceId, mem.snapshot());
 *
 * The plain-chat lane has one more line, and its own comment says why: *"ensure durable episodes are
 * loaded first"*. On a COLD instance — after every deploy, and after any 2-hour cache eviction —
 * `getWorkspaceMemory` returns an EMPTY object, `recordRequest` gives it exactly one episode, and
 * `saveWorkspaceMemory` writes that over the durable document with **`{ merge: false }`**. So the
 * turn destroyed the workspace's whole episode history and its persisted project graph — including
 * the `PLAN_STATE` note a "continue" reads back to resume an unfinished plan.
 *
 * 🔑 FIXED AS A CLASS. A rule written into one caller is a rule the next caller never hears about —
 * which is exactly how this arrived, by copying a lane and dropping a line. Every writer now goes
 * through `saveWorkspaceMemoryFor`, so "save without hydrating" cannot be expressed.
 *
 * ⚠️ AND `isHydrated()` IS NOT THE ANSWER TO "do I hold the history?". It is marked BEFORE the
 * durable read, deliberately, as a re-entrancy guard against double-replaying episodes. A 3-second
 * timeout race can leave it set while the read never landed. `isHydrationConfirmed()` is the one a
 * writer must ask, and only a genuine read sets it.
 */

describe('the two hydration flags answer two different questions', () => {
  it('a fresh memory holds neither', () => {
    const m = new WorkspaceMemory();
    expect(m.isHydrated()).toBe(false);
    expect(m.isHydrationConfirmed()).toBe(false);
  });

  it('the re-entrancy guard does NOT imply the durable read landed', () => {
    const m = new WorkspaceMemory();
    m.markHydrated();                       // what a timed-out restore leaves behind
    expect(m.isHydrated()).toBe(true);
    expect(m.isHydrationConfirmed()).toBe(false); // …and a writer must still refuse
  });

  it('a confirmed read is its own, separate fact', () => {
    const m = new WorkspaceMemory();
    m.markHydrated();
    m.markHydrationConfirmed();
    expect(m.isHydrationConfirmed()).toBe(true);
  });
});

/**
 * The store's real code path needs Firestore, which is stubbed out under VITEST — so the behaviour
 * that matters is asserted structurally, on the SOURCE with comments stripped. These are the facts
 * a unit test cannot reach and a future edit can silently undo.
 */
describe('no writer can save an unhydrated memory over the durable one', () => {
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const store = strip(readFileSync(join(__dirname, '../src/server/AgentV3/FirestoreWorkspaceMemoryStore.ts'), 'utf8'));
  const route = strip(readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8'));

  it('the route NEVER calls the raw write — every save goes through the safe writer', () => {
    // The whole class, in one assertion: a caller that could forget to hydrate no longer exists.
    expect(route).not.toMatch(/\bsaveWorkspaceMemory\s*\(/);
    expect(route).toMatch(/\bsaveWorkspaceMemoryFor\s*\(/);
  });

  it('all five save sites were converted, not just the reported one', () => {
    const calls = route.match(/saveWorkspaceMemoryFor\(/g) ?? [];
    expect(calls.length).toBe(5); // role-chat, plain-chat, suggestions, import, build-end
  });

  it('the safe writer hydrates first and REFUSES to write when the read was not confirmed', () => {
    const fn = store.slice(store.indexOf('export async function saveWorkspaceMemoryFor'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('restoreWorkspaceMemory(workspaceId, mem)');
    expect(body).toContain("if (!mem.isHydrationConfirmed()) return 'skipped-unconfirmed'");
    // The refusal must come BEFORE the write, or it is decoration.
    expect(body.indexOf('skipped-unconfirmed')).toBeLessThan(body.indexOf('await saveWorkspaceMemory('));
  });

  it('a FAILED durable read never counts as hydration — only a real read does', () => {
    const fn = store.slice(store.indexOf('export async function restoreWorkspaceMemory'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('loadWorkspaceMemoryResult(workspaceId)');
    expect(body).toContain('if (!result.ok) return null;');
    // Confirmation is set AFTER the ok check, never before it.
    expect(body.indexOf('if (!result.ok)')).toBeLessThan(body.indexOf('markHydrationConfirmed()'));
  });

  it('the load distinguishes "no snapshot" from "could not read"', () => {
    const fn = store.slice(store.indexOf('export async function loadWorkspaceMemoryResult'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // An ABSENT document is a real answer — there is nothing a save could destroy.
    expect(body).toContain('if (!snap.exists) return { ok: true, snapshot: null };');
    // A THROWN read is not. This is the branch whose absence turned a Firestore blip into deletion.
    expect(body).toContain('return { ok: false };');
    expect(body).toContain("notePersistenceFailure('workspace_memory', 'read'");
  });

  it('the raw write still exists, and says plainly what it does', () => {
    // It is not removed: `restoreWorkspaceMemory` is a legitimate caller, and so is any future path
    // that has already proven it holds the history. It simply must not be reached by accident.
    expect(store).toContain('export async function saveWorkspaceMemory(');
    expect(store).toContain("await doc.set(payload, { merge: false });");
  });
});
