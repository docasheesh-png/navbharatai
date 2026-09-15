import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

/**
 * 🔒 EVERY LEDGER WRITE GOES THROUGH THE SHARED APPENDER.
 *
 * The user's statement rests on one equation — opening + Σ (every row) = balance — and it holds only
 * while every writer that appends a row also bounds the ledger and moves the opening balance when
 * something rolls off. `appendLedgerEntry` / `ledgerPatch` do both together, which is the whole
 * point: a caller cannot take one and forget the other.
 *
 * 🔴 THIS IS NOT HYPOTHETICAL. When the statement was built, SEVEN call sites were writing
 * `walletLedger: [...(w.walletLedger || []), entry]` by hand — the four debit/trim sites that
 * dropped rows silently, and three credit paths that never trimmed at all. One of the seven was
 * written in this very session, minutes after the defect had been fixed everywhere else: the
 * referral credit. That is the strongest possible argument for a test rather than a convention —
 * the author who had just fixed it reintroduced it.
 *
 * A convention lives in someone's memory. This lives in CI.
 */

const root = resolve(__dirname, '..');

function walkServer(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const rel = relative(root, p).split('\\').join('/');
    if (statSync(p).isDirectory()) walkServer(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\./.test(p)) out.push(rel);
  }
  return out;
}

/** Strip comments — this file's own explanation quotes the forbidden pattern. */
function codeWithoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * The files allowed to assemble a ledger array themselves, each with the reason.
 * A file is GUILTY UNTIL LISTED — the discipline the other guards in this repo already use.
 */
const ALLOWED: Record<string, string> = {
  // It IS the appender.
  'src/server/lib/walletStatement.ts': 'owns appendLedgerEntry and ledgerPatch',
  // Builds a BRAND-NEW wallet: there is no prior ledger to append to or trim, and the one row it
  // writes is the opening balance itself.
  'src/server/lib/welcomeBonus.ts': 'constructs the initial wallet; its single row IS the opening balance',
  // Merges two wallets into one. It concatenates two whole ledgers and applies the cap itself, which
  // is a different operation from appending one row — and it is the one place the OPENING balances
  // of both wallets must be added together too.
  'src/server/lib/accountMerge.ts': 'merges two ledgers; a different operation from appending a row',
};

describe('🔒 every wallet-ledger write goes through the shared appender', () => {
  const files = walkServer(resolve(root, 'src/server'));

  it('scans a real number of server files — a scanner that finds nothing proves nothing', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('src/server/lib/walletDebit.ts');
    expect(files).toContain('src/server/routes/referral.ts');
  });

  it('no file assembles `walletLedger: [...something, entry]` by hand', () => {
    // The exact shape of all seven original offenders: a spread of the existing ledger with a new
    // row appended, written straight into the document.
    const HAND_ROLLED = /walletLedger\s*:\s*\[\s*\.\.\./;
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED[f]) continue;
      const src = codeWithoutComments(readFileSync(resolve(root, f), 'utf8'));
      for (const [i, line] of src.split('\n').entries()) {
        if (HAND_ROLLED.test(line)) offenders.push(`${f}:${i + 1}`);
      }
      // The multi-line form, which is how most of them were actually written.
      if (!offenders.some((o) => o.startsWith(f)) && /walletLedger\s*:\s*\[\s*\n\s*\.\.\./.test(src)) {
        offenders.push(`${f} (multi-line)`);
      }
    }
    expect(
      offenders.join('\n  '),
      'A wallet ledger is being assembled by hand. Use ledgerPatch(wallet, entry) from ' +
      'walletStatement.ts — it bounds the ledger AND moves the opening balance together, which is ' +
      'what keeps "opening + Σ rows = balance" true. If this genuinely is not an append, add the ' +
      'file to ALLOWED with the reason.',
    ).toBe('');
  });

  it('no file trims the ledger itself', () => {
    // A `slice` on the ledger outside the appender drops rows with nothing recorded — the original
    // defect exactly.
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED[f]) continue;
      const src = codeWithoutComments(readFileSync(resolve(root, f), 'utf8'));
      for (const [i, line] of src.split('\n').entries()) {
        if (/(walletLedger|ledger)\s*(\.slice\(|\]\s*\.slice\()/.test(line) || /\.slice\(-MAX_WALLET_LEDGER_ENTRIES\)/.test(line)) {
          offenders.push(`${f}:${i + 1} → ${line.trim().slice(0, 120)}`);
        }
      }
    }
    expect(
      offenders.join('\n  '),
      'The ledger is being trimmed outside appendLedgerEntry. Rows dropped without moving the ' +
      'opening balance are exactly what made the statement unreconcilable past 500 entries.',
    ).toBe('');
  });

  it('the allowlist is honest — every entry still exists', () => {
    for (const [f, reason] of Object.entries(ALLOWED)) {
      expect(files, `${f} is allowlisted (${reason}) but was not scanned — drop or fix the entry`).toContain(f);
    }
  });
});
