import { describe, it, expect } from 'vitest';
import {
  looksLikePlaceholder,
  isUrlShapedName,
  classifySecretShape,
  checkableSecrets,
  verifyInjectedSecrets,
  preflightNarration,
  MAX_CHECKS,
  type ConnectionProbe,
} from './secretPreflight';

/**
 * A SAVED CREDENTIAL IS NOT A WORKING ONE (admin finding 3, 2026-08-06).
 *
 * The build used to copy every vault key into the app and announce "🔐 Loaded 3 of your saved keys" —
 * a sentence about the COPY that says nothing about the TRUTH. A dead connection string got the same
 * confident line as a live one, and the user learned otherwise from a preview that would not load.
 */

const okProbe: ConnectionProbe = async () => ({ ok: true });
const deadProbe: ConnectionProbe = async () => ({ ok: false, message: 'Your database did not answer.', detail: 'ECONNREFUSED 1.2.3.4:5432' });

describe('looksLikePlaceholder — narrow on purpose', () => {
  it('catches the shapes people leave behind after copying a README', () => {
    expect(looksLikePlaceholder('<your-key-here>')).toBe(true);
    expect(looksLikePlaceholder('your-api-key')).toBe(true);
    expect(looksLikePlaceholder('your_key_here')).toBe(true);
    expect(looksLikePlaceholder('changeme')).toBe(true);
    expect(looksLikePlaceholder('xxxxxxxx')).toBe(true);
    expect(looksLikePlaceholder('aaaaaaaa')).toBe(true);
  });

  it('NEVER calls a real secret a placeholder — a false positive is worse than saying nothing', () => {
    // The separator is what makes the `your|my` rule safe; without it these are ordinary secrets.
    expect(looksLikePlaceholder('mysecretpassword')).toBe(false);
    expect(looksLikePlaceholder('yourgeneratedtoken99')).toBe(false);
    expect(looksLikePlaceholder('sk-live-8fa93bd21c')).toBe(false);
    expect(looksLikePlaceholder('Nav@8949199709')).toBe(false);
    expect(looksLikePlaceholder('postgresql://u:p@host:5432/db')).toBe(false);
  });

  it('an ABSENT value is not a placeholder — those are different facts', () => {
    expect(looksLikePlaceholder('')).toBe(false);
    expect(looksLikePlaceholder('   ')).toBe(false);
    expect(looksLikePlaceholder(null)).toBe(false);
    expect(looksLikePlaceholder(undefined)).toBe(false);
  });
});

describe('classifySecretShape — what can be said without opening a connection', () => {
  it('a Postgres URL is the one thing worth actually testing', () => {
    expect(classifySecretShape('DATABASE_URL', 'postgresql://u:p@ep-x.example.com/db')).toBe('checkable');
    expect(classifySecretShape('NEON_DATABASE_URL', 'postgres://u:p@h/db')).toBe('checkable');
  });

  it('a URL-shaped NAME whose value is not a URL could never have worked', () => {
    expect(classifySecretShape('SUPABASE_URL', 'not a url')).toBe('malformed');
    expect(classifySecretShape('WEBHOOK_ENDPOINT', 'localhost:3000')).toBe('malformed');
  });

  it('an API key is UNCHECKED, never an implied pass — testing it would spend the user\'s money', () => {
    expect(classifySecretShape('STRIPE_SECRET_KEY', 'sk_live_abc123')).toBe('unchecked');
    expect(classifySecretShape('RAZORPAY_KEY_SECRET', 'Nav@8949199709')).toBe('unchecked');
  });

  it('a LOOPBACK database is unchecked — it is reachable only from inside the sandbox that owns it', () => {
    // Probing it from this server would fail for a reason that is ours, not theirs, and calling that
    // "your database is broken" would be a confident lie about our own network.
    expect(classifySecretShape('DATABASE_URL', 'postgresql://postgres@localhost:5432/myapp')).toBe('unchecked');
    expect(classifySecretShape('DATABASE_URL', 'postgres://u:p@127.0.0.1:5432/db')).toBe('unchecked');
    expect(checkableSecrets({ DATABASE_URL: 'postgresql://postgres@localhost:5432/myapp' })).toEqual([]);
  });

  it('a MongoDB or MySQL URL is unchecked, not checkable — we have no transport that opens one', () => {
    // Claiming to have tested a connection we cannot open would be the exact dishonesty this file exists
    // to remove.
    expect(classifySecretShape('MONGODB_URI', 'mongodb+srv://u:p@cluster0.example.net/db')).toBe('unchecked');
    expect(classifySecretShape('MYSQL_URL', 'mysql://u:p@host:3306/db')).toBe('unchecked');
  });
});

describe('checkableSecrets — bounded, and the most important one first', () => {
  it('opens at most MAX_CHECKS connections however many are saved', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 10; i++) many[`DB_${i}_URL`] = `postgresql://u:p@h${i}/db`;
    expect(checkableSecrets(many)).toHaveLength(MAX_CHECKS);
  });

  it('DATABASE_URL is checked first — it is the one the app\'s own code almost certainly reads', () => {
    const s = { AAA_DATABASE_URL: 'postgres://u:p@a/db', DATABASE_URL: 'postgres://u:p@b/db' };
    expect(checkableSecrets(s)[0]).toBe('DATABASE_URL');
  });

  it('nothing checkable means nothing is opened at all — a vault of API keys costs the build zero', () => {
    expect(checkableSecrets({ STRIPE_SECRET_KEY: 'sk_live_x' })).toEqual([]);
  });
});

describe('verifyInjectedSecrets — the verdicts', () => {
  it('a live database is reported as PROVEN, not merely copied', async () => {
    const v = await verifyInjectedSecrets({ DATABASE_URL: 'postgres://u:p@h/db' }, okProbe);
    expect(v).toEqual([{ name: 'DATABASE_URL', status: 'ok', message: 'DATABASE_URL connected successfully.' }]);
  });

  it('a DEAD database is caught HERE, not by a preview that will not load ten minutes later', async () => {
    const v = await verifyInjectedSecrets({ DATABASE_URL: 'postgres://u:p@h/db' }, deadProbe);
    expect(v[0].status).toBe('broken');
    expect(v[0].message).toBe('Your database did not answer.');
    expect(v[0].detail).toContain('ECONNREFUSED'); // admin report only
  });

  it('every saved key gets a verdict — none is silently skipped', async () => {
    const v = await verifyInjectedSecrets({
      DATABASE_URL: 'postgres://u:p@h/db',
      STRIPE_SECRET_KEY: 'sk_live_x',
      SUPABASE_URL: 'nope',
    }, okProbe);
    expect(v.map((x) => x.name)).toEqual(['DATABASE_URL', 'STRIPE_SECRET_KEY', 'SUPABASE_URL']);
    expect(v.find((x) => x.name === 'STRIPE_SECRET_KEY')!.status).toBe('unchecked');
    expect(v.find((x) => x.name === 'SUPABASE_URL')!.status).toBe('malformed');
  });

  it('OUR failure is never reported as THEIR broken credential', async () => {
    const throwing: ConnectionProbe = async () => { throw new Error('probe blew up'); };
    const v = await verifyInjectedSecrets({ DATABASE_URL: 'postgres://u:p@h/db' }, throwing);
    expect(v[0].status).toBe('unchecked');
    expect(v[0].message).toContain('could not be tested');
  });

  it('a database that never answers costs the build the budget and no more', async () => {
    const hanging: ConnectionProbe = () => new Promise(() => { /* never settles */ });
    const started = Date.now();
    const v = await verifyInjectedSecrets({ DATABASE_URL: 'postgres://u:p@h/db' }, hanging, 40);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(v[0].status).toBe('unchecked'); // could not tell — never "broken", never "ok"
  });

  it('an empty vault does no work and says nothing', async () => {
    expect(await verifyInjectedSecrets({}, okProbe)).toEqual([]);
  });
});

describe('preflightNarration — the three facts that were being blurred into one', () => {
  it('says how many were PROVEN, not just how many were copied', () => {
    const { loaded } = preflightNarration([
      { name: 'DATABASE_URL', status: 'ok', message: 'x' },
      { name: 'STRIPE_SECRET_KEY', status: 'unchecked', message: 'y' },
    ]);
    expect(loaded).toContain('Loaded 2 of your saved keys');
    expect(loaded).toContain('1 of them tested and working');
  });

  it('claims nothing when nothing could be tested', () => {
    const { loaded, problems } = preflightNarration([{ name: 'STRIPE_SECRET_KEY', status: 'unchecked', message: 'y' }]);
    expect(loaded).not.toContain('tested and working');
    expect(problems).toEqual([]);
  });

  it('a broken database names the consequence the user actually cares about', () => {
    const { problems } = preflightNarration([{ name: 'DATABASE_URL', status: 'broken', message: 'Your database did not answer.' }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Your database did not answer.');
    expect(problems[0]).toContain('will not be able to save or read data');
  });

  it('WHITE-LABEL LAW — no vendor or driver text ever reaches these lines', () => {
    const { loaded, problems } = preflightNarration([
      { name: 'DATABASE_URL', status: 'broken', message: 'Your database did not answer.', detail: 'ECONNREFUSED ep-snowy.neon.tech' },
      { name: 'X', status: 'placeholder', message: 'X looks like an example value rather than a real one. Replace it in Settings → Secrets & API Keys.' },
    ]);
    const all = [loaded, ...problems].join(' ');
    for (const banned of ['neon', 'ECONNREFUSED', 'supabase', 'postgres', 'pg_hba', 'Anthropic', 'Claude']) {
      expect(all.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('the singular reads like English', () => {
    expect(preflightNarration([{ name: 'A', status: 'unchecked', message: '' }]).loaded).toContain('1 of your saved key ');
  });
});
