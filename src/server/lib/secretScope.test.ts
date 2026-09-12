import { describe, it, expect } from 'vitest';
import { resolveScopedSecrets, withheldSecretNames, isSharedSecret, isNewerRow, planSecretWrite, type VaultSecretRow } from './secretScope';

const shared = (name: string, value = `${name}-shared`): VaultSecretRow => ({ name, value });
const forApp = (name: string, workspaceId: string, value = `${name}-${workspaceId}`): VaultSecretRow =>
  ({ name, value, workspaceId });

describe('SHARED IS A REAL CHOICE, NOT A MIGRATION ARTEFACT', () => {
  it('a key with no app goes to every app', () => {
    // A user with one Stripe account behind three apps wants that key shared, and the Settings screen
    // offers "All apps" explicitly. It is also what a key carries when nobody picked an app.
    const rows = [shared('STRIPE_SECRET_KEY'), shared('RAZORPAY_KEY_ID')];
    expect(resolveScopedSecrets(rows, 'ws-1')).toEqual({
      STRIPE_SECRET_KEY: 'STRIPE_SECRET_KEY-shared',
      RAZORPAY_KEY_ID: 'RAZORPAY_KEY_ID-shared',
    });
    expect(resolveScopedSecrets(rows, 'ws-2')).toEqual(resolveScopedSecrets(rows, 'ws-1'));
  });

  it('a caller that does not name an app still gets EVERYTHING', () => {
    // The conservative direction on purpose: narrowing must be ASKED for, so a reader that has not been
    // taught scoping keeps working rather than silently losing credentials.
    const rows = [shared('A'), forApp('B', 'ws-1'), forApp('C', 'ws-2')];
    const all = { A: 'A-shared', B: 'B-ws-1', C: 'C-ws-2' };
    expect(resolveScopedSecrets(rows, undefined)).toEqual(all);
    expect(resolveScopedSecrets(rows, null)).toEqual(all);
    expect(resolveScopedSecrets(rows, '')).toEqual(all);
    expect(resolveScopedSecrets(rows, '   ')).toEqual(all);
  });
});

describe('least privilege — an app gets only what it should', () => {
  it('another app\'s key never reaches this build', () => {
    // The actual bug: a to-do list app's .env contained the user's Razorpay secret.
    const rows = [forApp('RAZORPAY_KEY_SECRET', 'shop-app'), shared('OPENAI_API_KEY')];
    const todo = resolveScopedSecrets(rows, 'todo-app');
    expect(todo).toEqual({ OPENAI_API_KEY: 'OPENAI_API_KEY-shared' });
    expect(todo).not.toHaveProperty('RAZORPAY_KEY_SECRET');
  });

  it('the app that owns the key does get it', () => {
    const rows = [forApp('RAZORPAY_KEY_SECRET', 'shop-app')];
    expect(resolveScopedSecrets(rows, 'shop-app')).toEqual({ RAZORPAY_KEY_SECRET: 'RAZORPAY_KEY_SECRET-shop-app' });
  });
});

describe('precedence — the specific key beats the shared one', () => {
  it('an app-specific value overrides a shared value of the same name', () => {
    // Somebody with a shared Stripe key and a different one for a particular app is stating an
    // exception, and an exception that loses to the general case is not an exception.
    const rows = [shared('STRIPE_SECRET_KEY'), forApp('STRIPE_SECRET_KEY', 'client-app')];
    expect(resolveScopedSecrets(rows, 'client-app').STRIPE_SECRET_KEY).toBe('STRIPE_SECRET_KEY-client-app');
    expect(resolveScopedSecrets(rows, 'other-app').STRIPE_SECRET_KEY).toBe('STRIPE_SECRET_KEY-shared');
  });

  it('does not depend on the order the rows arrive in', () => {
    const a = [shared('K'), forApp('K', 'ws')];
    const b = [forApp('K', 'ws'), shared('K')];
    expect(resolveScopedSecrets(a, 'ws')).toEqual(resolveScopedSecrets(b, 'ws'));
    expect(resolveScopedSecrets(b, 'ws').K).toBe('K-ws');
  });
});

describe('withheldSecretNames — the mystery this would otherwise create', () => {
  it('names what this app did NOT get, so a missing key is a sentence and not a puzzle', () => {
    const rows = [shared('A'), forApp('B', 'shop'), forApp('C', 'shop'), forApp('D', 'todo')];
    expect(withheldSecretNames(rows, 'todo')).toEqual(['B', 'C']);
  });

  it('is empty when nothing was withheld, and for an unscoped caller', () => {
    const rows = [shared('A'), forApp('B', 'shop')];
    expect(withheldSecretNames([shared('A')], 'todo')).toEqual([]);
    expect(withheldSecretNames(rows, null)).toEqual([]);
  });

  it('never reports a name the app DID receive, even when a shared key was overridden', () => {
    const rows = [shared('K'), forApp('K', 'ws')];
    expect(withheldSecretNames(rows, 'ws')).toEqual([]);
    expect(withheldSecretNames(rows, 'other')).toEqual([]); // the shared K was granted
  });
});

describe('shape handling', () => {
  it('treats absent, null, empty and whitespace workspace ids as shared', () => {
    expect(isSharedSecret({})).toBe(true);
    expect(isSharedSecret({ workspaceId: null })).toBe(true);
    expect(isSharedSecret({ workspaceId: '' })).toBe(true);
    expect(isSharedSecret({ workspaceId: '   ' })).toBe(true);
    expect(isSharedSecret({ workspaceId: 'ws' })).toBe(false);
  });

  it('never throws on junk input', () => {
    expect(resolveScopedSecrets(null, 'ws')).toEqual({});
    expect(resolveScopedSecrets(undefined, null)).toEqual({});
    expect(withheldSecretNames(null, 'ws')).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// DUPLICATES (2026-09-12) — the half this file used to get wrong.
//
// "Last write wins among equally-scoped duplicates" was written down in two places and true in
// neither: the save appended a second row, and the read walked Firestore's DOCUMENT-ID order, which
// for auto-ids is random. A user rotating a leaked key had a coin flip's chance of their build
// injecting the old one — silently, with nothing failing.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe('isNewerRow', () => {
  it('the later timestamp wins', () => {
    expect(isNewerRow({ createdAt: 2000 }, { createdAt: 1000 })).toBe(true);
    expect(isNewerRow({ createdAt: 1000 }, { createdAt: 2000 })).toBe(false);
  });

  it('equal timestamps keep the incumbent, so a read is stable', () => {
    expect(isNewerRow({ createdAt: 1000 }, { createdAt: 1000 })).toBe(false);
  });

  it('a DATED row beats an undated one — an undated row predates the date being recorded', () => {
    expect(isNewerRow({ createdAt: 1 }, { createdAt: null })).toBe(true);
    expect(isNewerRow({ createdAt: null }, { createdAt: 1 })).toBe(false);
  });

  it('two undated rows do not invent a winner', () => {
    expect(isNewerRow({ createdAt: null }, { createdAt: undefined })).toBe(false);
  });

  it('a nonsense timestamp is treated as absent, never as the epoch', () => {
    expect(isNewerRow({ createdAt: NaN }, { createdAt: null })).toBe(false);
  });
});

describe('resolveScopedSecrets picks the NEWEST duplicate, not the first', () => {
  const rows: VaultSecretRow[] = [
    // Deliberately in the WRONG order — this is what an id-ordered Firestore read looks like.
    { name: 'STRIPE_SECRET_KEY', value: 'sk_leaked_old', workspaceId: null, createdAt: 1000 },
    { name: 'STRIPE_SECRET_KEY', value: 'sk_rotated_new', workspaceId: null, createdAt: 5000 },
  ];

  it('🔒 a rotated key beats the leaked one it replaced, whatever order they arrive in', () => {
    expect(resolveScopedSecrets(rows, 'app-1').STRIPE_SECRET_KEY).toBe('sk_rotated_new');
    expect(resolveScopedSecrets([...rows].reverse(), 'app-1').STRIPE_SECRET_KEY).toBe('sk_rotated_new');
  });

  it('holds for the unscoped caller too', () => {
    expect(resolveScopedSecrets(rows).STRIPE_SECRET_KEY).toBe('sk_rotated_new');
    expect(resolveScopedSecrets([...rows].reverse()).STRIPE_SECRET_KEY).toBe('sk_rotated_new');
  });

  it('🔒 scope still beats age — an OLD app-specific key overrides a NEW shared one', () => {
    // The exception a user wrote for one app must not be undone by them updating the general key.
    const mixed: VaultSecretRow[] = [
      { name: 'DATABASE_URL', value: 'shared-brand-new', workspaceId: null, createdAt: 9000 },
      { name: 'DATABASE_URL', value: 'app-1-old', workspaceId: 'app-1', createdAt: 10 },
    ];
    expect(resolveScopedSecrets(mixed, 'app-1').DATABASE_URL).toBe('app-1-old');
    expect(resolveScopedSecrets(mixed, 'app-2').DATABASE_URL).toBe('shared-brand-new');
  });

  it('undated legacy rows still resolve, and a dated row wins over them', () => {
    const legacy: VaultSecretRow[] = [
      { name: 'K', value: 'undated', workspaceId: null },
      { name: 'K', value: 'dated', workspaceId: null, createdAt: 1 },
    ];
    expect(resolveScopedSecrets(legacy, 'app-1').K).toBe('dated');
    expect(resolveScopedSecrets([...legacy].reverse(), 'app-1').K).toBe('dated');
  });
});

describe('planSecretWrite — the upstream half, so the duplicate is never created', () => {
  it('nothing stored yet ⇒ add a new document', () => {
    expect(planSecretWrite([], null)).toEqual({ replace: null, retire: [] });
  });

  it('one row of the same scope ⇒ update it in place', () => {
    expect(planSecretWrite([{ id: 'a', workspaceId: null, createdAt: 1 }], null))
      .toEqual({ replace: 'a', retire: [] });
  });

  it('duplicates already there ⇒ keep the newest and retire the rest', () => {
    const plan = planSecretWrite([
      { id: 'old', workspaceId: null, createdAt: 1000 },
      { id: 'new', workspaceId: null, createdAt: 5000 },
      { id: 'older', workspaceId: null, createdAt: 5 },
    ], null);
    expect(plan.replace).toBe('new');
    expect(plan.retire.sort()).toEqual(['old', 'older']);
  });

  it('🔒 a row of a DIFFERENT scope is never touched', () => {
    // The bug this closes: provisioning a database used to delete every row of that name, wiping the
    // key a user had deliberately tied to one of their other apps.
    const plan = planSecretWrite([
      { id: 'shared', workspaceId: null, createdAt: 1 },
      { id: 'app-1', workspaceId: 'app-1', createdAt: 2 },
      { id: 'app-2', workspaceId: 'app-2', createdAt: 3 },
    ], null);
    expect(plan.replace).toBe('shared');
    expect(plan.retire).toEqual([]);
  });

  it('saving for one app replaces only that app’s row', () => {
    const plan = planSecretWrite([
      { id: 'shared', workspaceId: null, createdAt: 1 },
      { id: 'app-1', workspaceId: 'app-1', createdAt: 2 },
    ], 'app-1');
    expect(plan).toEqual({ replace: 'app-1', retire: [] });
  });

  it('a soft-deleted row is not resurrected — a new document is added instead', () => {
    expect(planSecretWrite([{ id: 'gone', workspaceId: null, createdAt: 1, deleted: true }], null))
      .toEqual({ replace: null, retire: [] });
  });

  it('whitespace scope is the same thing as shared', () => {
    expect(planSecretWrite([{ id: 'a', workspaceId: '  ', createdAt: 1 }], '  '))
      .toEqual({ replace: 'a', retire: [] });
  });

  it('survives junk input rather than throwing on a half-read document', () => {
    expect(planSecretWrite(null, null)).toEqual({ replace: null, retire: [] });
    expect(planSecretWrite(undefined, 'app-1')).toEqual({ replace: null, retire: [] });
  });
});
