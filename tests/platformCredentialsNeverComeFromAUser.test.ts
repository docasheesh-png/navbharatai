// Forensic audit 2026-10-04 (P0) — NavBharatAI's own merchant credentials never come from a user.
//
// Order creation and verification read the Cashfree credentials through a helper that checked the server
// environment and then the CALLER'S OWN secret vault. Production sets the CASHFREE_APP_ID/SECRET_KEY pair,
// so the CLIENT_ID/CLIENT_SECRET names fell through to whatever the user had saved: a user's own sandbox
// merchant account then created the order AND confirmed it was paid, and real wallet money was credited.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { platformCashfreeCredentials, platformCashfreeWebhookSecret } from '../src/server/lib/cashfreeCredentials';

const PROD = { CASHFREE_APP_ID: 'prod-app-id', CASHFREE_SECRET_KEY: 'cfsk_ma_prod_abc' } as NodeJS.ProcessEnv;

describe('the merchant credentials come from the server environment only', () => {
  it('the production pair is used, whatever names a user might have saved', () => {
    const c = platformCashfreeCredentials(PROD);
    expect(c).toMatchObject({ clientId: 'prod-app-id', clientSecret: 'cfsk_ma_prod_abc', mode: 'production', placeholder: false });
  });

  it('the function cannot be asked about a user — it takes no user id', () => {
    expect(platformCashfreeCredentials.length).toBeLessThanOrEqual(1);
    const code = readFileSync('src/server/lib/cashfreeCredentials.ts', 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toMatch(/userId|user_secrets|loadUserVault|getDoc|collection\(/);
  });

  it('create and verify can never disagree on the Cashfree host: one decision', () => {
    expect(platformCashfreeCredentials({ ...PROD, CASHFREE_ENV: 'sandbox' }).mode).toBe('sandbox');
    expect(platformCashfreeCredentials({ CASHFREE_APP_ID: 'TEST123', CASHFREE_SECRET_KEY: 'cfsk_ma_test_x' } as NodeJS.ProcessEnv).mode).toBe('sandbox');
    expect(platformCashfreeCredentials({ CASHFREE_APP_ID: 'a', CASHFREE_SECRET_KEY: 'sim_x' } as NodeJS.ProcessEnv).mode).toBe('sandbox');
  });

  it('missing values are a placeholder, never a call', () => {
    expect(platformCashfreeCredentials({} as NodeJS.ProcessEnv).placeholder).toBe(true);
  });

  it('the webhook secret is the environment\'s, or none', () => {
    expect(platformCashfreeWebhookSecret({ CASHFREE_WEBHOOK_SECRET: ' s3 ' } as NodeJS.ProcessEnv)).toBe('s3');
    expect(platformCashfreeWebhookSecret({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

function serverSources(): string[] {
  const out: string[] = ['server.ts'];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.ts$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
  };
  walk('src/server');
  return out;
}

describe('census: no helper mixes a user\'s vault with the platform\'s environment', () => {
  it('getSecretValue (environment, then the caller\'s vault) is gone and stays gone', () => {
    const code = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    expect(serverSources().filter((f) => /\bgetSecretValue\s*\(/.test(code(f)))).toEqual([]);
  });

  it('the payment code reads no user vault and no CASHFREE_ variable directly', () => {
    for (const f of ['src/server/routes/payment.ts', 'src/server/lib/payments.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/loadUserVaultSecrets|user_secrets/);
      expect(src, f).not.toMatch(/process\.env\.CASHFREE_(?:APP_ID|SECRET_KEY|CLIENT_ID|CLIENT_SECRET|WEBHOOK_SECRET)/);
      // Through the platform's own credential module: `platformCashfree…` or, since Q-615, the one
      // availability decision `cashfreePaymentsAvailability` (cashfreeCredentials.ts) built on it.
      expect(src, f).toMatch(/platformCashfree|cashfreePaymentsAvailability/);
    }
  });
});
