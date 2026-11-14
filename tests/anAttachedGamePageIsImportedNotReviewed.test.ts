// A WHOLE HTML PAGE PICKED THROUGH "CHOOSE FILE" IS IMPORTED, NOT REVIEWED (single-file game autopsy, 2026-11-14).
// The admin attached their 5.2 MB game and got a code review back: the attachment path reads a file and answers about it, and never
// opens it in Files / IDE / Preview. A page of app size now goes the import way; a small snippet stays an attachment.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldImportAttachedPage, ATTACHED_PAGE_IMPORT_BYTES } from '../src/lib/zipPicker';

describe('shouldImportAttachedPage', () => {
  it('the admin\'s real file (abcd.html, 5,432,975 bytes) is a project', () => {
    expect(shouldImportAttachedPage({ name: 'abcd.html', type: 'text/html', size: 5_432_975 })).toBe(true);
  });
  it('a page at the threshold is, one byte under is not', () => {
    expect(shouldImportAttachedPage({ name: 'g.html', size: ATTACHED_PAGE_IMPORT_BYTES })).toBe(true);
    expect(shouldImportAttachedPage({ name: 'g.html', size: ATTACHED_PAGE_IMPORT_BYTES - 1 })).toBe(false);
  });
  it('a small snippet, a big non-page file and a zip stay ordinary', () => {
    expect(shouldImportAttachedPage({ name: 'snippet.html', size: 4_000 })).toBe(false);
    expect(shouldImportAttachedPage({ name: 'data.json', size: 9_000_000 })).toBe(false);
    expect(shouldImportAttachedPage({ name: 'app.zip', type: 'application/zip', size: 9_000_000 })).toBe(false);
    expect(shouldImportAttachedPage(null)).toBe(false);
  });
});

describe('the attach handler uses it', () => {
  const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
  it('addFiles imports a page and does not stage it as an attachment', () => {
    const at = panel.indexOf('const addFiles = (list: FileList | null) => {');
    const body = panel.slice(at, at + 1800);
    expect(body).toContain('shouldImportAttachedPage(f)');
    expect(body).toContain('void handleZipProject(pages[0])');
    expect(body).toContain('picked.filter((f) => !pages.includes(f))');
  });
});
