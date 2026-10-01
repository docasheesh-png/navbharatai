// DOWNLOAD AN ENGINE-MADE SPREADSHEET (admin 2026-10-01, "A karo!!" — see
// `AgentV3/spreadsheetRequest.ts`).
//
// Two routes, the App Mart download's proven shape (`downloadTicket.ts` explains it in full):
//   1. POST …/ticket — an ordinary fetch, so it CAN read the Firebase token. It checks the file belongs
//      to the caller and mints a short-lived HMAC ticket bound to (file, format, sheet, account).
//   2. GET …/download/:format — a NAVIGATION (a browser download, or the system browser on a phone),
//      which can carry no header. The ticket is the proof; the file is written fresh from the stored
//      rows, as .xlsx (every sheet) or .csv (one sheet).
//
// 🔒 Someone else's file id answers exactly like a missing one (404), so ids cannot be probed. The
// ticket's subject names the format AND the sheet, so a ticket for one CSV cannot fetch another.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { routeParam } from '../lib/expressCompat';
import { escapeHtml } from '../../lib/escapeHtml';
import {
  signDownloadTicket, verifyDownloadTicket, downloadTicketQuery, ticketSecret, DOWNLOAD_TICKET_TTL_MS,
  type TicketVerdict,
} from '../lib/downloadTicket';
import { getSpreadsheetFile, isSpreadsheetFileId } from '../lib/spreadsheetFileStore';
import { sheetToCsv, workbookToXlsx, safeFileBase, CSV_UTF8_BOM } from '../lib/spreadsheetFile';

export type SheetDownloadFormat = 'xlsx' | 'csv';

export function parseSheetFormat(raw: unknown): SheetDownloadFormat | null {
  return raw === 'xlsx' || raw === 'csv' ? raw : null;
}

/** The sheet a CSV is written from. An .xlsx always carries every sheet, so its index is 0. */
export function parseSheetIndex(raw: unknown, format: SheetDownloadFormat, sheetCount: number): number | null {
  if (format === 'xlsx') return 0;
  const n = raw === undefined || raw === null || raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n >= sheetCount) return null;
  return n;
}

/** What the ticket signs: the file, the format and the sheet — never just the file. */
export function sheetTicketSubject(id: string, format: SheetDownloadFormat, sheet: number): string {
  return `sheet-file:${id}:${format}:${sheet}`;
}

export function sheetRefusalMessage(verdict: Exclude<TicketVerdict, 'ok'>): string {
  if (verdict === 'expired') return 'That download link has expired. Go back to the chat and press Download again.';
  if (verdict === 'missing') return 'Please sign in to NavBharatAI to download this file.';
  return 'That download link is not valid. Go back to the chat and press Download again.';
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function registerSpreadsheetFileRoutes(app: Express): void {
  app.post('/api/agentv3/sheet-files/:id/ticket', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in to download this file.', needsSignIn: true });
    const id = String(routeParam(req.params.id) || '');
    const format = parseSheetFormat(req.body?.format);
    if (!isSpreadsheetFileId(id) || !format) return res.status(400).json({ error: 'That file request is not valid.' });
    let rec: Awaited<ReturnType<typeof getSpreadsheetFile>> = null;
    try {
      rec = await getSpreadsheetFile(id);
    } catch {
      return res.status(502).json({ error: 'Could not reach your file just now. Please try again.' });
    }
    if (!rec || rec.uid !== uid) return res.status(404).json({ error: 'That file is not available.' });
    const sheet = parseSheetIndex(req.body?.sheet, format, rec.sheets.length);
    if (sheet === null) return res.status(400).json({ error: 'That sheet does not exist in this file.' });
    const exp = Date.now() + DOWNLOAD_TICKET_TTL_MS;
    const sig = signDownloadTicket(sheetTicketSubject(id, format, sheet), uid, exp, ticketSecret());
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      // A PATH: the client resolves it through `resolveApiHref`, which is what makes it reach this
      // server from the bundled phone app, where a relative /api points at the app itself.
      path: `/api/agentv3/sheet-files/${id}/download/${format}?s=${sheet}&${downloadTicketQuery(uid, exp, sig)}`,
      expiresAt: exp,
    });
  });

  app.get('/api/agentv3/sheet-files/:id/download/:format', async (req: Request, res: Response) => {
    // A navigation, so a refusal must read like a page, not a line of JSON.
    const fail = (code: number, message: string) => {
      if (String(req.headers.accept || '').includes('application/json')) {
        return res.status(code).json({ error: message });
      }
      res.status(code).type('html').send(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;'
        + 'font:16px/1.6 system-ui,sans-serif;padding:24px;text-align:center">'
        + `<p style="font-weight:700;margin:0">${escapeHtml(message)}</p>`,
      );
    };
    const id = String(routeParam(req.params.id) || '');
    const format = parseSheetFormat(routeParam(req.params.format));
    if (!isSpreadsheetFileId(id) || !format) return fail(404, 'That file is not available.');
    const query = req.query as Record<string, unknown>;
    const sheetRaw = Number(query.s ?? 0);
    const sheetForTicket = format === 'xlsx' ? 0 : (Number.isInteger(sheetRaw) && sheetRaw >= 0 ? sheetRaw : -1);
    const verdict = verifyDownloadTicket(sheetTicketSubject(id, format, sheetForTicket), query, ticketSecret(), Date.now());
    if (verdict !== 'ok') return fail(verdict === 'missing' ? 401 : 403, sheetRefusalMessage(verdict));

    let rec: Awaited<ReturnType<typeof getSpreadsheetFile>> = null;
    try {
      rec = await getSpreadsheetFile(id);
    } catch {
      return fail(502, 'Could not reach your file just now. Please try again.');
    }
    // The ticket names an account; the file must still belong to it.
    if (!rec || rec.uid !== String(query.u ?? '')) return fail(404, 'That file is not available.');

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (format === 'xlsx') {
      let buf: Buffer;
      try {
        buf = await workbookToXlsx({ title: rec.title, sheets: rec.sheets });
      } catch {
        return fail(500, 'This file could not be written. Please try again.');
      }
      res.setHeader('Content-Type', XLSX_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="${rec.fileBase}.xlsx"`);
      return res.send(buf);
    }
    const sheet = rec.sheets[sheetForTicket];
    if (!sheet) return fail(404, 'That sheet does not exist in this file.');
    const name = rec.sheets.length > 1 ? `${rec.fileBase}-${safeFileBase(sheet.name)}` : rec.fileBase;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(CSV_UTF8_BOM + sheetToCsv(sheet));
  });
}
