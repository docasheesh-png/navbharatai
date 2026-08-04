import { describe, it, expect } from 'vitest';
import { extractDocumentText, buildDocumentContext, isVisionAttachment, type RawAttachment } from './attachmentText';

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

describe('isVisionAttachment', () => {
  it('flags images and PDFs (by mime or extension)', () => {
    expect(isVisionAttachment('image/png')).toBe(true);
    expect(isVisionAttachment('application/pdf')).toBe(true);
    expect(isVisionAttachment('application/octet-stream', 'report.pdf')).toBe(true);
  });
  it('does not flag documents/text', () => {
    expect(isVisionAttachment('text/plain', 'a.txt')).toBe(false);
    expect(isVisionAttachment('application/zip', 'a.zip')).toBe(false);
  });
});

describe('extractDocumentText — text formats', () => {
  it('decodes plain text', async () => {
    const out = await extractDocumentText({ name: 'note.txt', type: 'text/plain', base64: b64('hello world') });
    expect(out).toBe('hello world');
  });
  it('decodes csv and json by extension even with octet-stream mime', async () => {
    const csv = await extractDocumentText({ name: 'data.csv', type: 'application/octet-stream', base64: b64('a,b\n1,2') });
    expect(csv).toContain('a,b');
    const json = await extractDocumentText({ name: 'x.json', type: 'application/octet-stream', base64: b64('{"k":1}') });
    expect(json).toContain('"k":1');
  });
  it('decodes source code files', async () => {
    const out = await extractDocumentText({ name: 'main.py', type: '', base64: b64('print("hi")') });
    expect(out).toContain('print');
  });
  it('caps very large documents', async () => {
    const big = 'x'.repeat(50000);
    const out = await extractDocumentText({ name: 'big.txt', type: 'text/plain', base64: b64(big) });
    expect(out!.length).toBeLessThanOrEqual(20000);
  });
});

describe('extractDocumentText — office + archives', () => {
  it('extracts text from a real .xlsx workbook', async () => {
    // Fixture built with exceljs — SheetJS was removed (its last npm release, 0.18.5, carries a
    // prototype-pollution CVE with no registry fix). The assertions are unchanged on purpose: this
    // test exists to prove the migration did not change what a user's workbook extracts to.
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('People');
    for (const row of [['Name', 'Age'], ['Asha', 30], ['Ravi', 25]]) ws.addRow(row as never[]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const out = await extractDocumentText({ name: 'p.xlsx', type: '', base64: buf.toString('base64') });
    expect(out).toContain('Name');
    expect(out).toContain('Asha');
    expect(out).toContain('Sheet: People');
  });

  it('extracts a listing + inner text from a real .zip', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('readme.txt', 'inside the zip');
    zip.file('data.csv', 'x,y\n9,8');
    const buf = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
    const out = await extractDocumentText({ name: 'bundle.zip', type: 'application/zip', base64: buf.toString('base64') });
    expect(out).toContain('ZIP archive');
    expect(out).toContain('readme.txt');
    expect(out).toContain('inside the zip');
    expect(out).toContain('x,y');
  });
});

describe('extractDocumentText — non-documents', () => {
  it('returns null for images/PDFs (handled by the vision path)', async () => {
    expect(await extractDocumentText({ name: 'a.png', type: 'image/png', base64: b64('x') })).toBeNull();
    expect(await extractDocumentText({ name: 'a.pdf', type: 'application/pdf', base64: b64('x') })).toBeNull();
  });
  it('returns null for unknown binary types', async () => {
    expect(await extractDocumentText({ name: 'a.bin', type: 'application/octet-stream', base64: b64('\x00\x01\x02') })).toBeNull();
  });
});

describe('buildDocumentContext', () => {
  it('fences and labels each document, ignoring vision attachments', async () => {
    const atts: RawAttachment[] = [
      { name: 'note.txt', type: 'text/plain', base64: b64('todo list') },
      { name: 'pic.png', type: 'image/png', base64: b64('x') }, // ignored (vision)
    ];
    const block = await buildDocumentContext(atts);
    expect(block).toContain('[Attached file: note.txt]');
    expect(block).toContain('todo list');
    expect(block).not.toContain('pic.png');
  });
  it('returns empty string when there are no document attachments', async () => {
    expect(await buildDocumentContext([{ name: 'a.png', type: 'image/png', base64: b64('x') }])).toBe('');
    expect(await buildDocumentContext([])).toBe('');
  });
});

/**
 * SPREADSHEET EXTRACTION — the user-uploaded-file path that made the SheetJS CVEs real rather than
 * theoretical (CVE-2023-30533, prototype pollution reachable by parsing a crafted workbook; npm's
 * last published SheetJS, 0.18.5, is still vulnerable because the vendor left the registry).
 *
 * These build a REAL .xlsx with exceljs and read it back through the production path, so the
 * migration is proven to still extract the user's data — not merely to compile.
 */
describe('extractDocumentText — spreadsheets (post-SheetJS migration)', () => {
  async function xlsxBase64(sheets: Record<string, unknown[][]>): Promise<string> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    for (const [name, rows] of Object.entries(sheets)) {
      const ws = wb.addWorksheet(name);
      for (const r of rows) ws.addRow(r as never[]);
    }
    return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  }

  it('extracts every sheet as CSV, labelled by sheet name', async () => {
    const base64 = await xlsxBase64({
      Sales: [['item', 'qty'], ['chai', 2]],
      Costs: [['head', 'inr'], ['rent', 15000]],
    });
    const text = await extractDocumentText({ name: 'book.xlsx', type: '', base64 });
    expect(text).toContain('# Sheet: Sales');
    expect(text).toContain('item,qty');
    expect(text).toContain('chai,2');
    expect(text).toContain('# Sheet: Costs');
    expect(text).toContain('rent,15000');
  });

  it('quotes a cell containing a comma instead of splitting it into two columns', async () => {
    const base64 = await xlsxBase64({ S: [['name', 'note'], ['Asheesh', 'Delhi, India']] });
    const text = await extractDocumentText({ name: 'a.xlsx', type: '', base64 });
    expect(text).toContain('"Delhi, India"');
  });

  it('never renders a rich-text cell as [object Object]', async () => {
    // exceljs returns rich objects for formatted cells; String() on those would put
    // "[object Object]" into the text the AI reads about the user's file.
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow([{ richText: [{ text: 'Total ' }, { text: 'due' }] }]);
    const base64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const text = await extractDocumentText({ name: 'rich.xlsx', type: '', base64 });
    expect(text).toContain('Total due');
    expect(text).not.toContain('[object Object]');
  });

  it('is honest about a file it cannot parse — never a fabricated reading', async () => {
    // Legacy .xls (pre-2007 binary) is not supported by exceljs. The honest outcome is nothing
    // extracted, not a partial or invented interpretation of bytes we cannot read.
    const base64 = Buffer.from('this is not a spreadsheet').toString('base64');
    const text = await extractDocumentText({ name: 'old.xls', type: '', base64 });
    expect(text === '' || text === null || /Could not extract/.test(String(text))).toBe(true);
    expect(text).not.toContain('# Sheet:');
  });
});
