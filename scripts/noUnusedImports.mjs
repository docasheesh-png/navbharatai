#!/usr/bin/env node
/**
 * Fails when a source file imports something it never uses.
 *
 * WHY THIS IS A SEPARATE GATE and not just `noUnusedLocals` in tsconfig (2026-08-24): turning that
 * compiler flag on today would also fail on ~122 unused LOCALS — dead `useState` setters and the
 * like, mostly in App.tsx. Those are real cleanup, but deleting a local can change behaviour, so
 * they need eyes and a change of their own. Unused IMPORTS need neither: removing one is provably
 * behaviour-free, and it is the class that actually cost something.
 *
 * WHAT IT COST. App.tsx imported AdminDashboard, AIChat, WorkspacePane, DeployModal and
 * MessageContent and rendered none of them — five components, ~50 KB gzipped, on the first-paint
 * path of every visitor, for nothing. Nothing flagged it, because `noUnusedLocals` is off. #2630 and
 * #2634 removed them; this stops the next one.
 *
 * The unused LOCALS are no longer unpoliced: since 2026-10-06 (Q-600) their count per file is
 * ratcheted against `scripts/unusedLocalsBaseline.json` — see `compareUnusedLocals` below. When that
 * baseline is empty, delete this script and set `noUnusedLocals: true` in tsconfig.json instead — one
 * compiler flag beats a bespoke gate.
 *
 * ⚠️ TWO ERROR CODES, NOT ONE — and missing the second is a bug this script shipped with.
 * TypeScript reports an unused import binding as TS6133, but when EVERY binding in a declaration is
 * unused it reports the whole line as TS6192 instead, with no name attached. The first version
 * matched only TS6133, so it printed "✅ No unused imports" while SEVEN entire import declarations
 * sat unused in App.tsx and AgentProgress.tsx — the exact case that costs the most, since a whole
 * unused declaration is a whole module kept on the load path. TS6192 needs no line-shape judgement:
 * the code only ever refers to an import declaration, so it is always an offender.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * THE UNUSED-LOCALS RATCHET (Q-600, 2026-10-06). The same tsc run also lists every LOCAL nothing reads
 * — state set but never shown, a handler never wired. `saveError` in ProfilePage was one: an error the
 * user should have seen, silently dropped, until #3531 found it by hand. Deleting a local can change
 * behaviour, so they are not removed blind; instead the count per file may only go DOWN. A file that
 * gains one fails CI, and a file that loses one must lower the baseline (`--update-baseline`), so the
 * slack can never be spent again. When every count reaches 0, set `noUnusedLocals: true` instead.
 *
 * PURE. `counts` and `baseline` map a file to its number of unused locals.
 */
export function compareUnusedLocals(counts, baseline) {
  const grown = [];
  const shrunk = [];
  for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    const now = counts[file] ?? 0;
    const was = baseline[file] ?? 0;
    if (now > was) grown.push({ file, now, was });
    else if (now < was) shrunk.push({ file, now, was });
  }
  const sort = (a, b) => a.file.localeCompare(b.file);
  return { grown: grown.sort(sort), shrunk: shrunk.sort(sort) };
}

const BASELINE = 'scripts/unusedLocalsBaseline.json';

/** An unused binding is an IMPORT problem when the line tsc points at is inside an import. PURE. */
export function isImportLine(fileLines, lineNo) {
  // Walk back to the statement start: an import can span many lines when the braces do.
  for (let i = lineNo - 1; i >= 0 && i > lineNo - 30; i--) {
    const t = fileLines[i].trim();
    if (t.startsWith('import ')) {
      for (let j = i; j <= lineNo - 1 + 30 && j < fileLines.length; j++) {
        if (fileLines[j].includes("from '") || fileLines[j].includes('from "')) return j >= lineNo - 1;
      }
      return false;
    }
    // A non-continuation line before reaching an `import` means we are in ordinary code.
    if (t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') &&
        !t.includes('}') && !t.includes(',')) return false;
  }
  return false;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let out = '';
  try {
    execSync('npx tsc --noEmit --noUnusedLocals', { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { out = e.stdout || ''; }

  const cache = new Map();
  const offenders = [];

  // TS6133 — ONE binding unused. Only counts when the line is part of an import statement.
  for (const m of out.matchAll(/^(.+?)\((\d+),(\d+)\): error TS6133: '([^']+)' is declared but its value is never read\./gm)) {
    const [, file, line, , name] = m;
    if (!cache.has(file)) {
      try { cache.set(file, readFileSync(file, 'utf8').split('\n')); } catch { cache.set(file, []); }
    }
    if (isImportLine(cache.get(file), Number(line))) offenders.push(`${file}:${line}  ${name}`);
  }

  // Unused LOCALS (not imports): TS6133 off an import line, TS6196 (an unused type or interface) and
  // TS6198 (every element of a destructuring unused). Counted per file for the ratchet below.
  const localCounts = {};
  const countLocal = (file) => { localCounts[file] = (localCounts[file] ?? 0) + 1; };
  for (const m of out.matchAll(/^(.+?)\((\d+),(\d+)\): error TS6133: /gm)) {
    const [, file, line] = m;
    if (!cache.has(file)) {
      try { cache.set(file, readFileSync(file, 'utf8').split('\n')); } catch { cache.set(file, []); }
    }
    if (!isImportLine(cache.get(file), Number(line))) countLocal(file);
  }
  for (const m of out.matchAll(/^(.+?)\((\d+),(\d+)\): error TS(6196|6198): /gm)) countLocal(m[1]);

  // TS6192 — EVERY binding in the declaration is unused. Always an import by definition, so no
  // line-shape check applies. See the header: omitting this let seven whole declarations through.
  for (const m of out.matchAll(/^(.+?)\((\d+),(\d+)\): error TS6192: All imports in import declaration are unused\./gm)) {
    const [, file, line] = m;
    offenders.push(`${file}:${line}  (entire import declaration)`);
  }

  let baseline = null;
  try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { /* no baseline file yet */ }
  const writeBaseline = () => {
    const sorted = Object.fromEntries(Object.entries(localCounts).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  };
  // The ONE way to record counts above the baseline is to create it — never to raise an existing one.
  if (baseline === null && process.argv.includes('--update-baseline')) {
    writeBaseline();
    console.log(`✅ ${BASELINE} created with the current counts.`);
    baseline = { ...localCounts };
  }
  const { grown, shrunk } = compareUnusedLocals(localCounts, baseline ?? {});
  let ratchetFailed = false;
  if (grown.length) {
    ratchetFailed = true;
    console.error(`\n❌ New unused local(s) — a value set and never read, or a handler never wired:\n`);
    for (const g of grown) console.error(`   ${g.file}: ${g.was} → ${g.now}`);
    console.error('\nRun `npx tsc --noEmit --noUnusedLocals` to see them. Wire it up or remove it.\n');
  } else if (shrunk.length && process.argv.includes('--update-baseline')) {
    writeBaseline();
    console.log(`✅ ${BASELINE} lowered to the current counts.`);
  } else if (shrunk.length) {
    ratchetFailed = true;
    console.error(`\n❌ Unused locals went DOWN — lock it in so they cannot come back:\n`);
    for (const s of shrunk) console.error(`   ${s.file}: ${s.was} → ${s.now}`);
    console.error('\nRun `node scripts/noUnusedImports.mjs --update-baseline` and commit the baseline.\n');
  }

  if (offenders.length) {
    console.error(`\n❌ ${offenders.length} unused import binding(s) — remove them:\n`);
    for (const o of offenders) console.error('   ' + o);
    console.error('\nAn unused import still ships: it keeps its whole module on the load path.\n');
    process.exit(1);
  }
  if (ratchetFailed) process.exit(1);
  console.log('✅ No unused imports, and no new unused locals.');
}
