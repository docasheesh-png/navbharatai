// EVERY PAISA ACCOUNTED FOR — the wallet statement, and the invariant it rests on.
//
// Admin, 2026-09-15: *"user wallet me token balance me ek ek paise ka sahi sahi hisab hona chahiye.
// ₹ / token credit kab kaise, ₹ / token deducted kab kaha kaise, aur user ke current balance se match
// hona chahiye."*
//
// ── THE INVARIANT ────────────────────────────────────────────────────────────────────────────────
//
//        opening balance  +  Σ (every ledger row)  =  tokenBalance
//
// That is the whole of double-entry bookkeeping applied to one wallet document, and the wallet was
// ALREADY built to satisfy it: every writer that moves `tokenBalance` also appends (or updates) a
// ledger row for the same number of tokens. A build writes its own row; a chat turn accumulates into
// a daily bucket row that always carries the bucket's RUNNING total, so the sum stays right either
// way.
//
// 🔴 EXCEPT THAT IT COULD NOT HOLD, FOR A REASON NOBODY HAD WRITTEN DOWN. The ledger is capped at 500
// entries — it must be, because an unbounded array eventually hits Firestore's 1 MiB document limit —
// and all four trim sites did `[...ledger, entry].slice(-500)`, dropping the oldest rows with
// **nothing recorded about them**. From the 501st entry onward the sum of a user's visible history
// was simply less than their balance, by an amount nobody could name. The statement would have had
// to either show a number that did not add up, or invent one.
//
// THE FIX IS THE OLDEST ONE IN ACCOUNTING: a statement does not begin at the beginning of time, it
// begins at an OPENING BALANCE. `appendLedgerEntry` folds whatever rolls off into
// `ledgerOpeningTokens`, so the invariant survives trimming exactly and for ever — the history a user
// can SEE is bounded, the arithmetic is not.
//
// 🔒 AND AN ACCOUNT THAT PREDATES THAT FIELD IS REPORTED AS 'unknown', NEVER AS A MISMATCH. A wallet
// already past 500 entries when this shipped has genuinely lost the record of its oldest rows; that
// is missing history, not a discrepancy. Reporting it as a mismatch would cry wolf on every old
// account and teach the admin to ignore the one that matters. Saying "this statement begins at the
// oldest row still held" is the truth, and it is what a bank statement says too.
//
// ── THE TWO VIEWS, AND WHY THEY MAY DIFFER ───────────────────────────────────────────────────────
// The wallet keeps one balance in two fields (`tokenBalance` and `remaining_balance`) because
// different parts of the platform read different ones. `walletMirror.ts` exists so every writer moves
// both by the same money. They CAN still legitimately differ — a Professional Pass buyer's two views
// differ by the Pass price, permanently, by design — so this module reports both and never "corrects"
// one to the other. An assignment is exactly the bug walletMirror was written to end.
//
// PURE. No Firestore, no clock, no env. Every number comes from the document it is handed.

import { TOKENS_PER_RUPEE } from '../../lib/walletPricing';

/**
 * Oldest ledger entries roll off past this bound (Firestore's 1 MiB document limit); the balance and
 * the totals are never trimmed, only the visible ENTRIES.
 *
 * ⚠️ IT LIVES HERE, NOT IN `walletDebit.ts` WHERE IT USED TO, and the move is not cosmetic: this
 * module is what enforces the trim, and `walletDebit` importing the appender while the appender
 * imported the constant was a genuine import CYCLE. It typechecks and would very probably have
 * worked — the constant is only read inside a function body — but a cycle on the money path is the
 * kind of thing that breaks one day on a bundler change, for reasons nobody can see. `walletDebit`
 * re-exports both names, so every existing importer is untouched.
 */
export const MAX_WALLET_LEDGER_ENTRIES = 500;

/** Field on the wallet doc holding the unbilled remainder, always 0 ≤ carry < 1 token. */
export const TOKEN_CARRY_FIELD = 'tokenCarry';

/** Tokens that rolled off the visible ledger. The statement's opening balance. */
export const LEDGER_OPENING_FIELD = 'ledgerOpeningTokens';
/** When the opening balance was last moved — i.e. how far back the visible history really goes. */
export const LEDGER_OPENING_AT_FIELD = 'ledgerOpeningAt';
/** How many rows have ever rolled off. Lets the statement say "and N earlier entries". */
export const LEDGER_DROPPED_FIELD = 'ledgerDroppedCount';

export interface LedgerRow {
  type?: unknown;
  amountCoinsOrTokens?: unknown;
  moneySpent?: unknown;
  timestamp?: unknown;
  description?: unknown;
  feature?: unknown;
  buildRef?: unknown;
  rollupRef?: unknown;
  absorbedInr?: unknown;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** The signed token movement of one row. A credit is positive, a debit negative. */
export function rowTokens(row: LedgerRow | null | undefined): number {
  return num(row?.amountCoinsOrTokens);
}

export interface AppendResult {
  /** The ledger to store — at most MAX_WALLET_LEDGER_ENTRIES rows. */
  ledger: LedgerRow[];
  /** The opening balance to store, with anything that rolled off folded in. */
  openingTokens: number;
  /** Total rows ever dropped, so the statement can say how much history is not shown. */
  droppedCount: number;
}

/**
 * Append (or replace) a row and trim, PRESERVING THE INVARIANT.
 *
 * 🔒 THIS IS THE ONLY PLACE THE LEDGER MAY BE TRIMMED. Four call sites used to do their own
 * `slice(-500)`, and every one of them silently broke the arithmetic. Centralising it is the same
 * discipline `walletMirror.ts` applies to credits: the rule lives once, and there is no way to call
 * this and trim without the opening balance moving with it.
 *
 * `replaceRollupRef` handles the daily-bucket case: that row carries the bucket's RUNNING total, so
 * the old copy must be removed rather than summed twice — and if it is the row that then rolls off,
 * its running total is what lands in the opening balance, which is exactly right.
 *
 * PURE.
 */
export function appendLedgerEntry(
  wallet: Record<string, unknown> | null | undefined,
  entry: LedgerRow,
  opts?: { replaceRollupRef?: string; max?: number },
): AppendResult {
  const w = wallet || {};
  const max = Math.max(1, opts?.max ?? MAX_WALLET_LEDGER_ENTRIES);
  const existing: LedgerRow[] = Array.isArray(w.walletLedger) ? (w.walletLedger as LedgerRow[]) : [];

  let base = existing;
  if (opts?.replaceRollupRef) {
    // Remove the bucket's previous row; the new one supersedes it and moves to the END, so the cap
    // trims genuinely old activity rather than a bucket still being added to.
    base = existing.filter((e) => String(e?.rollupRef ?? '') !== opts.replaceRollupRef);
  }

  const combined = [...base, entry];
  const overflow = Math.max(0, combined.length - max);
  const dropped = combined.slice(0, overflow);
  const ledger = combined.slice(overflow);

  // Whatever leaves the visible history moves into the opening balance. Nothing is lost, and the
  // invariant holds across the trim by construction.
  const openingTokens = num(w[LEDGER_OPENING_FIELD]) + dropped.reduce((sum, r) => sum + rowTokens(r), 0);

  return {
    ledger,
    openingTokens,
    droppedCount: num(w[LEDGER_DROPPED_FIELD]) + dropped.length,
  };
}

export type ReconcileVerdict = 'balanced' | 'off' | 'unknown';

export interface StatementRow {
  timestamp: string;
  description: string;
  /** Signed tokens. Positive is money in, negative is money out. */
  tokens: number;
  rupees: number;
  kind: 'credit' | 'debit' | 'nil';
  feature: string | null;
  /** The balance AFTER this row — what makes a statement readable rather than a list. */
  runningTokens: number;
  runningRupees: number;
  /** What NavBharatAI absorbed on this row (the overdraft floor). Never part of the user's number. */
  absorbedInr: number;
}

export interface WalletStatement {
  openingTokens: number;
  openingRupees: number;
  /** True when the opening balance is an assumption rather than a record — see the header. */
  openingIsAssumed: boolean;
  /** Rows the user can no longer see, if any. */
  hiddenRows: number;
  rows: StatementRow[];
  creditTokens: number;
  debitTokens: number;
  /** opening + credits − debits. What the balance SHOULD be. */
  expectedTokens: number;
  /** What the wallet document actually says. */
  actualTokens: number;
  /** expected − actual. Zero when the books balance. */
  differenceTokens: number;
  differenceRupees: number;
  verdict: ReconcileVerdict;
  /** Owed but not yet debited — under one whole token, carried to the next charge. */
  carryTokens: number;
  /** The ₹ view of the same balance, and whether it agrees with the token view. */
  actualRupees: number;
  rupeeViewTokens: number;
  rupeeViewAgrees: boolean;
  /** Plain sentences a person can read. Never empty when something needs explaining. */
  notes: string[];
}

function iso(v: unknown): string {
  const s = String(v ?? '').trim();
  return s || '';
}

/**
 * Build the statement and reconcile it.
 *
 * 🔒 IT NEVER "CORRECTS" ANYTHING. It reads a document and reports. A reconciler that quietly
 * adjusted a balance to make its own arithmetic work would be the most dangerous piece of code in
 * this repo — the whole value of this module is that its answer can be WRONG and say so.
 *
 * PURE.
 */
export function buildWalletStatement(wallet: Record<string, unknown> | null | undefined): WalletStatement {
  const w = wallet || {};
  const ledger: LedgerRow[] = Array.isArray(w.walletLedger) ? (w.walletLedger as LedgerRow[]) : [];
  const notes: string[] = [];

  const openingTokens = num(w[LEDGER_OPENING_FIELD]);
  const hiddenRows = num(w[LEDGER_DROPPED_FIELD]);
  // An account whose ledger is FULL and which carries no opening record predates this accounting.
  // Its oldest rows are genuinely gone, so the opening is an assumption, not a fact.
  const openingIsAssumed = w[LEDGER_OPENING_FIELD] === undefined && ledger.length >= MAX_WALLET_LEDGER_ENTRIES;

  let running = openingTokens;
  let creditTokens = 0;
  let debitTokens = 0;
  const rows: StatementRow[] = ledger.map((r) => {
    const tokens = rowTokens(r);
    if (tokens > 0) creditTokens += tokens;
    else if (tokens < 0) debitTokens += -tokens;
    running += tokens;
    return {
      timestamp: iso(r?.timestamp),
      description: String(r?.description ?? '').trim() || 'Wallet movement',
      tokens,
      rupees: Math.round((tokens / TOKENS_PER_RUPEE) * 100) / 100,
      kind: tokens > 0 ? 'credit' : tokens < 0 ? 'debit' : 'nil',
      feature: r?.feature ? String(r.feature) : null,
      runningTokens: running,
      runningRupees: Math.round((running / TOKENS_PER_RUPEE) * 100) / 100,
      absorbedInr: num(r?.absorbedInr),
    };
  });

  const expectedTokens = openingTokens + creditTokens - debitTokens;
  const actualTokens = num(w.tokenBalance);
  const differenceTokens = expectedTokens - actualTokens;

  const verdict: ReconcileVerdict = openingIsAssumed
    ? 'unknown'
    : differenceTokens === 0 ? 'balanced' : 'off';

  if (openingIsAssumed) {
    notes.push(
      `This statement begins at the oldest entry still held. ${hiddenRows > 0 ? `${hiddenRows} earlier entries` : 'Earlier entries'} rolled off before opening balances were recorded, so the total below cannot be checked against the balance.`,
    );
  } else if (hiddenRows > 0) {
    notes.push(`${hiddenRows} earlier entries are no longer shown; their total is included in the opening balance.`);
  }

  if (verdict === 'off') {
    notes.push(
      `The entries add up to ${(expectedTokens / TOKENS_PER_RUPEE).toFixed(2)} but the balance is ${(actualTokens / TOKENS_PER_RUPEE).toFixed(2)} — a difference of ₹${Math.abs(differenceTokens / TOKENS_PER_RUPEE).toFixed(2)}.`,
    );
  }

  const carryTokens = num(w[TOKEN_CARRY_FIELD]);
  if (carryTokens > 0) {
    notes.push('A charge smaller than ₹0.01 is carried to your next charge rather than rounded up, so it is not shown as a line yet.');
  }

  // The ₹ view. It may legitimately differ — a Pass buyer's two views differ by the Pass price,
  // permanently and by design — so this is REPORTED, never reconciled away.
  const actualRupees = num(w.remaining_balance);
  const rupeeViewTokens = Math.round(actualRupees * TOKENS_PER_RUPEE);
  const rupeeViewAgrees = Math.abs(rupeeViewTokens - actualTokens) <= 1; // one token of paisa rounding
  if (!rupeeViewAgrees) {
    notes.push(
      `The two stored views of this balance differ: ${actualTokens.toLocaleString()} tokens against ₹${actualRupees.toFixed(2)}. This is expected on an account that bought a Pass.`,
    );
  }

  return {
    openingTokens,
    openingRupees: Math.round((openingTokens / TOKENS_PER_RUPEE) * 100) / 100,
    openingIsAssumed,
    hiddenRows,
    rows,
    creditTokens,
    debitTokens,
    expectedTokens,
    actualTokens,
    differenceTokens,
    differenceRupees: Math.round((differenceTokens / TOKENS_PER_RUPEE) * 100) / 100,
    verdict,
    carryTokens,
    actualRupees,
    rupeeViewTokens,
    rupeeViewAgrees,
    notes,
  };
}
