// P-DATA.7 — Data Export / Report Generation.
//
// Users can import (ZIP/Excel/CSV/JSON) but could not EXPORT their own data. These endpoints export a
// signed-in user's build history and usage/cost as CSV, JSON, or Excel (.xlsx). Identity always comes
// from the verified Firebase token, so a user can only export their OWN data. PDF export is a deliberate
// follow-up — it needs a renderer dependency (pdfkit) not in the project; per "real features only" it is
// NOT stubbed. The CSV serializer is pure + unit-tested.

import type { Express, Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { userBuildHistoryStore } from '../lib/UserBuildHistoryStore';
import { sendSafeError } from '../lib/httpError';
import { userCostStore } from '../lib/UserCostStore';

export type ExportFormat = 'csv' | 'json' | 'xlsx';

/** Parse + validate the `?format=` query, defaulting to csv. */
export function parseFormat(raw: unknown): ExportFormat {
  return raw === 'json' || raw === 'xlsx' ? raw : 'csv';
}

/** Escape one CSV field per RFC 4180: quote when it contains a comma, quote, CR or LF; double inner quotes. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize an array of flat records to CSV. Header row is the UNION of all keys (stable first-seen
 * order) so rows with differing shapes still line up. Returns just the header row for an empty array.
 */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); headers.push(k); }
  }
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvField(row[h])).join(','));
  }
  return lines.join('\r\n');
}

/** Build an .xlsx workbook buffer from flat records under a single sheet. */
export function toXlsxBuffer(rows: ReadonlyArray<Record<string, unknown>>, sheetName = 'Export'): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows as any[]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function sendExport(res: Response, format: ExportFormat, rows: Record<string, unknown>[], baseName: string): void {
  if (format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.json"`);
    res.json(rows);
    return;
  }
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    res.send(toXlsxBuffer(rows, baseName));
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
  res.send(toCsv(rows));
}

export function registerExportRoutes(app: Express): void {
  // GET /api/export/build-history?format=csv|json|xlsx
  app.get('/api/export/build-history', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const records = await userBuildHistoryStore.list(userId, {});
      sendExport(res, parseFormat(req.query.format), records as unknown as Record<string, unknown>[], 'build-history');
    } catch (err: any) {
      sendSafeError(res, 500, 'Export failed. Please try again.', err, 'export build-history');
    }
  });

  // GET /api/export/usage?format=csv|json|xlsx[&month=YYYY-MM]
  app.get('/api/export/usage', async (req: Request, res: Response) => {
    const userId = await verifyFirebaseToken(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const month = typeof req.query.month === 'string' ? req.query.month : undefined;
      const doc = await userCostStore.get(userId, month);
      const rows = doc ? [doc as unknown as Record<string, unknown>] : [];
      sendExport(res, parseFormat(req.query.format), rows, 'usage');
    } catch (err: any) {
      sendSafeError(res, 500, 'Export failed. Please try again.', err, 'export usage');
    }
  });
}
