// THE SPREADSHEET TURN: ask the engine for the rows, keep them, hand back a reply and a file reference.
// Why a spreadsheet request is answered this way at all: `spreadsheetRequest.ts`. What happens to the
// rows: `lib/spreadsheetFile.ts` (clamped, then written as .xlsx / .csv at download time).
//
// Everything with I/O is injected, so every outcome — made, unreadable, no answer, signed out, not
// saved — is testable without a model or a database, and each one says something TRUE to the user:
// a reply never promises a file the chat line does not carry.

import {
  parseWorkbookSpec, safeFileBase, sheetMeta,
  MAX_ROWS_PER_SHEET, MAX_SHEETS, type SheetFileMeta, type SheetSpec,
} from '../lib/spreadsheetFile';
import type { SheetFileRef } from './types';

/** What the chat line carries: enough to show the file and ask for it, with no row data. */
export type { SheetFileRef };

/** The rows a model is ASKED for. Lower than the parser's cap, so a full answer fits the output limit. */
export const ASKED_ROWS_MAX = 100;
export const DEFAULT_ROWS = 20;

/** Added to the chat model's instructions for this turn. Written for the MODEL, in English. */
export const SPREADSHEET_FILE_INSTRUCTIONS = [
  'THIS MESSAGE ASKS FOR A SPREADSHEET FILE (Excel / CSV), NOT AN APP. NavBharatAI turns your answer into a',
  'real .xlsx file and a .csv file, with a Download button under your reply — so you CAN make the file.',
  'Never say you cannot create files, never tell the user to copy a table into Excel themselves.',
  '',
  'Answer with ONE JSON object and nothing else — no code fence, no words before or after it:',
  '{"message": "...", "title": "...", "sheets": [{"name": "...", "columns": ["...", "..."], "rows": [[...], [...]]}]}',
  '',
  'Rules:',
  '- "message" comes FIRST: one to three short sentences to the user, following the LANGUAGE rule (their own',
  '  language), saying what the file contains. Do not paste the data into the message, and do not mention JSON.',
  '- "title": a short English file title (letters, digits and spaces), e.g. "Student Marks Class 10".',
  `- "sheets": 1 to ${MAX_SHEETS} sheets. "columns" are the header names. Every row is an array in the same order as`,
  '  "columns". Numbers are JSON numbers (no currency symbol, no thousands separator — put the unit in the',
  '  header, e.g. "Price (₹)"). Dates are "YYYY-MM-DD" strings. An empty cell is null.',
  `- Rows: exactly as many as the user asked for, at most ${ASKED_ROWS_MAX} per sheet. If they named no number, make`,
  `  ${DEFAULT_ROWS}. If they asked for more than ${ASKED_ROWS_MAX}, make ${ASKED_ROWS_MAX} and say so in "message".`,
  '- Realistic, varied, internally consistent sample data — Indian names, cities and ₹ when the request fits.',
  '  Never a real person\'s private data: emails use example.com, phone numbers and ids are obviously fictional.',
  '- If the user pasted a table or attached a file, use exactly that data (cleaned up), not invented rows.',
].join('\n');

export type SpreadsheetTurnOutcome = 'made' | 'unreadable' | 'no-answer' | 'signed-out' | 'save-failed';

export interface SpreadsheetTurnDeps {
  /** The model's raw answer, or null when no answer came back (timeout, every provider failed). */
  ask: () => Promise<string | null>;
  /** The VERIFIED account. A file is owned by an account, so a signed-out turn makes no file. */
  uid: string | null;
  workspaceId: string;
  save: (rec: {
    id: string; uid: string; workspaceId: string; title: string; fileBase: string;
    sheets: SheetSpec[]; meta: SheetFileMeta[]; createdAt: number;
  }) => Promise<void>;
  newId: () => string;
  now?: () => number;
}

export interface SpreadsheetTurnResult {
  reply: string;
  file: SheetFileRef | null;
  outcome: SpreadsheetTurnOutcome;
}

/** "120 rows × 6 columns", "2 sheets". English, for the deterministic lines. */
export function describeSheets(meta: SheetFileMeta[]): string {
  if (meta.length === 1) return `${meta[0].rows} rows × ${meta[0].columns} columns`;
  const rows = meta.reduce((n, s) => n + s.rows, 0);
  return `${meta.length} sheets, ${rows} rows in all`;
}

export const SPREADSHEET_SIGN_IN_REPLY =
  'I can make this as a real Excel file for you to download — please sign in to NavBharatAI first, then send the same message again.';

export const SPREADSHEET_RETRY_REPLY =
  "I couldn't prepare the file this time. Please send the same message again — nothing was charged.";

export async function runSpreadsheetTurn(deps: SpreadsheetTurnDeps): Promise<SpreadsheetTurnResult> {
  // No account, no file: a download is tied to the account that asked. Not one model call is spent.
  if (!deps.uid) return { reply: SPREADSHEET_SIGN_IN_REPLY, file: null, outcome: 'signed-out' };

  let raw: string | null = null;
  try { raw = await deps.ask(); } catch { raw = null; }
  if (!raw || !raw.trim()) return { reply: SPREADSHEET_RETRY_REPLY, file: null, outcome: 'no-answer' };

  const spec = parseWorkbookSpec(raw);
  if (!spec || spec.sheets.every((s) => s.rows.length === 0)) {
    return { reply: SPREADSHEET_RETRY_REPLY, file: null, outcome: 'unreadable' };
  }

  const id = deps.newId();
  const fileBase = safeFileBase(spec.title);
  const meta = sheetMeta(spec);
  try {
    await deps.save({
      id, uid: deps.uid, workspaceId: deps.workspaceId, title: spec.title, fileBase,
      sheets: spec.sheets, meta, createdAt: (deps.now ?? Date.now)(),
    });
  } catch {
    return { reply: SPREADSHEET_RETRY_REPLY, file: null, outcome: 'save-failed' };
  }

  // The model's own words lead (in the user's language); the last line states what the FILE really
  // holds, from the clamped data — so a message that promised 500 rows cannot stand uncorrected.
  const lead = spec.message || `Your file "${spec.title}" is ready.`;
  const fact = `📎 ${fileBase}.xlsx — ${describeSheets(meta)}${meta.some((m) => m.rows >= MAX_ROWS_PER_SHEET) ? ` (the most one file holds here is ${MAX_ROWS_PER_SHEET} rows per sheet)` : ''}. Tap Download below.`;
  return {
    reply: `${lead}\n\n${fact}`,
    file: { id, title: spec.title, fileBase, sheets: meta },
    outcome: 'made',
  };
}
