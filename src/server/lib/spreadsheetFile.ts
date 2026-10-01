// A REAL SPREADSHEET FILE, FROM THE ENGINE'S ROWS (admin 2026-10-01: "A karo!!" — see
// `AgentV3/spreadsheetRequest.ts` for why a spreadsheet request is answered with a file, not an app).
//
// The engine writes the DATA as one JSON object; this module is everything after that, and it trusts
// none of it:
//   • `parseWorkbookSpec` reads the model's answer, tolerates a code fence or a sentence around the
//     object, and CLAMPS every dimension (sheets, columns, rows, cell length, total cells, stored size).
//     A model that writes 4,000 rows or a 50 KB cell gets a smaller file, never an unbounded one.
//   • `sheetToCsv` / `csvCell` write RFC 4180 CSV with a guard against FORMULA INJECTION: a text cell
//     that starts with = + - @ (or a tab / CR) is opened by Excel as a formula, so it is prefixed with
//     an apostrophe. The engine's text is untrusted input to whoever opens the file, and the same rule
//     now protects the account-data export (`routes/export.ts`), which had no guard at all.
//   • `workbookToXlsx` writes a real .xlsx with exceljs (the same library and the same reasons as
//     `routes/export.ts`): a bold, frozen, filterable header, column widths that fit, numbers stored
//     as numbers.
//
// PURE except `workbookToXlsx`, which is async only because exceljs writes through a stream.

export type SheetCell = string | number | boolean | null;

export interface SheetSpec {
  name: string;
  columns: string[];
  rows: SheetCell[][];
}

export interface WorkbookSpec {
  /** What the file is, in a few words — becomes the file name. */
  title: string;
  /** The short line to the user, in their language. */
  message: string;
  sheets: SheetSpec[];
}

/** What the chat line needs to show the file, with no row data in it. */
export interface SheetFileMeta {
  name: string;
  rows: number;
  columns: number;
}

export const MAX_SHEETS = 5;
export const MAX_COLUMNS = 30;
export const MAX_ROWS_PER_SHEET = 200;
export const MAX_TOTAL_CELLS = 20_000;
export const MAX_CELL_CHARS = 500;
export const MAX_HEADER_CHARS = 80;
export const MAX_MESSAGE_CHARS = 800;
/** A Firestore document holds 1 MiB; the stored JSON stays well under it. */
export const MAX_STORED_JSON_CHARS = 800_000;

/** Excel refuses a sheet name over 31 characters or containing any of these. */
export function safeSheetName(raw: unknown, fallback: string): string {
  const s = String(raw ?? '').replace(/[*?:\\/[\]]/g, '-').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '');
  return s.slice(0, 31).trim() || fallback;
}

/** A file name a phone, Windows and a Content-Disposition header all accept. Never empty. */
export function safeFileBase(title: unknown): string {
  const ascii = String(title ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  return ascii || 'navbharatai-sheet';
}

/** A plain number written as text ("45000", "-3.5"). Leading zeros (PIN, codes) and long ids stay text. */
const PLAIN_NUMBER = /^-?(?:0|[1-9]\d{0,14})(?:\.\d+)?$/;

function normalizeCell(v: unknown): SheetCell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().slice(0, MAX_CELL_CHARS);
    if (s === '') return null;
    if (PLAIN_NUMBER.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n) && Number.isSafeInteger(Math.trunc(n))) return n;
    }
    return s;
  }
  // An object or an array in a cell is the model getting the shape wrong; keep it readable.
  try { return JSON.stringify(v).slice(0, MAX_CELL_CHARS); } catch { return null; }
}

/**
 * The closers that would balance `text` (a JSON prefix), or null when the prefix ends inside a string
 * or is not a prefix of one object.
 */
function closersFor(text: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null;
    }
  }
  if (inString) return null;
  return stack.reverse().join('');
}

/**
 * A reply cut off by the provider's output ceiling (a long sheet is the likeliest case) is an object
 * missing its tail. Cut it back to the last complete value and close what is open: the rows already
 * written are real, and a file with 87 of them beats no file. Bounded — at most 400 cut points tried.
 */
function salvageTruncated(body: string): unknown {
  let tries = 0;
  for (let i = body.length - 1; i > 0 && tries < 400; i -= 1) {
    const ch = body[i];
    if (ch !== '}' && ch !== ']') continue;
    tries += 1;
    const prefix = body.slice(0, i + 1);
    const closers = closersFor(prefix);
    if (closers === null) continue;
    try { return JSON.parse(prefix + closers); } catch { /* try an earlier cut */ }
  }
  return null;
}

/** The first JSON object in a reply, with or without a ``` fence or words around it. */
export function extractJsonObject(text: string): unknown {
  const raw = String(text ?? '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  if (start < 0) return null;
  const end = body.lastIndexOf('}');
  if (end > start) {
    try { return JSON.parse(body.slice(start, end + 1)); } catch { /* maybe cut off — salvage below */ }
  }
  return salvageTruncated(body.slice(start));
}

/**
 * Read and clamp the engine's answer. Returns null when there is no usable sheet (no object, no
 * columns) — the caller then answers honestly instead of offering an empty file.
 */
export function parseWorkbookSpec(text: string): WorkbookSpec | null {
  const obj = extractJsonObject(text);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const rawSheets = Array.isArray(o.sheets) ? o.sheets
    // A single-sheet answer written without the wrapper is still the right answer.
    : (Array.isArray(o.columns) ? [o] : []);
  const sheets: SheetSpec[] = [];
  const usedNames = new Set<string>();
  let cellsLeft = MAX_TOTAL_CELLS;
  for (const rs of rawSheets.slice(0, MAX_SHEETS)) {
    if (!rs || typeof rs !== 'object') continue;
    const r = rs as Record<string, unknown>;
    const rawCols = Array.isArray(r.columns) ? r.columns.slice(0, MAX_COLUMNS) : [];
    const columns = rawCols.map((c, i) => String(c ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_HEADER_CHARS) || `Column ${i + 1}`);
    if (columns.length === 0) continue;
    let name = safeSheetName(r.name, `Sheet${sheets.length + 1}`);
    for (let n = 2; usedNames.has(name.toLowerCase()); n += 1) name = safeSheetName(`${name.slice(0, 27)} ${n}`, `Sheet${n}`);
    usedNames.add(name.toLowerCase());
    const rows: SheetCell[][] = [];
    const rawRows = Array.isArray(r.rows) ? r.rows : [];
    for (const rr of rawRows) {
      if (rows.length >= MAX_ROWS_PER_SHEET || cellsLeft < columns.length) break;
      // A row written as an object keyed by column name is the model getting the shape half right.
      const values: unknown[] = Array.isArray(rr)
        ? rr
        : (rr && typeof rr === 'object' ? columns.map((c) => (rr as Record<string, unknown>)[c]) : []);
      const row = columns.map((_, i) => normalizeCell(values[i]));
      if (row.every((c) => c === null)) continue;
      rows.push(row);
      cellsLeft -= columns.length;
    }
    sheets.push({ name, columns, rows });
  }
  if (sheets.length === 0) return null;
  // The stored copy must fit one document: halve the largest sheet until it does.
  while (JSON.stringify(sheets).length > MAX_STORED_JSON_CHARS) {
    const biggest = sheets.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
    if (biggest.rows.length <= 1) break;
    biggest.rows = biggest.rows.slice(0, Math.floor(biggest.rows.length / 2));
  }
  const title = String(o.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || sheets[0].name;
  const message = String(o.message ?? '').trim().slice(0, MAX_MESSAGE_CHARS);
  return { title, message, sheets };
}

export function sheetMeta(spec: Pick<WorkbookSpec, 'sheets'>): SheetFileMeta[] {
  return spec.sheets.map((s) => ({ name: s.name, rows: s.rows.length, columns: s.columns.length }));
}

/**
 * One CSV field: RFC 4180 quoting, plus the formula-injection guard on TEXT. Numbers and booleans are
 * written as they are, so a real −5 stays a number; only text that a spreadsheet would execute is
 * neutralised.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s) && !(s.startsWith('-') && PLAIN_NUMBER.test(s))) {
    s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The byte-order mark that makes Excel read a CSV as UTF-8. Without it, ₹ and every Indian script
 * open as mojibake — and a CSV written for an Indian user is exactly where both appear.
 */
export const CSV_UTF8_BOM = '﻿';

export function sheetToCsv(sheet: Pick<SheetSpec, 'columns' | 'rows'>): string {
  const lines = [sheet.columns.map(csvCell).join(',')];
  for (const row of sheet.rows) lines.push(sheet.columns.map((_, i) => csvCell(row[i])).join(','));
  return lines.join('\r\n');
}

export async function workbookToXlsx(spec: Pick<WorkbookSpec, 'title' | 'sheets'>): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NavBharatAI';
  wb.created = new Date();
  wb.title = spec.title;
  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(safeSheetName(sheet.name, 'Sheet1'), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.addRow(sheet.columns);
    for (const row of sheet.rows) ws.addRow(sheet.columns.map((_, i) => row[i] ?? null));
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
    if (sheet.columns.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    }
    sheet.columns.forEach((col, i) => {
      let widest = col.length;
      for (const row of sheet.rows) {
        const v = row[i];
        if (v !== null && v !== undefined) widest = Math.max(widest, String(v).length);
      }
      ws.getColumn(i + 1).width = Math.min(50, Math.max(8, widest + 2));
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
