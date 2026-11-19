// 🔴 AN ATTACHED TEXT FILE IS IN THE PROJECT, WHOLE (failedbr #2415, d57e9bde, 2026-11-17).
//
// `naveen_hub.html` reached the builder only as a prompt excerpt cut at 20,000 characters. The builder said "The
// attached HTML is trimmed in my view" and spent seven minutes and the whole $1.00 cost ceiling hunting the disk for
// the rest (`cd /; grep -rl "NAVEEN HUB" /` ran 300 s), writing nothing.
// Reversion: drop the attachmentFilesForProject wiring from the route and the wiring test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachmentFilesForProject, attachmentFilesNote, safeAttachmentName, ATTACHMENT_FILE_MAX_BYTES, writeAttachmentFilesInStep } from '../src/server/AgentV3/attachmentFilesOnDisk';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
/** A page the size of the report's (well past the 20,000-character prompt excerpt). */
const BIG_HTML = `<!doctype html><html lang="hi"><body><h1>NAVEEN HUB</h1>${'<section class="nb-card">tool</section>'.repeat(1500)}</body></html>`;

describe('the whole text file goes into the project', () => {
  it('#2415: the 60 KB HTML is written whole, under attachments/', () => {
    expect(BIG_HTML.length).toBeGreaterThan(20_000);
    const files = attachmentFilesForProject([{ name: 'naveen_hub.html', type: 'text/html', base64: b64(BIG_HTML) }]);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('attachments/naveen_hub.html');
    expect(files[0].content).toBe(BIG_HTML);
  });
  it('the builder is told where it is, that it is complete, and not to search the disk', () => {
    const note = attachmentFilesNote(attachmentFilesForProject([{ name: 'naveen_hub.html', type: 'text/html', base64: b64(BIG_HTML) }]));
    expect(note).toMatch(/naveen_hub\.html → attachments\/naveen_hub\.html/);
    expect(note).toMatch(/COMPLETE/);
    expect(note).toMatch(/do not search the filesystem/);
  });
  it('binary files, oversized files and unsafe names are handled', () => {
    expect(attachmentFilesForProject([{ name: 'letter.pdf', type: 'application/pdf', base64: b64('%PDF-1.4') }])).toEqual([]);
    expect(attachmentFilesForProject([{ name: 'huge.txt', type: 'text/plain', base64: Buffer.alloc(ATTACHMENT_FILE_MAX_BYTES + 1, 97).toString('base64') }])).toEqual([]);
    expect(safeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(safeAttachmentName('my page (1).html')).toBe('my_page_1_.html');
    const two = attachmentFilesForProject([{ name: 'a.css', type: 'text/css', base64: b64('x{}') }, { name: 'a.css', type: 'text/css', base64: b64('y{}') }]);
    expect(two.map((f) => f.path)).toEqual(['attachments/a.css', 'attachments/2-a.css']);
    expect(attachmentFilesNote([])).toBe('');
  });
});

describe('the write step', () => {
  const step = async (_l: string, run: () => Promise<unknown>) => run();
  it('writes every file inside the step and records ATTACHMENTS_ON_DISK', async () => {
    const written: string[] = []; const codes: string[] = [];
    await writeAttachmentFilesInStep(attachmentFilesForProject([{ name: 'naveen_hub.html', type: 'text/html', base64: b64(BIG_HTML) }]), step, async (p) => { written.push(p); }, (r) => codes.push(r.code));
    expect(written).toEqual(['attachments/naveen_hub.html']);
    expect(codes).toEqual(['ATTACHMENTS_ON_DISK']);
  });
  it('a failed write is reported, never silent', async () => {
    const codes: string[] = [];
    await writeAttachmentFilesInStep(attachmentFilesForProject([{ name: 'a.html', type: 'text/html', base64: b64('<p>x</p>') }]), step, async () => { throw new Error('sandbox gone'); }, (r) => codes.push(r.code));
    expect(codes).toEqual(['ATTACHMENTS_NOT_ON_DISK']);
  });
  it('no files: no step, no record', async () => {
    let stepped = false; const codes: string[] = [];
    await writeAttachmentFilesInStep([], async (_l, run) => { stepped = true; return run(); }, async () => {}, (r) => codes.push(r.code));
    expect(stepped).toBe(false); expect(codes).toEqual([]);
  });
});

describe('the wiring (source)', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  it('the route computes the files with the note, and writes them before the builder starts', () => {
    expect(route).toMatch(/attachmentFilesToWrite = attachmentFilesForProject\(docAttachments\)/);
    expect(route).toMatch(/attachmentFilesNote\(attachmentFilesToWrite\)/);
    const write = route.indexOf('await writeAttachmentFilesInStep(attachmentFilesToWrite');
    const firstModelCall = route.indexOf("closeSetupWindow('Build wiring ready'");
    expect(write).toBeGreaterThan(-1);
    expect(write).toBeLessThan(firstModelCall);
  });
});
