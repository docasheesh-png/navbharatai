// DOES THIS KEY ACTUALLY WORK? — the read-only credential probe (admin 2026-08-17, slice 3).
//
// Slices 1 and 2 got the user to the right console page and warned them about the two ways a correct
// key still goes wrong. This closes the loop: after somebody pastes a credential, NavBharatAI finds out
// whether it genuinely works instead of copying it in and hoping.
//
// WHY IT MATTERS. `secretPreflight.ts` already proves this is worth doing — it opens a real connection
// to a saved database and has caught stale, mistyped and deleted-database credentials at the START of a
// build instead of ten minutes later inside a preview that will not load. But it can only test ONE class
// of secret, a Postgres URL, and reports every API key as honestly "unchecked". That is most of them. A
// user pastes a Stripe key with a typo, the build is green, the preview renders, and the payment button
// fails for their first real customer.
//
// ── THE FOUR RULES THIS FILE CANNOT BREAK ───────────────────────────────────────────────────────────
//
// 1. NEVER SPEND THE USER'S MONEY. Every probe is a free, READ-ONLY endpoint — list, describe, whoami.
//    Nothing here sends an SMS, mails anybody, charges a card, or generates a token that bills. A
//    provider whose only "is this key valid" call costs money is deliberately NOT probed; it is reported
//    as not-testable. That is why Google Maps and MSG91 are absent: a Maps request consumes billable
//    quota, and MSG91's is an SMS. Being unable to check is an honest outcome. Guessing is not.
//
// 2. A FAILURE WE DID NOT UNDERSTAND IS NEVER "YOUR KEY IS WRONG". Only 401/403 — the provider itself
//    saying it rejected the credential — produces `rejected`. A 500, a timeout, a DNS failure or a rate
//    limit produces `unreachable`, which says we could not tell. Telling somebody their working key is
//    invalid because the vendor had an incident is a worse bug than not checking at all.
//
// 3. NO USER-CONTROLLED HOSTS. Every host below is a hardcoded constant, so this endpoint cannot be
//    turned into a request forwarder. The two places a user value reaches a URL at all — Cloudinary's
//    cloud name and Twilio's account SID, both PATH segments — are validated against a strict slug
//    pattern first, and Supabase's URL (the one genuinely user-supplied host) must be https and end in a
//    known Supabase domain or it is not probed. See `isSafeSlug` / `supabaseProbeUrl`.
//
// 4. THE VALUE NEVER LEAVES THIS PROCESS BY ANY ROUTE BUT THE PROVIDER'S OWN API. It is never logged,
//    never put in a verdict, never in an error string. Verdicts carry NAMES only.
//
// DATABASE_URL is deliberately absent: `secretPreflight.ts` already opens a real connection to it, and
// two modules probing one credential would double the work and let their verdicts disagree.
//
// The network call is injected, so every decision here is tested without touching the network.

/**
 * Kill switch. Default ON — checking the key IS the feature — but this makes real outbound calls on a
 * build that saved a credential, so it reverts instantly without a deploy.
 */
export function credentialProbeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_CREDENTIAL_PROBE ?? '').trim().toLowerCase() !== 'off';
}

import { probeSmtp, resolvePort } from './smtpProbe';

/** What we found out about one credential. */
export type ProbeStatus =
  /** The provider accepted it. This is the only status that means "proven". */
  | 'working'
  /** The provider itself rejected it — 401/403. The credential is genuinely wrong or revoked. */
  | 'rejected'
  /** We could not tell: an outage, a timeout, a rate limit, a network failure. NOT a verdict on the key. */
  | 'unreachable'
  /** We have no free, read-only way to test this one. An honest absence, never an implied pass. */
  | 'not-testable';

export interface ProbeVerdict {
  /** The credential(s) this verdict covers, as the user saved them. NEVER a value. */
  names: string[];
  /** The provider as the user knows it — "Stripe". */
  provider: string;
  status: ProbeStatus;
  /** Written for the USER, naming a screen they can act on. Never provider error text. */
  message: string;
  /** The real detail, for server logs and the admin report only. Never a credential value. */
  detail?: string;
}

/** The injected network call, so tests never touch the network. */
export type ProbeFetch = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{
  status: number;
  ok: boolean;
}>;

/** One probe may take this long before we stop waiting and call it unreachable. */
export const PROBE_TIMEOUT_MS = 8_000;
/** The whole batch, however many probes it runs, may not cost more than this. */
export const PROBE_BUDGET_MS = 15_000;
/** How many credentials we are willing to check in one pass. */
export const MAX_PROBES = 8;

/**
 * A path segment safe to interpolate into a probe URL.
 *
 * Cloudinary's cloud name and Twilio's account SID are the only user values that reach a URL at all.
 * Without this, a value containing `../` or `@` could redirect the request to another path or another
 * host entirely. Anything that is not a plain slug is simply not probed. PURE.
 */
export function isSafeSlug(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(String(value ?? '').trim());
}

/** Base64 basic-auth, without leaking either half into a log. */
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

/**
 * The Supabase REST probe URL for a user-supplied project URL, or null when it is not safely probeable.
 *
 * This is the one genuinely user-controlled HOST in the file, so it is the one place SSRF is a real
 * risk: an attacker who can save an arbitrary `VITE_SUPABASE_URL` could otherwise aim this server's
 * outbound request anywhere, including an internal address. It must be https and sit on a known
 * Supabase domain — anything else is not probed rather than probed carefully. PURE.
 */
export function supabaseProbeUrl(projectUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(String(projectUrl ?? '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+\.supabase\.(?:co|in)$/.test(host)) return null;
  return `https://${host}/rest/v1/`;
}

interface ProbeSpec {
  provider: string;
  /** Every credential this probe needs. All must be present and non-empty, or it does not run. */
  needs: string[];
  /** Build the request. Returns null when a value is unsafe to use (see isSafeSlug). */
  build: (v: Record<string, string>) => { url: string; headers: Record<string, string> } | null;
}

/**
 * The probes. Every URL is a documented, free, read-only endpoint of that provider.
 *
 * Absent on purpose, and each for a stated reason rather than an oversight:
 *   • Google Maps — the cheapest key check consumes billable quota (rule 1).
 *   • MSG91 — validating a sender key means sending an SMS, which costs the user money (rule 1).
 *   • Auth0 — the only "is this secret valid" call is a client-credentials token exchange, and Auth0's
 *     free tier METERS machine-to-machine tokens. Minting one to answer a question the user never asked
 *     would spend a quota they may need later. That is rule 1, so it stays unchecked deliberately.
 *   • SMTP — needs a mail transport rather than an HTTP call, so it is not in this table: it is handled
 *     by `probeSmtpCredential` below, which speaks the login handshake over TLS and sends no mail.
 *   • DATABASE_URL / MONGODB_URI — secretPreflight.ts owns connection strings.
 */
const PROBES: ProbeSpec[] = [
  {
    provider: 'Stripe', needs: ['STRIPE_SECRET_KEY'],
    build: (v) => ({ url: 'https://api.stripe.com/v1/account', headers: { Authorization: `Bearer ${v.STRIPE_SECRET_KEY}` } }),
  },
  {
    provider: 'Razorpay', needs: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
    build: (v) => ({
      // count=1 keeps the response tiny; listing payments neither creates nor changes anything.
      url: 'https://api.razorpay.com/v1/payments?count=1',
      headers: { Authorization: basic(v.RAZORPAY_KEY_ID, v.RAZORPAY_KEY_SECRET) },
    }),
  },
  {
    provider: 'SendGrid', needs: ['SENDGRID_API_KEY'],
    build: (v) => ({ url: 'https://api.sendgrid.com/v3/scopes', headers: { Authorization: `Bearer ${v.SENDGRID_API_KEY}` } }),
  },
  {
    provider: 'Resend', needs: ['RESEND_API_KEY'],
    build: (v) => ({ url: 'https://api.resend.com/domains', headers: { Authorization: `Bearer ${v.RESEND_API_KEY}` } }),
  },
  {
    provider: 'Twilio', needs: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    build: (v) => {
      const sid = v.TWILIO_ACCOUNT_SID.trim();
      if (!isSafeSlug(sid)) return null; // the SID is a PATH segment — never interpolate it unvalidated
      return {
        url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
        headers: { Authorization: basic(sid, v.TWILIO_AUTH_TOKEN) },
      };
    },
  },
  {
    provider: 'Cloudinary', needs: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
    build: (v) => {
      const cloud = v.CLOUDINARY_CLOUD_NAME.trim();
      if (!isSafeSlug(cloud)) return null;
      return {
        url: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/resources/image?max_results=1`,
        headers: { Authorization: basic(v.CLOUDINARY_API_KEY, v.CLOUDINARY_API_SECRET) },
      };
    },
  },
  {
    provider: 'Mapbox', needs: ['MAPBOX_ACCESS_TOKEN'],
    build: (v) => ({
      url: `https://api.mapbox.com/tokens/v2?access_token=${encodeURIComponent(v.MAPBOX_ACCESS_TOKEN)}`,
      headers: {},
    }),
  },
  {
    provider: 'Clerk', needs: ['CLERK_SECRET_KEY'],
    build: (v) => ({ url: 'https://api.clerk.com/v1/users?limit=1', headers: { Authorization: `Bearer ${v.CLERK_SECRET_KEY}` } }),
  },
  {
    provider: 'OpenAI', needs: ['OPENAI_API_KEY'],
    build: (v) => ({ url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${v.OPENAI_API_KEY}` } }),
  },
  {
    provider: 'Google AI Studio', needs: ['GOOGLE_API_KEY'],
    build: (v) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(v.GOOGLE_API_KEY)}`,
      headers: {},
    }),
  },
  {
    provider: 'Supabase', needs: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    build: (v) => {
      const url = supabaseProbeUrl(v.VITE_SUPABASE_URL);
      if (!url) return null; // not a Supabase https URL — never aim an outbound request at it
      return { url, headers: { apikey: v.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${v.VITE_SUPABASE_ANON_KEY}` } };
    },
  },
];

/**
 * IS THIS VERDICT ABOUT *THIS* APP? — the relevance filter (admin 2026-08-25).
 *
 * THE REPORT: "har ek build report me yeh message kyu aata hai?", about
 * "\u274c Razorpay did not accept this key". Nothing was wrong with the probe. The problem is WHO it
 * was aimed at: the whole VAULT is merged into every app's `.env` and then probed on every build, so a
 * Razorpay key saved once for one payment app is re-checked — and re-complained about — while building
 * a racing game, a to-do list, anything. The user is handed a payment error on a build that has no
 * payments in it, over and over, and cannot act on it from where they are standing.
 *
 * That is worse than noise. A warning that appears on every single build, that the user learns is not
 * about the thing they are doing, is a warning they stop reading — and the next one WILL matter.
 *
 * So the rule: a verdict is narrated only when the app's own code actually reads that variable.
 *
 * `referenced` is the env names found in the app's source (the same scan `devSecretsBoot` already
 * runs), or `null` when we could not scan at all. NULL KEEPS EVERYTHING — ignorance must not silently
 * delete a real warning, which is this repo's standing rule and the exact mistake Green Guard was
 * making the same week. Prefix-insensitive on both sides, so `VITE_X` and `X` are one variable. PURE.
 */
export function relevantToApp<T extends { names: string[] }>(
  verdicts: readonly T[],
  referenced: readonly string[] | null,
): T[] {
  if (referenced === null) return [...verdicts];
  const bare = (n: string) => String(n ?? '').replace(/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)/, '');
  const used = new Set(referenced.map(bare));
  return verdicts.filter((v) => (v.names || []).some((n) => used.has(bare(n))));
}

/** A saved value, ignoring the browser-exposure prefix so `VITE_X` satisfies a probe that needs `X`. */
function lookup(values: Record<string, string>, wanted: string): { name: string; value: string } | null {
  const bare = (n: string) => n.replace(/^(?:VITE_|NEXT_PUBLIC_|REACT_APP_)/, '');
  for (const [name, raw] of Object.entries(values || {})) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    if (name === wanted || bare(name) === bare(wanted)) return { name, value };
  }
  return null;
}

/** Every probe whose credentials are all present, in catalogue order, bounded by MAX_PROBES. PURE. */
export function probesFor(values: Record<string, string>): Array<{ spec: ProbeSpec; names: string[]; resolved: Record<string, string> }> {
  const out: Array<{ spec: ProbeSpec; names: string[]; resolved: Record<string, string> }> = [];
  for (const spec of PROBES) {
    const found = spec.needs.map((n) => lookup(values, n));
    if (found.some((f) => f === null)) continue; // an incomplete set is not a failure — just not testable yet
    const resolved: Record<string, string> = {};
    spec.needs.forEach((n, i) => { resolved[n] = found[i]!.value; });
    out.push({ spec, names: found.map((f) => f!.name), resolved });
    if (out.length >= MAX_PROBES) break;
  }
  return out;
}

/**
 * Turn one HTTP outcome into an honest verdict.
 *
 * The whole safety of this feature lives in the middle branch: ONLY the provider explicitly rejecting
 * the credential counts as a bad key. Everything else is "we could not tell". PURE.
 */
export function verdictFromStatus(provider: string, names: string[], httpStatus: number): ProbeVerdict {
  if (httpStatus >= 200 && httpStatus < 300) {
    return { names, provider, status: 'working', message: `✅ Your ${provider} key works — NavBharatAI checked it just now.` };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      names, provider, status: 'rejected',
      message: `❌ ${provider} did not accept this key. Re-copy it and save it again in `
        + 'Settings → App Settings → Secrets & API Keys — the feature that needs it will stay switched off until then.',
      detail: `HTTP ${httpStatus}`,
    };
  }
  return {
    names, provider, status: 'unreachable',
    message: `⏳ NavBharatAI could not reach ${provider} to check this key just now, so it was saved as you entered it.`,
    detail: `HTTP ${httpStatus}`,
  };
}

/**
 * SMTP, which needs a mail transport rather than an HTTPS read.
 *
 * Slice 3 recorded this as an open item and reported mail credentials as unchecked. It is worth closing
 * because the commonest mail credential our users paste is a Gmail app password, and the commonest
 * mistake is pasting their ORDINARY password — which Google rejects at login with no other symptom, so
 * the first sign of trouble is a real user never receiving their signup email.
 *
 * `smtpProbe` speaks the login handshake directly over TLS and SENDS NOTHING: no MAIL FROM, no RCPT TO,
 * no DATA. Its honesty rule is the same as the HTTP probes' — only the server's own auth rejection
 * counts as a bad credential.
 */
export async function probeSmtpCredential(
  values: Record<string, string>,
  // Injected for the same reason `doFetch` is: without it, any test that mentions SMTP_HOST makes a real
  // DNS lookup and a real outbound connection from CI. A probe that can only be exercised against
  // somebody's live mail server is a probe that does not get exercised.
  doProbe: typeof probeSmtp = probeSmtp,
): Promise<ProbeVerdict | null> {
  const host = lookup(values, 'SMTP_HOST');
  const user = lookup(values, 'SMTP_USER');
  // Providers disagree on the name, and our own catalogue lists both.
  const pass = lookup(values, 'SMTP_PASS') || lookup(values, 'SMTP_PASSWORD');
  if (!host || !user || !pass) return null;

  const names = [host.name, user.name, pass.name];
  const r = await doProbe(host.value, resolvePort(lookup(values, 'SMTP_PORT')?.value), user.value, pass.value);
  if (r.status === 'working') {
    return { names, provider: 'your mail server', status: 'working', message: '✅ Your email settings work — NavBharatAI signed in to your mail server just now (no email was sent).' };
  }
  if (r.status === 'rejected') {
    return {
      names, provider: 'your mail server', status: 'rejected',
      message: '❌ Your mail server did not accept this username and password. If you use Gmail, it must be a 16-character '
        + 'App Password, not your normal Google password — re-copy it in Settings → App Settings → Secrets & API Keys.',
      detail: r.detail,
    };
  }
  return {
    names, provider: 'your mail server', status: 'unreachable',
    message: '⏳ NavBharatAI could not reach your mail server to check these settings, so they were saved as you entered them.',
    detail: r.detail,
  };
}

/**
 * Check every credential we safely can, under one overall deadline.
 *
 * Never throws and never rejects: a probe that fails is a probe that says `unreachable`, because a bug
 * in our own verification must never condemn a working credential or stop a build. Returns [] when
 * there is nothing we can test — the caller says nothing rather than inventing reassurance.
 */
export async function probeCredentials(
  values: Record<string, string> | null | undefined,
  doFetch: ProbeFetch,
  budgetMs = PROBE_BUDGET_MS,
  doSmtpProbe: typeof probeSmtp = probeSmtp,
): Promise<ProbeVerdict[]> {
  const planned = probesFor(values || {});
  // SMTP rides the same budget but not the same transport, so it is raced alongside rather than folded
  // into `planned` — a mail handshake has nothing in common with an HTTPS GET but the deadline.
  const smtp = probeSmtpCredential(values || {}, doSmtpProbe).catch(() => null);
  if (planned.length === 0) {
    const only = await Promise.race([
      smtp,
      new Promise<null>((resolve) => {
        const t = setTimeout(() => resolve(null), budgetMs);
        if (typeof t === 'object' && t && typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
      }),
    ]);
    return only ? [only] : [];
  }

  const runOne = async ({ spec, names, resolved }: (typeof planned)[number]): Promise<ProbeVerdict> => {
    let req: { url: string; headers: Record<string, string> } | null = null;
    try {
      req = spec.build(resolved);
    } catch {
      req = null;
    }
    if (!req) {
      return {
        names, provider: spec.provider, status: 'not-testable',
        message: `${spec.provider} was saved as you entered it — NavBharatAI could not check this one automatically.`,
      };
    }
    try {
      const res = await Promise.race([
        doFetch(req.url, { method: 'GET', headers: req.headers }),
        new Promise<'timeout'>((resolve) => {
          const t = setTimeout(() => resolve('timeout'), PROBE_TIMEOUT_MS);
          if (typeof t === 'object' && t && typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
        }),
      ]);
      if (res === 'timeout') {
        return {
          names, provider: spec.provider, status: 'unreachable',
          message: `⏳ NavBharatAI could not reach ${spec.provider} in time to check this key, so it was saved as you entered it.`,
          detail: 'timeout',
        };
      }
      return verdictFromStatus(spec.provider, names, res.status);
    } catch (e) {
      // OUR failure, not theirs. Say so rather than blaming their credential.
      return {
        names, provider: spec.provider, status: 'unreachable',
        message: `⏳ NavBharatAI could not check your ${spec.provider} key just now, so it was saved as you entered it.`,
        // A network error can echo the request URL, which for Mapbox/Google carries the key in a query
        // string. Never let that reach a stored report (rule 4) — record the error TYPE only.
        detail: (e as { name?: string } | null)?.name || 'network-error',
      };
    }
  };

  const deadline = new Promise<'timeout'>((resolve) => {
    const t = setTimeout(() => resolve('timeout'), budgetMs);
    if (typeof t === 'object' && t && typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
  });
  const settled = await Promise.race([Promise.all([...planned.map(runOne), smtp]), deadline]);
  if (settled === 'timeout') {
    return planned.map(({ spec, names }) => ({
      names, provider: spec.provider, status: 'unreachable' as const,
      message: `⏳ NavBharatAI could not finish checking your ${spec.provider} key, so it was saved as you entered it.`,
      detail: 'batch-timeout',
    }));
  }
  return settled.filter((v): v is ProbeVerdict => v !== null);
}

/**
 * The real network call. Kept out of `probeCredentials` so the decision logic is testable offline.
 *
 * `redirect: 'error'` matters: a probe follows no redirects, so a provider (or anything able to answer
 * for one) cannot bounce this server's authenticated request to a host we never allowed.
 */
export const realProbeFetch: ProbeFetch = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      redirect: 'error',
      signal: controller.signal,
    });
    return { status: res.status, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * A one-line, admin-facing summary for the build report, or `''` when nothing was checked.
 *
 * Names and statuses only — never a value, and never the provider's own error text. PURE.
 */
export function probeSummary(verdicts: ProbeVerdict[]): string {
  if (!Array.isArray(verdicts) || verdicts.length === 0) return '';
  const by = (s: ProbeStatus) => verdicts.filter((v) => v.status === s);
  const parts: string[] = [];
  const rejected = by('rejected');
  const working = by('working');
  const unknown = [...by('unreachable'), ...by('not-testable')];
  if (rejected.length) parts.push(`${rejected.length} rejected by the provider: ${rejected.map((v) => v.names.join('+')).join(', ')}`);
  if (working.length) parts.push(`${working.length} proven working: ${working.map((v) => v.names.join('+')).join(', ')}`);
  if (unknown.length) parts.push(`${unknown.length} not verified: ${unknown.map((v) => v.names.join('+')).join(', ')}`);
  return parts.join(' · ');
}
