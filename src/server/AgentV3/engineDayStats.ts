// PER-DAY ENGINE STATS — what the admin's "Build Engines" panel shows when an engine is tapped.
//
// Admin 2026-11-25: "BUILD ENGINES me provider ke naam ke age abhi failed response likh ke aa rahe hai, woh theek nahi
// hai, inko per day fail response karo! … kisi provider par tap kar ke mai dekh saku ki kitne request gayi, kitne
// response aye, kitni der me aye (avg) aur kitne fail huye … fallback system kam kyu nahi kiya woh bhi likh kar ana
// chahiye".
//
// 🔴 WHY A NEW RECORD. The chip's "18 failed" came from the engine-health aggregate, which reads only the LATEST build
// of each project saved in the last 24 hours — a rolling window over a sample, not a day, and with no time or request
// count at all. Every build already knows, per engine, the turns it delivered, the calls that failed and why, the time
// of each answer and which engine carried on when one failed (BuildDiagnostics). This keeps that at the end of EVERY
// build, in one document per UTC day — the `agentv3_engine_use` pattern: one small write per build, never per call.
//
// 🔒 Limits, said where they are shown: a build whose server was lost before it finished never reaches `finish()`, so
// its calls are not counted; a failed attempt is counted once per attempt the engine refused.
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { engineKey, engineUseDayKey } from './engineUseStore';

export const ENGINE_DAY_COLLECTION = 'agentv3_engine_day';

/** One engine's part of one build. */
export interface EngineBuildTally {
  /** Build turns this engine delivered (answered). */
  answered: number;
  /** Calls/attempts this engine failed. */
  failed: number;
  /** Answers whose own time was measured, and their total time (ms). */
  timedAnswers: number;
  answerMsTotal: number;
  /** Why it failed: a code (the engine's own refusal code when it gave one, else the classifier's bucket) → count. */
  reasons: Record<string, number>;
  /** When it failed, which engine answered that turn instead → count. */
  carriedBy: Record<string, number>;
}

export interface EngineDayRow extends EngineBuildTally {
  engine: string;
  /** Builds that used or tried this engine that day. */
  builds: number;
  /** answered + failed. */
  requests: number;
  /** Average time of a measured answer, ms; null when none was measured. */
  avgAnswerMs: number | null;
}

/** A Firestore-safe map key for a reason code. PURE. */
export function reasonKey(raw: string): string {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'unknown';
}

/** The engine's own refusal code inside a failure message ("… (code no_sellers_for_model) …"), when there is one. PURE. */
export function engineCodeInMessage(message: string): string | null {
  const m = /\(code ([A-Za-z0-9_.-]{1,48})\)/.exec(String(message ?? ''));
  return m ? reasonKey(m[1]) : null;
}

/** A plain sentence per reason, for an admin who is not an engineer. Unknown codes are shown as written. */
export const ENGINE_REASON_TEXT: Readonly<Record<string, string>> = Object.freeze({
  no_sellers_for_model: 'Surplus had no seller for this model at that moment, so this model was skipped and another tried.',
  minimum_discount_not_met: 'No Surplus seller met the minimum discount (85%, or 90% for a Claude-family model) for a request this size, so this model was skipped.',
  'rate-limit': 'Too many requests: the provider rate-limited this key (HTTP 429).',
  timeout: 'Timed out before the answer finished.',
  silent: 'Sent nothing back within the wait time.',
  crawl: 'Started answering, but far too slowly.',
  'output-budget': 'Spent its token allowance thinking and returned no usable answer.',
  auth: 'The API key was refused (wrong, expired or revoked key).',
  billing: 'Out of balance or credit on the provider account.',
  'model-unavailable': 'The requested model is not available on this key.',
  'bad-request': 'The provider rejected the request as invalid.',
  'context-length': 'The request was longer than the model accepts.',
  'server-error': 'The provider had a server error (HTTP 5xx).',
  network: 'Could not connect to the provider.',
  unknown: 'Failed for a reason the build did not classify.',
});

/** Record one finished build's engines into its day. Best-effort; never throws; one write. */
export async function recordEngineDay(tally: Readonly<Record<string, EngineBuildTally>>, atMs: number = Date.now()): Promise<void> {
  const inc = (n: number) => admin.firestore.FieldValue.increment(n);
  const engines: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(tally ?? {})) {
    const key = engineKey(name);
    if (!key || !(t.answered > 0 || t.failed > 0)) continue;
    const reasons: Record<string, unknown> = {};
    for (const [code, n] of Object.entries(t.reasons ?? {})) if (n > 0) reasons[reasonKey(code)] = inc(n);
    const carriedBy: Record<string, unknown> = {};
    for (const [other, n] of Object.entries(t.carriedBy ?? {})) { const k = engineKey(other); if (k && n > 0) carriedBy[k] = inc(n); }
    engines[key] = {
      builds: inc(1), answered: inc(Math.max(0, t.answered)), failed: inc(Math.max(0, t.failed)),
      timedAnswers: inc(Math.max(0, t.timedAnswers)), answerMsTotal: inc(Math.max(0, Math.round(t.answerMsTotal))),
      ...(Object.keys(reasons).length ? { reasons } : {}), ...(Object.keys(carriedBy).length ? { carriedBy } : {}),
    };
  }
  if (!Object.keys(engines).length) return;
  try {
    const db = getServerDb();
    if (!db) return;
    const day = engineUseDayKey(atMs);
    await db.collection(ENGINE_DAY_COLLECTION).doc(day).set({ day, engines }, { merge: true });
  } catch { /* an observation must never block a build */ }
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
function counts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (num(n) > 0) out[k] = num(n);
  return out;
}

/** A stored day document → rows, most-failed first. PURE; anything malformed reads as zero, never as invented. */
export function engineDayRows(doc: unknown): EngineDayRow[] {
  const engines = doc && typeof doc === 'object' ? (doc as { engines?: unknown }).engines : undefined;
  if (!engines || typeof engines !== 'object') return [];
  return Object.entries(engines as Record<string, unknown>).map(([engine, raw]) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const answered = num(r.answered), failed = num(r.failed), timedAnswers = num(r.timedAnswers), answerMsTotal = num(r.answerMsTotal);
    return { engine, builds: num(r.builds), answered, failed, requests: answered + failed, timedAnswers, answerMsTotal,
      avgAnswerMs: timedAnswers > 0 ? Math.round(answerMsTotal / timedAnswers) : null, reasons: counts(r.reasons), carriedBy: counts(r.carriedBy) };
  }).sort((a, b) => b.failed - a.failed || b.requests - a.requests || a.engine.localeCompare(b.engine));
}

/** The last `days` UTC days, newest first. `null` = could not read (never the same as "nothing ran"). */
export async function readEngineDays(days = 7, nowMs: number = Date.now()): Promise<Array<{ day: string; engines: EngineDayRow[] }> | null> {
  try {
    const db = getServerDb();
    if (!db) return null;
    const keys = Array.from({ length: Math.max(1, Math.min(31, days)) }, (_, i) => engineUseDayKey(nowMs - i * 86_400_000));
    const snaps = await Promise.all(keys.map(k => db.collection(ENGINE_DAY_COLLECTION).doc(k).get()));
    return snaps.map((s, i) => ({ day: keys[i], engines: s.exists ? engineDayRows(s.data()) : [] }));
  } catch { return null; }
}
