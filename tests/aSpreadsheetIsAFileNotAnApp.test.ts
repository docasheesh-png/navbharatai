// A SPREADSHEET IS A FILE, NOT AN APP (admin 2026-10-01: "A karo!!").
//
// A user asked NavBharatAI Pro for a sample Excel file and got a React dashboard that showed a table —
// and still no .xlsx. These tests lock the whole path: which requests are FILE requests (and, just as
// much, which are not), how the engine's rows are read and clamped, the CSV formula-injection guard,
// a real .xlsx read back with exceljs, every outcome of the turn, the signed download routes, the
// wiring in the chat lane, and the Download button surviving a reopened chat.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

const state = { uid: null as string | null };
vi.mock('../src/server/lib/authMiddleware', () => ({
  verifyFirebaseToken: async () => state.uid,
}));

import { isSpreadsheetFileRequest, shouldAnswerSpreadsheetRequest } from '../src/server/AgentV3/spreadsheetRequest';
import {
  parseWorkbookSpec, csvCell, sheetToCsv, workbookToXlsx, safeFileBase, safeSheetName, extractJsonObject,
  MAX_ROWS_PER_SHEET, MAX_COLUMNS, MAX_SHEETS, MAX_CELL_CHARS, CSV_UTF8_BOM,
} from '../src/server/lib/spreadsheetFile';
import { runSpreadsheetTurn, SPREADSHEET_SIGN_IN_REPLY, SPREADSHEET_RETRY_REPLY, SPREADSHEET_FILE_INSTRUCTIONS } from '../src/server/AgentV3/spreadsheetTurn';
import { saveSpreadsheetFile, _resetSpreadsheetFileMemory, newSpreadsheetFileId } from '../src/server/lib/spreadsheetFileStore';
import { registerSpreadsheetFileRoutes, sheetTicketSubject } from '../src/server/routes/spreadsheetFiles';
import { toCsv } from '../src/server/routes/export';
import { conversationToEvents, restoredSheetFile } from '../src/components/agentv3/agentV3History';
import { agentV3Reducer } from '../src/components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';
import { sheetFileButtons, sheetFileSummary } from '../src/components/agentv3/sheetFileButtons';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

// ── 1. Which messages are FILE requests ─────────────────────────────────────────────────────────────
describe('a spreadsheet FILE request is recognised — and nothing that is software', () => {
  const FILE_REQUESTS = [
    'Make a sample Excel file',
    'make me a sample excel file of 50 students with marks',
    'create an excel sheet of 20 employees with salary',
    'ek csv bana do jisme 30 products ho',
    'students ka data excel me do',
    'generate dummy data in csv format',
    'Give me an xlsx of monthly expenses for 2025',
    'sample data excel',
    'mujhe ek excel file chahiye jisme kirana items aur price ho',
    'Prepare a spreadsheet of Indian states and their capitals',
    'convert this table to excel: name, age / Ravi, 23 / Asha, 31',
    'एक्सेल फाइल बना दो 10 छात्रों की',
  ];
  const NOT_FILE_REQUESTS = [
    'build an app with excel export',
    'make a todo app with csv export',
    'add an export to csv button',
    'excel jaisa app banao',
    'make a spreadsheet app like google sheets',
    'inventory management system with excel import',
    'excel me vlookup kaise lagaye',
    'how to make an excel sheet',
    'excel formula batao for percentage',
    'is csv ko analyse karo',
    'my excel file is corrupted, fix it',
    'write a python script to create an excel file',
    'make a website that reads csv files',
    'excel to pdf converter banao',
    'convert this excel to pdf',
    'excel ko word me convert karo',
    'what is the difference between csv and xlsx',
    'build a dashboard from this excel',
    'hello',
    'Make a todo app',
    'Create full image',
  ];
  it.each(FILE_REQUESTS)('FILE: %s', (p) => expect(isSpreadsheetFileRequest(p)).toBe(true));
  it.each(NOT_FILE_REQUESTS)('NOT a file: %s', (p) => expect(isSpreadsheetFileRequest(p)).toBe(false));

  it('has a kill switch, and an import is never a file request', () => {
    const prompt = 'Make a sample Excel file';
    expect(shouldAnswerSpreadsheetRequest({ prompt, importing: false, env: {} })).toBe(true);
    expect(shouldAnswerSpreadsheetRequest({ prompt, importing: false, env: { AGENTV3_SPREADSHEET_FILE: 'off' } })).toBe(false);
    expect(shouldAnswerSpreadsheetRequest({ prompt, importing: true, env: {} })).toBe(false);
  });
});

// ── 2. Reading and clamping the engine's answer ─────────────────────────────────────────────────────
describe('the engine answer is read defensively and clamped', () => {
  const good = JSON.stringify({
    message: 'Yeh rahi aapki file.',
    title: 'Student Marks',
    sheets: [{ name: 'Marks', columns: ['Name', 'Marks', 'PIN'], rows: [['Ravi', 91, '012345'], ['Asha', '88', '110001']] }],
  });

  it('reads a bare object, a fenced one and one wrapped in prose', () => {
    for (const text of [good, '```json\n' + good + '\n```', `Sure! Here it is:\n${good}\nHope it helps.`]) {
      const spec = parseWorkbookSpec(text);
      expect(spec?.title).toBe('Student Marks');
      expect(spec?.sheets[0].rows).toHaveLength(2);
    }
  });

  it('stores numbers as numbers, but keeps a leading-zero code as text', () => {
    const spec = parseWorkbookSpec(good)!;
    expect(spec.sheets[0].rows[1][1]).toBe(88);
    expect(spec.sheets[0].rows[0][2]).toBe('012345');
    expect(spec.sheets[0].rows[1][2]).toBe(110001);
  });

  it('salvages an answer cut off by the output limit, keeping the complete rows', () => {
    const cut = good.slice(0, good.indexOf('["Asha"') + 9); // ends inside the second row
    const spec = parseWorkbookSpec(cut);
    expect(spec).not.toBeNull();
    expect(spec!.sheets[0].rows).toEqual([['Ravi', 91, '012345']]);
    expect(spec!.message).toBe('Yeh rahi aapki file.');
  });

  it('clamps sheets, columns, rows and cell length', () => {
    const big = {
      title: 'Big',
      sheets: Array.from({ length: 8 }, (_, s) => ({
        name: 'Same',
        columns: Array.from({ length: 45 }, (_, c) => `C${c}`),
        rows: Array.from({ length: 260 }, (_, r) => Array.from({ length: 45 }, () => (r === 0 ? 'x'.repeat(2000) : s))),
      })),
    };
    const spec = parseWorkbookSpec(JSON.stringify(big))!;
    expect(spec.sheets.length).toBeLessThanOrEqual(MAX_SHEETS);
    for (const sh of spec.sheets) {
      expect(sh.columns.length).toBeLessThanOrEqual(MAX_COLUMNS);
      expect(sh.rows.length).toBeLessThanOrEqual(MAX_ROWS_PER_SHEET);
    }
    expect(String(spec.sheets[0].rows[0][0]).length).toBe(MAX_CELL_CHARS);
    // Duplicate sheet names would make Excel refuse the file.
    expect(new Set(spec.sheets.map((s) => s.name.toLowerCase())).size).toBe(spec.sheets.length);
    const cells = spec.sheets.reduce((n, s) => n + s.rows.length * s.columns.length, 0);
    expect(cells).toBeLessThanOrEqual(20_000);
  });

  it('accepts rows written as objects keyed by column', () => {
    const spec = parseWorkbookSpec(JSON.stringify({ title: 't', sheets: [{ name: 'S', columns: ['A', 'B'], rows: [{ A: 1, B: 'two' }] }] }))!;
    expect(spec.sheets[0].rows).toEqual([[1, 'two']]);
  });

  it('returns null when there is nothing usable', () => {
    expect(parseWorkbookSpec('I cannot create files, sorry.')).toBeNull();
    expect(parseWorkbookSpec('{"message":"hi","sheets":[]}')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });

  it('makes safe file and sheet names', () => {
    expect(safeFileBase('Student Marks: Class 10/A')).toBe('Student-Marks-Class-10-A');
    expect(safeFileBase('छात्र')).toBe('navbharatai-sheet');
    expect(safeSheetName('a/b*c?d:e[f]g\\h with a very long name indeed', 'S')).toHaveLength(31);
  });
});

// ── 3. CSV, and the formula-injection guard ─────────────────────────────────────────────────────────
describe('CSV is quoted and never runs a formula', () => {
  it('neutralises text a spreadsheet would execute, and leaves real numbers alone', () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe('"\'=HYPERLINK(""http://x"",""click"")"');
    expect(csvCell('+91 98765')).toBe("'+91 98765");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
  });

  it('the account-data export uses the same guard (the sibling that had none)', () => {
    expect(toCsv([{ prompt: '=1+1' }])).toBe("prompt\r\n'=1+1");
    expect(read('src/server/routes/export.ts')).toContain('CSV_UTF8_BOM + toCsv(rows)');
  });

  it('writes one sheet with its header', () => {
    expect(sheetToCsv({ columns: ['Name', 'Price (₹)'], rows: [['Chai', 10], ['Samosa', null]] }))
      .toBe('Name,Price (₹)\r\nChai,10\r\nSamosa,');
    expect(CSV_UTF8_BOM).toBe('﻿');
  });
});

// ── 4. A real .xlsx ─────────────────────────────────────────────────────────────────────────────────
describe('the .xlsx is a real workbook', () => {
  it('reads back with exceljs: every sheet, a frozen bold header, numbers as numbers', async () => {
    const buf = await workbookToXlsx({
      title: 'Shop',
      sheets: [
        { name: 'Items', columns: ['Item', 'Price'], rows: [['Chai', 10], ['=evil()', 20]] },
        { name: 'Staff', columns: ['Name'], rows: [['Ravi']] },
      ],
    });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Items', 'Staff']);
    const ws = wb.getWorksheet('Items')!;
    expect(ws.getCell('A1').value).toBe('Item');
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.getCell('B2').value).toBe(10);
    // A text cell that looks like a formula is stored as TEXT, never as a formula.
    expect(ws.getCell('A3').value).toBe('=evil()');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
});

// ── 5. The turn ─────────────────────────────────────────────────────────────────────────────────────
describe('every outcome of the turn says something true', () => {
  const answer = JSON.stringify({
    message: 'Here is your file with 3 students.',
    title: 'Students',
    sheets: [{ name: 'Students', columns: ['Name', 'Age'], rows: [['A', 10], ['B', 11], ['C', 12]] }],
  });
  const base = { workspaceId: 'ws', newId: () => 'a'.repeat(24), now: () => 5 };

  it('signed out: no model call, and the reply says to sign in', async () => {
    const ask = vi.fn(async () => answer);
    const r = await runSpreadsheetTurn({ ...base, uid: null, ask, save: async () => {} });
    expect(ask).not.toHaveBeenCalled();
    expect(r).toMatchObject({ outcome: 'signed-out', file: null, reply: SPREADSHEET_SIGN_IN_REPLY });
  });

  it('no answer, an unreadable answer or a failed save: no button, an honest retry line', async () => {
    const save = async () => {};
    expect((await runSpreadsheetTurn({ ...base, uid: 'u', ask: async () => null, save })).outcome).toBe('no-answer');
    expect((await runSpreadsheetTurn({ ...base, uid: 'u', ask: async () => { throw new Error('x'); }, save })).outcome).toBe('no-answer');
    const bad = await runSpreadsheetTurn({ ...base, uid: 'u', ask: async () => 'I cannot make files', save });
    expect(bad).toMatchObject({ outcome: 'unreadable', file: null, reply: SPREADSHEET_RETRY_REPLY });
    const failed = await runSpreadsheetTurn({ ...base, uid: 'u', ask: async () => answer, save: async () => { throw new Error('db'); } });
    expect(failed).toMatchObject({ outcome: 'save-failed', file: null });
  });

  it('made: saves the clamped rows under the account, and the line carries the shape, never the rows', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const r = await runSpreadsheetTurn({ ...base, uid: 'u1', ask: async () => answer, save: async (rec) => { saved.push(rec); } });
    expect(r.outcome).toBe('made');
    expect(saved[0]).toMatchObject({ id: 'a'.repeat(24), uid: 'u1', workspaceId: 'ws', fileBase: 'Students', createdAt: 5 });
    expect(r.file).toEqual({ id: 'a'.repeat(24), title: 'Students', fileBase: 'Students', sheets: [{ name: 'Students', rows: 3, columns: 2 }] });
    expect(JSON.stringify(r.file)).not.toContain('"A"');
    expect(r.reply).toContain('Here is your file with 3 students.');
    expect(r.reply).toContain('Students.xlsx — 3 rows × 2 columns');
  });

  it('the instructions forbid "I cannot create files" and ask for the message in the user\'s language', () => {
    expect(SPREADSHEET_FILE_INSTRUCTIONS).toMatch(/Never say you cannot create files/);
    expect(SPREADSHEET_FILE_INSTRUCTIONS).toMatch(/LANGUAGE rule/);
  });
});

// ── 6. The signed download routes ───────────────────────────────────────────────────────────────────
describe('a file downloads only for the account that asked for it', () => {
  const routes = captureRoutes(registerSpreadsheetFileRoutes);
  const ticket = routes.get('POST /api/agentv3/sheet-files/:id/ticket')!;
  const download = routes.get('GET /api/agentv3/sheet-files/:id/download/:format')!;
  const id = newSpreadsheetFileId();

  beforeEach(async () => {
    _resetSpreadsheetFileMemory();
    state.uid = null;
    await saveSpreadsheetFile({
      id, uid: 'owner', workspaceId: 'ws', title: 'Shop', fileBase: 'Shop',
      sheets: [
        { name: 'Items', columns: ['Item', 'Price'], rows: [['Chai', 10]] },
        { name: 'Staff', columns: ['Name'], rows: [['=cmd']] },
      ],
      meta: [], createdAt: 1,
    });
  });

  const mint = async (body: Record<string, unknown>) => {
    const res = mockRes();
    await ticket(mockReq({ params: { id }, body }), res);
    return res;
  };
  const fetchPath = async (path: string) => {
    const url = new URL(path, 'https://x');
    const [, , , , fileId, , format] = url.pathname.split('/');
    const res = mockRes();
    await download(mockReq({ params: { id: fileId, format }, query: Object.fromEntries(url.searchParams) }), res);
    return res;
  };

  it('refuses a signed-out caller and another account (the same 404 as a missing file)', async () => {
    expect((await mint({ format: 'xlsx' })).statusCode).toBe(401);
    state.uid = 'stranger';
    expect((await mint({ format: 'xlsx' })).statusCode).toBe(404);
  });

  it('the owner gets a link that downloads a real .xlsx', async () => {
    state.uid = 'owner';
    const t = await mint({ format: 'xlsx' });
    expect(t.statusCode).toBe(200);
    const res = await fetchPath(t.body.path);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Shop.xlsx"');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.sent as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Items', 'Staff']);
  });

  it('a CSV is one sheet, UTF-8 with a BOM, and guarded', async () => {
    state.uid = 'owner';
    const t = await mint({ format: 'csv', sheet: 1 });
    const res = await fetchPath(t.body.path);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Shop-Staff.csv"');
    expect(res.sent).toBe("﻿Name\r\n'=cmd");
  });

  it('a link signed for one sheet or format cannot fetch another, and a missing ticket asks to sign in', async () => {
    state.uid = 'owner';
    const t = await mint({ format: 'csv', sheet: 0 });
    const tampered = (t.body.path as string).replace('s=0', 's=1');
    expect((await fetchPath(tampered)).statusCode).toBe(403);
    const asXlsx = (t.body.path as string).replace('/download/csv', '/download/xlsx');
    expect((await fetchPath(asXlsx)).statusCode).toBe(403);
    expect((await fetchPath(`/api/agentv3/sheet-files/${id}/download/xlsx`)).statusCode).toBe(401);
    expect((await mint({ format: 'csv', sheet: 7 })).statusCode).toBe(400);
    expect(sheetTicketSubject(id, 'csv', 1)).not.toBe(sheetTicketSubject(id, 'csv', 0));
  });
});

// ── 7. Wiring ───────────────────────────────────────────────────────────────────────────────────────
describe('the chat lane makes the file, and the button survives', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('decides before the picture rule, turns the build into a chat turn, and never falls through to a build', () => {
    const decide = route.indexOf('const answerSpreadsheet =');
    const picture = route.indexOf('const answerPictureRequest =');
    expect(decide).toBeGreaterThan(0);
    expect(decide).toBeLessThan(picture);
    expect(route.slice(picture, picture + 200)).toContain('!answerSpreadsheet');
    expect(route).toMatch(/if \(answerSpreadsheet\) \{[\s\S]{0,200}intent = 'chat';/);
    expect(route).toContain('!answerSpreadsheet && !clarifyWhatToBuild && chatCacheEnabled()');
    expect(route).toContain('} else if (answerSpreadsheet) {');
  });

  it('the narration line and the persisted turn both carry the file', () => {
    expect(route).toContain("text: reply, ts: Date.now(), ...(sheetFile ? { file: sheetFile } : {}) });");
    expect(route).toContain("{ role: 'assistant', content: reply, ...(sheetFile ? { file: sheetFile } : {}) },");
    expect(read('server.ts')).toContain('registerSpreadsheetFileRoutes(app);');
  });

  it('a reopened chat replays the file, and a malformed stored file costs the button, never the reply', () => {
    const file = { id: 'b'.repeat(24), title: 'T', fileBase: 'T', sheets: [{ name: 'S', rows: 2, columns: 3 }] };
    const events = conversationToEvents({
      id: 'c', status: 'complete',
      messages: [{ role: 'user', content: 'make excel' }, { role: 'assistant', content: 'Here it is', file }],
    } as never);
    expect(events.find((e) => e.type === 'narration')).toMatchObject({ text: 'Here it is', file });
    expect(restoredSheetFile({ ...file, id: '../etc' })).toBeUndefined();
    expect(restoredSheetFile({ ...file, sheets: [] })).toBeUndefined();
    expect(restoredSheetFile(null)).toBeUndefined();
  });

  it('the reducer keeps the file on the line', () => {
    const file = { id: 'c'.repeat(24), title: 'T', fileBase: 'T', sheets: [{ name: 'S', rows: 1, columns: 1 }] };
    const s = agentV3Reducer(initialAgentV3State(), { type: 'narration', agent: 'architect', text: 'x', ts: 1, file });
    expect(s.narration[0].file).toEqual(file);
  });

  it('the card offers one .xlsx and a .csv per sheet, and the panel renders it', () => {
    const one = { id: 'd'.repeat(24), title: 'T', fileBase: 'T', sheets: [{ name: 'S', rows: 1, columns: 2 }] };
    expect(sheetFileButtons(one).map((b) => b.label)).toEqual(['Excel (.xlsx)', 'CSV']);
    const two = { ...one, sheets: [{ name: 'A', rows: 2, columns: 1 }, { name: 'B', rows: 3, columns: 1 }] };
    expect(sheetFileButtons(two).map((b) => [b.format, b.sheet])).toEqual([['xlsx', 0], ['csv', 0], ['csv', 1]]);
    expect(sheetFileSummary(one)).toBe('1 row × 2 columns');
    expect(sheetFileSummary(two)).toBe('2 sheets · 5 rows');
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('{msg.file && !msg.streaming && <SheetFileCard file={msg.file} />}');
    // Every place narration is carried into the thread keeps the file (four mappers).
    expect(panel.match(/\.\.\.\(n\.file \? \{ file: n\.file \} : \{\}\)/g)?.length).toBe(4);
  });
});
