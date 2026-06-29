/**
 * P-PME.3 — Technical Debt Tracker.
 *
 * Quality findings (security/architecture/lint issues) were either auto-repaired or silently dropped
 * — no accumulating register. This turns unfixed findings into a deduped, aged, prioritized debt
 * list per project: CRITICAL security first, then by severity, with `firstSeen`/`lastSeen` so chronic
 * debt is visible. Pure merge/prioritize logic is unit-tested; Firestore persistence is best-effort.
 */
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from '../../lib/db';

export type DebtSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DebtCategory = 'security' | 'architecture' | 'lint' | 'runtime' | 'test' | 'other';

export interface DebtItem {
  /** Stable identity for dedup across evaluations. */
  key: string;
  category: DebtCategory;
  severity: DebtSeverity;
  file: string;
  message: string;
  firstSeen: string;
  lastSeen: string;
}

export interface IncomingFinding {
  category: DebtCategory;
  severity: DebtSeverity;
  file?: string;
  message: string;
}

const SEVERITY_RANK: Record<DebtSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Stable dedup key for a finding (category + file + message). */
export function debtKey(f: { category: DebtCategory; file?: string; message: string }): string {
  return `${f.category}::${f.file || '-'}::${f.message.trim().slice(0, 200)}`;
}

/**
 * Merge newly-found findings into the existing debt list: existing items keep their `firstSeen` and
 * get a refreshed `lastSeen`; brand-new findings are appended. Findings NOT seen this round are
 * retained (debt persists until explicitly resolved). Pure.
 */
export function mergeDebt(existing: DebtItem[], incoming: IncomingFinding[], nowIso: string): DebtItem[] {
  const byKey = new Map<string, DebtItem>();
  for (const item of existing) byKey.set(item.key, { ...item });
  for (const f of incoming) {
    const key = debtKey(f);
    const prev = byKey.get(key);
    if (prev) {
      prev.lastSeen = nowIso;
      prev.severity = f.severity; // refresh severity in case it changed
    } else {
      byKey.set(key, {
        key, category: f.category, severity: f.severity,
        file: f.file || '-', message: f.message, firstSeen: nowIso, lastSeen: nowIso,
      });
    }
  }
  return [...byKey.values()];
}

/**
 * Prioritize debt: CRITICAL security first, then by severity (desc), then category, then file.
 * Pure — returns a new sorted array.
 */
export function prioritizeDebt(items: DebtItem[]): DebtItem[] {
  return [...items].sort((a, b) => {
    const aCritSec = a.category === 'security' && a.severity === 'critical' ? 1 : 0;
    const bCritSec = b.category === 'security' && b.severity === 'critical' ? 1 : 0;
    if (aCritSec !== bCritSec) return bCritSec - aCritSec;
    if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });
}

export interface DebtSummary {
  total: number;
  bySeverity: Record<DebtSeverity, number>;
  criticalSecurity: number;
}

/** Count debt by severity + highlight critical-security count. Pure. */
export function summarizeDebt(items: DebtItem[]): DebtSummary {
  const bySeverity: Record<DebtSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let criticalSecurity = 0;
  for (const it of items) {
    bySeverity[it.severity]++;
    if (it.category === 'security' && it.severity === 'critical') criticalSecurity++;
  }
  return { total: items.length, bySeverity, criticalSecurity };
}

// ── Firestore persistence (best-effort) ──

const docRef = (db: any, userId: string, projectId: string) => doc(db, 'techDebt', `${userId}__${projectId}`);

export async function loadDebt(userId: string, projectId: string): Promise<DebtItem[]> {
  const db = getDb() as any;
  if (!db) return [];
  try {
    const snap = await getDoc(docRef(db, userId, projectId));
    const items = snap.exists() ? (snap.data()?.items as DebtItem[] | undefined) : undefined;
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error('[TECH_DEBT] load failed:', err);
    return [];
  }
}

/** Merge incoming findings into the stored debt list, persist, and return the prioritized result. */
export async function recordDebt(userId: string, projectId: string, findings: IncomingFinding[], nowIso: string): Promise<DebtItem[]> {
  const existing = await loadDebt(userId, projectId);
  const merged = mergeDebt(existing, findings, nowIso);
  const db = getDb() as any;
  if (db) {
    try {
      await setDoc(docRef(db, userId, projectId), { items: merged, updatedAt: nowIso }, { merge: true });
    } catch (err) {
      console.error('[TECH_DEBT] save failed:', err);
    }
  }
  return prioritizeDebt(merged);
}
