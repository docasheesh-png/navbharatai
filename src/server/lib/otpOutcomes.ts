// HOW MOBILE OTP IS ENDING — sent, verified, or failed, and WHY it failed (admin 2026-09-26:
// "Mobile otp send nhi ho raha hai").
//
// 🔴 WHY: a failed OTP left no trace anyone could read. The native phone-auth plugin reports a failure
// only as a message, the screen showed one generic line, and the real reason went to the phone's own
// developer console. The single most useful fact for fixing it — "the provider does not recognise this
// app" vs "the region is not enabled" vs "the SMS quota is spent" — existed only on the handset that
// failed. This store is where it lands instead.
//
// 🔑 PATTERNED ON `referralClaimOutcomes.ts`: one document per UTC day of COUNTS, `FieldValue.increment`
// per key, plus the LATEST scrubbed detail per failure category (overwritten, so it stays bounded).
//
// 🔒 IT CAN NEVER BLOCK A SIGN-IN. Every write is best-effort and swallowed; the route answers 204
// before this finishes. 🔒 NOTHING NAMES A PERSON: no phone number, no uid, no IP. The detail is
// scrubbed on the phone (`otpFailureDetail`) and again here.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { outcomeDayKey } from './mobileBuildOutcomeStore';
import { OTP_FAILURE_CATEGORIES, isConfigurationFault, type OtpFailureCategory } from '../../lib/otpFailure';

export const OTP_OUTCOME_COLLECTION = 'auth_otp_outcomes';

export type OtpOutcome = 'sent' | 'failed' | 'verified';
export const OTP_OUTCOMES: readonly OtpOutcome[] = ['sent', 'failed', 'verified'];
export type OtpSurface = 'android' | 'ios' | 'web';
export const OTP_SURFACES: readonly OtpSurface[] = ['android', 'ios', 'web'];
const STAGES = ['gateway', 'send', 'verify'] as const;
const FLOWS = ['sign-in', 'link'] as const;

export interface OtpOutcomeInput {
  outcome: OtpOutcome;
  surface: OtpSurface;
  flow: (typeof FLOWS)[number];
  stage?: (typeof STAGES)[number];
  category?: OtpFailureCategory;
  detail?: string;
}

/** The detail, scrubbed once more on OUR side — a client cannot be trusted to have done it. PURE. */
export function scrubDetail(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\+?\d[\d\s-]{5,}\d/g, '<number>')
    .replace(/[A-Za-z0-9_-]{40,}/g, '<token>')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** Read a client's report. Anything outside the known enums is refused (null), never coerced. PURE. */
export function parseOtpOutcome(body: unknown): OtpOutcomeInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const outcome = OTP_OUTCOMES.find((o) => o === b.outcome);
  const surface = OTP_SURFACES.find((s) => s === b.surface);
  const flow = FLOWS.find((f) => f === b.flow);
  if (!outcome || !surface || !flow) return null;
  const input: OtpOutcomeInput = { outcome, surface, flow };
  if (outcome === 'failed') {
    input.stage = STAGES.find((s) => s === b.stage) ?? 'send';
    input.category = OTP_FAILURE_CATEGORIES.find((c) => c === b.category) ?? 'other';
    const detail = scrubDetail(b.detail);
    if (detail) input.detail = detail;
  }
  return input;
}

function db(): admin.firestore.Firestore | null {
  try { return getServerDb(); } catch { return null; }
}

/** Count one outcome. Best-effort; never throws; callers do not await it. */
export async function recordOtpOutcome(input: OtpOutcomeInput, atMs: number = Date.now()): Promise<boolean> {
  const store = db();
  if (!store) return false;
  const day = outcomeDayKey(atMs);
  const inc = admin.firestore.FieldValue.increment;
  const patch: Record<string, unknown> = {
    day,
    counts: { [input.surface]: { [input.outcome]: inc(1) } },
  };
  if (input.outcome === 'failed' && input.category) {
    const key = `${input.flow}:${input.stage ?? 'send'}:${input.category}`;
    patch.reasons = { [input.surface]: { [key]: inc(1) } };
    if (input.detail) patch.lastDetail = { [`${input.surface}:${input.category}`]: { text: input.detail, at: atMs } };
  }
  try {
    await store.collection(OTP_OUTCOME_COLLECTION).doc(day).set(patch, { merge: true });
    return true;
  } catch {
    return false;
  }
}

export interface DailyOtpOutcomes {
  day: string;
  counts: Partial<Record<OtpSurface, Partial<Record<OtpOutcome, number>>>>;
  reasons: Partial<Record<OtpSurface, Record<string, number>>>;
  lastDetail: Record<string, { text: string; at: number }>;
}

/** The last `days` UTC days, newest first. Bounded; never throws. */
export async function listDailyOtpOutcomes(days = 14): Promise<DailyOtpOutcomes[]> {
  const store = db();
  if (!store) return [];
  try {
    const snap = await store.collection(OTP_OUTCOME_COLLECTION)
      .orderBy('day', 'desc')
      .limit(Math.max(1, Math.min(90, days)))
      .get();
    return snap.docs
      .map((d) => d.data() as Partial<DailyOtpOutcomes>)
      .filter((r): r is DailyOtpOutcomes => !!r && typeof r.day === 'string')
      .map((r) => ({ day: r.day, counts: r.counts ?? {}, reasons: r.reasons ?? {}, lastDetail: r.lastDetail ?? {} }));
  } catch {
    return [];
  }
}

export interface OtpSurfaceTally {
  surface: OtpSurface;
  sent: number;
  failed: number;
  verified: number;
  /** `flow:stage:category`, commonest first. */
  reasons: Array<{ key: string; count: number }>;
}

export interface OtpOutcomeSummary {
  bySurface: OtpSurfaceTally[];
  /** The newest recorded detail per `surface:category`, newest first. */
  latest: Array<{ key: string; text: string; at: number }>;
  /** One plain reading of the numbers. Never a guess past what they say. */
  headline: string;
}

/** What the admin card shows. PURE — no clock, no I/O. */
export function summariseOtpOutcomes(rows: readonly DailyOtpOutcomes[]): OtpOutcomeSummary {
  const bySurface = OTP_SURFACES.map((surface): OtpSurfaceTally => {
    let sent = 0; let failed = 0; let verified = 0;
    const reasons = new Map<string, number>();
    for (const r of rows) {
      const c = r.counts?.[surface] ?? {};
      sent += Number(c.sent ?? 0) || 0;
      failed += Number(c.failed ?? 0) || 0;
      verified += Number(c.verified ?? 0) || 0;
      for (const [k, n] of Object.entries(r.reasons?.[surface] ?? {})) reasons.set(k, (reasons.get(k) ?? 0) + (Number(n) || 0));
    }
    return {
      surface, sent, failed, verified,
      reasons: [...reasons.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    };
  });

  const latestMap = new Map<string, { text: string; at: number }>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.lastDetail ?? {})) {
      if (!v || typeof v.text !== 'string') continue;
      const prev = latestMap.get(k);
      if (!prev || Number(v.at) > prev.at) latestMap.set(k, { text: v.text, at: Number(v.at) || 0 });
    }
  }
  const latest = [...latestMap.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.at - a.at);

  return { bySurface, latest, headline: otpHeadline(bySurface) };
}

function otpHeadline(bySurface: readonly OtpSurfaceTally[]): string {
  const attempts = bySurface.reduce((n, s) => n + s.sent + s.failed, 0);
  if (attempts === 0) return 'No mobile OTP attempt has been recorded yet.';
  const parts: string[] = [];
  for (const s of bySurface) {
    if (s.sent + s.failed === 0) continue;
    const top = s.reasons[0];
    const cat = top ? (top.key.split(':').pop() as OtpFailureCategory) : null;
    if (s.sent === 0 && s.failed > 0) {
      parts.push(`${s.surface}: every send failed (${s.failed})${cat ? ` — mostly "${cat}"${isConfigurationFault(cat) ? ', a setting on our side' : ''}` : ''}.`);
    } else if (s.failed > 0) {
      parts.push(`${s.surface}: ${s.sent} sent, ${s.failed} failed${cat ? ` — top reason "${cat}"` : ''}.`);
    } else {
      parts.push(`${s.surface}: ${s.sent} sent, none failed.`);
    }
  }
  return parts.join(' ');
}
