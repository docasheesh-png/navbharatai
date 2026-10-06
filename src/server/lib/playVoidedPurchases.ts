// A GOOGLE PLAY REFUND OR CHARGEBACK TAKES BACK THE TOKENS THAT PURCHASE BOUGHT (Q-690).
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// Q-614 (#3551) made a Cashfree refund or chargeback take its tokens back. The store rails were left
// out: Play only told us about refunds at the moment of the FIRST verify, so a pack refunded a week
// later — by the user from Play, by Google for fraud, or as a bank chargeback — kept every token it
// bought. The fix — a daily check of Play's voided-purchases list with the existing service account —
// was recommended on 2026-10-06 and accepted by the admin ("ok banao").
//
// ── WHAT ONE RUN DOES ────────────────────────────────────────────────────────────────────────────
//   1. Not configured (`GOOGLE_PLAY_PACKAGE_NAME` / `GOOGLE_PLAY_SA_JSON` unset or unreadable) ⇒ it
//      records "not-configured" and makes NO call. Never a crash, never a fake "ok".
//   2. Reads the durable cursor (the newest `voidedTimeMillis` fully applied) and asks Play for every
//      purchase voided since `cursor − 24 h` (the overlap absorbs Google listing a void late), never
//      further back than Google allows (30 days). No cursor yet ⇒ the whole 30 days.
//   3. For each voided purchase: finds OUR `payment_transactions` row by the same id the credit wrote
//      (`storeTransactionDocId('google', orderId || purchaseToken)` — orderId first, then the token)
//      and calls the ONE reversal path, `applyOrderReversal`, with the FULL store price paid. A Play void
//      is a whole purchase (partial quantity refunds are not requested), so it takes back everything the
//      pack credited — down to zero, never below, through `walletMirror` and a Refund/Chargeback line.
//      Play's `voidedReason` and `voidedSource` go on the order and, in plain words, on the user's
//      statement line.
//   4. Idempotent end to end: `applyOrderReversal` keeps its own marker on the order, so a void seen
//      twice (the overlap, a crash, a re-run) takes nothing the second time.
//   5. An unknown purchase (not ours, never credited, a test purchase) is SKIPPED AND COUNTED — never an
//      error, because a void we never credited costs us nothing.
//   6. The cursor advances only after a WHOLE page is applied without an error. A crash part-way through
//      a page re-reads that page next time, which is safe because of (4).
//   7. The outcome — status, counts, the window, the reason when it could not run — is written next to
//      the scheduler's own record of the job (`job_runs/play-voided-purchases`), where the admin's
//      Revenue page reads it.
//
// ⚠️ ASSUMPTION (Play Developer API v3): Google lists voided purchases oldest-first, so the newest void on
// a page is a safe resume point. Even if it does not, a void older than the cursor is re-read by the 24 h
// overlap; only one listed more than a day late AND out of order could be missed, and Google documents
// neither.
//
// ⚠️ PERMISSION the admin grants in Play Console (not in code): the service account needs "View financial
// data, orders and cancellation survey responses". Without it every run records "refused" with that hint.

import { doc, getDoc, setDoc, getServerDb } from './serverDb';
import {
  googleAccessToken, googleServiceAccountEmail, readGoogleVoidedPurchasesPage, PLAY_DEVELOPER_SCOPE,
  type GoogleVoidedPurchase,
} from './storeVerify';
import { storeTransactionDocId } from './storeBilling';
import { applyOrderReversal } from './paymentReversalStore';
import { reversalPaidBasisInr } from './paymentReversal';
import { JOB_RUNS_COLLECTION } from './schedulerTick';

/** The job's id in the shared scheduler and its document in `job_runs`. */
export const PLAY_VOIDED_JOB = 'play-voided-purchases';
/** Where the resume point lives: ONE document. */
export const PLAY_VOIDED_CURSOR_COLLECTION = 'payment_reversal_cursors';
export const PLAY_VOIDED_CURSOR_DOC = 'google_play_voided';
/** Re-read this much before the cursor — a void Google lists late is still caught. */
export const PLAY_VOIDED_OVERLAP_MS = 24 * 60 * 60 * 1000;
/** Google refuses a `startTime` older than 30 days; ten minutes of margin keeps a slow clock from tripping it. */
export const PLAY_VOIDED_MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000 - 10 * 60 * 1000;
/** A bound on one run. 50 pages × 1000 = 50,000 voids a day — far beyond any real volume. */
export const PLAY_VOIDED_MAX_PAGES = 50;

export type PlayVoidedStatus =
  /** Package name or service account missing or unreadable: nothing was called. */
  | 'not-configured'
  /** Every page was read and applied. */
  | 'ok'
  /** Some pages were applied; the rest (an item error, a cursor write failure, the page bound) waits for the next run. */
  | 'partial'
  /** Google refused the call (401/403) — almost always the missing "View financial data" permission. */
  | 'refused'
  /** Could not run at all: no database, no cursor, no access token, Google unreachable. */
  | 'failed';

export interface PlayVoidedRunResult {
  status: PlayVoidedStatus;
  /** Why it did not finish, in words the admin can act on. Absent on `ok`. */
  reason?: string;
  ranAt: string;
  /** The window asked for, epoch ms. */
  startTimeMs: number | null;
  endTimeMs: number;
  cursorBefore: number | null;
  cursorAfter: number | null;
  pages: number;
  /** Voided purchases Google listed. */
  seen: number;
  /** Tokens were taken back (or the shortfall recorded) on one of OUR purchases. */
  reversed: number;
  /** Ours, but already reversed by an earlier run — nothing taken. */
  alreadyReversed: number;
  /** Not one of our credited purchases: skipped. */
  unknown: number;
  /** A purchase whose reversal threw; its page will be re-read. */
  errors: number;
  tokensTaken: number;
  shortfallTokens: number;
  /** The cursor was older than Google's 30-day window: voids in between can no longer be listed. */
  gap: boolean;
  /** Up to ten unknown order ids, for the admin to look up in Play Console. */
  unknownSamples: string[];
}

const REASON_WORDS: Record<number, string> = {
  0: 'other',
  1: 'changed their mind',
  2: 'not received',
  3: 'defective',
  4: 'accidental purchase',
  5: 'fraud',
  6: 'disputed with the bank',
  7: 'chargeback',
  8: 'not acknowledged in time',
};
const SOURCE_WORDS: Record<number, string> = {
  0: 'requested by you',
  1: 'issued by us',
  2: 'issued by the store',
};

/** Play's reason code in plain words. PURE. */
export function voidedReasonLabel(code: number): string {
  return REASON_WORDS[code] ?? 'not stated';
}

/** Who voided it, in plain words for the buyer's own statement. PURE. */
export function voidedSourceLabel(code: number): string {
  return SOURCE_WORDS[code] ?? 'by the store';
}

/** A chargeback (the bank took the money back) rather than a refund. PURE. */
export function isChargebackReason(code: number): boolean {
  return code === 6 || code === 7;
}

/** The `payment_transactions` ids a voided purchase could have been credited under, most specific first. PURE. */
export function voidedPurchaseDocIds(v: Pick<GoogleVoidedPurchase, 'orderId' | 'purchaseToken'>): string[] {
  const out: string[] = [];
  for (const id of [v.orderId, v.purchaseToken]) {
    if (!id) continue;
    const docId = storeTransactionDocId('google', id);
    if (docId !== 'store_google_' && !out.includes(docId)) out.push(docId);
  }
  return out;
}

type Outcome = 'reversed' | 'alreadyReversed' | 'unknown';

async function applyOne(db: any, v: GoogleVoidedPurchase, nowIso: string, r: PlayVoidedRunResult): Promise<Outcome> {
  let orderId: string | null = null;
  let tx: Record<string, unknown> | null = null;
  for (const id of voidedPurchaseDocIds(v)) {
    const snap = await getDoc(doc(db, 'payment_transactions', id));
    if (!snap.exists()) continue;
    const data = snap.data() as Record<string, unknown>;
    // Only a Play row is ours to reverse here: the id is namespaced, and this makes it a fact, not a convention.
    if (String(data?.paymentProvider ?? '').toUpperCase() !== 'GOOGLE_PLAY') continue;
    orderId = id;
    tx = data;
    break;
  }
  if (!orderId || !tx) return 'unknown';

  const basis = reversalPaidBasisInr(tx);
  const chargeback = isChargebackReason(v.voidedReason);
  const reason = voidedReasonLabel(v.voidedReason);
  const source = voidedSourceLabel(v.voidedSource);
  const result = await applyOrderReversal(db, {
    orderId,
    // The WHOLE purchase: a Play void is never partial here (see `readGoogleVoidedPurchasesPage`).
    refundedInr: chargeback ? null : basis,
    disputeLostInr: chargeback ? basis : null,
    now: nowIso,
    recordFields: {
      voidedReason: v.voidedReason,
      voidedReasonLabel: reason,
      voidedSource: v.voidedSource,
      voidedSourceLabel: source,
      voidedAt: v.voidedTimeMillis > 0 ? new Date(v.voidedTimeMillis).toISOString() : nowIso,
    },
    ledgerNote: `${reason}; ${source}`,
  });
  if (result.status === 'clawed-back') {
    r.tokensTaken += result.appliedTokens ?? 0;
    r.shortfallTokens += result.shortfallTokens ?? 0;
    return 'reversed';
  }
  return 'alreadyReversed';
}

async function recordRun(db: any, r: PlayVoidedRunResult): Promise<void> {
  if (!db) return;
  // Beside the scheduler's own `lastRunAt` (merge), so one document answers "when, and what happened".
  await setDoc(doc(db, JOB_RUNS_COLLECTION, PLAY_VOIDED_JOB), { jobId: PLAY_VOIDED_JOB, lastResult: r }, { merge: true })
    .catch((e: unknown) => console.warn(`[play-voided] could not record the run: ${e instanceof Error ? e.message : String(e)}`));
}

/**
 * One pass over Play's Voided Purchases list. Never throws: every outcome is a recorded result.
 *
 * `db` / `nowMs` / `env` are injectable for tests; production passes nothing.
 */
export async function runPlayVoidedPurchases(opts: {
  db?: any;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  maxPages?: number;
} = {}): Promise<PlayVoidedRunResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const env = opts.env ?? process.env;
  const maxPages = Math.max(1, opts.maxPages ?? PLAY_VOIDED_MAX_PAGES);
  const r: PlayVoidedRunResult = {
    status: 'ok', ranAt: new Date(nowMs).toISOString(), startTimeMs: null, endTimeMs: nowMs,
    cursorBefore: null, cursorAfter: null, pages: 0, seen: 0, reversed: 0, alreadyReversed: 0, unknown: 0,
    errors: 0, tokensTaken: 0, shortfallTokens: 0, gap: false, unknownSamples: [],
  };
  let db: any = null;
  try { db = opts.db ?? getServerDb(); } catch { db = null; }

  const finish = async (status: PlayVoidedStatus, reason?: string): Promise<PlayVoidedRunResult> => {
    r.status = status;
    if (reason) r.reason = reason;
    await recordRun(db, r);
    return r;
  };

  // 1. Configuration — the same two keys the purchase verifier reads, and nothing is called without them.
  const packageName = String(env.GOOGLE_PLAY_PACKAGE_NAME ?? '').trim();
  const saRaw = String(env.GOOGLE_PLAY_SA_JSON ?? '').trim();
  if (!packageName || !saRaw) {
    return finish('not-configured', 'GOOGLE_PLAY_PACKAGE_NAME and GOOGLE_PLAY_SA_JSON must both be set — no Play refund was checked.');
  }
  if (!googleServiceAccountEmail(env)) {
    return finish('not-configured', 'GOOGLE_PLAY_SA_JSON is set but is not a readable service-account JSON (client_email and private_key) — no Play refund was checked.');
  }
  if (!db) return finish('failed', 'No database — the cursor and the purchases cannot be read.');

  // 2. The resume point. An unreadable cursor stops the run rather than guessing a window.
  const cursorRef = doc(db, PLAY_VOIDED_CURSOR_COLLECTION, PLAY_VOIDED_CURSOR_DOC);
  let cursor: number | null = null;
  try {
    const snap = await getDoc(cursorRef);
    const v = snap.exists() ? Number((snap.data() as { lastVoidedTimeMillis?: unknown })?.lastVoidedTimeMillis) : NaN;
    cursor = Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  } catch (e) {
    return finish('failed', `The cursor could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  r.cursorBefore = cursor;
  r.cursorAfter = cursor;
  const floor = nowMs - PLAY_VOIDED_MAX_LOOKBACK_MS;
  r.gap = cursor !== null && cursor < floor;
  const startTimeMs = cursor === null ? floor : Math.max(cursor - PLAY_VOIDED_OVERLAP_MS, floor);
  r.startTimeMs = startTimeMs;

  // 3. One access token for the whole run — the verifier's own helper, same account, same scope.
  const accessToken = await googleAccessToken(Math.floor(nowMs / 1000), PLAY_DEVELOPER_SCOPE, env);
  if (!accessToken) {
    return finish('failed', 'Google did not issue an access token for the service account (check that the key is current and the account is enabled).');
  }

  const nowIso = new Date(nowMs).toISOString();
  let pageToken: string | null = null;
  for (;;) {
    if (r.pages >= maxPages) {
      return finish('partial', `Stopped after ${maxPages} page(s); the next run continues from the cursor.`);
    }
    const page = await readGoogleVoidedPurchasesPage({ accessToken, packageName, startTimeMs, endTimeMs: nowMs, pageToken });
    if (!page.ok) {
      const refused = page.status === 401 || page.status === 403;
      return finish(refused ? 'refused' : r.pages > 0 ? 'partial' : 'failed', page.reason);
    }

    let pageErrors = 0;
    let pageNewest = 0;
    for (const v of page.purchases) {
      r.seen++;
      pageNewest = Math.max(pageNewest, v.voidedTimeMillis);
      try {
        const outcome = await applyOne(db, v, nowIso, r);
        r[outcome]++;
        if (outcome === 'unknown' && r.unknownSamples.length < 10) r.unknownSamples.push(v.orderId || '(no order id)');
      } catch (e) {
        r.errors++;
        pageErrors++;
        console.warn(`[play-voided] ${v.orderId || 'a voided purchase'} could not be reversed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (pageErrors > 0) {
      // The cursor stays where it was: the whole page is re-read next run, and every purchase that WAS
      // applied is a no-op then.
      return finish('partial', `${pageErrors} voided purchase(s) on page ${r.pages + 1} could not be reversed; that page is retried next run.`);
    }
    r.pages++;

    // 4. The page is fully applied — only now may the resume point move.
    const nextCursor = Math.max(r.cursorAfter ?? 0, pageNewest);
    if (nextCursor > 0 && nextCursor !== r.cursorAfter) {
      try {
        await setDoc(cursorRef, { lastVoidedTimeMillis: nextCursor, updatedAt: nowIso }, { merge: true });
        r.cursorAfter = nextCursor;
      } catch (e) {
        return finish('partial', `The cursor could not be saved: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  if (r.gap) {
    return finish('ok', 'The last checked refund is older than the 30 days Google can list, so refunds in between could not be checked — compare Play Console → Order management for that period.');
  }
  return finish('ok');
}

/** What the admin's Revenue page shows about this check. PURE over the `job_runs` document. */
export interface PlayRefundCheckView {
  lastRunAt: string | null;
  status: PlayVoidedStatus | 'never-run';
  reason: string | null;
  seen: number;
  reversed: number;
  alreadyReversed: number;
  unknown: number;
  errors: number;
}

export function playRefundCheckView(jobRun: Record<string, unknown> | null | undefined): PlayRefundCheckView {
  const last = (jobRun?.lastResult && typeof jobRun.lastResult === 'object' ? jobRun.lastResult : null) as Partial<PlayVoidedRunResult> | null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const statuses: readonly PlayVoidedStatus[] = ['not-configured', 'ok', 'partial', 'refused', 'failed'];
  if (!last || !statuses.includes(last.status as PlayVoidedStatus)) {
    return { lastRunAt: null, status: 'never-run', reason: null, seen: 0, reversed: 0, alreadyReversed: 0, unknown: 0, errors: 0 };
  }
  return {
    lastRunAt: typeof last.ranAt === 'string' ? last.ranAt : null,
    status: last.status as PlayVoidedStatus,
    reason: typeof last.reason === 'string' ? last.reason : null,
    seen: n(last.seen),
    reversed: n(last.reversed),
    alreadyReversed: n(last.alreadyReversed),
    unknown: n(last.unknown),
    errors: n(last.errors),
  };
}
