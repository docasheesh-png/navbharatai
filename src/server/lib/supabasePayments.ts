// PAYMENT VERIFICATION IN THE USER'S OWN SUPABASE (admin 2026-09-29: "database aur payment verification
// wala kaam shuru karo", choosing the user's own Supabase for both).
//
// THE PROBLEM THIS CLOSES. A generated app with no server of its own could only ever mark an order paid
// from the BROWSER's checkout-success callback — which anyone can call with any value. So a payment in
// such an app was never verified by anything, and PR A (#3385) made the builder say so honestly
// ("payment pending") instead of writing an Express route nothing would mount.
//
// This is the real server half, placed where the user's data already lives: one Supabase Edge Function,
// deployed into the USER'S OWN project, that
//   • creates the Razorpay order for the amount stored on the row (never an amount from the browser), and
//   • verifies Razorpay's HMAC signature before it marks that row paid, using the service role.
// A database trigger makes the payment columns unwritable by `anon` / `authenticated`, so the browser
// cannot set `payment_status = 'paid'` itself however the app is written.
//
// OWNERSHIP, the standing rule: the function runs in the user's project and bills the user's account;
// the Razorpay keys are the user's, stored as that project's secrets; NavBharatAI stores nothing here.
//
// HONEST LIMIT, said in the guidance the builder receives: `amount_due` is written by the app when the
// row is created. The trigger stops it being CHANGED from the browser afterwards, but a hostile client
// can still create a row with a small amount. `paid_amount` records what Razorpay actually charged, so
// the owner can always compare the two. Pricing that cannot be chosen by the client at all needs the
// price to live in a server-owned table — a later slice, not claimed here.
//
// Every network call takes an injected `fetch`, so each branch is unit-tested without a network.

import { SUPABASE_API, classifyStatus, applySchemaToProject, type ProvisionError } from './supabaseProvision';

type Fetch = typeof globalThis.fetch;

/** The function's slug in the user's project. Fixed — the client helper calls exactly this path. */
export const PAYMENTS_FUNCTION_SLUG = 'nbai-payments';

/** Secret names written into the user's project. None may start with `SUPABASE_` (Supabase reserves it). */
export const PAYMENT_SECRET_NAMES = {
  keyId: 'RAZORPAY_KEY_ID',
  keySecret: 'RAZORPAY_KEY_SECRET',
  tables: 'NBAI_PAYMENT_TABLES',
} as const;

/** Where the builder's client helper is written in the user's app. */
export const PAYMENTS_CLIENT_PATH = 'src/lib/payments.ts';

/**
 * Master switch. OFF unless the value is exactly `on`: this path deploys code into a user's own
 * account, so an unreadable value must never enable it.
 */
export function supabasePaymentsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SUPABASE_PAYMENTS ?? '').trim().toLowerCase() === 'on';
}

/**
 * A table name we are willing to put into SQL and into a REST path. Lower-case identifiers only —
 * anything else is refused rather than quoted, because a name we had to escape is a name the app's own
 * schema did not produce.
 */
export function isSafeTableName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(name);
}

/**
 * The columns and the guard trigger. Idempotent (`if not exists`, `create or replace`, drop-then-create
 * trigger), so running it twice on the same table is harmless. The table must already exist — it is the
 * app's own table; this only adds what payment needs to it.
 */
export function paymentGuardSql(table: string): string {
  if (!isSafeTableName(table)) throw new Error(`unsafe table name: ${String(table)}`);
  const t = `public.${table}`;
  const fn = `nbai_guard_payment_${table}`.slice(0, 63);
  const trg = `nbai_guard_payment`;
  return [
    `alter table ${t} add column if not exists amount_due integer;`,
    `alter table ${t} add column if not exists payment_status text not null default 'pending';`,
    `alter table ${t} add column if not exists payment_id text;`,
    `alter table ${t} add column if not exists paid_amount integer;`,
    // The browser talks to the database as `anon` or `authenticated`; the Edge Function uses the
    // service role. Only those two browser roles are restricted, so the project owner editing in the
    // Supabase dashboard is never blocked.
    `create or replace function public.${fn}() returns trigger language plpgsql as $$`,
    `declare r text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '');`,
    `begin`,
    `  if r not in ('anon', 'authenticated') then return new; end if;`,
    `  if tg_op = 'INSERT' then`,
    `    new.payment_status := 'pending'; new.payment_id := null; new.paid_amount := null;`,
    `    return new;`,
    `  end if;`,
    `  if new.payment_status is distinct from old.payment_status`,
    `     or new.payment_id is distinct from old.payment_id`,
    `     or new.paid_amount is distinct from old.paid_amount`,
    `     or new.amount_due is distinct from old.amount_due then`,
    `    raise exception 'Payment fields can only be changed by the payment service';`,
    `  end if;`,
    `  return new;`,
    `end $$;`,
    `drop trigger if exists ${trg} on ${t};`,
    `create trigger ${trg} before insert or update on ${t} for each row execute function public.${fn}();`,
  ].join('\n');
}

/**
 * The Edge Function (Deno). Two actions:
 *   order  — reads `amount_due` from the row with the service role and creates the Razorpay order.
 *   verify — checks Razorpay's signature, confirms the order belongs to that row and amount, then
 *            marks the row paid.
 * Tables are allowlisted through a project secret, so the function cannot be pointed at any other table.
 */
export function paymentsFunctionSource(): string {
  return `// NavBharatAI payment verification — runs in YOUR Supabase project with YOUR Razorpay keys.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const env = (k: string) => Deno.env.get(k) ?? '';
const TABLES = env('${PAYMENT_SECRET_NAMES.tables}').split(',').map((s) => s.trim()).filter(Boolean);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function rest(path: string, init: RequestInit = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(\`\${env('SUPABASE_URL')}/rest/v1/\${path}\`, {
    ...init,
    headers: { apikey: key, Authorization: \`Bearer \${key}\`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  });
}

function razorpay(path: string, init: RequestInit = {}) {
  const auth = btoa(\`\${env('${PAYMENT_SECRET_NAMES.keyId}')}:\${env('${PAYMENT_SECRET_NAMES.keySecret}')}\`);
  return fetch(\`https://api.razorpay.com/v1/\${path}\`, {
    ...init,
    headers: { Authorization: \`Basic \${auth}\`, 'Content-Type': 'application/json' },
  });
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readRow(table: string, id: string) {
  const res = await rest(\`\${table}?id=eq.\${encodeURIComponent(id)}&select=id,amount_due,payment_status\`);
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request.' }); }

  const table = String(body.table ?? '');
  const id = body.id === undefined || body.id === null ? '' : String(body.id);
  if (!TABLES.includes(table)) return json(400, { error: 'This table does not take payments.' });
  if (!id) return json(400, { error: 'Which record is being paid for?' });

  const row = await readRow(table, id);
  if (!row) return json(404, { error: 'That record was not found.' });
  const amount = Number(row.amount_due);

  if (body.action === 'order') {
    if (row.payment_status === 'paid') return json(409, { error: 'This has already been paid.' });
    if (!Number.isInteger(amount) || amount < 100) return json(400, { error: 'The amount to pay is not set (minimum Rs 1).' });
    const res = await razorpay('orders', {
      method: 'POST',
      body: JSON.stringify({
        amount, currency: 'INR', receipt: \`\${table}-\${id}\`.slice(0, 40),
        notes: { nbai_table: table, nbai_id: id },
      }),
    });
    if (!res.ok) return json(502, { error: 'The payment could not be started. Please try again.' });
    const order = await res.json();
    return json(200, { orderId: order.id, amount: order.amount, currency: order.currency, keyId: env('${PAYMENT_SECRET_NAMES.keyId}') });
  }

  if (body.action === 'verify') {
    const orderId = String(body.orderId ?? '');
    const paymentId = String(body.paymentId ?? '');
    const signature = String(body.signature ?? '');
    if (!orderId || !paymentId || !signature) return json(400, { error: 'Payment details are missing.' });
    const expected = await hmacHex(env('${PAYMENT_SECRET_NAMES.keySecret}'), \`\${orderId}|\${paymentId}\`);
    if (!sameText(expected, signature)) return json(400, { error: 'This payment could not be verified.' });

    const oRes = await razorpay(\`orders/\${encodeURIComponent(orderId)}\`);
    if (!oRes.ok) return json(502, { error: 'The payment could not be confirmed. Please try again.' });
    const order = await oRes.json();
    if (order?.notes?.nbai_table !== table || order?.notes?.nbai_id !== id || Number(order.amount) !== amount) {
      return json(400, { error: 'This payment does not belong to this record.' });
    }
    if (row.payment_status === 'paid') return json(200, { paid: true });

    const upd = await rest(\`\${table}?id=eq.\${encodeURIComponent(id)}\`, {
      method: 'PATCH',
      body: JSON.stringify({ payment_status: 'paid', payment_id: paymentId, paid_amount: Number(order.amount) }),
    });
    if (!upd.ok) return json(502, { error: 'The payment was received but could not be recorded. Please contact the seller.' });
    return json(200, { paid: true });
  }

  return json(400, { error: 'Unknown action.' });
});
`;
}

/**
 * The browser helper written into the user's app. It never marks anything paid itself: it opens
 * Razorpay's checkout for an order the function created, and hands the result back to the function.
 */
export function paymentsClientHelper(): string {
  return `// Pay for a saved record through the payment service in your own Supabase project.
// The record is marked paid ONLY by that service, after it has verified Razorpay's signature —
// nothing in the browser can mark it paid.

const FUNCTION_URL = \`\${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${PAYMENTS_FUNCTION_SLUG}\`;

async function callPayments(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The payment service is not available right now.');
  return data;
}

let checkoutLoading: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve();
  if (!checkoutLoading) {
    checkoutLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve();
      s.onerror = () => { checkoutLoading = null; reject(new Error('Could not load the payment window.')); };
      document.head.appendChild(s);
    });
  }
  return checkoutLoading;
}

export interface PayOptions {
  name?: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
}

/**
 * Pay for one row of \`table\` (its \`amount_due\` column, in paise). Resolves { paid: true } only after
 * the payment service has verified it; { paid: false } if the customer closed the window.
 */
export async function payForRecord(table: string, id: string | number, options: PayOptions = {}): Promise<{ paid: boolean }> {
  const order = await callPayments({ action: 'order', table, id });
  await loadCheckout();
  return new Promise((resolve, reject) => {
    const checkout = new (window as any).Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: options.name,
      description: options.description,
      prefill: options.prefill,
      handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        try {
          const v = await callPayments({
            action: 'verify', table, id,
            orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature,
          });
          resolve({ paid: v.paid === true });
        } catch (e) {
          reject(e);
        }
      },
      modal: { ondismiss: () => resolve({ paid: false }) },
    });
    checkout.open();
  });
}
`;
}

/** Map a Management API failure to something the user can act on. */
function functionFailure(status: number, body: string, what: string): ProvisionError {
  if (status === 401) return classifyStatus(401, body, 'read');
  if (status === 403) {
    return { ok: false, failure: 'unauthorized', detail: body.slice(0, 500),
      message: 'NavBharatAI does not have permission to set up payments in your Supabase account yet. '
        + 'Please reconnect Supabase from Settings → App Settings → Database and accept the requested permissions.' };
  }
  if (status === 402) {
    return { ok: false, failure: 'plan-limit', detail: body.slice(0, 500),
      message: `Your Supabase plan does not allow ${what} right now. Check your Supabase billing, then try again.` };
  }
  if (status === 429) return classifyStatus(429, body, 'read');
  return { ok: false, failure: 'api-error', detail: body.slice(0, 500),
    message: `Supabase could not ${what} just now. NavBharatAI has recorded the details — please try again in a moment.` };
}

/** Deploy (create or update) one Edge Function. Multipart, as the Management API's deploy endpoint takes it. */
export async function deployEdgeFunction(
  token: string,
  projectRef: string,
  slug: string,
  source: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true; version?: number } | ProvisionError> {
  const form = new FormData();
  form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: slug, verify_jwt: false }));
  form.append('file', new Blob([source], { type: 'application/typescript' }), 'index.ts');
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/projects/${projectRef}/functions/deploy?slug=${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'Supabase could not be reached to set up payments. Please try again in a moment.' };
  }
  if (!res.ok) return functionFailure(res.status, await res.text().catch(() => ''), 'set up the payment service');
  const data = await res.json().catch(() => ({})) as { version?: number };
  return { ok: true, version: typeof data.version === 'number' ? data.version : undefined };
}

/** Create or overwrite project secrets. The values are sent to Supabase and never logged or returned. */
export async function setProjectSecrets(
  token: string,
  projectRef: string,
  secrets: Record<string, string>,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true } | ProvisionError> {
  const pairs = Object.entries(secrets).map(([name, value]) => ({ name, value }));
  if (pairs.some((p) => p.name.startsWith('SUPABASE_') || !p.value)) {
    return { ok: false, failure: 'api-error', message: 'A payment key is missing, so payments were not set up.' };
  }
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/projects/${projectRef}/secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pairs),
    });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'Supabase could not be reached to save your payment keys. Please try again in a moment.' };
  }
  if (!res.ok) return functionFailure(res.status, await res.text().catch(() => ''), 'save your payment keys');
  return { ok: true };
}

export interface SetupPaymentsInput {
  token: string;
  projectRef: string;
  tables: string[];
  keyId: string;
  keySecret: string;
  fetchImpl?: Fetch;
}

/**
 * The whole setup, in the order that fails safest:
 *   1. columns + guard trigger (if this fails nothing else has changed),
 *   2. secrets (the function must never run without its keys),
 *   3. the function itself.
 * Stops at the first failure and reports it; never reports success for a partial setup.
 */
export async function setupSupabasePayments(input: SetupPaymentsInput): Promise<{ ok: true } | ProvisionError> {
  const tables = Array.from(new Set(input.tables));
  if (tables.length === 0 || !tables.every(isSafeTableName)) {
    return { ok: false, failure: 'api-error', message: 'Payments need the name of the table that holds the orders.' };
  }
  const f = input.fetchImpl ?? globalThis.fetch;
  for (const t of tables) {
    const applied = await applySchemaToProject(input.token, input.projectRef, paymentGuardSql(t), f);
    if (!applied.ok) {
      return applied.failure === 'api-error'
        ? { ...applied, message: `The payment columns could not be added to the "${t}" table. Make sure the table exists in your database, then try again.` }
        : applied;
    }
  }
  const secrets = await setProjectSecrets(input.token, input.projectRef, {
    [PAYMENT_SECRET_NAMES.keyId]: input.keyId,
    [PAYMENT_SECRET_NAMES.keySecret]: input.keySecret,
    [PAYMENT_SECRET_NAMES.tables]: tables.join(','),
  }, f);
  if (!secrets.ok) return secrets;
  const deployed = await deployEdgeFunction(input.token, input.projectRef, PAYMENTS_FUNCTION_SLUG, paymentsFunctionSource(), f);
  if (!deployed.ok) return deployed;
  return { ok: true };
}

/** What the builder is told after a successful setup. */
export function serverlessPaymentGuidance(table: string): string {
  return [
    `Razorpay payments are set up for the "${table}" table, verified in the user's own Supabase project.`,
    `Wrote ${PAYMENTS_CLIENT_PATH}. Use it like this:`,
    `  1. When the customer confirms, INSERT the row with amount_due = the price in PAISE (₹499 → 49900).`,
    `     payment_status starts as 'pending' automatically; never set payment_status, payment_id or paid_amount from the app — the database refuses it.`,
    `  2. Call payForRecord('${table}', row.id, { name: '<shop name>', description: '<what is being bought>' }).`,
    `  3. Treat the order as paid ONLY when it resolves { paid: true }, then re-read the row (payment_status = 'paid').`,
    `  4. { paid: false } means the customer closed the window — show "payment pending" and let them try again.`,
    `The row must have a primary-key column named "id". Keep offline payment working alongside.`,
    `Owner note for the app's admin screen: show paid_amount (what was actually charged) beside amount_due.`,
  ].join('\n');
}
