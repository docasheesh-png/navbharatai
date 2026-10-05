// A CLIENT READ CHECKS THE SERVER'S ANSWER BEFORE IT BECOMES STATE (Q-680, 2026-10-05).
//
// The read-side sibling of `aClientWriteReadsTheServerAnswer`. `fetch` resolves for a 403 and a 500 too,
// so `setData(await r.json())` stored a refusal body as the screen's data. Found in one sweep: the OTP card
// printed "Could not read the OTP tally: undefined"; the update-broadcast card read a 500 body's missing
// `latestVersionCode` as "ANDROID_LATEST_VERSION_CODE is not set"; the wallet statement and the referral
// cost card drew a refusal as data; the admin overview drew a failed analytics read as 0 users and ₹0.
//
// THE CENSUS: no client file may move a response body into React state without looking at `.ok` (or the
// status) first. The fix is `readAnswer(res, isShape)` in `src/lib/serverAnswer.ts`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import { readAnswer, isRecord } from '../src/lib/serverAnswer';
import { isOtpSummary } from '../src/components/admin/OtpHealthCard';
import { isReferralSummary } from '../src/components/admin/ReferralCostCard';
import { isStatement } from '../src/components/panels/WalletStatementPanel';
import { isSupabaseStatus } from '../src/components/settings/SupabaseConnectCard';

const root = join(__dirname, '..');

function clientFiles(): string[] {
  return globSync('src/**/*.{ts,tsx}', { cwd: root })
    .filter((f) => !f.startsWith('src/server/') && !/\.test\.tsx?$/.test(f));
}

/** Strip comments so the explanation of the bug in a comment is not counted as the bug. */
function code(file: string): string {
  return readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** `setX(await r.json())` on a line that never looks at `r.ok`. */
function inlineUnchecked(): string[] {
  const out: string[] = [];
  for (const f of clientFiles()) {
    code(f).split('\n').forEach((line, i) => {
      const m = line.match(/\bset[A-Z]\w*\(\s*await\s+\(?\s*(\w+)\s*\)?\.json\(\)\s*\)/);
      if (m && !new RegExp(`\\b${m[1]}\\.(ok|status)\\b`).test(line)) out.push(`${f}:${i + 1}`);
      if (/\bset[A-Z]\w*\(\s*await\s+\(\s*await\s+fetch\(/.test(line)) out.push(`${f}:${i + 1} (nested fetch)`);
    });
  }
  return out;
}

/** `const d = await r.json();` followed within two lines by `setX(d)`, with no `r.ok` / `r.status` and no shape test of `d`. */
function twoLineUnchecked(): string[] {
  const out: string[] = [];
  for (const f of clientFiles()) {
    const s = code(f);
    const re = /const (\w+) = await (\w+)\.json\(\)[^;\n]*;?\n((?:.*\n){0,2})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const [, v, res, next] = m;
      const set = next.match(new RegExp(`\\bset[A-Z]\\w*\\(\\s*${v}\\s*\\)`));
      if (!set) continue;
      const before = next.slice(0, set.index);
      const ctx = s.slice(Math.max(0, m.index - 300), m.index) + before;
      if (new RegExp(`\\b${res}\\.(ok|status)\\b`).test(ctx)) continue;
      // A shape test of the body on the way in (`if (Array.isArray(d?.rows)) setData(d)`) is the check.
      if (new RegExp(`\\bif\\s*\\([^)]*\\b${v}\\b`).test(before)) continue;
      out.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
    }
  }
  return out;
}

describe('every client read checks the answer before it becomes state', () => {
  it('no body goes straight into state on one line', () => {
    expect(inlineUnchecked()).toEqual([]);
  });

  it('no body goes into state two lines later without a check', () => {
    expect(twoLineUnchecked()).toEqual([]);
  });

  it('the sites this sweep fixed read through readAnswer', () => {
    for (const f of [
      'src/components/admin/OtpHealthCard.tsx',
      'src/components/admin/ReferralCostCard.tsx',
      'src/components/panels/WalletStatementPanel.tsx',
      'src/components/settings/SupabaseConnectCard.tsx',
      'src/components/AdminDashboard.tsx',
    ]) expect(readFileSync(join(root, f), 'utf8'), f).toMatch(/await readAnswer\(/);
  });

  it('a failed cohort read is its own state, never "the version code is not set"', () => {
    const dash = readFileSync(join(root, 'src/components/AdminDashboard.tsx'), 'utf8');
    expect(dash).toContain('{updateCohortError ? (');
    expect(dash).toContain(') : updateCohort.latestVersionCode == null ? (');
    expect(dash).toContain('Could not read the platform analytics:');
  });
});

describe('readAnswer', () => {
  const res = (status: number, body: unknown) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  const hasN = (b: unknown): b is { n: number } => isRecord(b) && typeof b.n === 'number';

  it('accepts a 2xx body of the right shape', async () => {
    expect(await readAnswer(res(200, { n: 3 }), hasN)).toEqual({ ok: true, value: { n: 3 } });
  });

  it("a refusal is the server's own sentence, never data", async () => {
    expect(await readAnswer(res(403, { error: 'Admin only.' }), hasN)).toEqual({ ok: false, sentence: 'Admin only.' });
  });

  it('a refusal with no sentence names the status', async () => {
    expect(await readAnswer(res(500, 'Internal Server Error'), hasN)).toEqual({ ok: false, sentence: 'The server refused the request (HTTP 500).' });
  });

  it('a 2xx body of the wrong shape is not data either', async () => {
    const a = await readAnswer(res(200, { error: 'x' }), hasN);
    expect(a.ok).toBe(false);
  });
});

describe('the shapes each fixed screen accepts', () => {
  it('OTP: the tally, or the route\'s own { ok: false, reason } — not a 403 body', () => {
    expect(isOtpSummary({ ok: true, bySurface: [] })).toBe(true);
    expect(isOtpSummary({ ok: false, reason: 'store down' })).toBe(true);
    expect(isOtpSummary({ error: 'Admin token required' })).toBe(false);
  });

  it('referral: the summary, or its own failure', () => {
    expect(isReferralSummary({ ok: true, topReferrers: [] })).toBe(true);
    expect(isReferralSummary({ ok: false, reason: 'store-unavailable' })).toBe(true);
    expect(isReferralSummary({ error: 'nope' })).toBe(false);
  });

  it('wallet statement: rows, not a refusal', () => {
    expect(isStatement({ ok: true, rows: [] })).toBe(true);
    expect(isStatement({ error: 'Could not build your statement.' })).toBe(false);
  });

  it('Supabase status: both flags present', () => {
    expect(isSupabaseStatus({ available: true, connected: false, orgName: null })).toBe(true);
    expect(isSupabaseStatus({ error: 'Sign in first' })).toBe(false);
  });
});
