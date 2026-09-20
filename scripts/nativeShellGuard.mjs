#!/usr/bin/env node
// THE STORE BUILDS CANNOT BREAK SILENTLY — the guard CI was missing (2026-09-20).
//
// 🔴 WHY THIS EXISTS. On one day, BOTH store builds failed on a `main` whose CI was fully green, on
// two faults neither `tsc` nor `vitest` nor `npm run build` on Linux can see:
//
//   1. ANDROID — `android/app/src/main/res/values/nbai_colors.xml` carried a literal `--` inside an
//      XML comment (it quoted a CSS custom property by name). That is illegal XML, and
//      `:app:mergeReleaseResources` refused it. Nothing in this repo reads Android resource XML, so
//      the only way to discover it was to run the .aab workflow — which is manual, and is run on the
//      day somebody needs a release.
//   2. iOS — `HeaderBadges.tsx` and `headerBadges.ts` sat in one directory, differing only in case.
//      Linux (case-SENSITIVE) has two files and resolves each import correctly; the macOS runner
//      (case-INSENSITIVE) has one, so the component's import resolved to the rules module and
//      `npm run build` failed at rollup. Our whole gate runs on Linux, so it could not reproduce it.
//
// The shared root cause is not either fault: it is that **the two platforms that actually ship the
// app are built by manual workflows, and nothing on the ordinary path speaks for them.** This script
// is that voice. It needs no Android SDK, no macOS and no Xcode — it is a few milliseconds of reading.
//
// ⚠️ IT IS NOT A FULL XML VALIDATOR, AND MUST NOT BE READ AS ONE. It enforces the three rules that can
// be checked exactly and with no false positives (see `xmlFaults`). A rule that cannot be checked
// exactly is deliberately absent: a guard that blocks a correct build is worse than the bug it hunts.

import { readFileSync, readdirSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

/** Every `<!-- … -->` in `source`, as [startIndex, endIndex or -1 when unterminated]. */
function comments(source) {
  const found = [];
  let at = 0;
  for (;;) {
    const open = source.indexOf('<!--', at);
    if (open === -1) return found;
    const close = source.indexOf('-->', open + 4);
    found.push([open, close]);
    if (close === -1) return found;
    at = close + 3;
  }
}

/** 1-indexed line number of a character offset — so a fault names the line a human can open. */
function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') line++;
  return line;
}

const ENTITY = /^(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/;

/**
 * The three exact faults. PURE — takes the text, returns what is wrong with it.
 *
 * 1. `--` inside a comment (XML forbids it; this is the fault that broke the .aab).
 * 2. An unterminated comment (silently eats the rest of the file).
 * 3. A bare `&` that starts no entity (aapt refuses it, and it is always a mistake in a resource).
 */
export function xmlFaults(source) {
  const text = String(source ?? '');
  const faults = [];
  const ranges = comments(text);
  for (const [open, close] of ranges) {
    if (close === -1) {
      faults.push({ line: lineOf(text, open), why: 'a comment is opened and never closed' });
      continue;
    }
    const body = text.slice(open + 4, close);
    const hyphens = body.indexOf('--');
    if (hyphens !== -1) {
      faults.push({
        line: lineOf(text, open + 4 + hyphens),
        why: 'a comment contains "--", which XML forbids (write the word out instead)',
      });
    }
  }
  const inComment = (i) => ranges.some(([o, c]) => i >= o && (c === -1 || i <= c + 2));
  for (let i = text.indexOf('&'); i !== -1; i = text.indexOf('&', i + 1)) {
    if (inComment(i)) continue;
    if (!ENTITY.test(text.slice(i + 1))) {
      faults.push({ line: lineOf(text, i), why: 'a bare "&" that begins no entity (write &amp;)' });
    }
  }
  return faults;
}

/**
 * Paths that differ ONLY by case. PURE. Returns one pair per collision, in the order given.
 *
 * On a case-insensitive filesystem these are ONE file, so a checkout on macOS or Windows silently
 * loses one of them.
 */
export function caseCollisions(paths) {
  const byLower = new Map();
  const pairs = [];
  for (const p of paths) {
    const key = String(p).toLowerCase();
    const seen = byLower.get(key);
    if (seen === undefined) byLower.set(key, p);
    else if (seen !== p) pairs.push([seen, p]);
  }
  return pairs;
}

/** What a bare `import './x'` may resolve to, in the order a bundler tries them. */
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

/**
 * Two modules in ONE directory whose names differ only by case once the extension is removed. PURE.
 *
 * 🔴 THIS IS THE RULE THAT ACTUALLY CATCHES THE iOS FAULT, and `caseCollisions` above does NOT —
 * which was proven by running it against the real bug and watching it pass. `HeaderBadges.tsx` and
 * `headerBadges.ts` are different PATHS (different extensions), so no filesystem collision exists on
 * any platform. What collides is the SPECIFIER: `./HeaderBadges` and `./headerBadges` are the same
 * string to a case-insensitive resolver, and which file it hands back is not something the code can
 * state. Linux picks right, macOS picked the other one, and the iOS build died on a green `main`.
 *
 * Both rules are kept: one is about the filesystem, the other about resolution, and neither implies
 * the other.
 */
export function ambiguousModuleNames(paths) {
  const byDir = new Map();
  for (const raw of paths) {
    const p = String(raw);
    const slash = p.lastIndexOf('/');
    const dir = slash === -1 ? '.' : p.slice(0, slash);
    const base = slash === -1 ? p : p.slice(slash + 1);
    const dot = base.lastIndexOf('.');
    if (dot <= 0) continue;
    const stem = base.slice(0, dot);
    if (!MODULE_EXTENSIONS.includes(base.slice(dot))) continue;
    const key = `${dir}\u0000${stem.toLowerCase()}`;
    const seen = byDir.get(key);
    if (seen === undefined) byDir.set(key, [p, stem]);
    else if (seen[1] !== stem) byDir.set(key, [seen[0], seen[1], p]);
  }
  const pairs = [];
  for (const entry of byDir.values()) if (entry.length === 3) pairs.push([entry[0], entry[2]]);
  return pairs;
}

/** Every `.xml` under a directory, recursively. Missing directory ⇒ no files, never a throw. */
export function xmlFilesUnder(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      const full = join(d, name);
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) walk(full);
      else if (name.endsWith('.xml')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

function main() {
  const problems = [];

  const xmlFiles = xmlFilesUnder('android');
  for (const file of xmlFiles) {
    let source;
    try { source = readFileSync(file, 'utf8'); } catch { continue; }
    for (const fault of xmlFaults(source)) {
      problems.push(`${file}:${fault.line} — ${fault.why}`);
    }
  }

  // `git ls-files` is the right list: it is exactly what a fresh checkout on another machine gets.
  //
  // 🔒 A LIST WE COULD NOT READ IS A FAILURE, NOT A PASS. The first draft of this block swallowed the
  // error and carried on with an empty list, so the guard reported success having checked nothing —
  // the fake-green class this whole script exists to end, reproduced inside the script itself on its
  // very first run. It is caught here rather than in review because the success line PRINTS THE COUNT.
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (err) {
    console.error(`[nativeShellGuard] FAIL — could not list tracked files (${err?.message || err}).`);
    console.error('The case-collision half cannot run without it, and silently skipping it is how a');
    console.error('store build breaks on a green main. Run this from inside the git checkout.');
    process.exit(1);
  }
  if (tracked.length === 0) {
    console.error('[nativeShellGuard] FAIL — `git ls-files` returned nothing. Refusing to report a');
    console.error('pass on an empty list: a check of zero files is not a check.');
    process.exit(1);
  }
  for (const [a, b] of caseCollisions(tracked)) {
    problems.push(`${a} and ${b} differ only in case — one file on macOS/Windows, two on Linux`);
  }
  for (const [a, b] of ambiguousModuleNames(tracked)) {
    problems.push(`${a} and ${b} are one module name to a case-insensitive resolver — an import of either is ambiguous on macOS/Windows`);
  }

  if (problems.length > 0) {
    console.error('[nativeShellGuard] FAIL — these break a store build that Linux CI cannot see:\n');
    for (const p of problems) console.error(`  • ${p}`);
    console.error('\nSee the header of scripts/nativeShellGuard.mjs for what each rule is and why.');
    process.exit(1);
  }
  console.log(`✅ [nativeShellGuard] ${xmlFiles.length} Android XML files parse; no case-colliding paths and no ambiguous module names in ${tracked.length} tracked files.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
