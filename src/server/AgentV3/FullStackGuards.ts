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
      const t = mod === '[]' ? 'String[]' : `String${mod}`; // SQLite has no scalar lists either, but keep shape
      return `${head}${t}${tail}`;
    });
    // `@default(TODO)` → `@default("TODO")` (an enum default becomes a String default).
    out = out.replace(new RegExp(`@default\\(\\s*([A-Z_][A-Z0-9_]*)\\s*\\)`, 'g'), '@default("$1")');
  }
  return out;
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

/** Apply every full-stack write-time guard in order. Flag-gated; a disabled flag is a pure pass-through. */
export function applyFullStackGuards(path: string, content: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!fullStackGuardsEnabled(env)) return content;
  return ensureViteTypeModule(path, fixCjsDefaultImport(path, stripPrismaSqliteEnums(path, content)));
}
