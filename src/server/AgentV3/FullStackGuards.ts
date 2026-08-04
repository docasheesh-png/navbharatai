// AgentV3 — FULL-STACK WRITE-TIME GUARDS (TaskFlow autopsy 2026-07-17).
//
// Two deterministic write-time transforms for the exact full-stack walls the builder hit AGAIN
// despite a standing prompt rule — costing ~4 minutes of read→edit→retry each. Applied in
// guardConfigContent (like the Vite/tsconfig guards) so the FIRST write is already correct,
// on EVERY app, with no LLM step:
//
//   1. PRISMA + SQLITE ENUMS — SQLite has no enum type, so `enum TaskStatus { TODO … }` makes
//      `prisma generate` fail with "the current connector does not support enums". The fix is
//      mechanical: drop the enum blocks and rewrite every field of that type to `String`
//      (`status TaskStatus` → `status String`, `@default(TODO)` → `@default("TODO")`).
//
//   2. CJS-DEFAULT NAMESPACE IMPORT — `import * as bcrypt from 'bcrypt'` yields a namespace whose
//      `.hash` is undefined under esModuleInterop (the real object is the DEFAULT export), so the
//      seed crashed with "bcrypt.hash is not a function". The fix: convert the namespace import to a
//      default import for the known CJS-default auth libs. Tight whitelist so legitimate namespace
//      imports (React, fs, path, …) are never touched.
//
// PURE (path + content in → content out), so every transform is unit-testable with the real
// TaskFlow failure inputs. Kill switch: AGENTV3_FULLSTACK_GUARDS=off.

export function fullStackGuardsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_FULLSTACK_GUARDS ?? '').trim().toLowerCase() !== 'off';
}

const isPrismaSchema = (path: string): boolean => /(^|\/)schema\.prisma$/.test(path);

/**
 * When a Prisma schema targets SQLite, strip its enums and rewrite the referencing fields to String.
 * No-op for any other datasource (Postgres/MySQL DO support enums) or a schema with no enums. Pure.
 */
export function stripPrismaSqliteEnums(path: string, content: string): string {
  if (!isPrismaSchema(path) || typeof content !== 'string') return content;
  // Only act when the datasource provider is sqlite (string literal or an env — we match the literal).
  if (!/datasource\s+\w+\s*\{[^}]*provider\s*=\s*["']sqlite["'][^}]*\}/s.test(content)) return content;
  const enumRe = /enum\s+(\w+)\s*\{[^}]*\}/g;
  const enumNames: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = enumRe.exec(content)) !== null) enumNames.push(m[1]);
  if (enumNames.length === 0) return content;

  let out = content.replace(enumRe, '').replace(/\n{3,}/g, '\n\n'); // drop the enum blocks
  for (const name of enumNames) {
    // A model FIELD typed by the enum: `  status   TaskStatus`  /  `TaskStatus?`  /  `TaskStatus[]`.
    // Keep the field name + attributes; swap only the type token to String.
    const fieldRe = new RegExp(`^(\\s*\\w+\\s+)${name}(\\??|\\[\\])(\\s|$)`, 'gm');
    out = out.replace(fieldRe, (_all, head: string, mod: string, tail: string) => {
      const t = mod === '[]' ? 'String[]' : `String${mod}`; // an enum LIST becomes String[] here; fixPrismaSqliteScalarList (below) then collapses the unsupported scalar list to a single String
      return `${head}${t}${tail}`;
    });
    // `@default(TODO)` → `@default("TODO")` (an enum default becomes a String default).
    out = out.replace(new RegExp(`@default\\(\\s*([A-Z_][A-Z0-9_]*)\\s*\\)`, 'g'), '@default("$1")');
  }
  return out;
}

/** The nine Prisma primitive SCALAR types. A `[]` of one of these is a "scalar list". */
const PRISMA_SCALARS = ['String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes'];

/**
 * SQLITE HAS NO SCALAR LISTS (LearnLoop autopsy 2026-07-21). The builder modelled `attachments String[]`
 * / `tags String[]` / `scores Int[]` on a SQLite datasource — but SQLite's connector does not support
 * lists of primitive types, so `prisma validate` / `prisma generate` fails with
 * "Field 'attachments' in model 'X' can't be a list. The current connector does not support lists of
 * primitive types." This looped the whole DB setup and, together with the Prisma-7 skew, sank the build.
 *
 * The mechanical, always-valid fix (Prisma's own SQLite guidance): store the list as ONE serialized
 * `String?` field and (de)serialize in app code. This guard rewrites every SCALAR list field
 * (`<name> <Scalar>[]`) to `<name> String?` and drops any now-invalid `@default([...])` on that line.
 * RELATION lists (`lessons Lesson[]`, `students User[]`) are LEFT ALONE — those are valid on SQLite —
 * because only the nine Prisma primitive scalar type tokens are matched (a relation uses a model name,
 * never a scalar keyword). Runs AFTER stripPrismaSqliteEnums, so an enum-list it rewrote to `String[]`
 * is collapsed here too. No-op for a non-SQLite datasource or a schema with no scalar list. Pure.
 */
export function fixPrismaSqliteScalarList(path: string, content: string): string {
  if (!isPrismaSchema(path) || typeof content !== 'string') return content;
  if (!/datasource\s+\w+\s*\{[^}]*provider\s*=\s*["']sqlite["'][^}]*\}/s.test(content)) return content;
  // A model field line whose type is `<Scalar>[]` (with optional trailing attributes). [ \t] only, so the
  // match stays on ONE field line and never crosses into the next.
  const scalarAlt = PRISMA_SCALARS.join('|');
  const fieldRe = new RegExp(`^([ \\t]*\\w+[ \\t]+)(?:${scalarAlt})\\[\\]([ \\t]*[^\\n]*)$`, 'gm');
  return content.replace(fieldRe, (all, head: string, attrs: string) => {
    if (/@relation\b/.test(attrs)) return all; // defensive: never touch an explicit relation
    // A scalar list becomes a single nullable String; a `@default([...])` is invalid on a scalar → drop it.
    const cleaned = attrs.replace(/@default\(\s*\[[^\]]*\]\s*\)/g, '').replace(/[ \t]+$/, '');
    return `${head}String?${cleaned}`;
  });
}

/**
 * A Prisma date field typed `String` but defaulted to `now()` / marked `@updatedAt` is INVALID — the
 * `now()` function and `@updatedAt` produce a DateTime, so `prisma generate` fails with
 * "The function `now()` cannot be used on fields of type `String`" (MediConnect autopsy 2026-07-19: 19
 * such validation errors after the builder wrongly converted DateTime→String for SQLite). SQLite fully
 * supports Prisma's `DateTime` scalar, so the correct, mechanical fix is to restore the type to
 * `DateTime`. Fires on ANY schema.prisma (the bug is provider-independent). Only rewrites the type token
 * of a field that ALSO carries `@default(now())` or `@updatedAt` on the SAME line — a plain
 * `String @default("x")` is untouched. Pure.
 */
export function fixPrismaDateStringDefault(path: string, content: string): string {
  if (!isPrismaSchema(path) || typeof content !== 'string') return content;
  // `  createdAt   String   @default(now())`  /  `  updatedAt String @updatedAt`  (optional `?`).
  // Use [ \t] (NOT \s, which crosses newlines) so the match stays strictly on ONE field line.
  const fieldRe = /^([ \t]*\w+[ \t]+)String(\??)([ \t]+[^\n]*@(?:default\([ \t]*now\(\)[ \t]*\)|updatedAt)[^\n]*)$/gm;
  return content.replace(fieldRe, (_all, head: string, opt: string, tail: string) => `${head}DateTime${opt}${tail}`);
}

/** CJS libraries whose USABLE api is the DEFAULT export — a namespace import breaks their methods. */
const CJS_DEFAULT_LIBS = ['bcrypt', 'bcryptjs', 'jsonwebtoken'];
const isCodeFile = (path: string): boolean => /\.(t|j)sx?$/.test(path) && !/\.d\.ts$/.test(path);

/**
 * Convert `import * as X from '<cjs-default-lib>'` → `import X from '<cjs-default-lib>'` so `X.hash` /
 * `X.sign` resolve (the real object is the module's default export under esModuleInterop). Whitelisted
 * to known auth libs, so a legitimate namespace import elsewhere is never rewritten. Pure.
 */
export function fixCjsDefaultImport(path: string, content: string): string {
  if (!isCodeFile(path) || typeof content !== 'string' || !content.includes('import * as')) return content;
  let out = content;
  for (const lib of CJS_DEFAULT_LIBS) {
    const re = new RegExp(`import\\s+\\*\\s+as\\s+(\\w+)\\s+from\\s+(["'])${lib}\\2`, 'g');
    out = out.replace(re, (_all, local: string, q: string) => `import ${local} from ${q}${lib}${q}`);
  }
  return out;
}

/**
 * A VITE app's package.json MUST carry "type": "module" (ShopKhata autopsy 2026-07-17). The scaffold's
 * vite.config.ts imports vite-tsconfig-paths, whose newer 5.x builds are ESM-only; without type:module
 * Vite loads the bundled config via require() and the dev server dies on BOOT ("resolved to an ESM
 * file. ESM file cannot be loaded by `require`") — the user sees "No live preview yet" forever. The
 * template now ships type:module, but a builder that REWRITES package.json (adding deps, monorepo
 * roots) can silently drop it — this write-time guard re-inserts the invariant where the data enters.
 * Only fires for a package.json that is actually a Vite app (vite in deps or the dev script) with NO
 * explicit "type" — an explicit "type": "commonjs" is respected (the author chose it), and backend
 * package.jsons (express/node, no vite) are never touched. Pure.
 */
export function ensureViteTypeModule(path: string, content: string): string {
  if (!/(^|\/)package\.json$/.test(path) || typeof content !== 'string') return content;
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>;
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return content;
    if (pkg.type !== undefined) return content; // an explicit choice (module OR commonjs) is respected
    const deps = { ...(pkg.dependencies as object | undefined), ...(pkg.devDependencies as object | undefined) } as Record<string, unknown>;
    const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
    const usesVite = deps.vite !== undefined || /\bvite\b/.test(String(scripts.dev ?? ''));
    if (!usesVite) return content;
    // Rebuild with "type" up front (name/version keep their spot; the spread restores everything else).
    return JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', ...pkg }, null, 2);
  } catch {
    return content; // not valid JSON — never mangle a file we can't parse
  }
}

/**
 * Run a Prisma SEED script with `tsx`, not `ts-node` (LedgerLoop autopsy 2026-07-20). LedgerLoop's seed
 * crashed twice: first `ts-node` failed on the ESM project (`require.extensions.<computed> [as .ts]`),
 * then it could not resolve the `@/lib/auth` path alias. `tsx` fixes BOTH — it loads TS under ESM and
 * honours tsconfig `paths`. This guard rewrites a `package.json` "seed" script (and a Prisma `prisma.seed`
 * command) that invokes `ts-node` to use `tsx`, and guarantees `tsx` is in devDependencies so
 * `npm run seed` resolves the binary. Only touches a package.json whose seed actually uses ts-node; a
 * seed already on tsx, or none, is untouched. Pure.
 */
export function fixPrismaSeedRunner(path: string, content: string): string {
  if (!/(^|\/)package\.json$/.test(path) || typeof content !== 'string') return content;
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>;
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return content;
    const swapTsNode = (cmd: unknown): { cmd: string; changed: boolean } => {
      if (typeof cmd !== 'string' || !/\bts-node\b/.test(cmd)) return { cmd: String(cmd ?? ''), changed: false };
      // `ts-node`, `ts-node-esm`, `ts-node --esm`, `node --loader ts-node/esm` → `tsx`.
      const next = cmd
        .replace(/\bnode\s+--loader\s+ts-node\/esm\b/g, 'tsx')
        .replace(/\bts-node(?:-esm)?\b(?:\s+--esm\b)?/g, 'tsx');
      return { cmd: next, changed: next !== cmd };
    };
    let changed = false;
    const scripts = { ...(pkg.scripts as Record<string, unknown> | undefined) };
    if (scripts && typeof scripts.seed === 'string') {
      const r = swapTsNode(scripts.seed);
      if (r.changed) { scripts.seed = r.cmd; changed = true; }
    }
    const prisma = { ...(pkg.prisma as Record<string, unknown> | undefined) };
    if (prisma && typeof prisma.seed === 'string') {
      const r = swapTsNode(prisma.seed);
      if (r.changed) { prisma.seed = r.cmd; changed = true; }
    }
    if (!changed) return content;
    const devDeps = { ...(pkg.devDependencies as Record<string, unknown> | undefined) };
    if (devDeps.tsx === undefined) devDeps.tsx = '^4';
    const out = { ...pkg, scripts, devDependencies: devDeps };
    if (pkg.prisma !== undefined) (out as Record<string, unknown>).prisma = prisma;
    return JSON.stringify(out, null, 2);
  } catch {
    return content; // not valid JSON — never mangle a file we can't parse
  }
}

/**
 * Collapse a DUPLICATE same-name import of the SAME module (Bazaar-era autopsy 2026-07-20). The builder
 * wrote BOTH `import ErrorBoundary from './ErrorBoundary'` AND `import { ErrorBoundary } from './ErrorBoundary'`
 * — two bindings of the same name in one scope → babel/Vite hard-fails with "Duplicate declaration
 * 'ErrorBoundary'" and the whole preview won't compile. Deterministic + SAFE because both point at the
 * SAME module: keep the FIRST import statement that binds the name, and drop the name from any LATER
 * import of that same module (removing the whole statement if it becomes empty). Only the same-module
 * case is touched — a genuine cross-module name clash (a real conflict) is left for the reconciler. Pure.
 */
export function dedupeSameModuleImports(path: string, content: string): string {
  if (!isCodeFile(path) || typeof content !== 'string' || !content.includes('import')) return content;
  const seen = new Set<string>(); // `${module}::${localName}` already bound by an earlier import
  const localsOf = (clause: string): string[] => {
    const names: string[] = [];
    const def = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause); // leading default binding
    if (def && !clause.trimStart().startsWith('{') && !clause.trimStart().startsWith('*')) names.push(def[1]);
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (ns) names.push(ns[1]);
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) for (const part of braces[1].split(',')) {
      const m = /(?:\btype\s+)?[A-Za-z_$][\w$]*\s+as\s+([A-Za-z_$][\w$]*)|(?:\btype\s+)?([A-Za-z_$][\w$]*)/.exec(part.trim());
      if (m) names.push(m[1] || m[2]);
    }
    return names.filter(Boolean);
  };
  const lines = content.split('\n');
  const out: string[] = [];
  const importRe = /^(\s*import\s+)(.+?)(\s+from\s+)(["'])([^"']+)\4(\s*;?\s*)$/;
  for (const line of lines) {
    const m = importRe.exec(line);
    if (!m) { out.push(line); continue; }
    const mod = m[5];
    const locals = localsOf(m[2]);
    const dupes = locals.filter((n) => seen.has(`${mod}::${n}`));
    locals.forEach((n) => seen.add(`${mod}::${n}`));
    if (dupes.length === 0) { out.push(line); continue; }
    if (dupes.length === locals.length) continue; // every binding is a same-module dupe → drop the whole line
    // Some bindings survive: strip only the duplicate NAMED specifiers, keep the rest.
    const kept = m[2].replace(/\{([^}]*)\}/, (_all, inner: string) => {
      const parts = inner.split(',').map((s) => s.trim()).filter(Boolean).filter((p) => {
        const nm = /\bas\s+([A-Za-z_$][\w$]*)$|^(?:type\s+)?([A-Za-z_$][\w$]*)$/.exec(p);
        const local = nm ? (nm[1] || nm[2]) : p;
        return !dupes.includes(local);
      });
      return parts.length ? `{ ${parts.join(', ')} }` : '';
    }).replace(/,\s*$/, '').replace(/^\s*,/, '').trim();
    out.push(`${m[1]}${kept}${m[3]}${m[4]}${mod}${m[4]}${m[6]}`);
  }
  return out.join('\n');
}

/** Apply every full-stack write-time guard in order. Flag-gated; a disabled flag is a pure pass-through. */
export function applyFullStackGuards(path: string, content: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!fullStackGuardsEnabled(env)) return content;
  return dedupeSameModuleImports(path, fixPrismaSeedRunner(path, ensureViteTypeModule(path, fixCjsDefaultImport(path, fixPrismaDateStringDefault(path, fixPrismaSqliteScalarList(path, stripPrismaSqliteEnums(path, content)))))));
}
