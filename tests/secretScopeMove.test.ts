/**
 * "Apply this key to all my apps" — the toggle the admin asked for on 2026-09-13, and the trap it would
 * have walked into.
 *
 * THE TRAP: re-scoping by calling the ordinary save with the new scope does NOT move a key.
 * `planSecretWrite` only ever touches rows of the SAME scope (deliberately — that is what stops a shared
 * save from destroying a deliberate app-specific exception), so the save would ADD a shared row and leave
 * the app-scoped one alive. And `resolveScopedSecrets` makes an app-specific key beat a shared one
 * however old it is. That app would then keep injecting the OLD value while every other app got the new
 * one — invisible to the user and undiagnosable from the screen.
 *
 * So the move is a MOVE: same document, same ciphertext, different scope. These tests pin that, and the
 * last block pins the behaviour that made the move necessary in the first place.
 */
import { describe, it, expect } from 'vitest';
import { planScopeMove, planSecretWrite, resolveScopedSecrets } from '../src/server/lib/secretScope';

const row = (id: string, workspaceId: string | null, createdAt = 1_000, deleted = false) =>
  ({ id, workspaceId, createdAt, deleted });

describe('planScopeMove', () => {
  it('moves an app-scoped key to shared', () => {
    const plan = planScopeMove([row('a', 'app-1')], 'a', null);
    expect(plan).toEqual({ move: 'a', retire: [], alreadyThere: false });
  });

  it('moves a shared key down to one app', () => {
    const plan = planScopeMove([row('a', null)], 'a', 'app-1');
    expect(plan).toEqual({ move: 'a', retire: [], alreadyThere: false });
  });

  it('THE DUPLICATE: a same-named key already at the destination is retired, not left beside it', () => {
    // KEY=x tied to app-1, and a shared KEY=y already exists. Sharing the app-1 one must leave exactly
    // ONE shared row — otherwise the pile planSecretWrite exists to collapse is re-created by hand.
    const plan = planScopeMove([row('scoped', 'app-1'), row('shared', null)], 'scoped', null);
    expect(plan.move).toBe('scoped');
    expect(plan.retire).toEqual(['shared']);
  });

  it('retires EVERY duplicate at the destination, not just the newest', () => {
    const plan = planScopeMove([row('scoped', 'app-1'), row('s1', null, 1), row('s2', null, 2)], 'scoped', null);
    expect(plan.retire.sort()).toEqual(['s1', 's2']);
  });

  it('a key at a THIRD scope is never touched — that is somebody else’s exception', () => {
    const plan = planScopeMove([row('scoped', 'app-1'), row('other', 'app-2')], 'scoped', null);
    expect(plan.retire).toEqual([]);
  });

  it('already at the destination: no write at all, and it says so rather than erroring', () => {
    expect(planScopeMove([row('a', null)], 'a', null)).toEqual({ move: null, retire: [], alreadyThere: true });
    expect(planScopeMove([row('a', 'app-1')], 'a', 'app-1')).toEqual({ move: null, retire: [], alreadyThere: true });
  });

  it('a soft-deleted row is not a target and is not a duplicate', () => {
    expect(planScopeMove([row('a', 'app-1', 1, true)], 'a', null).move).toBeNull();
    expect(planScopeMove([row('a', 'app-1'), row('gone', null, 1, true)], 'a', null).retire).toEqual([]);
  });

  it('an unknown id moves nothing — a caller that lost the row must not blank a scope', () => {
    expect(planScopeMove([row('a', 'app-1')], 'nope', null)).toEqual({ move: null, retire: [], alreadyThere: false });
  });

  it('scope strings are trimmed and empty means shared, matching every other reader', () => {
    expect(planScopeMove([row('a', '  app-1  ')], 'a', 'app-1').alreadyThere).toBe(true);
    expect(planScopeMove([row('a', '   ')], 'a', null).alreadyThere).toBe(true);
  });

  it('survives junk input rather than throwing on a screen the user is looking at', () => {
    expect(planScopeMove(null, 'a', null).move).toBeNull();
    expect(planScopeMove(undefined, 'a', 'app-1').move).toBeNull();
  });
});

describe('WHY a plain save could not have done this', () => {
  it('saving at the new scope ADDS a row instead of moving the old one', () => {
    // The existing row is app-scoped; a save at the SHARED scope finds nothing to replace.
    const plan = planSecretWrite([row('scoped', 'app-1')], null);
    expect(plan.replace).toBeNull(); // → the route would addDoc, leaving 'scoped' alive
    expect(plan.retire).toEqual([]);
  });

  it('and the leftover app-scoped row would SHADOW the new shared value for that app', () => {
    const resolved = resolveScopedSecrets([
      { name: 'KEY', value: 'old-app-value', workspaceId: 'app-1', createdAt: 1 },
      { name: 'KEY', value: 'new-shared-value', workspaceId: null, createdAt: 999 },
    ], 'app-1');
    // Newer AND shared, and it still loses — this is the split the move exists to prevent.
    expect(resolved.KEY).toBe('old-app-value');
  });

  it('after a real MOVE there is only one row, so every app agrees', () => {
    const resolved = resolveScopedSecrets([
      { name: 'KEY', value: 'the-one-value', workspaceId: null, createdAt: 999 },
    ], 'app-1');
    expect(resolved.KEY).toBe('the-one-value');
    expect(resolveScopedSecrets([
      { name: 'KEY', value: 'the-one-value', workspaceId: null, createdAt: 999 },
    ], 'app-2').KEY).toBe('the-one-value');
  });
});
