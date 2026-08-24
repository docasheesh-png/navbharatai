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
 * When the ~122 locals are cleaned up, delete this script and set `noUnusedLocals: true` in
 * tsconfig.json instead — one compiler flag beats a bespoke gate.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
  for (const m of out.matchAll(/^(.+?)\((\d+),(\d+)\): error TS6133: '([^']+)' is declared but its value is never read\./gm)) {
    const [, file, line, , name] = m;
    if (!cache.has(file)) {
      try { cache.set(file, readFileSync(file, 'utf8').split('\n')); } catch { cache.set(file, []); }
    }
    if (isImportLine(cache.get(file), Number(line))) offenders.push(`${file}:${line}  ${name}`);
  }

  if (offenders.length) {
    console.error(`\n❌ ${offenders.length} unused import binding(s) — remove them:\n`);
    for (const o of offenders) console.error('   ' + o);
    console.error('\nAn unused import still ships: it keeps its whole module on the load path.\n');
    process.exit(1);
  }
  console.log('✅ No unused imports.');
}
