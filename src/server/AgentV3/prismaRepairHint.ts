// AgentV3 — Prisma schema repair hints (widen the relation self-heal beyond the `prisma format` class).
//
// The inline `prisma format` self-heal in ToolDispatcher mechanically completes ONE error class: a
// missing opposite relation field. Every other common Prisma schema-validation failure (ambiguous
// relation, missing @id/@unique, missing fields/references on @relation, SQLite enum, unset datasource
// URL) fires the same validation error but `prisma format` cannot fix it — so today the raw error is
// returned and the builder re-discovers the fix by trial and error (the LearnLoop/ShopKhata struggle).
//
// This module turns that struggle into a smooth path: given a failed prisma command's output, it returns
// ONE deterministic, actionable fix instruction for the recognised error class, which ToolDispatcher
// appends to the tool result. It is GUIDANCE only — it never edits the schema (safe: "never break the
// app"). PURE + unit-tested. Returns null when the output is not a recognised Prisma schema error.

/** True when the text is recognisably Prisma output (so a generic phrase like "must be unique" from an
 *  unrelated command never triggers a hint). */
function looksLikePrisma(text: string): boolean {
  return /prisma|schema\.prisma|\bP1\d{3}\b|datasource\s|@relation|@prisma\/client/i.test(text);
}

interface HintRule {
  readonly id: string;
  readonly match: RegExp;
  readonly hint: string;
}

// Ordered most-specific → most-generic. The FIRST match wins.
const RULES: readonly HintRule[] = [
  {
    id: 'ambiguous-relation',
    match: /ambiguous relation|more than one relation|relation[^\n]*is ambiguous|ambiguous self[- ]relation/i,
    hint:
      'Prisma found an AMBIGUOUS relation (two relations between the same two models). Give BOTH sides the ' +
      'same relation name so Prisma can pair them, e.g. `author User @relation("PostAuthor", fields: [authorId], ' +
      'references: [id])` on one model and `posts Post[] @relation("PostAuthor")` on the other.',
  },
  {
    id: 'missing-fields-references',
    match: /specify the [`'"]?references[`'"]? argument|specify the [`'"]?fields[`'"]? argument|argument [`'"]?(fields|references)[`'"]? is missing/i,
    hint:
      'An `@relation` is missing its `fields`/`references`. Add the scalar foreign-key field and point it at the ' +
      'related model’s id, e.g. add `authorId Int` and change the relation to ' +
      '`author User @relation(fields: [authorId], references: [id])`.',
  },
  {
    id: 'missing-opposite-field',
    match: /missing an opposite relation field|missing the opposite relation/i,
    hint:
      'This relation has NO opposite field. Add the back-relation on the other model — e.g. if `Post` has ' +
      '`author User`, add `posts Post[]` on `User`. (`prisma format` usually completes this automatically; if it ' +
      'did not, add the field by hand.)',
  },
  {
    id: 'one-to-one-needs-unique',
    match: /one-to-one relation must use unique fields|add an? [`'"]?@unique[`'"]? attribute/i,
    hint:
      'A one-to-one Prisma relation needs the foreign-key scalar to be `@unique`. Either add `@unique` to the FK ' +
      'field (e.g. `vehicleId String? @unique`), OR make it one-to-many by changing the other side to a list ' +
      '(e.g. `Vehicle` → `vehicles Vehicle[]`).',
  },
  {
    id: 'referenced-not-unique',
    match: /references[^\n]*must (point|refer) to[^\n]*unique|referenced field[^\n]*is not unique|must be unique to be used in an? (@relation|relation)/i,
    hint:
      'The field named in `references:` must be `@unique` (or `@id`). Add `@unique` to that scalar field on the ' +
      'related model so it can back a relation.',
  },
  {
    id: 'no-primary-key',
    match: /must have at least one unique|at least one @id|needs at least one @id|no unique field|unique criteria|each model must have/i,
    hint:
      'The model has NO primary key. Add an id field, e.g. `id Int @id @default(autoincrement())` (or ' +
      '`id String @id @default(cuid())`).',
  },
  {
    id: 'sqlite-enum-unsupported',
    match: /does not support enums|enums are not supported/i,
    hint:
      'SQLite does not support Prisma `enum`s. Replace the enum with a `String` field and validate the allowed ' +
      'values in application code (or switch the datasource to PostgreSQL if enums are required).',
  },
  {
    id: 'datasource-url-missing',
    match: /environment variable not found: \w+|datasource[^\n]*url[^\n]*not found|the URL must start with the protocol/i,
    hint:
      'The datasource URL env var is not set (or malformed). Add it to `.env` — e.g. `DATABASE_URL="file:./dev.db"` ' +
      'for SQLite — and ensure `schema.prisma` reads `url = env("DATABASE_URL")`.',
  },
];

// Fallback for a P1012 / "Error validating" that no specific rule matched — still better than a raw dump.
const GENERIC_VALIDATION =
  /\bP1012\b|error validating (model|field|datasource|the relation)/i;

/**
 * Return a single actionable fix instruction for a failed Prisma command's combined stdout+stderr, or
 * null when the output is not a recognised Prisma schema error. PURE.
 */
/**
 * True when a failed prisma command's output shows the `prisma` CLI itself is NOT INSTALLED (so
 * `npx prisma …` tried to auto-fetch it and, being non-interactive, aborted). Drives the ToolDispatcher
 * "install prisma + retry" self-heal (Bazaar-era autopsy 2026-07-20: 13 failed generates over ~10 min
 * because prisma wasn't in node_modules after a sandbox recycle). Pure + unit-tested.
 */
export function isPrismaCliMissingError(output: string | null | undefined): boolean {
  if (typeof output !== 'string' || !output) return false;
  return /npx canceled due to missing packages|missing packages and no YES option|could not determine executable to run|\bprisma: not found\b|Cannot find module ['"]?prisma['"]?|["']?prisma@[\d.]+["']?\s+is not|npm error 404[^\n]*\bprisma\b/i.test(output);
}

export function prismaRepairHint(output: string): string | null {
  const text = output || '';
  if (!looksLikePrisma(text)) return null;
  for (const rule of RULES) {
    if (rule.match.test(text)) return rule.hint;
  }
  if (GENERIC_VALIDATION.test(text)) {
    return (
      'Prisma schema validation failed. Read the "Error validating …" line — it names the exact model/field and ' +
      'the required change. Common fixes: add the opposite relation field, add `@id`/`@unique`, or add ' +
      '`fields:`/`references:` to the `@relation`.'
    );
  }
  return null;
}
