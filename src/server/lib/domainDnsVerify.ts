// DO THE USER'S DNS RECORDS ACTUALLY EXIST? — asked of the public internet, from our own server.
//
// WHY THIS EXISTS (admin, 2026-08-21, connecting mitrify.com). The Publish sheet showed
// `ownership: missing` while every required record was live and byte-perfect in public DNS — proven
// by resolving them by hand. The user had done everything right and the screen told them, in effect,
// that they had not. There was no way to tell these three apart, and they need completely different
// actions:
//
//   1. the record is wrong / not added        → the USER must fix it at their registrar
//   2. the record is right but not visible yet → WAIT (their registrar is still publishing it)
//   3. the record is right AND visible         → WAIT for Firebase, which re-checks on its own
//                                                schedule; there is nothing left for the user to do
//
// Case 3 is the one that was indistinguishable from case 1, and it is the one that makes a person
// edit correct records over and over.
//
// 🔒 THE HONESTY BOUNDARY. This says what OUR resolver can see. It does NOT and cannot promise what
// Firebase sees — different resolver, different cache, different moment. So a clean result never says
// "this will work"; it says "your records are correct and live from here", which is a fact we can
// stand behind, and it names the remaining wait as ours to bear rather than the user's to fix.

import { promises as dns } from 'dns';

export interface RequiredRecord { type: string; name: string; value: string }

export interface RecordCheck {
  type: string;
  name: string;
  /** What the user was asked to publish. */
  expected: string;
  /** True when a value matching `expected` is live in public DNS right now. */
  seen: boolean;
  /** What we actually found at that name — so a WRONG value can be shown next to the right one. */
  found: string[];
  /** Set when the lookup itself failed (NXDOMAIN, timeout) rather than returning a wrong answer. */
  lookupError: string;
}

export interface DnsVerifyResult {
  checks: RecordCheck[];
  /** True only when every required record is live and correct from here. */
  allSeen: boolean;
  /** One honest sentence for the user. Never claims Firebase will accept anything. */
  summary: string;
}

type Resolver = (name: string) => Promise<string[]>;

/** Test seam — CI has no DNS, and this logic must still be provable. */
export interface VerifyDeps { a?: Resolver; txt?: Resolver; cname?: Resolver }

const defaultDeps: Required<VerifyDeps> = {
  a: (n) => dns.resolve4(n),
  txt: async (n) => (await dns.resolveTxt(n)).map((chunks) => chunks.join('')),
  cname: (n) => dns.resolveCname(n),
};

/** Trailing dots and case are not differences a user can act on. */
function norm(s: string): string {
  return String(s ?? '').trim().replace(/\.$/, '').toLowerCase();
}

/**
 * A TXT value as a resolver returns it, versus as a registrar's UI shows it.
 *
 * Hostinger (and most panels) DISPLAY a TXT value wrapped in double quotes — that is DNS presentation
 * syntax, not part of the value, and the wire format has no quotes. Comparing the two naively reports
 * a perfectly correct record as wrong, which is precisely the false alarm this module exists to stop.
 * Long TXT values also arrive split into 255-byte chunks, already rejoined by the resolver above.
 */
function normTxt(s: string): string {
  return norm(s).replace(/^"+|"+$/g, '');
}

async function checkOne(rec: RequiredRecord, deps: Required<VerifyDeps>): Promise<RecordCheck> {
  const type = String(rec.type || '').toUpperCase();
  const name = norm(rec.name);
  const base: RecordCheck = { type, name, expected: rec.value, seen: false, found: [], lookupError: '' };
  try {
    if (type === 'TXT') {
      const found = await deps.txt(name);
      return { ...base, found, seen: found.some((v) => normTxt(v) === normTxt(rec.value)) };
    }
    if (type === 'A' || type === 'AAAA') {
      const found = await deps.a(name);
      return { ...base, found, seen: found.some((v) => norm(v) === norm(rec.value)) };
    }
    if (type === 'CNAME') {
      const found = await deps.cname(name);
      return { ...base, found, seen: found.some((v) => norm(v) === norm(rec.value)) };
    }
    // A type we do not know how to check is reported as UNCHECKED, never as missing — claiming a
    // record is absent because we did not look is the same lie in the other direction.
    return { ...base, lookupError: `NavBharatAI cannot check ${type} records automatically.` };
  } catch (e: any) {
    // ENOTFOUND / ENODATA mean "nothing published at that name yet" — a real, expected state while a
    // registrar propagates, and NOT an error worth alarming anyone with.
    const code = e?.code ? String(e.code) : '';
    if (code === 'ENOTFOUND' || code === 'ENODATA') return base;
    return { ...base, lookupError: code || 'lookup failed' };
  }
}

/**
 * Check every required record against public DNS, in parallel and bounded.
 *
 * Never throws: this runs inside a status poll, and a DNS hiccup must not turn a working status
 * screen into an error. An unreadable check reports itself as unreadable.
 */
export async function verifyRecordsLive(
  records: readonly RequiredRecord[] | null | undefined,
  deps: VerifyDeps = {},
  timeoutMs = 6000,
): Promise<DnsVerifyResult> {
  const d: Required<VerifyDeps> = { ...defaultDeps, ...deps };
  const list = (records ?? []).filter((r) => r && r.type && r.name && r.value);
  if (list.length === 0) return { checks: [], allSeen: false, summary: '' };

  const withTimeout = (p: Promise<RecordCheck>, rec: RequiredRecord): Promise<RecordCheck> =>
    Promise.race([
      p,
      new Promise<RecordCheck>((resolve) => setTimeout(() => resolve({
        type: String(rec.type).toUpperCase(), name: norm(rec.name), expected: rec.value,
        seen: false, found: [], lookupError: 'timed out',
      }), timeoutMs)),
    ]);

  const checks = await Promise.all(list.map((r) => withTimeout(checkOne(r, d), r)));
  return { checks, allSeen: checks.every((c) => c.seen), summary: summarize(checks) };
}

/**
 * The one sentence the user reads.
 *
 * Ordered by what they can DO about it: a wrong value first (only they can fix it), then a missing
 * one (wait for their registrar), then the all-clear (wait for us). The all-clear deliberately names
 * the remaining wait as OURS — that is the sentence whose absence had the admin re-editing correct
 * records.
 */
export function summarize(checks: readonly RecordCheck[]): string {
  if (checks.length === 0) return '';
  const wrong = checks.filter((c) => !c.seen && c.found.length > 0 && !c.lookupError);
  const absent = checks.filter((c) => !c.seen && c.found.length === 0 && !c.lookupError);
  const unreadable = checks.filter((c) => !!c.lookupError);

  if (wrong.length > 0) {
    const w = wrong[0];
    return `Your ${w.type} record for ${w.name} has a different value than the one shown above. `
      + `Edit it at your registrar so it matches exactly, then check again.`;
  }
  if (absent.length > 0) {
    const names = absent.map((c) => `${c.type} ${c.name}`).join(', ');
    return `Not visible on the internet yet: ${names}. If you have just added it, your registrar is `
      + `still publishing it — this can take a few minutes to a few hours. Nothing is wrong.`;
  }
  if (unreadable.length > 0 && unreadable.length === checks.length) {
    return 'We could not read your DNS just now. This is our side, not yours — try again in a moment.';
  }
  return 'All your DNS records are correct and live on the internet. Nothing is left for you to do — '
    + 'we are now waiting for the hosting service to re-check them, which it does on its own schedule. '
    + 'You can safely close this page; your progress is saved.';
}
