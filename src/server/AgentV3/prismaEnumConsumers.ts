// AgentV3 — PRISMA ENUM-CONSUMER COHERENCE (MediConnect autopsy 2026-07-19).
//
// ROOT CAUSE (App #14, item 2): when a Prisma schema targets SQLite, its enums are stripped to `String`
// (SQLite has no enum type — see FullStackGuards.stripPrismaSqliteEnums). But the CODE that imported those
// enums is left dangling: `import { AppointmentStatus } from '@prisma/client'` then crashes at load with
// `SyntaxError: The requested module '@prisma/client' does not provide an export named 'AppointmentStatus'`
// — so the seed (exit 1) never ran and the DB was never seeded. Stripping the schema without fixing its
// consumers is an INCOMPLETE transform.
//
// THE FIX (reactive self-heal, mirroring the existing prisma-format / prisma-generate self-heals in
// ToolDispatcher): on that exact runtime error, find the files importing the missing enum from
// '@prisma/client' and make them coherent with a stripped (String) enum:
//   • drop the enum from its `import { … } from '@prisma/client'` (keep PrismaClient / other names),
//   • rewrite member accesses `AppointmentStatus.CONFIRMED` → the string `'CONFIRMED'` (a stripped enum
//     field is now String, whose values are exactly the member names),
//   • rewrite type annotations `: AppointmentStatus` → `: string`.
// Then retry the failed command once. All transforms are PURE (content in → content out), so they are
// unit-testable with the exact MediConnect failure input.

/**
 * Pull the export name(s) a module said it does NOT provide, from an ESM load error like:
 *   "The requested module '@prisma/client' does not provide an export named 'AppointmentStatus'"
 * Returns the de-duplicated names (usually one — Node reports the first missing export). Pure.
 */
export function extractMissingPrismaExports(errorText: string | null | undefined): string[] {
  if (typeof errorText !== 'string' || !errorText) return [];
  const names = new Set<string>();
  const re = /does not provide an export named ['"]([A-Za-z_$][\w$]*)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(errorText)) !== null) names.add(m[1]);
  return [...names];
}

/** True for a source file that could import a Prisma enum (ts/tsx/js/jsx, not a .d.ts). */
export function isEnumConsumerFile(path: string): boolean {
  return /\.(t|j)sx?$/.test(path) && !/\.d\.ts$/.test(path);
}

/**
 * Make ONE file coherent with a stripped (String) Prisma enum `enumName`:
 *   • remove `enumName` from any `import { … } from '@prisma/client'` — if it was the only name, drop the
 *     whole import line; otherwise keep the surviving names,
 *   • `enumName.MEMBER` → `'MEMBER'`,
 *   • `: enumName` type annotation → `: string`.
 * Only touches files that actually reference the name; returns the input unchanged otherwise. Pure.
 */
export function fixDanglingEnumConsumer(path: string, content: string, enumName: string): string {
  if (!isEnumConsumerFile(path) || typeof content !== 'string' || !enumName) return content;
  if (!content.includes(enumName)) return content;
  const esc = enumName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = content;

  // 1) Prune the enum from `import { … } from '@prisma/client'` (single or multi-line names).
  out = out.replace(
    /import\s*\{([^}]*)\}\s*from\s*(["'])@prisma\/client\2\s*;?/g,
    (whole, names: string, q: string) => {
      const kept = names
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.replace(/^type\s+/, '') !== enumName);
      if (kept.length === 0) return ''; // the enum was the only import → drop the line entirely
      return `import { ${kept.join(', ')} } from ${q}@prisma/client${q};`;
    },
  );

  // 2) Member access `Enum.MEMBER` → 'MEMBER' (the stripped field is a String whose value is the member).
  out = out.replace(new RegExp(`\\b${esc}\\.([A-Za-z_$][\\w$]*)`, 'g'), (_all, member: string) => `'${member}'`);

  // 3) Type annotation `: Enum` (optionally `Enum[]` / `Enum | null`) → `: string`.
  out = out.replace(new RegExp(`:\\s*${esc}(\\b)`, 'g'), ': string$1');

  // 4) Tidy a now-empty import artifact and collapse the blank line it may leave.
  out = out.replace(/^[ \t]*\n(?=import|const|let|var|function|export|\/\/|\/\*)/m, (m0) => m0).replace(/\n{3,}/g, '\n\n');
  return out;
}
