#!/usr/bin/env node
/**
 * THE SHEET CONTRACT CENSUS — which dialogs reserve the app's own chrome, and which do not.
 *
 * `index.css` defines the contract: `nb-sheet-overlay` / `nb-sheet-overlay-flush` on the fixed
 * backdrop subtract the three things a dialog cannot see for itself — the browser toolbar (`dvh`),
 * the device notch and home indicator (`env()`), and the app's own bottom tab bar
 * (`--nb-bottom-nav`, which is `fixed bottom-0` at z-150 and paints over everything below it).
 * `nb-sheet` / `nb-sheet-partial` on the card cap it at the room the overlay really has.
 *
 * A dialog that skips the contract is cropped by the header, the notch or the tab bar the moment its
 * content is long enough — which for a list or a scrolling form is the ordinary case.
 *
 * This prints the dialogs that do NOT carry it. `--write` records the count per file as a BASELINE,
 * and `tests/everyPopupClearsTheChrome.test.ts` fails if any file goes ABOVE its number. The number
 * only ever goes down — the theme-colour ratchet's own pattern, for the same reason: a hard failure
 * on all of them at once would be red on day one and switched off within a week.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

export const BASELINE = 'tests/fixtures/sheetContractBaseline.json';

/** Every `fixed inset-0` element that LAYS OUT a card — a bare click-catcher has no card to crop. */
export function scanDialogs(root = process.cwd()) {
  const files = execSync(
    "grep -rl 'fixed inset-0' src --include=*.tsx | grep -v '/server/' | grep -v '\\.test\\.'",
    { cwd: root, encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);

  const out = [];
  for (const f of files) {
    const lines = readFileSync(resolve(root, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = /className=(?:\{[`"]|["`])([^"`]*fixed inset-0[^"`]*)/.exec(line);
      if (!m) return;
      const cls = m[1];
      const laysOut = /\bflex\b/.test(cls) && /(items-center|items-end|justify-center)/.test(cls);
      const ariaHidden = /aria-hidden/.test(line) || /aria-hidden/.test(lines[i + 1] ?? '');
      if (!laysOut || ariaHidden) return;
      const hasContract = /nb-sheet-overlay/.test(cls);
      // 🔴 A `p-*` utility on the SAME element cancels the contract silently: Tailwind emits
      // utilities after components and both are one class of specificity, so the utility wins on
      // source order and every reserve becomes whatever it says. A RESPONSIVE variant (`sm:p-4`) is
      // fine — at that width the bar is not rendered and the insets are zero.
      const cancelling = cls.split(/\s+/).filter((t) => /^p[trblxy]?-/.test(t));
      out.push({ file: f, line: i + 1, hasContract, cancelling });
    });
  }
  return out;
}

const dialogs = scanDialogs();
const missing = dialogs.filter((d) => !d.hasContract);
const cancelled = dialogs.filter((d) => d.hasContract && d.cancelling.length > 0);

if (process.argv.includes('--write')) {
  const counts = {};
  for (const d of missing) counts[d.file] = (counts[d.file] ?? 0) + 1;
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  console.log(`sheetContractBaseline: ${missing.length} dialogs without the contract across ${Object.keys(counts).length} files → ${BASELINE}`);
} else {
  console.log(`${dialogs.length} dialogs · ${dialogs.length - missing.length} carry the contract · ${missing.length} do not`);
  for (const d of missing) console.log(`  – ${d.file}:${d.line}`);
  if (cancelled.length) {
    console.log(`\n🔴 CARRY IT BUT CANCEL IT WITH A PADDING UTILITY (${cancelled.length}):`);
    for (const d of cancelled) console.log(`  – ${d.file}:${d.line}  ${d.cancelling.join(' ')}`);
  }
}
