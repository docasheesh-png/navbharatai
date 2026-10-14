// APPEND-ONLY WALLET LEDGER, DUAL-WRITTEN (go-live safety PR 5, audit 2026-10-13).
//
// Today the ledger lives INSIDE the wallet doc as `walletLedger[]`, capped at 500 rows, and rolled-up
// rows are rewritten in place. That is fine for a statement screen but it is not an audit trail: rows
// are trimmed, replaced, and can never be summed back to the balance across all time.
//
// This module writes ONE immutable `wallet_ledger/{id}` doc per committed wallet change, in the SAME
// transaction as the wallet write, carrying the signed token delta and the balance before and after.
// Invariant (checked by `checkLedgerV2Chain`): for each wallet, rows ordered by `seq` chain exactly —
// row[n].balanceBefore === row[n-1].balanceAfter and balanceAfter === balanceBefore + deltaTokens.
//
// 🔒 OFF BY DEFAULT. Nothing is written unless WALLET_LEDGER_V2_DUALWRITE=on. READS ARE UNCHANGED: no
// screen, statement or balance reads this collection yet. Server-only (firestore.rules default-deny).
// Wired into the main paths (build debit, rolled-up debit, Cashfree credit, hosting-plan purchase);
// remaining credit paths are listed in the PR and follow in a later PR before any read switch.

import { createHash } from 'crypto';
import { parseEnvFlag } from './envFlag';

export const WALLET_LEDGER_V2 = 'wallet_ledger';

export function ledgerV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.WALLET_LEDGER_V2_DUALWRITE) ?? false;
}

export interface LedgerV2Row {
  ownerId: string;
  seq: number;
  source: string;
  deltaTokens: number;
  balanceBefore: number;
  balanceAfter: number;
  /** Ledger rows that appeared or changed in the embedded array with this write (for forensics). */
  rows: unknown[];
  at: string;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Build the immutable row for one wallet write. Null when nothing moved and no row changed. PURE. */
export function ledgerV2Row(
  ownerId: string,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  source: string,
  at: string,
): LedgerV2Row | null {
  const b = num(before?.tokenBalance);
  const a = num(after.tokenBalance);
  const prev = new Set((Array.isArray(before?.walletLedger) ? before!.walletLedger as unknown[] : []).map((r) => JSON.stringify(r)));
  const rows = (Array.isArray(after.walletLedger) ? after.walletLedger as unknown[] : []).filter((r) => !prev.has(JSON.stringify(r)));
  if (a === b && rows.length === 0) return null;
  return {
    ownerId, seq: num(before?.ledgerV2Seq) + 1, source: String(source || 'unknown').slice(0, 64),
    deltaTokens: a - b, balanceBefore: b, balanceAfter: a, rows, at,
  };
}

/** Deterministic doc id: one row per (wallet, seq). A retried transaction writes the same id. PURE. */
export function ledgerV2Id(row: LedgerV2Row): string {
  return `${createHash('sha256').update(row.ownerId).digest('hex').slice(0, 24)}_${String(row.seq).padStart(10, '0')}`;
}

/**
 * Inside a wallet transaction, AFTER the wallet write is decided: stamp `ledgerV2Seq` on the wallet and
 * queue the immutable row. Returns the wallet to write (unchanged when the flag is off). Never throws:
 * a bug here must not block a money move that the old path already records.
 */
export function withLedgerV2(
  t: { set: (ref: any, data: any) => void },
  docFn: (collection: string, id: string) => any,
  ownerId: string,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  if (!ledgerV2Enabled(env)) return after;
  try {
    const row = ledgerV2Row(ownerId, before, after, source, new Date().toISOString());
    if (!row) return after;
    t.set(docFn(WALLET_LEDGER_V2, ledgerV2Id(row)), row);
    return { ...after, ledgerV2Seq: row.seq };
  } catch (err) {
    console.error('[ledgerV2] dual-write skipped', (err as Error)?.message);
    return after;
  }
}

export interface ChainCheck { ok: boolean; problems: string[] }

/** The invariant, for the daily check and for tests. Rows of ONE wallet, any order. PURE. */
export function checkLedgerV2Chain(rows: LedgerV2Row[], currentBalance?: number): ChainCheck {
  const problems: string[] = [];
  const sorted = [...rows].sort((x, y) => x.seq - y.seq);
  sorted.forEach((r, i) => {
    if (r.balanceAfter !== r.balanceBefore + r.deltaTokens) problems.push(`seq ${r.seq}: after ≠ before + delta`);
    if (i > 0) {
      const p = sorted[i - 1];
      if (r.seq !== p.seq + 1) problems.push(`gap between seq ${p.seq} and ${r.seq}`);
      if (r.balanceBefore !== p.balanceAfter) problems.push(`seq ${r.seq}: before ≠ previous after`);
    }
  });
  const last = sorted[sorted.length - 1];
  if (last && currentBalance !== undefined && last.balanceAfter !== currentBalance) {
    problems.push(`latest balanceAfter ${last.balanceAfter} ≠ wallet ${currentBalance} (a write path is not dual-writing yet)`);
  }
  return { ok: problems.length === 0, problems };
}
