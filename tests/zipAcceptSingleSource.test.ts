/**
 * The zip picker filter must never be hand-written again.
 *
 * ADMIN REPORT 2026-08-13: on Android, "Import project (.zip)" showed none of the user's archives.
 * The cause was a hand-typed `accept=".zip,application/zip,application/x-zip-compressed"` — correct on
 * desktop, and on Android a filter that hides the very files it names, because Android matches MIME
 * types and reports a .zip as `application/octet-stream`.
 *
 * It was typed out in TWO places and both were broken; the ONE entry point that worked was the one
 * with no filter at all. That is the shape this guard forbids: a literal zip filter anywhere but the
 * shared module, so the next screen that needs a zip input cannot re-introduce the bug.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, sep } from 'path';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const OWNER = join('lib', 'zipPicker.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments name the broken filter on purpose; only real code counts. */
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');

const files = walk(SRC)
  .filter((f) => !f.endsWith(OWNER))
  .map((f) => ({ path: f.slice(SRC.length + 1), code: codeOnly(readFileSync(f, 'utf8')) }));

describe('🔒 one source for the zip accept filter', () => {
  it('no component hardcodes a zip MIME filter', () => {
    const offenders = files
      .filter((f) => /accept\s*=\s*["'{][^}"']*(application\/(x-)?zip|\.zip)/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `use zipAccept() from lib/zipPicker instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('🔒 the exact string from the report appears in no FILE INPUT', () => {
    // Scoped to files that actually render a picker. Server-side code legitimately needs these MIME
    // strings to CLASSIFY an upload (attachmentText.ts, uploadClassify.ts) -- detecting a zip is not
    // the bug; filtering a picker by it is.
    const offenders = files
      .filter((f) => /type\s*=\s*["']file["']/.test(f.code) && f.code.includes('application/x-zip-compressed'))
      .map((f) => f.path);
    expect(offenders, `this filter hides every archive on Android:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the guard is actually scanning files', () => {
    // A broken walk would make both assertions above pass vacuously.
    expect(files.length).toBeGreaterThan(200);
    expect(() => readFileSync(join(SRC, OWNER), 'utf8')).not.toThrow();
  });
});

describe('🔒 every zip entry point verifies the pick', () => {
  const importers = [
    'components/AttachMenu.tsx',
    'components/ide/CodeStudio.tsx',
    'components/agentv3/AgentV3Panel.tsx',
  ].map((p) => ({ path: p, code: codeOnly(readFileSync(join(SRC, p.replace(/\//g, sep)), 'utf8')) }));

  it('the two that START an import check the bytes, not just the name', () => {
    // Opening the filter is only safe because the pick is verified afterwards. A screen that opened
    // the filter WITHOUT verifying would hand a photo to a multi-minute upload.
    for (const f of importers.filter((x) => x.path !== 'components/AttachMenu.tsx')) {
      expect(f.code, f.path).toContain('acceptZipPick');
    }
  });

  it('🔒 nobody gates an import on the filename alone any more', () => {
    // `looksLikeZip` only ever tested the extension — too weak once the picker offers every file.
    for (const f of importers) {
      expect(f.code, f.path).not.toMatch(/if\s*\(\s*!\s*looksLikeZip\s*\(/);
    }
  });
});
