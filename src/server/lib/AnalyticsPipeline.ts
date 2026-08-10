// P-MON.1 — Server-side product-analytics pipeline.
//
// `/api/analytics/event` previously only console.log'd events — no aggregation, no funnels. This adds a
// real server-side rollup: every event increments a daily aggregate doc (per-event counts + the
// activation funnel signup→build→deploy→pay), race-safe via Firestore FieldValue.increment, plus a
// bounded raw-event log. Funnel/cohort queries read the daily rollups. Pure helpers (stage mapping,
// funnel aggregation) are unit-tested; the store is best-effort + VITEST-skip (never throws).

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

const DAILY_COLLECTION = 'analytics_daily';
const EVENTS_COLLECTION = 'analytics_events';

export type FunnelStage = 'signup' | 'build' | 'deploy' | 'pay';
export const FUNNEL_ORDER: FunnelStage[] = ['signup', 'build', 'deploy', 'pay'];

export interface DailyAnalytics {
  date: string;
  totalEvents: number;
  events: Record<string, number>;
  funnel: Record<FunnelStage, number>;
}

export interface FunnelResult {
  stages: Record<FunnelStage, number>;
  /** Stage-to-stage conversion rate (0..1), e.g. conversion.build = build/signup. */
  conversion: Record<FunnelStage, number>;
}

/** Map a raw event name to an activation-funnel stage (or null if it isn't a funnel event). Pure. */
export function funnelStage(event: string): FunnelStage | null {
  const e = String(event || '').toLowerCase();
  if (/(sign[_-]?up|signup|register|account[_-]?created)/.test(e)) return 'signup';
  if (/(build[_-]?start|build[_-]?created|app[_-]?build|generate[_-]?app|^build$)/.test(e)) return 'build';
  if (/(deploy|publish|go[_-]?live)/.test(e)) return 'deploy';
  if (/(pay|purchase|subscribe|checkout|upgrade[_-]?pro|billing[_-]?success)/.test(e)) return 'pay';
  return null;
}

/** Firestore-field-safe event key (no dots/slashes; bounded). Pure. */
export function sanitizeEventKey(event: string): string {
  return String(event || 'unknown').replace(/[.$/[\]#]/g, '_').slice(0, 80) || 'unknown';
}

/** Pure: aggregate a set of daily docs into the funnel + conversion rates. */
export function funnelFromDaily(dailies: Array<Partial<DailyAnalytics> | null | undefined>): FunnelResult {
  const stages: Record<FunnelStage, number> = { signup: 0, build: 0, deploy: 0, pay: 0 };
  for (const d of dailies) {
    const f = d?.funnel;
    if (!f) continue;
    for (const s of FUNNEL_ORDER) stages[s] += typeof f[s] === 'number' ? f[s] : 0;
  }
  const conversion: Record<FunnelStage, number> = { signup: 1, build: 0, deploy: 0, pay: 0 };
  conversion.signup = 1;
  conversion.build = stages.signup > 0 ? stages.build / stages.signup : 0;
  conversion.deploy = stages.build > 0 ? stages.deploy / stages.build : 0;
  conversion.pay = stages.deploy > 0 ? stages.pay / stages.deploy : 0;
  return { stages, conversion };
}

/** Pure: the UTC YYYY-MM-DD bucket for a timestamp. */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/** Record one analytics event into the daily rollup (race-safe increments) + a bounded raw log. Best-effort. */
export async function recordAnalyticsEvent(input: {
  event: string;
  userId?: string;
  sessionId?: string;
  props?: Record<string, unknown>;
  ts?: number;
}): Promise<void> {
  const event = typeof input?.event === 'string' ? input.event : '';
  if (!event) return;
  const db = getDb();
  if (!db) return;
  const ts = typeof input.ts === 'number' && input.ts > 0 ? input.ts : Date.now();
  const date = dayKey(ts);
  const key = sanitizeEventKey(event);
  const stage = funnelStage(event);
  try {
    const inc = admin.firestore.FieldValue.increment(1);
    const update: Record<string, unknown> = {
      date,
      totalEvents: inc,
      [`events.${key}`]: inc,
      updatedAt: Date.now(),
    };
    if (stage) update[`funnel.${stage}`] = inc;
    await db.collection(DAILY_COLLECTION).doc(date).set(update, { merge: true });
    // Bounded raw event (for cohort/segmentation drill-down). Best-effort, fire-and-forget.
    await db.collection(EVENTS_COLLECTION).add({
      event: key,
      userId: typeof input.userId === 'string' ? input.userId.slice(0, 128) : 'anon',
      sessionId: typeof input.sessionId === 'string' ? input.sessionId.slice(0, 128) : '',
      stage: stage || '',
      ts,
    });
  } catch {
    /* best-effort — analytics never breaks the request */
  }
}

/** Load the last `days` daily rollups and compute the activation funnel. Never throws. */
export async function getFunnel(days: number = 30): Promise<FunnelResult> {
  const db = getDb();
  if (!db) return funnelFromDaily([]);
  try {
    const snap = await db.collection(DAILY_COLLECTION).orderBy('date', 'desc').limit(Math.max(1, Math.min(365, days))).get();
    return funnelFromDaily(snap.docs.map((d) => d.data() as Partial<DailyAnalytics>));
  } catch {
    return funnelFromDaily([]);
  }
}
