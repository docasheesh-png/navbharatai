import { describe, it, expect, afterAll } from 'vitest';

import { generateSoftDeleteIntegration, SOFT_DELETE_LIB_SOURCE } from './SoftDeleteGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateSoftDeleteIntegration (wiring)', () => {
  it('emits server/lib/softDelete.ts, dependency-free', () => {
    const out = generateSoftDeleteIntegration();
    expect(Object.keys(out.files)).toContain('server/lib/softDelete.ts');
    expect(out.dependencies).toEqual([]);
    expect(SOFT_DELETE_LIB_SOURCE).toContain('export function softDelete');
    expect(SOFT_DELETE_LIB_SOURCE).toContain('export function restore');
    expect(SOFT_DELETE_LIB_SOURCE).toContain('export function activeWhere');
  });
});

describe('emitted softDelete helpers — behaviour', () => {
  const emitted = emitModule('softdelete', SOFT_DELETE_LIB_SOURCE);
  afterAll(emitted.cleanup);

  interface Row { id: number; deletedAt?: string | null }
  interface Emitted {
    softDelete<T extends Row>(record: T, at?: Date): T;
    restore<T extends Row>(record: T): T;
    isDeleted(record: Row): boolean;
    activeOnly<T extends Row>(records: readonly T[]): T[];
    trashedOnly<T extends Row>(records: readonly T[]): T[];
    activeWhere(column?: string): string;
    trashedWhere(column?: string): string;
  }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('softDelete stamps deletedAt and isDeleted reflects it; restore clears it', async () => {
    const m = await load();
    const row: Row = { id: 1 };
    expect(m.isDeleted(row)).toBe(false);
    m.softDelete(row, new Date('2026-01-02T03:04:05.000Z'));
    expect(row.deletedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(m.isDeleted(row)).toBe(true);
    m.restore(row);
    expect(row.deletedAt).toBeNull();
    expect(m.isDeleted(row)).toBe(false);
  });

  it('softDelete is idempotent (keeps the original timestamp)', async () => {
    const m = await load();
    const row: Row = { id: 2 };
    m.softDelete(row, new Date('2026-01-01T00:00:00.000Z'));
    m.softDelete(row, new Date('2026-06-01T00:00:00.000Z'));
    expect(row.deletedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('activeOnly / trashedOnly partition a list', async () => {
    const m = await load();
    const rows: Row[] = [{ id: 1 }, { id: 2, deletedAt: '2026-01-01T00:00:00.000Z' }, { id: 3 }];
    expect(m.activeOnly(rows).map((r) => r.id)).toEqual([1, 3]);
    expect(m.trashedOnly(rows).map((r) => r.id)).toEqual([2]);
  });

  it('SQL clauses use the default column and a custom one', async () => {
    const m = await load();
    expect(m.activeWhere()).toBe('deleted_at IS NULL');
    expect(m.trashedWhere()).toBe('deleted_at IS NOT NULL');
    expect(m.activeWhere('removed_at')).toBe('removed_at IS NULL');
  });
});
