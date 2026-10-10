// AgentV3 — ENDGAME REPAIR (QuizArena autopsy 2026-07-17, admin-mandated Slice 1).
//
// THE FAILURE THIS KILLS: the agentic builder ground the last ~10 TypeScript errors ONE per
// round-trip (read → edit → tsc ≈ 4-5 steps each) until "Step limit reached (80)" — and a
// 13-minute build shipped NOT-ready over errors that were almost all MECHANICAL (an unused
// import, a missing `FormEvent` import, an export-name mismatch). The admin's mandate: stop
// paying an LLM to do grep's job.
//
// TWO LAYERS, cheapest first:
//   1. DETERMINISTIC — parse `tsc --noEmit` output and fix the mechanical classes in pure code:
//      • TS6133/TS6192 unused IMPORT → remove exactly that specifier (only import lines; deleting
//        other "unused" code deterministically is unsafe, so it is left to layer 2).
//      • import/export drift → the SAME proven reconcilers the fast lane uses
//        (reconcileImportExports / addMissingProjectImports / fixWrongSourceImports), run over the
//        FULL workspace map. Zero LLM calls, zero steps, milliseconds.
//   2. ONE BATCH LLM CALL — every REMAINING error in a single repair prompt over only the offending
//      files (the fast lane's repair shape) instead of one error per agent round-trip.
//
// PURE core (parse + unused-import removal + orchestration over injected I/O) so every piece is
// unit-testable with the real QuizArena error text. The dispatcher/runner supply sandbox I/O and
// the single LLM call. Kill switch: AGENTV3_ENDGAME_REPAIR=off.

import { reconcileImportExports, addMissingProjectImports, fixWrongSourceImports } from './ImportExportReconcile';
import { tscErrorCauses, tscCauseNote } from './tscErrorCause';
import { tscNeverRan } from './TscGate';
import { reactNamespaceValueUse } from './PostEditReviewer';

export interface TscError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

// The cause analysis is imported AFTER TscError is declared above — tscErrorCause.ts imports the type
// from here, so this pairing is type-only in one direction and value-only in the other (no cycle at runtime).
/** Parse `tsc --noEmit` output lines like `src/x.ts(12,5): error TS6133: 'y' is declared …`. Pure. */
export function parseTscErrors(output: string): TscError[] {
  const out: TscError[] = [];
  const re = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output || '')) !== null) {
    out.push({ file: m[1].trim(), line: Number(m[2]), col: Number(m[3]), code: m[4], message: m[5].trim() });
  }
  return out;
}

/**
 * TS1361 — a VALUE imported with `import type` (an enum, a class, a function). The fix has exactly one
 * correct form: move that one name into a value import from the same module. Pure.
 *
 * 🔴 AUTOPSY b47c56d8 (2026-09-30): the ONLY compile error in a Next.js build was
 * `src/ThemeToggle.tsx(4,27): error TS1361: 'ThemeMode' cannot be used as a value because it was imported
 * using 'import type'` — the shared contract declared `ThemeMode` as an enum and one file imported it as a
 * type. No deterministic pass knew the code, so it went to a model: two reasoning rungs spent 350 s thinking
 * and returned nothing, and the repair loop took 763 s of a 926 s lane. It is a string edit.
 *
 * Acts only when the name appears in exactly ONE import of that file, as a plain or aliased specifier —
 * anything it cannot match with certainty is left to the model, as before.
 */
export function fixTypeOnlyValueImports(
  files: Record<string, string>,
  errors: TscError[],
): { files: Record<string, string>; fixed: string[] } {
  const fixed: string[] = [];
  const out = { ...files };
  for (const e of errors) {
    if (e.code !== 'TS1361') continue;
    const name = /^'([A-Za-z_$][\w$]*)' cannot be used as a value because it was imported using 'import type'/.exec(e.message)?.[1];
    const src = out[e.file];
    if (!name || typeof src !== 'string') continue;
    const specRe = new RegExp(`^(?:type\\s+)?(?:[A-Za-z_$][\\w$]*\\s+as\\s+)?${name.replace(/\$/g, '\\$')}$`);
    const stmts = [...src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*(['"][^'"]+['"])\s*;?/g)]
      .filter((m) => m[2].split(',').some((sp) => specRe.test(sp.trim())));
    if (stmts.length !== 1) continue;
    const m = stmts[0];
    const specs = m[2].split(',').map((sp) => sp.trim()).filter(Boolean);
    const target = specs.find((sp) => specRe.test(sp))!;
    const valueSpec = target.replace(/^type\s+/, '');
    let replacement: string;
    if (m[1]) {
      // `import type { A, X } from 'm'` → keep the types, import X as a value.
      const rest = specs.filter((sp) => sp !== target);
      replacement = rest.length
        ? `import type { ${rest.join(', ')} } from ${m[3]};\nimport { ${valueSpec} } from ${m[3]};`
        : `import { ${valueSpec} } from ${m[3]};`;
    } else if (target !== valueSpec) {
      // `import { type X, B } from 'm'` → drop the inline `type` modifier on X only.
      replacement = `import { ${specs.map((sp) => (sp === target ? valueSpec : sp)).join(', ')} } from ${m[3]};`;
    } else {
      continue; // already a value import — this is not the shape TS1361 describes; leave it to the model
    }
    out[e.file] = src.slice(0, m.index!) + replacement + src.slice(m.index! + m[0].length);
    fixed.push(`${e.file}: imported '${name}' as a value (it was imported with 'import type')`);
  }
  return { files: out, fixed };
}

/**
 * TS2865 — `Import 'X' conflicts with local value, so must be declared with a type-only import when
 * 'isolatedModules' is enabled.` The file imports the TYPE `X` and declares a value (usually the component)
 * named `X`. tsc names the fix, and it has one form: mark that specifier `type`. A type-only import and a
 * value of the same name coexist (verified against tsc, 2026-09-30). Pure.
 *
 * 🔴 BUILD 9762f589 (2026-09-30): `src/components/CitySummary.tsx` imported `interface CitySummary` and declared
 * `const CitySummary`. No deterministic pass knew the code, so a model repair was sent — it turned the import
 * into a self-import (`from './CitySummary'`), and the error survived all three passes.
 *
 * Acts only when the name is a plain specifier of exactly ONE named import in that file.
 */
export function fixTypeImportValueClash(
  files: Record<string, string>,
  errors: TscError[],
): { files: Record<string, string>; fixed: string[] } {
  const fixed: string[] = [];
  const out = { ...files };
  for (const e of errors) {
    if (e.code !== 'TS2865') continue;
    const name = /^Import '([A-Za-z_$][\w$]*)' conflicts with local value/.exec(e.message)?.[1];
    const src = out[e.file];
    if (!name || typeof src !== 'string') continue;
    const esc = name.replace(/\$/g, '\\$');
    const plain = new RegExp(`^${esc}$`);
    const stmts = [...src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*(['"][^'"]+['"])\s*;?/g)]
      .filter((m) => !m[1] && m[2].split(',').some((sp) => plain.test(sp.trim())));
    if (stmts.length !== 1) continue;
    const m = stmts[0];
    const specs = m[2].split(',').map((sp) => sp.trim()).filter(Boolean);
    const replacement = specs.length === 1
      ? `import type { ${name} } from ${m[3]};`
      : `import { ${specs.map((sp) => (plain.test(sp) ? `type ${sp}` : sp)).join(', ')} } from ${m[3]};`;
    out[e.file] = src.slice(0, m.index!) + replacement + src.slice(m.index! + m[0].length);
    fixed.push(`${e.file}: imported '${name}' as a type (a value of the same name is declared in the file)`);
  }
  return { files: out, fixed };
}

/**
 * The property renames tsc itself proposes — TS2551 (`Property 'x' does not exist on type 'T'. Did you
 * mean 'y'?`) and TS2561 (`… but 'x' does not exist in type 'T'. Did you mean to write 'y'?`). PURE.
 *
 * Only PROPERTY suggestions: tsc makes one only when `y` is a real member of `T` within a small edit
 * distance, so the rename is the type's own spelling. TS2552 (`Cannot find name 'X'. Did you mean 'x'?`)
 * is deliberately NOT here — autopsy a5b661c8's was `CollectionScene` → `collection`, where the real fix
 * was a missing import, and following the suggestion would have broken the file further.
 */
export function suggestedPropertyRenames(errors: TscError[]): Array<{ file: string; line: number; col: number; from: string; to: string }> {
  const out: Array<{ file: string; line: number; col: number; from: string; to: string }> = [];
  for (const e of errors) {
    if (e.code !== 'TS2551' && e.code !== 'TS2561') continue;
    const m = /'([A-Za-z_$][\w$]*)' does not exist (?:on|in) type [\s\S]*?Did you mean (?:to write )?'([A-Za-z_$][\w$]*)'\?/.exec(e.message);
    if (m && m[1] !== m[2]) out.push({ file: e.file, line: e.line, col: e.col, from: m[1], to: m[2] });
  }
  return out;
}

/**
 * Apply tsc's own property renames, at the exact line and column it names. PURE.
 *
 * 🔴 AUTOPSY a5b661c8 (2026-09-30): `PostStep.tsx` used `scheduledDate` where the shared `Campaign` type
 * says `scheduledAt`, at two places. tsc said so, with the right name, at both — and the file was edited
 * five times, one occurrence per turn. The token at the reported position must BE the misspelled name,
 * or nothing is touched: a stale position, a moved line or a shadowing local is left to the model.
 */
export function fixSuggestedPropertyNames(
  files: Record<string, string>,
  errors: TscError[],
): { files: Record<string, string>; fixed: string[] } {
  const fixed: string[] = [];
  const out = { ...files };
  // Right-to-left within a line, so an earlier fix never shifts a later column.
  const renames = suggestedPropertyRenames(errors).sort((a, b) => (a.file === b.file ? (a.line === b.line ? b.col - a.col : a.line - b.line) : a.file.localeCompare(b.file)));
  for (const r of renames) {
    const src = out[r.file];
    if (typeof src !== 'string') continue;
    const lines = src.split('\n');
    const text = lines[r.line - 1];
    if (text === undefined) continue;
    const at = r.col - 1;
    if (text.slice(at, at + r.from.length) !== r.from || /[\w$]/.test(text[at + r.from.length] ?? '') || /[\w$]/.test(text[at - 1] ?? '')) continue;
    lines[r.line - 1] = text.slice(0, at) + r.to + text.slice(at + r.from.length);
    out[r.file] = lines.join('\n');
    fixed.push(`${r.file}:${r.line}: renamed '${r.from}' to '${r.to}' (the type's own spelling, as tsc suggested)`);
  }
  return { files: out, fixed };
}

/** The error codes the deterministic layer addresses (everything else goes to the batch LLM call). */
const UNUSED_CODES = new Set(['TS6133', 'TS6192', 'TS6196']);

/**
 * Remove UNUSED IMPORT bindings named by TS6133/TS6192/TS6196 errors. Only import lines are touched:
 * the named specifier is removed from its list; a list/line left empty is dropped entirely (side-effect
 * imports like `import './index.css'` are never targeted by these codes, so they survive). Pure.
 */
export function removeUnusedImports(
  files: Record<string, string>,
  errors: TscError[],
): { files: Record<string, string>; removed: string[] } {
  const removed: string[] = [];
  const out = { ...files };
  for (const err of errors) {
    if (!UNUSED_CODES.has(err.code)) continue;
    const src = out[err.file];
    if (typeof src !== 'string') continue;
    const name = /'([^']+)'/.exec(err.message)?.[1];
    if (!name) continue;
    const lines = src.split('\n');
    const idx = err.line - 1;
    const line = lines[idx];
    if (typeof line !== 'string' || !/^\s*import\b/.test(line)) continue; // ONLY import lines
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let next = line
      // named specifier with optional alias, and a neighbouring comma on either side
      .replace(new RegExp(`\\{([^}]*)\\}`), (_all, inner: string) => {
        const kept = inner
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s && s !== name && !new RegExp(`^${esc}\\s+as\\s+`).test(s) && !new RegExp(`\\s+as\\s+${esc}$`).test(s));
        return `{ ${kept.join(', ')} }`;
      })
      // default import (`import Name from` / `import Name, {…} from`)
      .replace(new RegExp(`^(\\s*import\\s+(?:type\\s+)?)${esc}\\s*,\\s*`), '$1')
      .replace(new RegExp(`^(\\s*import\\s+(?:type\\s+)?)${esc}\\s+from`), '$1{ } from');
    if (next === line) continue; // nothing matched — leave for the LLM layer
    // A now-empty binding (`import { } from 'x'` / `import type { } from 'x'`) → drop the whole line.
    if (/^\s*import\s+(type\s+)?\{\s*\}\s+from/.test(next)) {
      lines.splice(idx, 1);
    } else {
      lines[idx] = next;
    }
    out[err.file] = lines.join('\n');
    removed.push(`${err.file}: removed unused import '${name}'`);
  }
  return { files: out, removed };
}

/**
 * TS2686 `'React' refers to a UMD global, but the current file is a module` — the file uses `React.x` and
 * never imports React (autopsy a9f8d186: five of these on one App.tsx rewritten by a model repair). The fix
 * is one line and has exactly one right form: add the default React import, beside a named `react` import
 * when there is one. A file whose own code already binds `React` otherwise is left alone. Pure.
 */
/** Add the React default import (beside a named `react` import when there is one). Pure. */
function withReactImport(src: string): string {
  if (/\bimport\s+(?:\*\s+as\s+)?React\b/.test(src)) return src; // React is already imported
  const named = /^(\s*)import\s+(\{[^}]*\})\s+from\s+(['"])react\3\s*;?/m;
  return named.test(src)
    ? src.replace(named, (_m, lead: string, braces: string, q: string) => `${lead}import React, ${braces} from ${q}react${q};`)
    : `import React from 'react';\n${src}`;
}

/**
 * The same fix BEFORE any compiler runs, for a file a lane writes without a tool loop to read the
 * write-time note (autopsy d382b398): the fast lane wrote a hook with nine `React.useCallback` /
 * `React.useState` calls and no import, handed it off before its verify step, and the full builder
 * spent three edits and two typechecks putting the import back. Only a VALUE use counts
 * (`reactNamespaceValueUse`) — `React.FC` in a type needs nothing — and only a script file. Pure.
 */
export function ensureReactValueImport(path: string, content: string): string {
  if (!/\.(?:tsx|ts|jsx|js)$/i.test(String(path ?? '')) || /\.d\.ts$/i.test(path)) return content;
  if (typeof content !== 'string' || !reactNamespaceValueUse(content)) return content;
  return withReactImport(content);
}

export function fixReactUmdGlobal(
  files: Record<string, string>,
  errors: TscError[],
): { files: Record<string, string>; fixed: string[] } {
  const out = { ...files };
  const fixed: string[] = [];
  const targets = new Set(errors.filter((e) => e.code === 'TS2686' && /'React'/.test(e.message)).map((e) => e.file));
  for (const file of targets) {
    const src = out[file];
    if (typeof src !== 'string') continue;
    const next = withReactImport(src);
    if (next !== src) {
      out[file] = next;
      fixed.push(`${file}: added the missing React import`);
    }
  }
  return { files: out, fixed };
}

export interface EndgameDeterministicResult {
  files: Record<string, string>;
  /** Human-readable fix descriptions, in application order. */
  fixes: string[];
  /** Paths whose content changed. */
  changedPaths: string[];
}

/**
 * The full deterministic layer: unused-import removal (guided by the tsc errors) followed by the three
 * proven import/export reconcilers over the WHOLE map. Best-effort — a reconciler throw skips only
 * that reconciler. Returns the updated map + honest fix list.
 */
/**
 * The names the compiler reported as undefined — TS2304 "Cannot find name 'X'". Exactly these, and only
 * these, may be imported from an installed package on the package's own word (Q-115). PURE.
 */
export function unresolvedNames(errors: TscError[]): string[] {
  const out = new Set<string>();
  for (const e of errors) {
    if (e.code !== 'TS2304') continue;
    const m = /^Cannot find name '([A-Za-z_$][\w$]*)'/.exec(e.message);
    if (m) out.add(m[1]);
  }
  return [...out];
}

export async function endgameDeterministicPass(
  files: Record<string, string>,
  errors: TscError[],
  installedExports?: Record<string, readonly string[]>,
): Promise<EndgameDeterministicResult> {
  const fixes: string[] = [];
  let cur = files;
  const typeOnly = fixTypeOnlyValueImports(cur, errors);
  cur = typeOnly.files;
  fixes.push(...typeOnly.fixed);
  const clash = fixTypeImportValueClash(cur, errors);
  cur = clash.files;
  fixes.push(...clash.fixed);
  const renamed = fixSuggestedPropertyNames(cur, errors);
  cur = renamed.files;
  fixes.push(...renamed.fixed);
  const react = fixReactUmdGlobal(cur, errors);
  cur = react.files;
  fixes.push(...react.fixed);
  const unused = removeUnusedImports(cur, errors);
  cur = unused.files;
  fixes.push(...unused.removed);
  try {
    const r = await reconcileImportExports(cur);
    cur = r.files;
    fixes.push(...r.fixes.map((f) => `${f.file}: ${f.kind} '${f.name}' from '${f.from}'`));
  } catch { /* best-effort */ }
  try {
    const a = await addMissingProjectImports(cur, { installedExports, unresolvedNames: unresolvedNames(errors) });
    cur = a.files;
    fixes.push(...a.added.map((f) => `${f.file}: added missing import '${f.name}' from '${f.from}'`));
  } catch { /* best-effort */ }
  try {
    const w = await fixWrongSourceImports(cur);
    cur = w.files;
    fixes.push(...w.fixes.map((f) => `${f.file}: re-pointed '${f.name}' to '${f.from}'`));
  } catch { /* best-effort */ }
  const changedPaths = Object.keys(cur).filter((p) => cur[p] !== files[p]);
  return { files: cur, fixes, changedPaths };
}

/** Default ON — the endgame only ever runs on a build that is ALREADY failing, so it can only help. */
export function endgameRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_ENDGAME_REPAIR ?? '').trim().toLowerCase() !== 'off';
}

/** The offending-file subset for the batch LLM call (bounded so the prompt stays sane). */
export function offendingFileSubset(
  files: Record<string, string>,
  errors: TscError[],
  maxFiles = 12,
): Array<{ path: string; content: string }> {
  const paths: string[] = [];
  for (const e of errors) if (files[e.file] !== undefined && !paths.includes(e.file)) paths.push(e.file);
  return paths.slice(0, maxFiles).map((path) => ({ path, content: files[path] }));
}

export interface EndgameIo {
  /** Run `tsc --noEmit` in the sandbox and return its combined output ('' = clean). */
  runTsc(): Promise<string>;
  /** Full project text-file map (durable/collected — the app the user actually runs). */
  readFiles(): Promise<Record<string, string>>;
  /** Persist one repaired file (sandbox + any mirrors the caller maintains). */
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Delete a file the repair CREATED (there was no previous content to restore). Absent → the created
   * file is left in place and named in the log; a repair must not pretend it can delete what it cannot.
   */
  removeFile?(path: string): Promise<void>;
  /**
   * ONE bounded batch repair call: all remaining error text + the offending files, returns corrected
   * files (fast-lane repair shape). Absent → deterministic-only endgame.
   */
  llmRepair?(errorText: string, files: Array<{ path: string; content: string }>): Promise<Array<{ path: string; content: string }>>;
  /**
   * Ask the INSTALLED packages which of these names they export (bare specifier → names). Absent, or a
   * failure, means no package import is added on a package's word — exactly the behaviour before Q-115.
   */
  installedExports?(names: string[]): Promise<Record<string, string[]>>;
  log?(msg: string): void;
}

export interface EndgameVerdict {
  attempted: boolean;
  /** tsc error count when the endgame started / after the deterministic layer / at the end. */
  errorsBefore: number;
  errorsAfterDeterministic: number;
  errorsAfter: number;
  deterministicFixes: string[];
  llmFilesWritten: number;
  clean: boolean;
  /**
   * The compiler did not finish a later run (timeout, crash, help page, missing binary). The counts
   * above are the last VERIFIED ones — never "0 errors" read off a run that did not happen.
   */
  tscUnverified?: boolean;
  /** True when the batch LLM repair INCREASED the error count and was rolled back (CrewHub 59→67). */
  llmReverted?: boolean;
  /**
   * Files the batch repair proposed at paths the project does not have and nothing imports — NOT
   * written (autopsy e706e068; see `resolveRepairTarget`). Omitted when there were none.
   */
  llmFilesRejected?: number;
}

const NO_ATTEMPT: EndgameVerdict = {
  attempted: false, errorsBefore: 0, errorsAfterDeterministic: 0, errorsAfter: 0,
  deterministicFixes: [], llmFilesWritten: 0, clean: true,
};

// === A REPAIR MAY FIX FILES; IT MAY NOT ADD STRAY ONES (autopsy e706e068, 2026-09-17) ============
//
// The School ERP build's real app lived under `src/` (`index.html → src/main.tsx → src/App.tsx`) and
// was rendering in a real browser. Three files then appeared at the ROOT of the project — `App.tsx`,
// `hooks/useStudents.ts`, `types/student.ts` — all timestamped inside the batch repair's window and
// named in none of the model's own tool calls. The batch call had been handed `src/App.tsx` and
// returned its corrected content under the path `App.tsx`: the `src/` prefix dropped in transit, and
// this loop wrote whatever path came back. Nothing imported the copies, `npm run build` never saw
// them, so the app kept working — while the readiness gate read the WHOLE tree, found an unresolved
// import and placeholder data in the strays, called the build "not ready", and made it free.
//
// The rule, stated once: the batch pass exists to REPAIR the files it was given. A returned path is
// written only when it is one of three things —
//   1. an EXISTING project file (the ordinary case);
//   2. a path that names exactly ONE existing file by its tail (`App.tsx` → `src/App.tsx`) — the
//      dropped-prefix case above, remapped to the file the model was actually repairing;
//   3. a path the erroring code already IMPORTS (a TS2307 "Cannot find module './x'" resolved from
//      the importing file) — the one kind of new file that can only ever be part of the app.
// Anything else is a stray: it is skipped, counted in `llmFilesRejected`, and named in the log.
// Rejecting is the safe direction — a fix that is not written costs one more repair round; a stray
// that is written costs the build its verdict.

/** Extensions a bare module specifier may resolve to, so `./x` matches `x.ts`, `x.tsx`, `x/index.ts`… */
const MODULE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function normalizeRel(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

/** Strip a code extension and a trailing `/index` so `src/a/index.tsx` and `src/a.ts` both key as `src/a`. */
function moduleKey(p: string): string {
  let k = normalizeRel(p);
  for (const ext of MODULE_EXTS) {
    if (k.endsWith(ext)) { k = k.slice(0, -ext.length); break; }
  }
  if (k.endsWith('/index')) k = k.slice(0, -'/index'.length);
  return k;
}

/**
 * The local modules the compile errors say are MISSING — `Cannot find module './components/X'`
 * (TS2307) resolved against the importing file. A new file at one of these paths is one the app
 * already imports, so creating it completes the app rather than littering it. Package specifiers
 * (`react`, `@x/y`) are not files and are ignored. Pure.
 */
export function referencedMissingModules(errors: TscError[]): Set<string> {
  const out = new Set<string>();
  for (const e of errors) {
    if (e.code !== 'TS2307') continue;
    const m = /Cannot find module '([^']+)'/.exec(e.message);
    if (!m) continue;
    const spec = m[1];
    if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
    const dir = e.file.includes('/') ? e.file.slice(0, e.file.lastIndexOf('/')) : '';
    out.add(moduleKey(dir ? `${dir}/${spec}` : spec));
  }
  return out;
}

export type RepairTargetHow = 'existing' | 'remapped' | 'referenced' | 'rejected';

/**
 * Where, if anywhere, a path returned by the batch repair may be written. Pure. See the block header
 * for the three admissible cases; everything else is `rejected` with `target: null`.
 */
export function resolveRepairTarget(
  path: string,
  files: Record<string, string>,
  referenced: Set<string>,
): { target: string | null; how: RepairTargetHow } {
  const p = normalizeRel(String(path ?? ''));
  if (!p) return { target: null, how: 'rejected' };
  if (files[p] !== undefined) return { target: p, how: 'existing' };
  const tail = `/${p}`;
  const matches = Object.keys(files).filter((k) => k.endsWith(tail));
  if (matches.length === 1) return { target: matches[0], how: 'remapped' };
  if (referenced.has(moduleKey(p))) return { target: p, how: 'referenced' };
  return { target: null, how: 'rejected' };
}

/** A later `tsc` either produced a real result or it did not. A throw is "did not", not "0 errors". */
async function tscChecked(io: EndgameIo): Promise<{ out: string; ran: boolean }> {
  try {
    const out = await io.runTsc();
    return { out: String(out ?? ''), ran: !tscNeverRan(out) };
  } catch {
    return { out: '', ran: false };
  }
}

/**
 * Put every touched path back. A string `prev` is the old file; `undefined` means the repair created
 * it, so it is removed (or logged, when the caller has no `removeFile`).
 */
async function rollbackTouched(
  io: EndgameIo,
  snapshot: Map<string, string | undefined>,
  files: Record<string, string>,
): Promise<void> {
  for (const [p, prev] of snapshot) {
    if (typeof prev === 'string') {
      try {
        await io.writeFile(p, prev);
        files[p] = prev;
      } catch { /* a failed restore is logged by the caller staying unverified */ }
    } else if (io.removeFile) {
      try { await io.removeFile(p); } catch { /* best-effort */ }
      delete files[p];
    } else {
      io.log?.(`cannot remove created file ${p} — removeFile is not available`);
      delete files[p];
    }
  }
}

function unverifiedVerdict(errorsBefore: number, deterministicFixes: string[] = []): EndgameVerdict {
  return {
    attempted: true,
    errorsBefore,
    errorsAfterDeterministic: errorsBefore,
    errorsAfter: errorsBefore,
    deterministicFixes,
    llmFilesWritten: 0,
    clean: false,
    tscUnverified: true,
  };
}

/**
 * Run the two-layer endgame over injected I/O. Never throws — any I/O failure returns the honest
 * partial verdict (the caller's NOT-ready outcome then stands unchanged).
 */
export async function runEndgameRepair(io: EndgameIo): Promise<EndgameVerdict> {
  try {
    const out1 = await io.runTsc();
    // A compiler that never ran (missing, a help page, a torn install — autopsy 120eb52f) is not
    // "already clean": nothing was checked, so nothing is claimed.
    if (tscNeverRan(out1)) return NO_ATTEMPT;
    const errors1 = parseTscErrors(out1);
    if (errors1.length === 0) return { ...NO_ATTEMPT, attempted: true }; // already clean — nothing to do
    io.log?.(`🔧 Endgame repair: ${errors1.length} compile error(s) left — fixing mechanically first…`);
    let files = await io.readFiles();
    const missing = unresolvedNames(errors1);
    const installed = missing.length > 0 && io.installedExports
      ? await io.installedExports(missing).catch(() => undefined)
      : undefined;
    const det = await endgameDeterministicPass(files, errors1, installed);
    // Snapshot BEFORE the writes. A later tsc that did not run, or a pass that increased the count,
    // puts these bytes back. A failed write is not a success and is not in the snapshot.
    const preDet = new Map<string, string | undefined>();
    const detWritten: string[] = [];
    for (const p of det.changedPaths) {
      if (!preDet.has(p)) preDet.set(p, files[p]);
      try {
        await io.writeFile(p, det.files[p]);
        files[p] = det.files[p];
        detWritten.push(p);
      } catch { /* a failed deterministic write is not counted and not rolled forward */ }
    }
    let deterministicFixes = detWritten.length > 0 ? det.fixes : [];
    const checked2 = detWritten.length > 0 ? await tscChecked(io) : { out: out1, ran: true };
    if (!checked2.ran) {
      await rollbackTouched(io, preDet, files);
      io.log?.('tsc did not complete after the deterministic pass — reverted those writes; types are NOT verified');
      return unverifiedVerdict(errors1.length);
    }
    let errors2 = parseTscErrors(checked2.out);
    if (detWritten.length > 0 && errors2.length > errors1.length) {
      await rollbackTouched(io, preDet, files);
      io.log?.('deterministic fixes made things worse — reverted');
      errors2 = errors1;
      deterministicFixes = [];
    }
    let llmFilesWritten = 0;
    let llmReverted = false;
    let llmFilesRejected = 0;
    let finalErrors = errors2;
    if (errors2.length > 0 && io.llmRepair) {
      io.log?.(`🔧 ${errors2.length} error(s) need real fixes — one batch repair pass…`);
      const subset = offendingFileSubset(files, errors2);
      const causes = tscCauseNote(tscErrorCauses(errors2, files));
      const fixed = (await io.llmRepair(out2Text(checked2.out, causes), subset).catch(() => [])) || [];
      const preRepair = new Map<string, string | undefined>();
      const referenced = referencedMissingModules(errors2);
      const rejected: string[] = [];
      for (const f of fixed) {
        if (!f?.path || typeof f.content !== 'string') continue;
        const where = resolveRepairTarget(f.path, files, referenced);
        if (!where.target) { rejected.push(f.path); continue; }
        const path = where.target;
        if (where.how === 'remapped') io.log?.(`↪️ The repair returned '${f.path}' — written to the file it was repairing, '${path}'.`);
        const existing = files[path];
        if (typeof existing === 'string' && existing.trim().length > 80 && f.content.trim().length < 10) continue;
        try {
          await io.writeFile(path, f.content);
        } catch {
          continue; // a rejected write is not a written file
        }
        if (!preRepair.has(path)) preRepair.set(path, existing);
        files[path] = f.content;
        llmFilesWritten++;
      }
      if (rejected.length > 0) {
        llmFilesRejected = rejected.length;
        io.log?.(`⚠️ The repair proposed ${rejected.length} file(s) at path(s) this project does not have and nothing imports (${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? ', …' : ''}) — not written: a repair may fix files, not add stray ones.`);
      }
      if (llmFilesWritten > 0) {
        const checkedFinal = await tscChecked(io);
        if (!checkedFinal.ran) {
          await rollbackTouched(io, preRepair, files);
          io.log?.('tsc did not complete after the batch repair — reverted those writes; types are NOT verified');
          return unverifiedVerdict(errors1.length, deterministicFixes);
        }
        finalErrors = parseTscErrors(checkedFinal.out);
        if (finalErrors.length > errors2.length) {
          await rollbackTouched(io, preRepair, files);
          io.log?.(`↩️ The batch repair increased the error count (${errors2.length} → ${finalErrors.length}) — reverted those files and kept the better state.`);
          finalErrors = errors2;
          llmFilesWritten = 0;
          llmReverted = true;
        }
      }
    }
    return {
      attempted: true,
      errorsBefore: errors1.length,
      errorsAfterDeterministic: errors2.length,
      errorsAfter: finalErrors.length,
      deterministicFixes,
      llmFilesWritten,
      clean: finalErrors.length === 0,
      ...(llmReverted ? { llmReverted } : {}),
      ...(llmFilesRejected > 0 ? { llmFilesRejected } : {}),
    };
  } catch {
    return NO_ATTEMPT; // endgame is best-effort — it must never worsen or hang a build
  }
}

/** The error text handed to the batch repair: the compiler output, then the cause note (may be ''). */
function out2Text(out: string, causes: string): string {
  return out + causes;
}

// === SLICE 2 — MID-BUILD ERROR-TREND CHECKPOINT (admin-mandated 2026-07-17) =======================
// The admin's alternative to "raise the cap to 800": every ~25 steps peek at the tsc error count.
// Two consecutive peeks with errors NOT decreasing = the builder is grinding, not converging — fire
// the SAME two-layer endgame repair immediately (once per run) instead of waiting for the step cap.

export interface ErrorTrendConfig {
  enabled: boolean;
  /** Steps between peeks (default 25; floor 5 so a misconfig can't hammer tsc every step). */
  interval: number;
}

export function errorTrendConfig(env: NodeJS.ProcessEnv = process.env): ErrorTrendConfig {
  const enabled = (env.AGENTV3_ERRTREND_CHECKPOINT ?? '').trim().toLowerCase() !== 'off';
  const n = Number(env.AGENTV3_ERRTREND_INTERVAL);
  return { enabled, interval: Number.isFinite(n) && n >= 5 ? Math.floor(n) : 25 };
}

/**
 * TRUE when the last two checkpoint counts show NO convergence (both > 0, not decreasing).
 * A single bad peek never fires (files are legitimately half-written mid-build); two flat/rising
 * peeks = ~2×interval steps with zero progress on compile errors. Pure.
 */
export function shouldTriggerMidBuildRepair(counts: number[]): boolean {
  if (counts.length < 2) return false;
  const prev = counts[counts.length - 2];
  const last = counts[counts.length - 1];
  return prev > 0 && last > 0 && last >= prev;
}

// === SLICE 3 — STEP-LIMIT AUTO-RESUME (admin-mandated 2026-07-17: "pause, not death") ==============
// When the cap hits and the build is STILL not ready (even after the endgame repair), the run gets a
// bounded extension instead of dying: budget = how many times a single build may extend (default 1;
// each extension adds half the base cap). 0/off disables. A runaway can never loop: the budget is
// consumed per run and the wall-clock watchdog still rules over everything.
export function stepResumeBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.AGENTV3_STEP_RESUME ?? '').trim().toLowerCase();
  if (raw === '') return 1; // unset → the default ONE extension
  if (raw === 'off') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 3) : 1;
}
