// QUEUE Q-322: A REGEX WITH A LOOKBEHIND IN THE WEB BUNDLE BREAKS ITS SCREEN ON iOS 15 – 16.3.
//
// Safari learned lookbehind (`(?<=…)`, `(?<!…)`) in 16.4. Our build targets `safari14`, and the
// phone app runs on iOS 15 (Capacitor 8's minimum). Vite does not rewrite a lookbehind: it turns the
// literal into a `RegExp(...)` call so the file still PARSES, and the call then THROWS when it runs —
// at module load for a top-level regex, which takes the whole screen down with it.
//
// So the question is asked of the BUILT bundle, not of `src/`: a server module imported by the client
// (`imagePeople.ts`, `pollinationsGuard.ts`) is client code too, and so is a library. Every regex
// literal and every `RegExp`/`new RegExp` call whose pattern is a string or template is read with the
// TypeScript parser — text that merely mentions `(?<=` (a regex engine's own parser) is not a regex.
//
// Runs in CI after `vite build`, as part of `npm run test:bundle`. The pure `findLookbehinds()` is
// unit-tested in tests/noLookbehindInBundle.test.ts.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const LOOKBEHIND = /\(\?<[=!]/;

/**
 * Library code we cannot rewrite, each with the reason it is safe. A NEW entry needs the same:
 * evidence that the regex is never constructed on the affected browsers, or that its failure is caught.
 */
export const ALLOWED = [];

/** Every regex in `source` whose pattern contains a lookbehind: `{ pattern, offset }`. Pure. */
export function findLookbehinds(source) {
  const sf = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const found = [];
  const textOf = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join('${…}');
    return null;
  };
  const visit = (n) => {
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const lit = n.getText(sf);
      const pattern = lit.slice(1, lit.lastIndexOf('/'));
      if (LOOKBEHIND.test(pattern)) found.push({ pattern, offset: n.getStart(sf) });
    } else if ((ts.isCallExpression(n) || ts.isNewExpression(n))
      && ts.isIdentifier(n.expression) && n.expression.text === 'RegExp' && n.arguments?.length) {
      const pattern = textOf(n.arguments[0]);
      if (pattern !== null && LOOKBEHIND.test(pattern)) found.push({ pattern, offset: n.getStart(sf) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function main() {
  const dir = join(process.cwd(), 'dist', 'assets');
  if (!existsSync(dir)) {
    console.error('[noLookbehindInBundle] dist/assets not found — run `vite build` first.');
    process.exit(1);
  }
  const bad = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    if (!LOOKBEHIND.test(source)) continue;
    for (const hit of findLookbehinds(source)) {
      if (ALLOWED.some((a) => hit.pattern.includes(a.pattern))) continue;
      bad.push(`${file}: /${hit.pattern.slice(0, 100)}/`);
    }
  }
  if (bad.length) {
    console.error(`[noLookbehindInBundle] FAIL — ${bad.length} regex(es) with a lookbehind reach the web bundle.`);
    console.error('Safari before 16.4 (iOS 15 – 16.3) throws on these, taking their screen down. Rewrite each with a');
    console.error('consuming start, e.g. `(?:^|[^\\d])(…)` and read the capture group:');
    for (const b of bad) console.error(`  ${b}`);
    process.exit(1);
  }
  console.log('[noLookbehindInBundle] PASS — no lookbehind in the web bundle.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
