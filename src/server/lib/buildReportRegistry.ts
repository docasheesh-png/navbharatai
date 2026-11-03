/**
 * THE BUILD REPORT REGISTRY — one permanent number for every build report, of every outcome.
 *
 * 🔴 WHY THIS EXISTS (admin 2026-11-02: "usme bas failed build report ati hai, aur numbering bhi stable
 * nahi hai … numbering rocksolid karo"). Two defects, one root each:
 *
 *   1. The number the failed-reports plugin showed was a RANK, recomputed on every read by scanning
 *      every retained failure and sorting by start time. A report expiring off the 180-day clock, or a
 *      late-arriving one, shifted every number after it. A rank is not an identity.
 *   2. A permanent allocator did exist (`reportNumber`, failures only), but its counter document was
 *      never created by anything, so every report was saved with `counter_uninitialized` and no number.
 *
 * The fix is an identity, not a better rank: a row per report in `build_report_numbers`, keyed by the
 * report's own identity (workspace + start time), carrying a number taken ONCE from a single
 * transactional counter. The number is given when the build's report is FIRST saved — every build,
 * whatever its outcome, including one that never finishes — and nothing ever rewrites it. Numbers are
 * never reused: the counter only moves forward, and a row that expires or is erased leaves a gap.
 *
 * Reports that predate the registry are numbered once, by `runBuildReportNumbering`, oldest first.
 * Until that has run, live writes leave a report unnumbered rather than give it a number that would
 * jump ahead of older reports; readers then say "numbering pending" instead of inventing one.
 */
import { FieldPath, type DocumentReference, type Firestore, type Query, type Transaction } from 'firebase-admin/firestore';
import { ABORT_OUTCOME_CODES } from '../AgentV3/abortOutcome';

export const BUILD_REPORT_NUMBERS_COLLECTION = 'build_report_numbers';
export const BUILD_REPORT_COUNTER_COLLECTION = 'admin_build_report_counter';
export const BUILD_REPORT_COUNTER_DOC = 'counter';
const DIAGNOSTICS_COLLECTION = 'workspace_diagnostics_v3';

export const BUILD_REPORT_OUTCOMES = ['failed', 'succeeded', 'stopped', 'unfinished'] as const;
export type BuildReportOutcome = typeof BUILD_REPORT_OUTCOMES[number];

export interface BuildReportRegistryRow {
  number: number;
  workspaceId: string;
  /** The history document id (`String(startedAt)`), or `latest` for a pre-history report. */
  historyId: string;
  startedAt: number;
  endedAt: number | null;
  outcome: BuildReportOutcome;
  numberedAt: number;
  /** The report's own latest save time; the retention clock reads this, matching its history entry. */
  lastSavedAt: number;
}

export interface BuildReportCounter {
  state: 'backfilling' | 'ready';
  nextNumber: number;
  leaseOwner?: string;
  leaseUntil?: number;
  readyAt?: number;
  sweptAt?: number;
  updatedAt?: number;
}

const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
export const validBuildReportNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value < Number.MAX_SAFE_INTEGER;

/** The report's identity. `~` cannot occur in a start time, so the last `~` always splits it. */
export function buildReportKey(workspaceId: string, startedAt: number): string {
  return `${workspaceId}~${startedAt}`;
}

/** A counter that may hand out numbers. Anything else allocates nothing, and says why. PURE. */
export function readyCounter(raw: unknown): BuildReportCounter | null {
  const c = raw as BuildReportCounter | undefined;
  return c && c.state === 'ready' && validBuildReportNumber(c.nextNumber) ? c : null;
}

/** What a report's outcome is, from the report alone. PURE. */
export function buildReportOutcome(raw: unknown, inProgress?: boolean): BuildReportOutcome {
  const r = (raw ?? {}) as { startedAt?: unknown; endedAt?: unknown; ok?: unknown; issues?: unknown };
  const settled = validTime(r.startedAt) && typeof r.endedAt === 'number' && Number.isFinite(r.endedAt) && r.endedAt >= r.startedAt;
  if (inProgress === true || !settled) return 'unfinished';
  if (r.ok === true) return 'succeeded';
  if (r.ok !== false) return 'unfinished';
  const stopped = Array.isArray(r.issues) && r.issues.some((i) => !!i && typeof i === 'object' && (i as { code?: unknown }).code === ABORT_OUTCOME_CODES.userStopped);
  return stopped ? 'stopped' : 'failed';
}

export interface RegistryWritePlan {
  entry?: BuildReportRegistryRow;
  counter?: Partial<BuildReportCounter>;
}

/**
 * The registry half of one history write. PURE, so every branch is tested without a database.
 *
 * An existing row keeps its number and only follows the report's outcome; a new row takes the next
 * number from a ready counter; with no ready counter, nothing is written and the backfill numbers it.
 */
export function planRegistryWrite(
  existing: unknown,
  counter: unknown,
  input: { workspaceId: string; historyId: string; report: { startedAt: number; endedAt?: number }; inProgress?: boolean; savedAt: number },
): RegistryWritePlan {
  const outcome = buildReportOutcome(input.report, input.inProgress);
  const endedAt = outcome === 'unfinished' || typeof input.report.endedAt !== 'number' ? null : input.report.endedAt;
  const prior = existing as Partial<BuildReportRegistryRow> | undefined;
  if (prior && validBuildReportNumber(prior.number)) {
    return { entry: { ...(prior as BuildReportRegistryRow), endedAt, outcome, lastSavedAt: input.savedAt } };
  }
  const ready = readyCounter(counter);
  if (!ready) return {};
  return {
    entry: {
      number: ready.nextNumber, workspaceId: input.workspaceId, historyId: input.historyId,
      startedAt: input.report.startedAt, endedAt, outcome, numberedAt: input.savedAt, lastSavedAt: input.savedAt,
    },
    counter: { nextNumber: ready.nextNumber + 1, updatedAt: input.savedAt },
  };
}

export function registryRef(db: Firestore, workspaceId: string, startedAt: number): DocumentReference {
  return db.collection(BUILD_REPORT_NUMBERS_COLLECTION).doc(buildReportKey(workspaceId, startedAt));
}
export function counterRef(db: Firestore): DocumentReference {
  return db.collection(BUILD_REPORT_COUNTER_COLLECTION).doc(BUILD_REPORT_COUNTER_DOC);
}

/**
 * Read inside a history-write transaction. The counter is read only when the report has no row yet,
 * so a build's progress saves never contend on the counter after its first save.
 */
export async function readRegistryForWrite(tx: Transaction, db: Firestore, workspaceId: string, startedAt: number): Promise<{ existing: unknown; counter: unknown }> {
  const existing = (await tx.get(registryRef(db, workspaceId, startedAt))).data();
  if (existing && validBuildReportNumber((existing as { number?: unknown }).number)) return { existing, counter: undefined };
  return { existing, counter: (await tx.get(counterRef(db))).data() };
}

export function applyRegistryPlan(tx: Transaction, db: Firestore, workspaceId: string, startedAt: number, plan: RegistryWritePlan): void {
  if (plan.entry) tx.set(registryRef(db, workspaceId, startedAt), plan.entry);
  if (plan.counter) tx.set(counterRef(db), plan.counter, { merge: true });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The one-time numbering of reports saved before the registry existed.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const LEASE_MS = 10 * 60_000;
const CHUNK = 200;
const PAGE = 300;
const MAX_INVENTORY_DOCS = 200_000;
const INVENTORY_FIELDS = ['report.startedAt', 'report.endedAt', 'report.ok', 'report.issues', 'inProgress', 'savedAt'];

interface InventoryItem { workspaceId: string; historyId: string; report: Record<string, unknown> & { startedAt: number }; inProgress?: boolean; savedAt: number }

export type NumberingRunStatus = 'ready' | 'numbered' | 'busy' | 'counter_invalid' | 'scan_limit' | 'lease_lost' | 'unavailable';
export interface NumberingRunResult { status: NumberingRunStatus; numbered: number; swept: number }

class LeaseLost extends Error {}
class InventoryTooLarge extends Error {}

/** Every retained report, newest-save-agnostic, with only the fields an outcome needs. */
async function inventory(db: Firestore): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];
  let documents = 0;
  const pages = async (base: Query, each: (doc: FirebaseFirestore.QueryDocumentSnapshot) => void, fields?: string[]) => {
    let query = base;
    for (;;) {
      const page = await (fields ? query.select(...fields) : query).limit(PAGE).get();
      documents += page.size;
      if (documents > MAX_INVENTORY_DOCS) throw new InventoryTooLarge();
      page.docs.forEach(each);
      if (page.size < PAGE) return;
      query = base.startAfter(page.docs[page.docs.length - 1]);
    }
  };
  const parents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  await pages(db.collection(DIAGNOSTICS_COLLECTION).orderBy(FieldPath.documentId()), (d) => { parents.push(d); }, [...INVENTORY_FIELDS, 'historyAvailable']);
  for (const parent of parents) {
    const seen = new Set<string>();
    await pages(parent.ref.collection('history').orderBy(FieldPath.documentId()), (d) => {
      const data = d.data();
      const report = data.report as InventoryItem['report'] | undefined;
      if (!report || !validTime(report.startedAt) || d.id !== String(report.startedAt)) return;
      seen.add(d.id);
      items.push({ workspaceId: parent.id, historyId: d.id, report, inProgress: data.inProgress === true ? true : undefined, savedAt: validTime(data.savedAt) ? data.savedAt : report.startedAt });
    }, INVENTORY_FIELDS);
    const latest = parent.data().report as InventoryItem['report'] | undefined;
    // A report saved before per-build history existed lives only on the parent document.
    if (latest && validTime(latest.startedAt) && !seen.has(String(latest.startedAt))) {
      const savedAt = parent.data().savedAt;
      items.push({ workspaceId: parent.id, historyId: 'latest', report: latest, savedAt: validTime(savedAt) ? savedAt : latest.startedAt });
    }
  }
  return items;
}

async function registryInventory(db: Firestore): Promise<{ keys: Set<string>; max: number }> {
  const keys = new Set<string>();
  let max = 0;
  const base = db.collection(BUILD_REPORT_NUMBERS_COLLECTION).orderBy(FieldPath.documentId());
  let query: Query = base;
  for (;;) {
    const page = await query.select('number').limit(PAGE).get();
    for (const d of page.docs) {
      keys.add(d.id);
      const n = d.data().number;
      if (validBuildReportNumber(n) && n > max) max = n;
    }
    if (page.size < PAGE) break;
    query = base.startAfter(page.docs[page.docs.length - 1]);
  }
  return { keys, max };
}

/** Oldest first; equal start times break on identity so a re-run orders them identically. PURE. */
export function backfillOrder<T extends { workspaceId: string; report: { startedAt: number } }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.report.startedAt - b.report.startedAt ||
    (a.workspaceId < b.workspaceId ? -1 : a.workspaceId > b.workspaceId ? 1 : 0));
}

function rowFor(item: InventoryItem, number: number, now: number): BuildReportRegistryRow {
  const outcome = buildReportOutcome(item.report, item.inProgress);
  const endedAt = outcome === 'unfinished' || typeof item.report.endedAt !== 'number' ? null : item.report.endedAt as number;
  return { number, workspaceId: item.workspaceId, historyId: item.historyId, startedAt: item.report.startedAt, endedAt, outcome, numberedAt: now, lastSavedAt: item.savedAt };
}

/**
 * Number every report that has no row yet, then keep the counter ready for live writes. Idempotent:
 * once the counter is ready and the post-backfill sweep has run, a call is one document read.
 *
 * Exactly one runner holds the lease. A runner that dies mid-way leaves a numbered PREFIX of the
 * oldest-first order; the next runner continues after the highest number, so chronology still holds.
 */
export async function runBuildReportNumbering(db: Firestore, owner: string, now: () => number = Date.now): Promise<NumberingRunResult> {
  const counter = counterRef(db);
  const mode = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counter);
    const c = snap.data() as BuildReportCounter | undefined;
    const t = now();
    if (!snap.exists) {
      tx.set(counter, { state: 'backfilling', nextNumber: 1, leaseOwner: owner, leaseUntil: t + LEASE_MS, updatedAt: t });
      return 'backfill' as const;
    }
    if (c?.state === 'ready') {
      if (!validBuildReportNumber(c.nextNumber)) return 'counter_invalid' as const;
      return validTime(c.sweptAt) ? 'done' as const : 'sweep' as const;
    }
    if (c?.state !== 'backfilling' || !validBuildReportNumber(c.nextNumber)) return 'counter_invalid' as const;
    if (validTime(c.leaseUntil) && c.leaseUntil > t && c.leaseOwner !== owner) return 'busy' as const;
    tx.set(counter, { leaseOwner: owner, leaseUntil: t + LEASE_MS, updatedAt: t }, { merge: true });
    return 'backfill' as const;
  });
  if (mode === 'done') return { status: 'ready', numbered: 0, swept: 0 };
  if (mode === 'busy' || mode === 'counter_invalid') return { status: mode, numbered: 0, swept: 0 };

  let numbered = 0;
  try {
    if (mode === 'backfill') {
      const [items, registry] = await Promise.all([inventory(db), registryInventory(db)]);
      const missing = backfillOrder(items.filter((i) => !registry.keys.has(buildReportKey(i.workspaceId, i.report.startedAt))));
      for (let offset = 0; offset < missing.length; offset += CHUNK) {
        const chunk = missing.slice(offset, offset + CHUNK);
        // The highest number is recorded only after the commit: a retried attempt must not see a
        // number that a failed attempt computed but never wrote.
        const highest = await db.runTransaction(async (tx) => {
          const c = (await tx.get(counter)).data() as BuildReportCounter | undefined;
          if (c?.state !== 'backfilling' || c.leaseOwner !== owner || !validBuildReportNumber(c.nextNumber)) throw new LeaseLost();
          const base = Math.max(c.nextNumber, registry.max + 1);
          const t = now();
          chunk.forEach((item, i) => tx.set(registryRef(db, item.workspaceId, item.report.startedAt), rowFor(item, base + i, t)));
          tx.set(counter, { nextNumber: base + chunk.length, leaseUntil: t + LEASE_MS, updatedAt: t }, { merge: true });
          return base + chunk.length - 1;
        });
        registry.max = highest;
        numbered += chunk.length;
      }
      await db.runTransaction(async (tx) => {
        const c = (await tx.get(counter)).data() as BuildReportCounter | undefined;
        if (c?.state !== 'backfilling' || c.leaseOwner !== owner) throw new LeaseLost();
        const t = now();
        tx.set(counter, { state: 'ready', nextNumber: Math.max(c.nextNumber, registry.max + 1), readyAt: t, updatedAt: t, leaseOwner: null, leaseUntil: null }, { merge: true });
      });
    }
    // Reports saved while the backfill ran were left unnumbered on purpose (no number may jump ahead
    // of an older report). The counter is ready now, so every later write numbers itself; this pass
    // gives the ones in that window theirs, through the same transactional allocation.
    const swept = await sweepUnnumbered(db, now);
    await db.runTransaction(async (tx) => {
      const c = (await tx.get(counter)).data() as BuildReportCounter | undefined;
      if (c?.state === 'ready') tx.set(counter, { sweptAt: now() }, { merge: true });
    });
    return { status: numbered > 0 || swept > 0 ? 'numbered' : 'ready', numbered, swept };
  } catch (err) {
    if (err instanceof LeaseLost) return { status: 'lease_lost', numbered, swept: 0 };
    if (err instanceof InventoryTooLarge) return { status: 'scan_limit', numbered, swept: 0 };
    throw err;
  }
}

async function sweepUnnumbered(db: Firestore, now: () => number): Promise<number> {
  const [items, registry] = await Promise.all([inventory(db), registryInventory(db)]);
  let swept = 0;
  for (const item of backfillOrder(items.filter((i) => !registry.keys.has(buildReportKey(i.workspaceId, i.report.startedAt))))) {
    const wrote = await db.runTransaction(async (tx) => {
      const { existing, counter } = await readRegistryForWrite(tx, db, item.workspaceId, item.report.startedAt);
      if (existing) return false;
      const plan = planRegistryWrite(undefined, counter, { workspaceId: item.workspaceId, historyId: item.historyId, report: item.report, inProgress: item.inProgress, savedAt: now() });
      if (!plan.entry) return false;
      plan.entry.lastSavedAt = item.savedAt;
      applyRegistryPlan(tx, db, item.workspaceId, item.report.startedAt, plan);
      return true;
    });
    if (wrote) swept++;
  }
  return swept;
}
