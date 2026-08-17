import { describe, it, expect } from 'vitest';
import { resolveScopedSecrets, withheldSecretNames, isSharedSecret, type VaultSecretRow } from './secretScope';

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
