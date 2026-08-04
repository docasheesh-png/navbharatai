import { describe, it, expect } from 'vitest';
import { generateBackup } from './BackupGenerator';

describe('generateBackup', () => {
  it('emits a single backup route (dependency-free)', () => {
    const out = generateBackup(['Post', 'User']);
    expect(Object.keys(out.files)).toEqual(['server/routes/backup.routes.ts']);
    expect(out.dependencies).toEqual([]);
  });

  it('dumps every row of each model as a downloadable JSON snapshot', () => {
    const r = generateBackup(['Post', 'User']).files['server/routes/backup.routes.ts'];
    expect(r).toContain("router.get('/backup'");
    expect(r).toContain('data["posts"] = await prisma.post.findMany();');
    expect(r).toContain('data["users"] = await prisma.user.findMany();');
    expect(r).toContain('res.setHeader(\'Content-Disposition\', \'attachment; filename="backup.json"\')');
    expect(r).toContain('exportedAt: new Date().toISOString()');
  });

  it('de-dupes models and never throws on malformed input', () => {
    const r = generateBackup(['Post', 'post']).files['server/routes/backup.routes.ts'];
    expect((r.match(/data\["posts"\]/g) || []).length).toBe(1);
    // @ts-expect-error — malformed input must not throw
    expect(() => generateBackup(null)).not.toThrow();
    expect(() => generateBackup([])).not.toThrow();
  });
});
