import { describe, it, expect, vi } from 'vitest';
import {
  probeCredentials, probesFor, verdictFromStatus, probeSummary,
  isSafeSlug, supabaseProbeUrl, MAX_PROBES, relevantToApp, type ProbeFetch,
} from './credentialProbe';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A fetch that always answers with one status, and records every request it saw. */
const stub = (status: number) => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fn: ProbeFetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { status, ok: status >= 200 && status < 300 };
  };
  return { fn, calls };
};

describe('honesty: only the provider itself can call a key wrong', () => {
  it('2xx is the ONLY thing that proves a key works', async () => {
    const { fn } = stub(200);
    const [v] = await probeCredentials({ STRIPE_SECRET_KEY: 'sk_live_a' }, fn);
    expect(v.status).toBe('working');
    expect(v.message).toContain('✅');
  });

  it('401/403 — and nothing else — means the key is genuinely wrong', () => {
    expect(verdictFromStatus('Stripe', ['K'], 401).status).toBe('rejected');
    expect(verdictFromStatus('Stripe', ['K'], 403).status).toBe('rejected');
  });

  it('a provider OUTAGE never tells the user their key is invalid', async () => {
    // This is the rule that matters most: a vendor incident must not condemn a working credential.
    for (const status of [500, 502, 503, 429, 404, 400]) {
      const { fn } = stub(status);
      const [v] = await probeCredentials({ STRIPE_SECRET_KEY: 'sk_live_a' }, fn);
      expect(v.status, `HTTP ${status}`).toBe('unreachable');
      expect(v.message, `HTTP ${status}`).not.toMatch(/did not accept/i);
    }
  });

  it('a network error is our failure, not a verdict on their key', async () => {
    const boom: ProbeFetch = async () => { throw Object.assign(new Error('ECONNREFUSED'), { name: 'FetchError' }); };
    const [v] = await probeCredentials({ STRIPE_SECRET_KEY: 'sk_live_a' }, boom);
    expect(v.status).toBe('unreachable');
    expect(v.message).toMatch(/could not check/i);
  });

  it('never throws, whatever the fetch does', async () => {
    const nasty: ProbeFetch = async () => { throw 'not even an Error'; };
    await expect(probeCredentials({ STRIPE_SECRET_KEY: 'sk_a' }, nasty)).resolves.toBeInstanceOf(Array);
  });

  it('says nothing at all when there is nothing it can test', async () => {
    const { fn, calls } = stub(200);
    // Maps and MSG91 are deliberately unprobeable — checking them would spend the user's money.
    expect(await probeCredentials({ GOOGLE_MAPS_API_KEY: 'AIza', MSG91_AUTH_KEY: 'abc' }, fn)).toEqual([]);
    expect(await probeCredentials({}, fn)).toEqual([]);
    expect(await probeCredentials(null, fn)).toEqual([]);
    expect(calls).toHaveLength(0); // and it made no request while deciding that
  });
});

describe('rule 1: no probe may ever cost the user money', () => {
  it('does not probe the providers whose only check is billable', async () => {
    const { fn, calls } = stub(200);
    await probeCredentials({
      GOOGLE_MAPS_API_KEY: 'AIza-billable-quota',
      VITE_GOOGLE_MAPS_API_KEY: 'AIza-billable-quota',
      MSG91_AUTH_KEY: 'sending-an-sms-costs-money',
      AUTH0_CLIENT_SECRET: 'needs-a-token-exchange',
      SMTP_PASS: 'needs-a-mail-transport',
    }, fn);
    expect(calls).toHaveLength(0);
  });

  it('leaves connection strings to secretPreflight — two owners would disagree', async () => {
    const { fn, calls } = stub(200);
    await probeCredentials({ DATABASE_URL: 'postgres://u:p@h/db', MONGODB_URI: 'mongodb+srv://u:p@h/db' }, fn);
    expect(calls).toHaveLength(0);
  });

  it('every probe it DOES run is a GET', async () => {
    const seen: string[] = [];
    const fn: ProbeFetch = async (_url, init) => { seen.push(init.method); return { status: 200, ok: true }; };
    await probeCredentials({ STRIPE_SECRET_KEY: 'sk', RESEND_API_KEY: 're', OPENAI_API_KEY: 'sk' }, fn);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['GET']));
  });
});

describe('rule 3: no user-controlled hosts (SSRF)', () => {
  it('refuses a Supabase URL that is not https on a Supabase domain', () => {
    expect(supabaseProbeUrl('https://abc.supabase.co')).toBe('https://abc.supabase.co/rest/v1/');
    expect(supabaseProbeUrl('http://abc.supabase.co')).toBeNull();          // not https
    expect(supabaseProbeUrl('https://evil.com')).toBeNull();                 // not Supabase
    expect(supabaseProbeUrl('https://abc.supabase.co.evil.com')).toBeNull(); // suffix trick
    expect(supabaseProbeUrl('https://169.254.169.254/')).toBeNull();         // cloud metadata
    expect(supabaseProbeUrl('http://localhost:8080')).toBeNull();
    expect(supabaseProbeUrl('not a url')).toBeNull();
    expect(supabaseProbeUrl('')).toBeNull();
  });

  it('a rejected Supabase URL causes NO outbound request at all', async () => {
    const { fn, calls } = stub(200);
    const out = await probeCredentials(
      { VITE_SUPABASE_URL: 'https://169.254.169.254/', VITE_SUPABASE_ANON_KEY: 'k' }, fn,
    );
    expect(calls).toHaveLength(0);
    expect(out[0].status).toBe('not-testable');
  });

  it('refuses a path segment that could escape the URL', () => {
    expect(isSafeSlug('mycloud')).toBe(true);
    expect(isSafeSlug('AC123_abc-def')).toBe(true);
    expect(isSafeSlug('../../etc')).toBe(false);
    expect(isSafeSlug('a/b')).toBe(false);
    expect(isSafeSlug('evil.com')).toBe(false);   // a dot could start a host
    expect(isSafeSlug('a@b')).toBe(false);        // an @ could redirect the host
    expect(isSafeSlug('')).toBe(false);
    expect(isSafeSlug('a'.repeat(200))).toBe(false);
  });

  it('an unsafe Cloudinary cloud name is not-testable, not a crafted request', async () => {
    const { fn, calls } = stub(200);
    const out = await probeCredentials(
      { CLOUDINARY_CLOUD_NAME: '../../evil', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' }, fn,
    );
    expect(calls).toHaveLength(0);
    expect(out[0].status).toBe('not-testable');
  });

  it('every probe URL it builds is https on the provider\'s own host', async () => {
    const { fn, calls } = stub(200);
    await probeCredentials({
      STRIPE_SECRET_KEY: 'sk', RAZORPAY_KEY_ID: 'id', RAZORPAY_KEY_SECRET: 's',
      SENDGRID_API_KEY: 'SG.a', RESEND_API_KEY: 're', MAPBOX_ACCESS_TOKEN: 'pk.a',
    }, fn);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      const u = new URL(c.url);
      expect(u.protocol).toBe('https:');
      expect(u.hostname).toMatch(/\.(?:com|co|in)$/);
    }
  });
});

describe('rule 4: a value never appears in a verdict', () => {
  it('keeps the secret out of names, messages and details', async () => {
    const secret = 'sk_live_SUPERSECRETVALUE';
    const { fn } = stub(401);
    const [v] = await probeCredentials({ STRIPE_SECRET_KEY: secret }, fn);
    const blob = JSON.stringify(v);
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain('SUPERSECRET');
    expect(v.names).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('a network error never leaks a key that lives in a query string', async () => {
    // Mapbox and Google put the key in the URL, and fetch errors routinely echo the URL back.
    const leaky: ProbeFetch = async (url) => { throw Object.assign(new Error(`failed to reach ${url}`), { name: 'TypeError' }); };
    const [v] = await probeCredentials({ MAPBOX_ACCESS_TOKEN: 'pk.SUPERSECRETTOKEN' }, leaky);
    expect(JSON.stringify(v)).not.toContain('SUPERSECRETTOKEN');
    expect(v.detail).toBe('TypeError');
  });

  it('the admin summary carries names and statuses only', async () => {
    const { fn } = stub(401);
    const verdicts = await probeCredentials({ STRIPE_SECRET_KEY: 'sk_live_SECRETVALUE' }, fn);
    const summary = probeSummary(verdicts);
    expect(summary).toContain('STRIPE_SECRET_KEY');
    expect(summary).not.toContain('SECRETVALUE');
    expect(probeSummary([])).toBe('');
  });
});

describe('SMTP — checked over its own transport, and never by sending mail', () => {
  const smtpCreds = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'a@b.com', SMTP_PASS: 'app-password' };
  const smtpStub = (status: 'working' | 'rejected' | 'unreachable') => async () => ({ status });

  it('produces a verdict naming all three variables the user saved', async () => {
    const { fn } = stub(200);
    const [v] = await probeCredentials(smtpCreds, fn, undefined, smtpStub('working'));
    expect(v.status).toBe('working');
    expect(v.names).toEqual(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']);
    // The user is told explicitly that checking their mail login did not mail anybody.
    expect(v.message).toMatch(/no email was sent/i);
  });

  it('names the real cause when Gmail rejects an ordinary password', async () => {
    const { fn } = stub(200);
    const [v] = await probeCredentials(smtpCreds, fn, undefined, smtpStub('rejected'));
    expect(v.status).toBe('rejected');
    expect(v.message).toMatch(/App Password/i);
  });

  it('accepts SMTP_PASSWORD as well, since the catalogue lists both spellings', async () => {
    const { fn } = stub(200);
    const [v] = await probeCredentials(
      { SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASSWORD: 'p' }, fn, undefined, smtpStub('working'),
    );
    expect(v.names).toContain('SMTP_PASSWORD');
  });

  it('does not run at all on an incomplete set — a host with no password is not a failure', async () => {
    const { fn } = stub(200);
    let called = false;
    const spy = async () => { called = true; return { status: 'working' as const }; };
    expect(await probeCredentials({ SMTP_HOST: 'h' }, fn, undefined, spy)).toEqual([]);
    expect(called).toBe(false);
  });

  it('runs ALONGSIDE the HTTP probes, not after them', async () => {
    const { fn } = stub(200);
    const out = await probeCredentials({ ...smtpCreds, STRIPE_SECRET_KEY: 'sk' }, fn, undefined, smtpStub('working'));
    expect(out).toHaveLength(2);
    expect(out.map((v) => v.provider).sort()).toEqual(['Stripe', 'your mail server']);
  });
});

describe('probesFor — which credentials get checked', () => {
  it('needs the WHOLE set before it runs a multi-value probe', () => {
    expect(probesFor({ RAZORPAY_KEY_ID: 'id' })).toEqual([]);                       // secret missing
    expect(probesFor({ RAZORPAY_KEY_SECRET: 's' })).toEqual([]);                    // id missing
    expect(probesFor({ RAZORPAY_KEY_ID: 'id', RAZORPAY_KEY_SECRET: 's' })).toHaveLength(1);
  });

  it('treats an empty or whitespace value as absent', () => {
    expect(probesFor({ STRIPE_SECRET_KEY: '' })).toEqual([]);
    expect(probesFor({ STRIPE_SECRET_KEY: '   ' })).toEqual([]);
  });

  it('accepts a browser-prefixed name for a probe that names the bare one', () => {
    const found = probesFor({ VITE_MAPBOX_ACCESS_TOKEN: 'pk.a' });
    expect(found).toHaveLength(1);
    expect(found[0].names).toEqual(['VITE_MAPBOX_ACCESS_TOKEN']); // reports the name the user really saved
  });

  it('is bounded, so a big vault cannot fan out without limit', () => {
    const big: Record<string, string> = {
      STRIPE_SECRET_KEY: 'a', RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'a',
      SENDGRID_API_KEY: 'a', RESEND_API_KEY: 'a', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'a',
      CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'a', CLOUDINARY_API_SECRET: 'a',
      MAPBOX_ACCESS_TOKEN: 'a', CLERK_SECRET_KEY: 'a', OPENAI_API_KEY: 'a', GOOGLE_API_KEY: 'a',
      VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'a',
    };
    expect(probesFor(big).length).toBeLessThanOrEqual(MAX_PROBES);
  });
});

describe('the batch is bounded in time', () => {
  it('a hanging provider degrades to unreachable rather than stalling the caller', async () => {
    vi.useFakeTimers();
    try {
      const hang: ProbeFetch = () => new Promise(() => { /* never settles */ });
      const p = probeCredentials({ STRIPE_SECRET_KEY: 'sk_a' }, hang, 50);
      await vi.advanceTimersByTimeAsync(200);
      const out = await p;
      expect(out).toHaveLength(1);
      expect(out[0].status).toBe('unreachable');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('relevantToApp — a verdict is about THIS app, not about the vault (admin 2026-08-25)', () => {
  const razorpay = { names: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'], provider: 'Razorpay' };
  const stripe = { names: ['STRIPE_SECRET_KEY'], provider: 'Stripe' };

  it("THE REPORT: a racing game no longer gets a payment error on every build", () => {
    // The vault holds a Razorpay key. The app being built reads none of it.
    const kept = relevantToApp([razorpay], ['VITE_API_URL', 'SESSION_SECRET']);
    expect(kept).toEqual([]);
  });

  it('an app that DOES read the key is still told', () => {
    expect(relevantToApp([razorpay], ['RAZORPAY_KEY_ID'])).toEqual([razorpay]);
    expect(relevantToApp([razorpay], ['RAZORPAY_KEY_SECRET'])).toEqual([razorpay]);
  });

  it('prefixed and bare names are ONE variable, in both directions', () => {
    expect(relevantToApp([stripe], ['VITE_STRIPE_SECRET_KEY'])).toEqual([stripe]);
    expect(relevantToApp([{ names: ['VITE_MAPBOX_ACCESS_TOKEN'] }], ['MAPBOX_ACCESS_TOKEN'])).toHaveLength(1);
    expect(relevantToApp([{ names: ['NEXT_PUBLIC_X'] }], ['REACT_APP_X'])).toHaveLength(1);
  });

  it('IGNORANCE KEEPS EVERYTHING — a scan we could not run never deletes a warning', () => {
    // null is "we could not look", which must behave exactly as the code did before this filter.
    expect(relevantToApp([razorpay, stripe], null)).toEqual([razorpay, stripe]);
  });

  it('an app that reads NOTHING is a real answer, not an unknown one', () => {
    // [] means the scan ran and found no env reads at all — nothing here is this build's business.
    expect(relevantToApp([razorpay, stripe], [])).toEqual([]);
  });

  it('filters each verdict independently — one relevant key does not carry the others in', () => {
    expect(relevantToApp([razorpay, stripe], ['STRIPE_SECRET_KEY'])).toEqual([stripe]);
  });

  it('survives malformed input rather than throwing inside a build', () => {
    expect(relevantToApp([{ names: [] }], ['A'])).toEqual([]);
    expect(relevantToApp([], ['A'])).toEqual([]);
  });
});

describe('WIRING — the relevance filter is on the real build path', () => {
  const dispatcher = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

  it('both notices are filtered, and by ONE scan rather than two', () => {
    expect(dispatcher).toContain('relevantToApp(probed, referencedEnvNames)');
    expect(dispatcher).toContain("relevantToApp([{ names: [w.name] }], referencedEnvNames)");
    expect((dispatcher.match(/ENV_SCAN_COMMAND/g) || []).length).toBe(2); // the import + one use
  });

  it('a LEAKED secret is never suppressed by relevance — it must be rotated regardless', () => {
    expect(dispatcher).toContain("w.kind !== 'exposed-secret'");
  });

  it('a scan failure falls back to saying everything', () => {
    const at = dispatcher.indexOf("'probe-relevance'");
    expect(at).toBeGreaterThan(-1);
    expect(dispatcher.slice(at, at + 300)).toContain('referencedEnvNames = null');
  });
});
