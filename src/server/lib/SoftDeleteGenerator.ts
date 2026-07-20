// Roadmap breadth — soft-delete (trash & restore) recipe.
//
// A very common real requirement: don't HARD-delete user data — mark it deleted so it can be restored
// ("undo delete", a Trash/Bin, an audit trail, GDPR-friendly retention). This emits a small, dependency-free,
// storage-agnostic helper: stamp a deletedAt, restore it, filter active vs trashed records, plus the exact
// SQL WHERE clause so the same rule works against a real database. Pure builder → the caller writes the file.
// No API key, no dependency.

export const SOFT_DELETE_LIB_SOURCE = `// Soft delete: mark a record deleted (set deletedAt) instead of removing it, so it can be RESTORED and stays
// auditable. Storage-agnostic — works on any object that carries an optional deletedAt field, and gives you
// the SQL clause to apply the same rule in your database. For SQL, add a nullable deleted_at timestamp
// column; a row is "active" when it IS NULL, "trashed" when it is set.

export interface SoftDeletable {
  deletedAt?: string | null;
}

/** Mark a record deleted (idempotent — an already-deleted record keeps its original deletedAt). */
export function softDelete<T extends SoftDeletable>(record: T, at: Date = new Date()): T {
  if (!record.deletedAt) record.deletedAt = at.toISOString();
  return record;
}

/** Restore a soft-deleted record (clears deletedAt). */
export function restore<T extends SoftDeletable>(record: T): T {
  record.deletedAt = null;
  return record;
}

/** Is this record currently soft-deleted? */
export function isDeleted(record: SoftDeletable): boolean {
  return record.deletedAt != null;
}

/** Only the active (not-deleted) records. */
export function activeOnly<T extends SoftDeletable>(records: readonly T[]): T[] {
  return records.filter((r) => r.deletedAt == null);
}

/** Only the trashed (soft-deleted) records. */
export function trashedOnly<T extends SoftDeletable>(records: readonly T[]): T[] {
  return records.filter((r) => r.deletedAt != null);
}

/** SQL fragment selecting ACTIVE rows, e.g. "WHERE " + activeWhere() -> "deleted_at IS NULL".
 *  Pass your column name if it is not the default snake_case deleted_at. */
export function activeWhere(column = 'deleted_at'): string {
  return column + ' IS NULL';
}

/** SQL fragment selecting TRASHED rows -> "deleted_at IS NOT NULL". */
export function trashedWhere(column = 'deleted_at'): string {
  return column + ' IS NOT NULL';
}
`;

export interface SoftDeleteConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Soft delete (trash & restore) wired at server/lib/softDelete.ts (dependency-free, storage-agnostic). Instead ' +
  'of removing a record, call softDelete(record) to stamp deletedAt; restore(record) brings it back; ' +
  'isDeleted(record) checks it. Filter lists with activeOnly(records) / trashedOnly(records). For a real ' +
  'database, add a nullable deleted_at timestamp column and apply activeWhere() ("deleted_at IS NULL") to your ' +
  'default queries and trashedWhere() for the Trash view. Pairs with the audit-log recipe. No dependency, no key.';

export function generateSoftDeleteIntegration(): SoftDeleteConfig {
  return {
    files: { 'server/lib/softDelete.ts': SOFT_DELETE_LIB_SOURCE },
    dependencies: [],
    instructions: INSTRUCTIONS,
  };
}
