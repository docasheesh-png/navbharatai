// PAYMENT VERIFICATION IN THE USER'S OWN SUPABASE (admin 2026-09-29). An app with no server could only
// mark an order paid from the browser's checkout callback. These tests lock the server half that now
// lives in the user's own project: what it deploys, what it refuses, and that nothing reports success
// for a partial setup.

import { describe, it, expect, vi } from 'vitest';
import { transformSync } from 'esbuild';
import { readFileSync } from 'fs';
import {
  PAYMENTS_FUNCTION_SLUG, PAYMENT_SECRET_NAMES, isSafeTableName, paymentGuardSql, paymentsFunctionSource,
  paymentsClientHelper, deployEdgeFunction, setProjectSecrets, setupSupabasePayments, supabasePaymentsEnabled,
  serverlessPaymentGuidance,
} from '../src/server/lib/supabasePayments';
import { supabaseScopes, SUPABASE_SCOPES, buildSupabaseAuthorizeUrl } from '../src/server/lib/supabaseOAuth';
import { PAYMENTS_CLIENT_PATH } from '../src/server/lib/supabasePayments';
import { noServerPaymentGuidance } from '../src/server/lib/PaymentGenerator';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

type Call = { url: string; init: RequestInit };
function fakeFetch(statusFor: (url: string) => number, bodyFor: (url: string) => unknown = () => ({})) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const status = statusFor(url);
    const body = bodyFor(url);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('the switch and the consent screen', () => {
  it('is off unless the value is exactly "on"', () => {
    expect(supabasePaymentsEnabled({})).toBe(false);
    expect(supabasePaymentsEnabled({ AGENTV3_SUPABASE_PAYMENTS: 'yes' })).toBe(false);
    expect(supabasePaymentsEnabled({ AGENTV3_SUPABASE_PAYMENTS: ' ON ' })).toBe(true);
  });

  it('asks for Edge Functions and Secrets write ONLY when the path is on', () => {
    expect(supabaseScopes({})).toEqual([...SUPABASE_SCOPES]);
    const on = supabaseScopes({ AGENTV3_SUPABASE_PAYMENTS: 'on' });
    expect(on).toEqual([...SUPABASE_SCOPES, 'edge_functions.write', 'secrets.write']);
  });

  it('the authorize URL carries the scopes the switch decides', () => {
    const url = new URL(buildSupabaseAuthorizeUrl({ clientId: 'c', redirectUri: 'https://x/cb', state: 's', codeChallenge: 'cc' }));
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(supabaseScopes());
  });
});

describe('table names', () => {
  it('accepts plain lower-case identifiers and refuses everything else', () => {
    for (const ok of ['bookings', 'orders_2026', '_x']) expect(isSafeTableName(ok)).toBe(true);
    for (const bad of ['Bookings', 'a-b', 'a;drop table x', '1orders', '', 'a'.repeat(64), undefined, 3]) {
      expect(isSafeTableName(bad)).toBe(false);
    }
  });

  it('the guard SQL refuses an unsafe name instead of quoting it', () => {
    expect(() => paymentGuardSql('x; drop table y')).toThrow();
  });
});

describe('the guard SQL', () => {
  const sql = paymentGuardSql('bookings');

  it('adds the payment columns idempotently to the app\'s own table', () => {
    for (const col of ['amount_due integer', "payment_status text not null default 'pending'", 'payment_id text', 'paid_amount integer']) {
      expect(sql).toContain(`alter table public.bookings add column if not exists ${col};`);
    }
    expect(sql).toContain('drop trigger if exists nbai_guard_payment on public.bookings;');
  });

  it('restricts only the browser roles, so the owner\'s dashboard is never blocked', () => {
    expect(sql).toContain("if r not in ('anon', 'authenticated') then return new; end if;");
  });

  it('forces a new row to pending, and refuses browser changes to the payment fields', () => {
    expect(sql).toMatch(/tg_op = 'INSERT'[\s\S]*new\.payment_status := 'pending'/);
    for (const f of ['payment_status', 'payment_id', 'paid_amount', 'amount_due']) {
      expect(sql).toContain(`new.${f} is distinct from old.${f}`);
    }
    expect(sql).toContain('raise exception');
  });
});

describe('the generated code', () => {
  it('the Edge Function parses as TypeScript', () => {
    expect(() => transformSync(paymentsFunctionSource(), { loader: 'ts' })).not.toThrow();
  });

  it('the client helper parses as TypeScript and calls the deployed slug', () => {
    const src = paymentsClientHelper();
    expect(() => transformSync(src, { loader: 'ts' })).not.toThrow();
    expect(src).toContain(`/functions/v1/${PAYMENTS_FUNCTION_SLUG}`);
  });

  it('the function reads the amount from the row, never from the request', () => {
    const src = paymentsFunctionSource();
    expect(src).toContain('const amount = Number(row.amount_due);');
    expect(src).not.toMatch(/body\.amount\b/);
  });

  it('the function verifies the signature before it marks anything paid', () => {
    const src = paymentsFunctionSource();
    const verifyAt = src.indexOf('sameText(expected, signature)');
    const patchAt = src.indexOf("payment_status: 'paid'");
    expect(verifyAt).toBeGreaterThan(0);
    expect(patchAt).toBeGreaterThan(verifyAt);
    expect(src).toContain('`${orderId}|${paymentId}`');
    // …and confirms the order belongs to THIS row and amount.
    expect(src).toContain('order?.notes?.nbai_table !== table');
    expect(src).toContain('Number(order.amount) !== amount');
  });

  it('the function only serves allowlisted tables', () => {
    const src = paymentsFunctionSource();
    expect(src).toContain(`env('${PAYMENT_SECRET_NAMES.tables}')`);
    expect(src.indexOf('TABLES.includes(table)')).toBeLessThan(src.indexOf('await readRow'));
  });

  it('the browser helper never marks a record paid itself', () => {
    const src = paymentsClientHelper();
    expect(src).not.toContain("payment_status");
    expect(src).toContain("action: 'verify'");
  });
});

describe('the Management API calls', () => {
  it('deploys the function as multipart with verify_jwt off and the fixed slug', async () => {
    const { f, calls } = fakeFetch(() => 201, () => ({ version: 3 }));
    const r = await deployEdgeFunction('tok', 'abcdefghijklmnopqrst', PAYMENTS_FUNCTION_SLUG, 'src', f);
    expect(r).toEqual({ ok: true, version: 3 });
    expect(calls[0].url).toBe('https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/functions/deploy?slug=nbai-payments');
    const form = calls[0].init.body as FormData;
    expect(JSON.parse(String(form.get('metadata')))).toEqual({ entrypoint_path: 'index.ts', name: 'nbai-payments', verify_jwt: false });
    expect((form.get('file') as File).name).toBe('index.ts');
    // No Content-Type by hand — the runtime must write the multipart boundary itself.
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('a missing permission reads as "reconnect", never as our bug', async () => {
    const { f } = fakeFetch(() => 403);
    const r = await deployEdgeFunction('tok', 'ref', 's', 'src', f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure).toBe('unauthorized');
      expect(r.message).toMatch(/reconnect Supabase/);
    }
  });

  it('writes secrets as a name/value array and refuses reserved or empty ones', async () => {
    const { f, calls } = fakeFetch(() => 201);
    expect(await setProjectSecrets('tok', 'ref', { A: '1' }, f)).toEqual({ ok: true });
    expect(JSON.parse(String(calls[0].init.body))).toEqual([{ name: 'A', value: '1' }]);
    expect((await setProjectSecrets('tok', 'ref', { SUPABASE_X: '1' }, f)).ok).toBe(false);
    expect((await setProjectSecrets('tok', 'ref', { A: '' }, f)).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('the whole setup', () => {
  const base = { token: 'tok', projectRef: 'ref', tables: ['bookings'], keyId: 'rzp_test_1', keySecret: 's3cret' };

  it('runs guard SQL, then secrets, then the function, and reports success only when all three worked', async () => {
    const { f, calls } = fakeFetch(() => 201);
    expect(await setupSupabasePayments({ ...base, fetchImpl: f })).toEqual({ ok: true });
    expect(calls.map((c) => c.url.replace('https://api.supabase.com/v1/projects/ref/', ''))).toEqual([
      'database/query', 'secrets', 'functions/deploy?slug=nbai-payments',
    ]);
    const secrets = JSON.parse(String(calls[1].init.body));
    expect(secrets).toEqual([
      { name: 'RAZORPAY_KEY_ID', value: 'rzp_test_1' },
      { name: 'RAZORPAY_KEY_SECRET', value: 's3cret' },
      { name: 'NBAI_PAYMENT_TABLES', value: 'bookings' },
    ]);
  });

  it('stops at the first failure: a missing table never deploys a function or stores keys', async () => {
    const { f, calls } = fakeFetch((u) => (u.endsWith('database/query') ? 400 : 201), () => ({ message: 'relation "public.bookings" does not exist' }));
    const r = await setupSupabasePayments({ ...base, fetchImpl: f });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/"bookings" table/);
    expect(calls).toHaveLength(1);
  });

  it('a refused secrets write never deploys the function', async () => {
    const { f, calls } = fakeFetch((u) => (u.endsWith('/secrets') ? 403 : 201));
    expect((await setupSupabasePayments({ ...base, fetchImpl: f })).ok).toBe(false);
    expect(calls.some((c) => c.url.includes('functions/deploy'))).toBe(false);
  });

  it('refuses an unsafe or missing table before calling anything', async () => {
    const { f, calls } = fakeFetch(() => 201);
    expect((await setupSupabasePayments({ ...base, tables: ['Bad Name'], fetchImpl: f })).ok).toBe(false);
    expect((await setupSupabasePayments({ ...base, tables: [], fetchImpl: f })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('never puts a key value into a user-facing message', async () => {
    const { f } = fakeFetch(() => 500, () => 'boom');
    const r = await setupSupabasePayments({ ...base, fetchImpl: f });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain('s3cret');
  });
});

describe('the builder\'s guidance', () => {
  it('tells it to write the amount in paise and to trust only a verified result', () => {
    const g = serverlessPaymentGuidance('bookings');
    expect(g).toContain('PAISE');
    expect(g).toContain("payForRecord('bookings'");
    expect(g).toContain('{ paid: true }');
    expect(g).toMatch(/never set payment_status/);
  });
});

describe('wiring', () => {
  const dispatcher = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the no-server branch reaches the Supabase path only for razorpay with a handler', () => {
    expect(dispatcher).toContain("if (pProvider !== 'razorpay' || !this.onServerlessPayment) return noServerPaymentGuidance(pProvider);");
  });

  it('a failed or unavailable setup still ends in the honest "payment pending" guidance', () => {
    const body = dispatcher.slice(dispatcher.indexOf('private async setUpServerlessPayment'));
    expect(body).toContain('if (!result) return pending;');
    expect(body).toContain('Online payment could not be set up');
  });

  it('the route wires the handler only behind the switch and a verified user', () => {
    expect(route).toContain('if (userId && supabasePaymentsEnabled()) {');
    expect(route).toContain('dispatcher.setServerlessPaymentHandler(');
  });

  it('sub-agents receive the same setup', () => {
    expect(readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8')).toContain('childDispatcher.setServerlessPaymentHandler(pay)');
    expect(route).toContain('serverlessPayment: () => dispatcherForSubAgents?.serverlessPaymentHandler(),');
  });
});

// ── The dispatcher branch, driven for real ───────────────────────────────────────────────────────────

class StaticApp implements ActuatorPort {
  files = new Map<string, string>([
    ['package.json', JSON.stringify({ dependencies: { react: '^19.0.0', '@supabase/supabase-js': '^2.0.0' } })],
    ['src/App.tsx', 'export default function App() { return null; }'],
  ]);
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

function dispatcherFor(act: StaticApp) {
  const stream = new AgentEventStream();
  return new ToolDispatcher(act, 'ws-pay', new WorkspaceState(stream), stream);
}
const pay = (input: Record<string, unknown>) => ({ id: 't1', name: 'generate_payment', input });
const pending = () => noServerPaymentGuidance('razorpay');

describe('generate_payment on an app with no server', () => {
  it('without the setup wired, it is exactly the honest "payment pending" guidance', async () => {
    const act = new StaticApp();
    const res = await dispatcherFor(act).dispatch(pay({ provider: 'razorpay', table: 'bookings' }), 'architect');
    expect(res.content).toBe(pending());
    expect(act.files.has(PAYMENTS_CLIENT_PATH)).toBe(false);
  });

  it('asks for the table name before touching anything', async () => {
    const d = dispatcherFor(new StaticApp());
    const handler = vi.fn();
    d.setServerlessPaymentHandler(handler);
    const res = await d.dispatch(pay({ provider: 'razorpay' }), 'architect');
    expect(res.content).toMatch(/Call generate_payment again with provider = "razorpay" and table/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a successful setup writes the client helper and returns the usage guidance', async () => {
    const act = new StaticApp();
    const d = dispatcherFor(act);
    d.setServerlessPaymentHandler(async () => ({ ok: true }));
    const res = await d.dispatch(pay({ provider: 'razorpay', table: 'bookings' }), 'architect');
    expect(res.content).toContain("payForRecord('bookings'");
    expect(act.files.get(PAYMENTS_CLIENT_PATH)).toContain('export async function payForRecord');
  });

  it('missing keys are asked for ONCE through the key card, then the setup is retried', async () => {
    const d = dispatcherFor(new StaticApp());
    const results: Array<{ ok: true } | { ok: false; needKeys: boolean; message: string }> = [
      { ok: false, needKeys: true, message: 'x' }, { ok: true },
    ];
    const handler = vi.fn(async () => results.shift()!);
    const ask = vi.fn(async () => ({ RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' }));
    d.setServerlessPaymentHandler(handler);
    d.setSecretRequestHandler(ask);
    const res = await d.dispatch(pay({ provider: 'razorpay', table: 'bookings' }), 'architect');
    expect(ask).toHaveBeenCalledTimes(1);
    expect((ask.mock.calls[0] as unknown as [Array<{ name: string }>])[0].map((a) => a.name)).toEqual(['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(res.content).toContain('payForRecord');
  });

  it('a skipped key card falls back to "payment pending" and writes nothing', async () => {
    const act = new StaticApp();
    const d = dispatcherFor(act);
    d.setServerlessPaymentHandler(async () => ({ ok: false, needKeys: true, message: 'x' }));
    d.setSecretRequestHandler(async () => null);
    const res = await d.dispatch(pay({ provider: 'razorpay', table: 'bookings' }), 'architect');
    expect(res.content.startsWith(pending())).toBe(true);
    expect(act.files.has(PAYMENTS_CLIENT_PATH)).toBe(false);
  });

  it('a sub-agent without the key card is told the keys are needed, not left guessing', async () => {
    const d = dispatcherFor(new StaticApp());
    d.setServerlessPaymentHandler(async () => ({ ok: false, needKeys: true, message: 'x' }));
    const res = await d.dispatch(pay({ provider: 'razorpay', table: 'bookings' }), 'frontend');
    expect(res.content).toContain('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  });

  it('a refused setup keeps "payment pending" and says why, in the user\'s words', async () => {
    const act = new StaticApp();
    const d = dispatcherFor(act);
    d.setServerlessPaymentHandler(async () => ({ ok: false, message: 'Please reconnect Supabase.' }));
    const res = await d.dispatch(pay({ provider: 'razorpay', table: 'bookings' }), 'architect');
    expect(res.content).toContain('Online payment could not be set up: Please reconnect Supabase.');
    expect(act.files.has(PAYMENTS_CLIENT_PATH)).toBe(false);
  });

  it('other providers never reach the Supabase path', async () => {
    const d = dispatcherFor(new StaticApp());
    const handler = vi.fn();
    d.setServerlessPaymentHandler(handler);
    await d.dispatch(pay({ provider: 'stripe', table: 'bookings' }), 'architect');
    expect(handler).not.toHaveBeenCalled();
  });
});
