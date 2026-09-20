/**
 * BOTH STORE BUILDS FAILED ON A GREEN `main` — and neither fault was visible to this suite (2026-09-20).
 *
 * The admin asked for a fresh `.aab` and `.ipa`. Both workflows failed within two minutes, on a commit
 * whose CI had just gone green across typecheck, 27,370 tests, the Linux bundle build, the bundle
 * budget, the boot check and the server-deps gate.
 *
 *   ANDROID — `:app:mergeReleaseResources` refused `nbai_colors.xml`: a comment quoted a CSS custom
 *   property by name and so contained a literal `--`, which XML forbids. Nothing in this repo reads
 *   Android resource XML.
 *
 *   iOS — `npm run build` died at rollup: "HeaderBadges is not exported by headerBadges.ts". The two
 *   files differ only by case, so Linux has two modules and the case-insensitive macOS runner has one.
 *
 * The shared root cause is neither fault: the two platforms that actually ship the app were built by
 * manual workflows and nothing on the ordinary path spoke for them. These cases are the voice.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { xmlFaults, caseCollisions, ambiguousModuleNames, xmlFilesUnder } from '../scripts/nativeShellGuard.mjs';

describe('the Android fault: "--" inside an XML comment', () => {
  it('catches the exact comment that broke the .aab', () => {
    const faults = xmlFaults('<!-- the `--accent` token -->\n<resources/>');
    expect(faults).toHaveLength(1);
    expect(faults[0].line).toBe(1);
    expect(faults[0].why).toContain('"--"');
  });

  it('names the LINE, so the fault can be opened rather than hunted', () => {
    const faults = xmlFaults('<resources>\n\n\n<!--\n  a -- b\n-->\n</resources>');
    expect(faults[0].line).toBe(5);
  });

  it('allows a single hyphen, an em dash and a trailing hyphen before the close', () => {
    expect(xmlFaults('<!-- well-formed — really -->\n<resources/>')).toEqual([]);
  });

  it('catches a comment that is opened and never closed', () => {
    const faults = xmlFaults('<resources>\n<!-- forgot to close\n<color name="x">#fff</color>');
    expect(faults).toHaveLength(1);
    expect(faults[0].why).toContain('never closed');
  });

  it('catches a bare & but not a real entity', () => {
    expect(xmlFaults('<string name="a">Tom & Jerry</string>')).toHaveLength(1);
    expect(xmlFaults('<string name="a">Tom &amp; Jerry &#160; &#x2014;</string>')).toEqual([]);
  });

  it('does not fault on a "--" INSIDE a comment-looking string in ordinary content', () => {
    // The rule is about comments only; a value may legitimately contain hyphens.
    expect(xmlFaults('<string name="flag">--no-audit</string>')).toEqual([]);
  });

  it('every Android XML file in the repo passes — the fix is real, not just the rule', () => {
    const files = xmlFilesUnder('android');
    expect(files.length).toBeGreaterThan(0);
    const bad = files.filter((f: string) => xmlFaults(readFileSync(f, 'utf8')).length > 0);
    expect(bad).toEqual([]);
  });
});

describe('the iOS fault: two modules that are one name to a case-insensitive resolver', () => {
  it('catches the exact pair that broke the .ipa', () => {
    const pairs = ambiguousModuleNames([
      'src/components/agentv3/HeaderBadges.tsx',
      'src/components/agentv3/headerBadges.ts',
    ]);
    expect(pairs).toHaveLength(1);
  });

  it('🔴 and the FULL-PATH rule does not — which is why both rules exist', () => {
    // Proven against the real bug before it was trusted: different extensions mean different paths,
    // so no filesystem collision exists on any platform. What collides is the import specifier.
    expect(caseCollisions([
      'src/components/agentv3/HeaderBadges.tsx',
      'src/components/agentv3/headerBadges.ts',
    ])).toEqual([]);
  });

  it('still catches a true filesystem collision — same name, same extension', () => {
    expect(caseCollisions(['a/Foo.ts', 'a/foo.ts'])).toEqual([['a/Foo.ts', 'a/foo.ts']]);
  });

  it('does not fault on the same stem in DIFFERENT directories', () => {
    // `a/foo.ts` and `b/Foo.ts` are unambiguous: a relative import names its directory.
    expect(ambiguousModuleNames(['a/foo.ts', 'b/Foo.ts'])).toEqual([]);
  });

  it('does not fault on an asset that is not a module', () => {
    expect(ambiguousModuleNames(['a/Logo.png', 'a/logo.svg'])).toEqual([]);
  });

  it('does not fault on the ordinary one-file-one-name case', () => {
    expect(ambiguousModuleNames(['a/foo.ts', 'a/bar.tsx', 'a/foo.test.ts'])).toEqual([]);
  });

  it('the repo itself is clean — measured, not assumed', () => {
    // This pair was the only one in 4,049 tracked files, which is what made the rule safe to enforce
    // rather than a sweep of dozens of renames.
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(tracked.length).toBeGreaterThan(1000);
    expect(ambiguousModuleNames(tracked)).toEqual([]);
    expect(caseCollisions(tracked)).toEqual([]);
  });
});

describe('the guard runs where it can bite', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  it('CI runs it on every pull request', () => {
    // A guard that exists and is never invoked is the shape of the bug it was written for.
    expect(pkg.scripts['native:guard']).toBe('node scripts/nativeShellGuard.mjs');
    expect(ci).toContain('npm run native:guard');
  });

  it('a file list it could not read is a FAILURE, never a pass', () => {
    // Its own first run printed "0 tracked files" and exited 0 — the fake-green class, reproduced
    // inside the guard. The success line prints the count precisely so that cannot recur unseen.
    const src = readFileSync('scripts/nativeShellGuard.mjs', 'utf8');
    expect(src).toContain('a check of zero files is not a check');
    expect(src).toContain('${tracked.length} tracked files');
  });
});
