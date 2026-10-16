/**
 * Build `413d29a1` (2026-10-14, the MP4→MP3 converter) — Q-1084.
 *
 * The delivered app painted its own error — "Failed to load converter engine: Error: failed to import
 * ffmpeg-core.js" — and the release gate went RED. `npm install @ffmpeg/ffmpeg @ffmpeg/util` had reported
 * `added 3 packages` and `found 0 vulnerabilities`: a clean install of a package that still cannot run,
 * because `@ffmpeg/ffmpeg` fetches its WebAssembly core at RUNTIME and npm pulls no such thing.
 *
 * 🔴 THE BUILDER WAS NOT IGNORANT, AND THAT IS WHAT DECIDED THE FIX. From its own commands in that report,
 * after the error it proved the diagnosis completely: `… || echo "no @ffmpeg/core installed"` printed
 * exactly that; it fetched the CDN core and got 200 with `access-control-allow-origin: *`; it read
 * `classes.js`, `worker.js`, `const.js` and `errors.js` looking for the import. ~30 commands of correct
 * investigation, and the fix was never applied — that turn was consumed by the no-op loop of Q-1081.
 *
 * So another warning after the install would have told it what it had already worked out. The fix is the
 * conclusion this module reached one function below, in autopsy 3f959fde's own words: "Told BEFORE the
 * first install, it is a choice." Prevent (the 50/50 law's first half) — with the wiring known up front,
 * the error never happens, so neither do the thirty commands nor the loop.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  NEEDS_RUNTIME_ARTIFACT, runtimeArtifactAdvice, packageChoiceRule, packagesInstalledBy,
} from '../src/server/lib/unfixablePackages';
import { bannedPackagesInCommand } from '../src/server/AgentV3/reliability/bannedPackages';

describe('a clean install is not a working package', () => {
  it('the package the report failed on is listed', () => {
    expect(runtimeArtifactAdvice('@ffmpeg/ffmpeg')).toBeTruthy();
    expect(runtimeArtifactAdvice('@ffmpeg/FFMPEG')).toBeTruthy(); // case does not matter
    expect(runtimeArtifactAdvice('react')).toBeNull();
    expect(runtimeArtifactAdvice('')).toBeNull();
    expect(runtimeArtifactAdvice(undefined as unknown as string)).toBeNull();
  });

  it('the advice names what the report proved, not a guess', () => {
    const a = runtimeArtifactAdvice('@ffmpeg/ffmpeg')!;
    expect(a).toMatch(/coreURL/);
    expect(a).toMatch(/wasmURL/);
    expect(a).toMatch(/toBlobURL/);          // the only thing that lets the worker load it cross-origin
    expect(a).toMatch(/@ffmpeg\/core/);      // the artifact npm never pulled
    expect(a).toMatch(/SharedArrayBuffer/);  // why the -mt build fails without COOP/COEP
    expect(a).toMatch(/failed to import ffmpeg-core\.js/); // the user-visible error, verbatim
  });

  it('🔒 NO PINNED VERSIONS — an entry that goes stale becomes a lie the builder acts on', () => {
    for (const [pkg, why] of Object.entries(NEEDS_RUNTIME_ARTIFACT)) {
      expect(why, pkg).not.toMatch(/@\d+\.\d+/);        // no "@0.12.10"
      expect(why, pkg).not.toMatch(/\bv\d+\.\d+\.\d+/); // no "v0.12.10"
      expect(why, pkg).not.toMatch(/unpkg\.com|jsdelivr/); // no CDN URL that can 404 later
    }
  });

  it('every entry states both halves: that the install is not enough, and what to do', () => {
    for (const [pkg, why] of Object.entries(NEEDS_RUNTIME_ARTIFACT)) {
      expect(why.length, pkg).toBeGreaterThan(80);
      expect(why, pkg).toMatch(/RUNTIME|runtime/);
    }
  });
});

describe('the builder is told BEFORE it writes the code, not after the install', () => {
  const rule = packageChoiceRule();

  it('the rule carries the wiring section', () => {
    expect(rule).toMatch(/NEED WIRING BEFORE THEY RUN/);
    expect(rule).toContain('@ffmpeg/ffmpeg');
    expect(rule).toMatch(/npm install\W+is NOT enough/);
  });

  it('it is DERIVED from the list — a new entry reaches every prompt with no second edit', () => {
    for (const pkg of Object.keys(NEEDS_RUNTIME_ARTIFACT)) expect(rule).toContain(pkg);
    // And the source proves the derivation rather than a hand-copied paragraph.
    const src = readFileSync(join(__dirname, '../src/server/lib/unfixablePackages.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function packageChoiceRule'));
    expect(fn).toMatch(/Object\.entries\(NEEDS_RUNTIME_ARTIFACT\)/);
  });

  it('the older sections are untouched — this adds a section, it does not replace one', () => {
    expect(rule).toMatch(/PACKAGES NOT TO INSTALL/);
    expect(rule).toContain('xlsx');
    expect(rule).toContain('uuid');
  });

  it('it reaches the builder AND the sub-agents that write files', () => {
    const sys = readFileSync(join(__dirname, '../src/server/AgentV3/systemPrompt.ts'), 'utf8');
    const sub = readFileSync(join(__dirname, '../src/server/AgentV3/SubAgent.ts'), 'utf8');
    expect(sys).toContain('packageChoiceRule()');
    expect(sub).toContain('packageChoiceRule()');
  });

  it('it names no vendor or model — the rule can reach a build report the USER reads', () => {
    expect(rule).not.toMatch(/claude|anthropic|kimi|glm|grok|gemini|opus|sonnet|haiku/i);
  });
});

describe('🔴 a word after a pipe is not a package — found by the test above, and it could BLOCK an install', () => {
  it('the exact install line from build 413d29a1 parses as two packages, not three', () => {
    // Verbatim from the report, pipe and all. Before the fix this returned `tail` as a third package.
    expect(packagesInstalledBy('npm install @ffmpeg/ffmpeg @ffmpeg/util 2>&1 | tail -20'))
      .toEqual(['@ffmpeg/ffmpeg', '@ffmpeg/util']);
  });

  it('and it is not cosmetic: a piped word matching a list would REFUSE a legitimate install', () => {
    // `bannedInstallRefusal` does not warn, it refuses to run the command. `uuid` is on
    // BUILT_IN_ALTERNATIVES, so before the fix this install was blocked because of a grep argument.
    expect(packagesInstalledBy('npm install react 2>&1 | grep uuid')).toEqual(['react']);
    expect(bannedPackagesInCommand('npm install react 2>&1 | grep uuid')).toEqual([]);
    // The real thing still gets refused — the fix narrows false positives, it does not disarm the guard.
    expect(bannedPackagesInCommand('npm install uuid')).toEqual(['uuid']);
  });

  it('every pipe-and-redirect shape this builder actually uses', () => {
    for (const cmd of [
      'npm install axios | tail -5',
      'npm install axios > /tmp/log',
      'npm install axios 2>&1 | head -20',
      'npm i axios 2>/dev/null',
      'npm install axios | grep xlsx',
    ]) {
      expect(packagesInstalledBy(cmd), cmd).toEqual(['axios']);
    }
  });

  it('flags are still skipped rather than terminal, and chained installs still both count', () => {
    expect(packagesInstalledBy('npm i -D @types/node typescript')).toEqual(['@types/node', 'typescript']);
    expect(packagesInstalledBy('npm install a b && npm i -D c')).toEqual(['a', 'b', 'c']);
    expect(packagesInstalledBy('npm install react@18.3.1')).toEqual(['react']);
    expect(packagesInstalledBy('npm install @scope/pkg@1.2.3')).toEqual(['@scope/pkg']);
  });
});
