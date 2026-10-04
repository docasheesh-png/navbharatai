/**
 * AUTOPSY 1eaa5f5a / e3b0ce25 (2026-10-04): THE SANDBOX'S package.json WAS 0 BYTES, TWICE IN ONE BUILD.
 *
 * The saved copy was fine (453 B). Every npm command failed with EJSONPARSE and the dev server would not
 * stay up. An empty manifest is never a real project, so the one install path now puts the last valid
 * copy back first — and records what the machine was doing, because which process emptied it is still
 * an open question.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isEmptyManifest, validManifest, pickManifestRestore, emptyManifestNote, EMPTY_MANIFEST_EVIDENCE_COMMAND } from '../src/server/AgentV3/emptyManifest';

const PKG = '{\n  "name": "block-fit-game",\n  "version": "1.0.0",\n  "scripts": { "dev": "vite" }\n}\n';

describe('only an empty manifest is restored', () => {
  it('empty and whitespace-only are empty; a missing file is not', () => {
    expect(isEmptyManifest('')).toBe(true);
    expect(isEmptyManifest('  \n')).toBe(true);
    expect(isEmptyManifest(null)).toBe(false);
    expect(isEmptyManifest(undefined)).toBe(false);
    expect(isEmptyManifest(PKG)).toBe(false);
    // A broken-but-written file is the user's (or the model's) work in progress, not an emptied one.
    expect(isEmptyManifest('{ "name": ')).toBe(false);
  });

  it('a restore source must be a real JSON object', () => {
    expect(validManifest(PKG)).toBe(PKG);
    expect(validManifest('')).toBeNull();
    expect(validManifest('[]')).toBeNull();
    expect(validManifest('{ "name": ')).toBeNull();
    expect(validManifest('null')).toBeNull();
  });

  it('the session\'s last write wins; the saved copy is the fallback', () => {
    const saved = '{ "name": "saved" }';
    expect(pickManifestRestore(PKG, saved)).toBe(PKG);
    expect(pickManifestRestore('', saved)).toBe(saved);
    expect(pickManifestRestore(undefined, null)).toBeNull();
  });
});

describe('the report says what happened', () => {
  it('names the restore and carries the evidence', () => {
    const note = emptyManifestNote(true, '-rw-r--r-- 1 user user 0 package.json\n123 1 4 npm install');
    expect(note).toMatch(/EMPTY .* restored the last valid copy/);
    expect(note).toContain('npm install');
    expect(emptyManifestNote(false, '')).toMatch(/no valid copy/);
  });

  it('the evidence command only reads', () => {
    expect(EMPTY_MANIFEST_EVIDENCE_COMMAND).not.toMatch(/\b(rm|mv|cp|kill|npm\s+(?:i|install|ci))\b|>\s*package/);
  });

  it('every install goes through the guard (one install function, no path around it)', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');
    const calls = src.match(/this\._npmInstall\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c).toBe('this._npmInstall(sandbox, workspaceId)');
    const body = src.slice(src.indexOf('private async _npmInstall('), src.indexOf('private async _restoreEmptyManifest('));
    const guard = body.indexOf('this._restoreEmptyManifest(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('this._npmInstallLocked('));
  });
});
