/**
 * ONE mic implementation, enforced.
 *
 * The admin's 2026-08-13 report ("free voice typing ek word ko bar bar type kar deta hai") was not
 * really a bug in one screen — it was FOUR hand-written copies of the same logic, two of which had
 * the fault. Fixing the two would have left the shape that produced them, and the next chat screen
 * would have re-typed it a fifth time.
 *
 * So this file guards the SHAPE, not the symptom: no component may touch the Web Speech API directly,
 * and no component may reconstruct a transcript by joining the results list. Both are the exact moves
 * that caused the report.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The three modules that are ALLOWED to know how speech recognition works. */
const OWNERS = ['hooks/useSpeechInput.ts', 'lib/speechTranscript.ts', 'lib/voiceInput.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Comments describe the bug on purpose; only real code counts. */
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');

const files = walk(SRC)
  .filter((f) => !OWNERS.some((o) => f.endsWith(o.replace(/\//g, require('path').sep)) || f.endsWith(o)))
  .map((f) => ({ path: f.slice(SRC.length + 1), code: codeOnly(readFileSync(f, 'utf8')) }));

describe('🔒 only the shared hook may construct a recogniser', () => {
  it('no component instantiates SpeechRecognition itself', () => {
    const offenders = files
      .filter((f) => /\b(webkitSpeechRecognition|SpeechRecognition)\b/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `these must use useSpeechInput() instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('🔒 nobody rebuilds a transcript by joining the results list — the reported bug', () => {
    // `Array.from(e.results).map(r => r[0].transcript).join('')` looks right on desktop Chrome and
    // produces "voicevoice typingvoice typing Mein…" on Android, because each revision arrives as a
    // NEW entry carrying the cumulative text.
    const offenders = files
      // Anchored on `.transcript`, which only speech results have -- an earlier version keyed on
      // `results.map` and flagged search results, route results and SSRF checks.
      .filter((f) => /\.transcript\b[\s\S]{0,200}\.join\(/.test(f.code) || /\.map\([^)]*\)[\s\S]{0,80}\.transcript\b/.test(f.code) || /\[0\]\.transcript\b/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `rebuilding the transcript is the bug:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('🔒 nobody hardcodes a recognition language', () => {
    // Two screens pinned 'en-IN', so a Hindi speaker was transcribed by an English recogniser -- in an
    // India-first product, on the screens most likely to be used in Hindi.
    const offenders = files
      .filter((f) => /\.lang\s*=\s*['"][a-z]{2}-[A-Z]{2}['"]/.test(f.code))
      .map((f) => f.path);
    expect(offenders, `pass a lang to useSpeechInput instead:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('the guard is actually looking at something', () => {
  it('scanned a realistic number of source files', () => {
    // A broken walk would make every assertion above pass vacuously.
    expect(files.length).toBeGreaterThan(200);
  });

  it('and the owners it exempts really exist', () => {
    for (const owner of OWNERS) {
      expect(() => readFileSync(join(SRC, owner), 'utf8'), owner).not.toThrow();
    }
  });
});
