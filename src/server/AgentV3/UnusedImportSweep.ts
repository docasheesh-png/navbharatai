// AgentV3 — FIRST-BUILD-CORRECT: strip provably-unused NAMED imports (prevent-not-heal, admin 2026-07-31).
//
// WHY: across many real reports the engine burned a whole "continue / fix the error" ROUND removing its
// OWN unused imports (Suspense, useAuth, useEffect, `User` from lucide-react …) after the reviewer flagged
// them. The app worked the whole time (an unused import is harmless at runtime) — it was pure wasted effort
// on cosmetics. This deterministic FINAL-PASS sweep removes those genuinely-dead named imports before the
// reviewer ever sees them, so no round is wasted and the delivered app ships clean.
//
// SAFE BY CONSTRUCTION (rule 1 — never break the app): it removes a NAMED import specifier ONLY when its
// local binding appears NOWHERE ELSE in the file (word-boundary), keep-on-ANY-doubt. It NEVER touches:
//   • side-effect imports (`import './styles.css'`) — no binding to judge;
//   • namespace imports (`import * as X`)          — may be used dynamically;
//   • default imports (`import React from 'react'`) — the risky JSX/implicit case is left alone;
//   • a specifier whose name appears anywhere else (JSX, a type position, code — even a comment/string →
//     safe false-negative: we KEEP it).
// So a USED import can never be removed; the worst case is leaving a truly-dead import (today's status quo).
// Pure + total; never throws.

const JS_TS = /\.(mjs|cjs|jsx?|tsx?)$/i;
const DECL = /\.d\.ts$/i;

export function importSweepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_IMPORT_SWEEP ?? '').trim().toLowerCase() !== 'off';
}

/** Escape a binding name for use inside a RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The LOCAL binding name of a named specifier: `Foo` → Foo; `Foo as Bar` → Bar; `type Foo as Bar` → Bar. */
function localName(specifier: string): string | null {
  const s = specifier.trim().replace(/^type\s+/, ''); // a `type`-only specifier still binds a local name
  if (!s) return null;
  const asMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(s);
  if (asMatch) return asMatch[2];
  return /^[A-Za-z_$][\w$]*$/.test(s) ? s : null;
}

// One import statement: `import <clause> from '<mod>';`  (clause = default and/or `{ named }` and/or `* as X`).
// Multiline-tolerant for the braces group. We only ever rewrite the `{ … }` part.
const IMPORT_RE = /^([ \t]*import\s+)([\s\S]*?)(\s+from\s+["'][^"']+["']\s*;?)[ \t]*$/gm;

/**
 * Remove provably-unused NAMED import specifiers from one JS/TS/JSX/TSX file. Returns the cleaned content
 * (unchanged when nothing is safely removable, or the file isn't a parseable source). Pure; never throws.
 */
export function stripUnusedNamedImports(path: string, content: string): string {
  if (!JS_TS.test(path) || DECL.test(path) || typeof content !== 'string' || !content.includes('import')) {
    return content;
  }
  try {
    return content.replace(IMPORT_RE, (whole, head: string, clause: string, tail: string) => {
      const braceMatch = /\{([\s\S]*?)\}/.exec(clause);
      if (!braceMatch) return whole;                 // no named group (default-only, `* as`, side-effect) → untouched
      let before = clause.slice(0, braceMatch.index);     // a leading default binding (e.g. `Def, `)
      // `import type { … }` — the `type` is a type-only MODIFIER on the whole import, NOT a default
      // binding. Peel it off so it is preserved as a prefix and never rebuilt as `type, { … }`, which is
      // a syntax error that corrupts a working app (confirmed: `import type { Props, Unused }` →
      // `import type, { Props }`; `import type {` appears in 390 files in this repo alone, and
      // findSyntaxErrors parses the broken output fine so nothing catches it — admin audit 2026-08-12).
      let typeModifier = '';
      if (/^\s*type\s+$/.test(before)) { typeModifier = 'type '; before = ''; }
      const inner = braceMatch[1];
      const after = clause.slice(braceMatch.index + braceMatch[0].length);
      const specs = inner.split(',').map((s) => s.trim()).filter(Boolean);
      if (specs.length === 0) return whole;

      // "The rest of the file" = everything EXCEPT this import statement (so a name only present here is dead).
      const rest = content.slice(0, content.indexOf(whole)) + content.slice(content.indexOf(whole) + whole.length);
      const kept = specs.filter((spec) => {
        const name = localName(spec);
        if (!name) return true;                      // unparseable specifier → keep (safe)
        return new RegExp(`\\b${esc(name)}\\b`).test(rest); // used elsewhere → keep; nowhere else → drop
      });
      if (kept.length === specs.length) return whole; // nothing removable

      const defaultPart = before.replace(/,\s*$/, '').trim(); // `Def` (already excludes the braces)
      if (kept.length > 0) {
        const named = `{ ${kept.join(', ')} }`;
        const newClause = defaultPart ? `${defaultPart}, ${named}` : named;
        return `${head}${typeModifier}${newClause}${after}${tail}`;
      }
      // Every named specifier was unused.
      if (defaultPart) return `${head}${defaultPart}${after}${tail}`; // keep the default binding
      return '';                                       // pure named import, all dead → drop the whole statement
    }).replace(/^\n/, '').replace(/\n{3,}/g, '\n\n');  // tidy a blank line left by a dropped import
  } catch {
    return content;                                    // best-effort — never break a build
  }
}

/**
 * Apply the sweep across a set of files, returning ONLY the ones that actually changed (path → cleaned
 * content). Skips non-source files. Pure; never throws. The caller persists the changed files.
 */
export function sweepUnusedImports(files: Record<string, string>): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    try {
      const next = stripUnusedNamedImports(path, content);
      if (next !== content) changed[path] = next;
    } catch { /* per-file best-effort */ }
  }
  return changed;
}
