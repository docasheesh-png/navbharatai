import { describe, it, expect } from 'vitest';
import {
  credentialGuardEnabled,
  credentialGuardInstruction,
  findBootKillingEnvGuards,
  bootKillingGuardSummary,
  bootKillerRepairInstruction,
  SECRETS_SETTINGS_PATH,
} from './missingCredentialGuard';

describe('credentialGuardEnabled — default ON, one kill switch', () => {
  it('is on by default and for any value other than "off"', () => {
    expect(credentialGuardEnabled({})).toBe(true);
    expect(credentialGuardEnabled({ AGENTV3_CREDENTIAL_GUARD: '' })).toBe(true);
    expect(credentialGuardEnabled({ AGENTV3_CREDENTIAL_GUARD: 'on' })).toBe(true);
  });

  it('is off for "off" in any case / with whitespace', () => {
    expect(credentialGuardEnabled({ AGENTV3_CREDENTIAL_GUARD: 'off' })).toBe(false);
    expect(credentialGuardEnabled({ AGENTV3_CREDENTIAL_GUARD: 'OFF' })).toBe(false);
    expect(credentialGuardEnabled({ AGENTV3_CREDENTIAL_GUARD: '  Off  ' })).toBe(false);
  });
});

describe('credentialGuardInstruction — the contract the builder must follow', () => {
  const text = credentialGuardInstruction();

  it('states the absolute rule: never crash the whole app at boot for one missing key', () => {
    expect(text).toMatch(/NEVER throw/);
    expect(text).toMatch(/process\.exit/);
    expect(text).toMatch(/boot scope|module\/boot|import\/module\/boot/i);
  });

  it('mandates the visible frozen "Coming soon" state, not a hidden feature', () => {
    expect(text).toContain('Coming soon');
    expect(text).toMatch(/disabled/);
    expect(text).toMatch(/Do NOT hide or delete the feature/);
  });

  it('points at the exact settings path the user must use', () => {
    expect(text).toContain(SECRETS_SETTINGS_PATH);
    expect(SECRETS_SETTINGS_PATH).toBe('Settings → App Settings → Secrets & API Keys');
  });

  it('forbids fake success (second absolute rule)', () => {
    expect(text).toMatch(/NEVER fake the result/);
    expect(text).toMatch(/Payment successful/);
    expect(text).toMatch(/503/); // honest server response instead of a crash or a lie
  });

  it('requires the rest of the app to keep working', () => {
    expect(text).toMatch(/Everything that does NOT need that key must work completely/);
  });
});

describe('findBootKillingEnvGuards — the app-killing pattern, high precision', () => {
  it('finds the single-line top-level throw', () => {
    const found = findBootKillingEnvGuards({
      'server/pay.ts': `import Razorpay from 'razorpay';\nif (!process.env.RAZORPAY_KEY_SECRET) throw new Error('Missing RAZORPAY_KEY_SECRET');\n`,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: 'server/pay.ts', line: 2, envVar: 'RAZORPAY_KEY_SECRET' });
    expect(found[0].snippet).toContain('RAZORPAY_KEY_SECRET');
  });

  it('finds the brace form where the throw is on the next line', () => {
    const found = findBootKillingEnvGuards({
      'server/db.ts': `if (!process.env.DATABASE_URL) {\n  throw new Error('DATABASE_URL is required');\n}\n`,
    });
    expect(found.map((g) => g.envVar)).toEqual(['DATABASE_URL']);
  });

  it('finds process.exit and the import.meta.env / bracket forms', () => {
    expect(
      findBootKillingEnvGuards({ 'server/boot.ts': `if (!process.env.SMTP_HOST) process.exit(1);\n` }).map((g) => g.envVar),
    ).toEqual(['SMTP_HOST']);
    expect(
      findBootKillingEnvGuards({ 'src/main.ts': `if (!import.meta.env.VITE_API_KEY) throw new Error('no key');\n` }).map((g) => g.envVar),
    ).toEqual(['VITE_API_KEY']);
    expect(
      findBootKillingEnvGuards({ 'src/x.ts': `if (!process.env['STRIPE_SECRET_KEY']) throw new Error('x');\n` }).map((g) => g.envVar),
    ).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('does NOT flag the CORRECT pattern the contract asks for', () => {
    expect(
      findBootKillingEnvGuards({
        'src/Pay.tsx':
          `const paymentsEnabled = Boolean(import.meta.env.VITE_RAZORPAY_KEY_ID);\n` +
          `export default () => paymentsEnabled ? <PayButton/> : <button disabled>Pay now — Coming soon</button>;\n`,
      }),
    ).toEqual([]);
  });

  it('does NOT flag a throw INSIDE a handler (recoverable, not a boot-killer)', () => {
    const found = findBootKillingEnvGuards({
      'server/routes.ts':
        `app.post('/pay', (req, res) => {\n` +
        `    if (!process.env.RAZORPAY_KEY_SECRET) throw new Error('not configured');\n` +
        `});\n`,
    });
    expect(found).toEqual([]);
  });

  it('does NOT flag a plain throw with no missing-env test, or a non-fatal env check', () => {
    expect(findBootKillingEnvGuards({ 'a.ts': `throw new Error('boom');\n` })).toEqual([]);
    expect(
      findBootKillingEnvGuards({ 'a.ts': `if (!process.env.FEATURE_X) console.warn('feature off');\n` }),
    ).toEqual([]);
  });

  it('skips node_modules, dist and test files, and non-source files', () => {
    const killer = `if (!process.env.API_KEY) throw new Error('x');\n`;
    expect(
      findBootKillingEnvGuards({
        'node_modules/lib/index.js': killer,
        'dist/bundle.js': killer,
        'src/pay.test.ts': killer,
        '__tests__/pay.ts': killer,
        'README.md': killer,
      }),
    ).toEqual([]);
  });

  it('handles empty / null input and a Map without throwing', () => {
    expect(findBootKillingEnvGuards(null)).toEqual([]);
    expect(findBootKillingEnvGuards({})).toEqual([]);
    expect(findBootKillingEnvGuards(new Map([['a.ts', `if (!process.env.K) throw new Error('x');`]]))).toHaveLength(1);
  });

  it('reports every occurrence across files, in file order', () => {
    const found = findBootKillingEnvGuards({
      'server/a.ts': `if (!process.env.A_KEY) throw new Error('a');\nif (!process.env.B_KEY) throw new Error('b');\n`,
      'server/c.ts': `if (!process.env.C_KEY) process.exit(1);\n`,
    });
    expect(found.map((g) => g.envVar)).toEqual(['A_KEY', 'B_KEY', 'C_KEY']);
    expect(found.map((g) => g.line)).toEqual([1, 2, 1]);
  });
});

describe('bootKillingGuardSummary — admin-facing, honest, bounded', () => {
  it('is empty when the app is clean', () => {
    expect(bootKillingGuardSummary([])).toBe('');
    expect(bootKillingGuardSummary(null as any)).toBe('');
  });

  it('names the files and says what would actually happen', () => {
    const found = findBootKillingEnvGuards({ 'server/pay.ts': `if (!process.env.RAZORPAY_KEY_SECRET) throw new Error('x');\n` });
    const msg = bootKillingGuardSummary(found);
    expect(msg).toContain('server/pay.ts:1');
    expect(msg).toContain('RAZORPAY_KEY_SECRET');
    expect(msg).toMatch(/WHOLE app down/);
  });

  it('caps the list at 8 and says how many more', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ file: `f${i}.ts`, line: 1, envVar: `K${i}`, snippet: '' }));
    const msg = bootKillingGuardSummary(many);
    expect(msg).toContain('11 boot-killing env guard(s)');
    expect(msg).toContain('+3 more');
    expect(msg).not.toContain('f9.ts');
  });
});

describe('bootKillerRepairInstruction — focused, safe, non-destructive', () => {
  const found = findBootKillingEnvGuards({
    'server/pay.ts': `if (!process.env.RAZORPAY_KEY_SECRET) throw new Error('missing');\n`,
    'server/db.ts': `if (!process.env.DATABASE_URL) process.exit(1);\n`,
  });
  const text = bootKillerRepairInstruction(found);

  it('names every offending file:line and env var so the healer cannot guess', () => {
    expect(text).toContain('server/pay.ts:1');
    expect(text).toContain('RAZORPAY_KEY_SECRET');
    expect(text).toContain('server/db.ts:1');
    expect(text).toContain('DATABASE_URL');
  });

  it('asks for the boolean + "Coming soon" shape, not a hidden feature', () => {
    expect(text).toMatch(/Boolean\(process\.env/);
    expect(text).toContain('Coming soon');
    expect(text).toContain(SECRETS_SETTINGS_PATH);
    expect(text).toMatch(/Do not hide or delete the feature/);
  });

  it('blocks the two UNSAFE shortcuts (re-adding a throw, or silencing TS with a non-null assertion)', () => {
    expect(text).toMatch(/do not re-add a top-level throw/i);
    expect(text).toMatch(/non-null assertion/i);
  });

  it('keeps the blast radius small — no refactors, no renames, no unrelated changes', () => {
    expect(text).toMatch(/Fix ONLY this, nothing else/);
    expect(text).toMatch(/Do not refactor anything else/);
  });

  it('still forbids faking a result, and requires an honest 503 on the server', () => {
    expect(text).toMatch(/NEVER fake a result/);
    expect(text).toContain('503');
  });

  it('caps the listed items at 20 so a pathological app cannot blow up the prompt', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ file: `f${i}.ts`, line: 1, envVar: `K${i}`, snippet: 'x' }));
    const msg = bootKillerRepairInstruction(many);
    expect(msg).toContain('f19.ts');
    expect(msg).not.toContain('f20.ts');
  });
});
