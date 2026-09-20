import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../src/lib/authedFetch', () => ({ authHeaders: async () => ({}) }));

import {
  appLockStatus, cachedAppLockStatus, currentUnlock, unlockWithPin, unlockHeaders,
  resetAppLock, invalidateAppLockStatus, saveLockedAreas, shouldGate, unlockIsLive,
} from '../src/lib/appLock';

/**
 * 🔴 ONE ACCOUNT'S UNLOCK IS NOT ANOTHER'S — the app lock's account boundary.
 *
 * WHAT THIS PINS, and it is not a hypothetical. Both halves were MEASURED leaking before the fix, with
 * a probe against this very module:
 *
 *   - `appLockStatus('userA')` cached `{hasPin:false}`; `appLockStatus('userB')` — a different account,
 *     really `{hasPin:true, areas:['settings','billing','code_studio']}` — returned **userA's answer**
 *     without asking the server. Every gate then read `shouldGate(area, statusA)` ⇒ false, so user B's
 *     locked screens rendered with no PIN at all.
 *   - After `unlockWithPin('userA', …)`, `currentUnlock()` still returned A's live ticket while B was
 *     signed in, and `unlockHeaders()` put `x-vault-unlock: <A's ticket>` on B's requests.
 *
 * WHY IT SURVIVED SO LONG: the ordinary logout reloads the page (`performSignOut`), and a reload wipes
 * module state — so the protection was accidental, not designed. `resetAppLock()` claimed in its own
 * docstring to be "called on SIGN-OUT" and was called from nowhere. Exactly one sign-out skips the
 * reload, and it is the one in front of the PIN screen itself.
 *
 * ⚠️ THE HONEST SCOPE, so nobody reads this as a bigger hole than it was: the SERVER binds a ticket to
 * a uid (`verifyUnlockTicket(ticket, uid, …)`), so A's ticket could never decrypt B's API keys or
 * authorise B's recharge. The money and vault paths held. What leaked was the CLIENT-side screen lock
 * and the lock configuration shown — which is the whole of the protection for five of the seven areas.
 */

const areasFor: Record<string, unknown> = {};
let served: string[] = [];

function serve(byUser: Record<string, unknown>, opts: { holdUnlock?: () => Promise<void> } = {}) {
  served = [];
  (globalThis as never as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    if (String(url).endsWith('/unlock')) {
      const uid = String(url).split('/').slice(-2)[0];
      return { ok: true, json: async () => ({ ticket: `TICKET-FOR-${uid}`, expiresInMs: 300_000, method: 'pin' }) };
    }
    if (String(url).endsWith('/areas')) return { ok: true, json: async () => ({ areas: areasFor.saved ?? [] }) };
    const uid = String(url).split('/').pop() as string;
    served.push(uid);
    if (opts.holdUnlock) await opts.holdUnlock();
    return { ok: true, json: async () => byUser[uid] };
  });
}

/** The two accounts used throughout: A locks nothing optional, B locks three screens. */
const A = { hasPin: false, areas: [] };
const B = { hasPin: true, areas: ['settings', 'billing', 'code_studio'] };

beforeEach(() => { resetAppLock(); served = []; });

describe('🔴 the status cache cannot answer for a different account', () => {
  it('does NOT serve user A’s answer to a question about user B', async () => {
    serve({ userA: A, userB: B });
    const a = await appLockStatus('userA');
    expect(a.hasPin).toBe(false);

    const b = await appLockStatus('userB');

    // The exact measured failure: before the fix this returned A's `{hasPin:false, areas:['api_keys']}`
    // and `served` held only 'userA' — the server was never asked about B at all.
    expect(b.hasPin).toBe(true);
    expect(b.areas).toContain('settings');
    expect(served).toEqual(['userA', 'userB']);
  });

  it('🔒 so B’s locked screens are still gated — the consequence the leak actually had', async () => {
    serve({ userA: A, userB: B });
    await appLockStatus('userA');
    const b = await appLockStatus('userB');

    // With A's status in hand every one of these was `false`, i.e. the screen rendered open.
    expect(shouldGate('settings', b)).toBe(true);
    expect(shouldGate('billing', b)).toBe(true);
    expect(shouldGate('code_studio', b)).toBe(true);
  });

  it('reports "not known yet" rather than another account’s answer', async () => {
    serve({ userA: A, userB: B });
    await appLockStatus('userA');

    expect(cachedAppLockStatus('userA')).not.toBeNull();
    // Unknown ⇒ locked, at the one place where nothing is traded away: the gate simply asks the server
    // about the user who is actually signed in. This is NOT the documented fail-open-on-network-error
    // trade being reversed — that answers a different question.
    expect(cachedAppLockStatus('userB')).toBeNull();
  });
});

describe('🔴 a ticket earned by one account is not live for another', () => {
  it('does NOT report user A’s unlock as live for user B', async () => {
    serve({ userA: A, userB: B });
    await appLockStatus('userA');
    await unlockWithPin('userA', '1357');

    expect(unlockIsLive(currentUnlock('userA'))).toBe(true);
    // The measured failure: this returned A's live `TICKET-FOR-userA`.
    expect(currentUnlock('userB')).toBeNull();
  });

  it('does NOT put user A’s ticket on user B’s requests', async () => {
    serve({ userA: A, userB: B });
    await appLockStatus('userA');
    await unlockWithPin('userA', '1357');

    expect(await unlockHeaders('userA')).toHaveProperty('x-vault-unlock', 'TICKET-FOR-userA');
    expect(await unlockHeaders('userB')).toEqual({});
  });

  it('🔒 drops the previous account’s unlock entirely once the user really changes', async () => {
    serve({ userA: A, userB: B });
    await appLockStatus('userA');
    await unlockWithPin('userA', '1357');

    await appLockStatus('userB');

    // Not merely hidden from B — gone, so not even an unscoped reader can find it.
    expect(currentUnlock()).toBeNull();
    expect(currentUnlock('userA')).toBeNull();
  });
});

describe('the rightful owner is not made to suffer for the fix', () => {
  it('still serves the SAME user from cache — one request, not one per gate', async () => {
    serve({ userA: A });
    await appLockStatus('userA');
    await appLockStatus('userA');
    await appLockStatus('userA');
    expect(served).toEqual(['userA']);
  });

  it('keeps the unlock across a SETTINGS change — a saved tick must not shut the lock', async () => {
    serve({ userA: { hasPin: true, areas: [] } });
    await appLockStatus('userA');
    await unlockWithPin('userA', '1357');

    areasFor.saved = ['settings'];
    await saveLockedAreas('userA', ['settings']);
    expect(unlockIsLive(currentUnlock('userA'))).toBe(true);

    // The distinction that makes the two resets different, stated as a test: invalidating the STATUS
    // must never do what a user CHANGE does.
    invalidateAppLockStatus();
    expect(unlockIsLive(currentUnlock('userA'))).toBe(true);
  });

  it('a caller that names no user keeps exactly its old behaviour', async () => {
    serve({ userA: { hasPin: true, areas: [] } });
    await appLockStatus('userA');
    await unlockWithPin('userA', '1357');
    // The money routes spread `unlockHeaders()` with no uid to hand, and the SERVER is still what
    // checks a ticket against a uid. Narrowing them is a separate decision, not a silent side effect.
    expect(await unlockHeaders()).toHaveProperty('x-vault-unlock', 'TICKET-FOR-userA');
    expect(cachedAppLockStatus()).not.toBeNull();
  });
});

describe('a switch that happens MID-REQUEST', () => {
  it('does not install an answer about the account that has already been left', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    serve({ userA: A, userB: B }, {
      holdUnlock: async () => { if (first) { first = false; await gate; } },
    });

    const slow = appLockStatus('userA');          // held open
    const fast = await appLockStatus('userB', true); // lands first
    expect(fast.hasPin).toBe(true);

    release();
    await slow.catch(() => undefined);

    // A's late answer must not overwrite B's, which is the state the app is actually in now.
    expect(cachedAppLockStatus('userB')?.hasPin).toBe(true);
    expect(cachedAppLockStatus('userA')).toBeNull();
  });
});

describe('🔴 the reset is actually reachable — it was exported and called from NOWHERE', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  /** Strip comments before asserting presence — a comment naming the call is not the call. */
  const codeOnly = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');

  it('the sign-out that does NOT reload the page clears this module first', () => {
    // `signInAgain` is a raw `signOut(auth)` — every other logout goes through `performSignOut`, whose
    // last step is a reload. Without this call the next person to sign in on the same page load
    // inherits the previous account's open lock.
    const gate = codeOnly(read('src/components/AppLockGate.tsx'));
    expect(gate).toContain('resetAppLock');
    const signInAgain = gate.slice(gate.indexOf('const signInAgain'));
    const body = signInAgain.slice(0, signInAgain.indexOf('};'));
    expect(body).toContain('resetAppLock()');
    expect(body.indexOf('resetAppLock()')).toBeLessThan(body.indexOf('signOut(auth)'));
  });

  it('the status read itself resets on a user change, so no call site has to remember', () => {
    // The half that makes this a class fix rather than an instance fix: a future path that changes the
    // user without a reload is covered by construction.
    const src = codeOnly(read('src/lib/appLock.ts'));
    const fn = src.slice(src.indexOf('export function appLockStatus'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('statusUserId !== userId');
    expect(body).toContain('resetAppLock()');
  });
});
