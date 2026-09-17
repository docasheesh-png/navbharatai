import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { savePlanForFileSet } from '../src/server/AgentV3/WorkspaceFileStore';

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

describe('🔎 the SIBLING (rule 3): the shrink guard was defeated by the failure it exists to survive', () => {
  /**
   * `saveWorkspaceFiles` read the existing index with `root.get().catch(() => null)` — the SAME
   * collapse of "there is no document" and "the read FAILED" — and passed `existingPaths.length`,
   * i.e. 0, into the guard. `0 <= 3` returned 'replace', and the write that follows is
   * `{ merge: false }`. So one transient Firestore blip during a VISUAL EDIT (which saves ONE file)
   * or the reviewer's critical-fix pass (~3 files) wiped the whole path index — the exact
   * "49 files thi! 3 rah gayi kyu?!" wipe the guard was written to prevent.
   */
  /**
   * ⚠️ HONEST NOTE ON WHAT THESE THREE CASES DO AND DO NOT PROVE. Reverting `WorkspaceFileStore.ts`
   * makes only the THIRD one fail. The first two pass either way — under the old numeric signature
   * `'unknown' <= 3` is `false` (a NaN comparison) and `newCount >= 'unknown'/2` is `false` too, so
   * the old code returned `'merge'` for this input **by accident**. What the type change buys is that
   * the answer is now INTENTIONAL and stated, and that a caller passing an unknown size type-checks
   * instead of being coerced. The DEFECT was never in this function: the call site never passed
   * `'unknown'` — it passed `0`, because its read collapsed a failure into an empty document. That is
   * what the third case measures, and it is the one that goes red.
   */
  it('an UNKNOWN existing size can never authorise a replace', () => {
    expect(savePlanForFileSet('unknown', 1)).toBe('merge');    // the visual-edit case
    expect(savePlanForFileSet('unknown', 3)).toBe('merge');    // the reviewer critical-fix case
    expect(savePlanForFileSet('unknown', 500)).toBe('merge');  // even a big save may not replace blind
  });

  it('every numeric verdict is unchanged — this widens the guard, it does not loosen it', () => {
    expect(savePlanForFileSet(0, 1)).toBe('replace');   // genuinely empty index
    expect(savePlanForFileSet(3, 1)).toBe('replace');   // tiny index, nothing to protect
    expect(savePlanForFileSet(49, 3)).toBe('merge');    // the original reported wipe
    expect(savePlanForFileSet(49, 40)).toBe('replace'); // a real full save
    expect(savePlanForFileSet(10, 5)).toBe('replace');  // exactly half is still comparable
    expect(savePlanForFileSet(10, 4)).toBe('merge');
  });

  it('the caller distinguishes a failed read from an absent document', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/WorkspaceFileStore.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The collapsing form must be gone from the guard's own read.
    expect(src).not.toContain('await root.get().catch(() => null)');
    expect(src).toContain("let guardRead: 'ok' | 'failed' = 'ok';");
    expect(src).toContain("guardRead === 'ok' ? existingPaths.length : 'unknown'");
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
