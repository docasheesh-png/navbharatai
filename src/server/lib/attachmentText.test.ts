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
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['Name', 'Age'], ['Asha', 30], ['Ravi', 25]]);
    XLSX.utils.book_append_sheet(wb, ws, 'People');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
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
