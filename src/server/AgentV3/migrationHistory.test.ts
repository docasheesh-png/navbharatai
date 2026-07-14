import { describe, it, expect } from 'vitest';
import { foldMigrationRun, summarizeMigrationHistory, type MigrationRun } from './migrationHistory';

const run = (over: Partial<MigrationRun> = {}): MigrationRun => ({
  tool: 'prisma', commands: ['npx prisma migrate deploy'], ok: true, exitCodes: [0], ranAt: '2026-07-14T10:00:00.000Z', ...over,
});

describe('foldMigrationRun', () => {
  it('appends newest last and caps the history', () => {
    let hist: MigrationRun[] = [];
    for (let i = 0; i < 55; i++) hist = foldMigrationRun(hist, run({ exitCodes: [i] }), 50);
    expect(hist).toHaveLength(50);
    expect(hist[0].exitCodes[0]).toBe(5);   // oldest 5 dropped
    expect(hist[49].exitCodes[0]).toBe(54); // newest last
  });
  it('tolerates a null/undefined existing history', () => {
    expect(foldMigrationRun(null, run())).toHaveLength(1);
    expect(foldMigrationRun(undefined, run())).toHaveLength(1);
  });
});

describe('summarizeMigrationHistory', () => {
  it('is empty for no runs', () => {
    expect(summarizeMigrationHistory([])).toBe('');
    expect(summarizeMigrationHistory(null)).toBe('');
  });
  it('renders tool + date + ok/fail per run', () => {
    const s = summarizeMigrationHistory([run(), run({ ok: false, exitCodes: [1], tool: 'knex', commands: ['knex migrate:latest'] })]);
    expect(s).toContain('Prior migrations for this project:');
    expect(s).toContain('2026-07-14 prisma: npx prisma migrate deploy → ok');
    expect(s).toContain('knex migrate:latest → FAILED');
  });
  it('respects the limit (only the latest N)', () => {
    const runs = Array.from({ length: 8 }, (_, i) => run({ commands: [`cmd-${i}`] }));
    const s = summarizeMigrationHistory(runs, 2);
    expect(s).toContain('cmd-7');
    expect(s).toContain('cmd-6');
    expect(s).not.toContain('cmd-5');
  });
});
