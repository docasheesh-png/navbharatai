// THE IMPORT SIZE LIMITS ARE ONE NUMBER (single-file game autopsy, 2026-11-14).
//
// The "largest text file we keep" was written down five times — the browser filter, the server zip extractor, the
// import-files route, the durable file store and the AI edit tool — and the copies disagreed (900 KB, 900 KB, 5 MiB,
// 900 KB, 900 KB). A 5.4 MB single-file game was refused by one door, accepted by another, and would have vanished from
// the durable store with every layer reporting success. This test fails the build when a copy drifts or a new one appears.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { IMPORT_LIMITS } from '../src/lib/importRules';
import {
  IMPORT_MAX_FILES, IMPORT_MAX_FILE_BYTES, IMPORT_MAX_TOTAL_BYTES, IMPORT_MAX_ZIP_ENTRIES, IMPORT_MAX_DECOMPRESSED_BYTES,
  IMPORT_MAX_LOCKFILE_BYTES, IMPORT_MAX_ASSET_BYTES, IMPORT_MAX_ASSETS, IMPORT_MAX_ASSET_TOTAL_BYTES,
  IMPORT_MAX_SANDBOX_ASSET_BYTES, IMPORT_MAX_SANDBOX_ASSET_TOTAL_BYTES,
} from '../src/server/AgentV3/ProjectImport';
import {
  BROWSER_MAX_FILE_BYTES, BROWSER_MAX_TOTAL_BYTES, BROWSER_MAX_FILES, BROWSER_MAX_ASSET_BYTES, BROWSER_MAX_ASSETS,
} from '../src/lib/browserZipImport';
import { MAX_WRITE_FILE_BYTES } from '../src/server/lib/workspaceEdit';
import { selectImportableFiles } from '../src/server/AgentV3/WorkspaceFiles';

describe('every importer, store and tool reads its limit from IMPORT_LIMITS', () => {
  it('the server importer', () => {
    expect(IMPORT_MAX_FILES).toBe(IMPORT_LIMITS.maxFiles);
    expect(IMPORT_MAX_FILE_BYTES).toBe(IMPORT_LIMITS.maxTextFileBytes);
    expect(IMPORT_MAX_TOTAL_BYTES).toBe(IMPORT_LIMITS.maxTotalTextBytes);
    expect(IMPORT_MAX_ZIP_ENTRIES).toBe(IMPORT_LIMITS.maxZipEntries);
    expect(IMPORT_MAX_DECOMPRESSED_BYTES).toBe(IMPORT_LIMITS.maxDecompressedBytes);
    expect(IMPORT_MAX_LOCKFILE_BYTES).toBe(IMPORT_LIMITS.maxLockfileBytes);
    expect(IMPORT_MAX_ASSET_BYTES).toBe(IMPORT_LIMITS.maxInlineAssetBytes);
    expect(IMPORT_MAX_ASSETS).toBe(IMPORT_LIMITS.maxInlineAssets);
    expect(IMPORT_MAX_ASSET_TOTAL_BYTES).toBe(IMPORT_LIMITS.maxInlineAssetTotalBytes);
    expect(IMPORT_MAX_SANDBOX_ASSET_BYTES).toBe(IMPORT_LIMITS.maxSandboxAssetBytes);
    expect(IMPORT_MAX_SANDBOX_ASSET_TOTAL_BYTES).toBe(IMPORT_LIMITS.maxSandboxAssetTotalBytes);
  });

  it('the browser filter says what the server says', () => {
    expect(BROWSER_MAX_FILE_BYTES).toBe(IMPORT_MAX_FILE_BYTES);
    expect(BROWSER_MAX_TOTAL_BYTES).toBe(IMPORT_MAX_TOTAL_BYTES);
    expect(BROWSER_MAX_FILES).toBe(IMPORT_MAX_FILES);
    expect(BROWSER_MAX_ASSET_BYTES).toBe(IMPORT_MAX_ASSET_BYTES);
    expect(BROWSER_MAX_ASSETS).toBe(IMPORT_MAX_ASSETS);
  });

  it('the AI edit tool will not write a file the durable store would drop', () => {
    expect(MAX_WRITE_FILE_BYTES).toBe(IMPORT_LIMITS.maxTextFileBytes);
  });

  it('the import-files route holds a file to the SAME text cap — it used to take up to 5 MiB the store then dropped', () => {
    const justOver = 'x'.repeat(IMPORT_LIMITS.maxTextFileBytes + 1);
    const justUnder = 'x'.repeat(IMPORT_LIMITS.maxTextFileBytes);
    const { accepted, skipped } = selectImportableFiles({ 'src/over.js': justOver, 'src/under.js': justUnder });
    expect(accepted.map(([p]) => p)).toEqual(['src/under.js']);
    expect(skipped).toEqual(['src/over.js']);
  });

  it('the media ceiling is above the text ceiling and inside what the asset store can spill', () => {
    expect(IMPORT_LIMITS.maxEmbeddedMediaBytes).toBeGreaterThan(IMPORT_LIMITS.maxTextFileBytes);
    expect(IMPORT_LIMITS.maxEmbeddedMediaTotalBytes).toBeGreaterThanOrEqual(IMPORT_LIMITS.maxEmbeddedMediaBytes);
    expect(IMPORT_LIMITS.maxHtmlSourceBytes).toBeGreaterThan(IMPORT_LIMITS.maxEmbeddedMediaBytes);
    expect(Object.isFrozen(IMPORT_LIMITS)).toBe(true);
  });
});

/** Source files (relative to the repo root) that may still spell a 900 KB literal, each with the reason it is NOT the import cap. */
const UNRELATED_900KB: Readonly<Record<string, string>> = {
  'src/lib/importRules.ts': 'the one definition',
  'src/components/professionals/ProfessionalChat.tsx': 'an IMAGE is re-compressed above 900 KB before it is sent as a chat attachment',
  'src/components/agentv3/AgentV3Panel.tsx': 'the same image re-compression threshold for a build attachment',
  'src/hooks/useChatEngine.ts': 'the same image re-compression threshold for a chat attachment',
  'src/server/AgentV3/DiagnosticsStore.ts': 'a Firestore document cap for a diagnostics record, not an imported file',
  'src/server/routes/pwa.ts': 'the size of a generated PWA page',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('no second copy of the number can appear', () => {
  const root = join(__dirname, '..');
  const files = walk(join(root, 'src')).map((p) => ({ rel: relative(root, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));

  it('a 900 KB literal exists only where the reason is written down', () => {
    const offenders = files
      .filter((f) => /\b900\s*\*\s*1024\b/.test(f.text) && !(f.rel in UNRELATED_900KB))
      .map((f) => f.rel);
    expect(offenders, 'use IMPORT_LIMITS (src/lib/importRules.ts), or add the file to UNRELATED_900KB with the reason it is not the import cap').toEqual([]);
  });

  it('the allowlist is not stale: every listed file still has the literal', () => {
    for (const rel of Object.keys(UNRELATED_900KB)) {
      const f = files.find((x) => x.rel === rel);
      expect(f, rel + ' no longer exists — remove it from UNRELATED_900KB').toBeTruthy();
      expect(/\b900\s*\*\s*1024\b/.test(f!.text), rel + ' no longer has the literal — remove it from UNRELATED_900KB').toBe(true);
    }
  });

  it('the importers do not restate the 80 MB total or the 16,000-file count', () => {
    const guarded = ['src/lib/browserZipImport.ts', 'src/server/AgentV3/ProjectImport.ts', 'src/server/AgentV3/WorkspaceFileStore.ts', 'src/server/lib/workspaceEdit.ts'];
    for (const rel of guarded) {
      const text = files.find((f) => f.rel === rel)!.text;
      expect(/\b80\s*\*\s*1024\s*\*\s*1024\b/.test(text), rel + ' restates the total-bytes budget').toBe(false);
      expect(/\b16_?000\b/.test(text.replace(/\/\/.*$/gm, '')), rel + ' restates the file-count cap').toBe(false);
    }
  });
});
