/**
 * Report numbers for list rows — read from the build report registry, never computed.
 *
 * 🔴 THIS USED TO BE A RANK (until 2026-11-02): every read scanned up to 5,000 documents, sorted the
 * retained reports by start time and handed out positions. A position moves whenever a report
 * expires or a late one arrives, so "#555" today was a different report next week — the defect the
 * admin reported as "numbering stable nahi hai". A number is now a stored fact about one report
 * (`buildReportRegistry.ts`): looked up by the report's identity, the same for every cohort and
 * every screen, and never renumbered. One read per row, no scan, no cache to go stale.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { getServerDb } from './serverDb';
import { counterRef, readyCounter, registryRef, validBuildReportNumber } from './buildReportRegistry';
import type { BuildReportNumbering, ReportNumberFailure } from '../../lib/buildReportNumbering';

export type ReportNumberingCohort = 'latest' | 'failed';
const READ_CONCURRENCY = 50;
const unavailable = (reason: ReportNumberFailure): BuildReportNumbering => ({ ordinal: null, total: null, asOf: null, reason });
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

async function readNumbers(db: Firestore, startedAts: Array<{ workspaceId: string; startedAt: number }>): Promise<Array<number | null>> {
  const out: Array<number | null> = [];
  for (let i = 0; i < startedAts.length; i += READ_CONCURRENCY) {
    const snaps = await Promise.all(startedAts.slice(i, i + READ_CONCURRENCY).map((r) => registryRef(db, r.workspaceId, r.startedAt).get()));
    for (const snap of snaps) {
      const n = snap.data()?.number;
      out.push(validBuildReportNumber(n) ? n : null);
    }
  }
  return out;
}

/** Lazy authenticated-list reads only. A failure never replaces the report list or invents a number. */
export async function numberBuildReports<T extends { workspaceId: string; startedAt?: number }>(
  _cohort: ReportNumberingCohort, rows: T[], _historyId: (row: T) => string,
): Promise<Array<T & { numbering: BuildReportNumbering }>> {
  if (!rows.length) return [];
  const db = getServerDb();
  if (!db) return rows.map(row => ({ ...row, numbering: unavailable('storage_unavailable') }));
  try {
    const timed = rows.filter((row): row is T & { startedAt: number } => validTime(row.startedAt));
    const [counterSnap, numbers] = await Promise.all([counterRef(db).get(), readNumbers(db, timed)]);
    const counter = readyCounter(counterSnap.data());
    const byRow = new Map<T, number | null>(timed.map((row, i) => [row, numbers[i]]));
    const asOf = Date.now();
    return rows.map(row => {
      if (!validTime(row.startedAt)) return { ...row, numbering: unavailable('invalid_timestamp') };
      const n = byRow.get(row) ?? null;
      if (n !== null) {
        // `total` is the highest number ever assigned. A number below it whose report is gone left a
        // gap on purpose: numbers are never reused.
        const highest = counter ? Math.max(counter.nextNumber - 1, n) : n;
        return { ...row, numbering: { ordinal: n, total: highest, asOf } };
      }
      return { ...row, numbering: unavailable(counter ? 'not_numbered' : 'numbering_pending') };
    });
  } catch {
    return rows.map(row => ({ ...row, numbering: unavailable('storage_unavailable') }));
  }
}

export class ReportNumberingInputError extends Error {}
/** Only bounded references enter the metadata route; never reflect a caller's extra fields. */
export async function readBuildReportNumbers(cohort: ReportNumberingCohort, raw: unknown) {
  if (!Array.isArray(raw) || raw.length > (cohort === 'latest' ? 500 : 50)) throw new ReportNumberingInputError();
  const rows = raw.map(row => {
    if (!row || typeof row !== 'object' || typeof row.workspaceId !== 'string' ||
      !/^[A-Za-z0-9._-]{1,400}$/.test(row.workspaceId) || ['.', '..'].includes(row.workspaceId) ||
      typeof row.historyId !== 'string' || !/^(?:latest|\d{1,20})$/.test(row.historyId) ||
      !validTime(row.startedAt) || (cohort === 'latest' && row.historyId !== String(row.startedAt))) throw new ReportNumberingInputError();
    return { workspaceId: row.workspaceId as string, historyId: row.historyId as string, startedAt: row.startedAt as number };
  });
  return numberBuildReports(cohort, rows, row => row.historyId);
}
