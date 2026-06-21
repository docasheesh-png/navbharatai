import { describe, it, expect } from 'vitest';
import { BackendProvisioner } from '../src/server/EngineerAI/BackendProvisioner';

describe('BackendProvisioner.getScaffoldFiles', () => {
  it('returns empty array for empty features', () => {
    expect(BackendProvisioner.getScaffoldFiles([])).toHaveLength(0);
  });

  it('returns db.ts for "db" feature', () => {
    const files = BackendProvisioner.getScaffoldFiles(['db']);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/lib/db.ts');
  });

  it('db scaffold content includes Pool import', () => {
    const files = BackendProvisioner.getScaffoldFiles(['db']);
    expect(files[0].content).toContain('Pool');
  });

  it('returns auth.ts for "auth" feature', () => {
    const files = BackendProvisioner.getScaffoldFiles(['auth']);
    expect(files[0].path).toBe('src/lib/auth.ts');
    expect(files[0].content).toContain('bcrypt');
  });

  it('returns storage.ts for "storage" feature', () => {
    const files = BackendProvisioner.getScaffoldFiles(['storage']);
    expect(files[0].path).toBe('src/lib/storage.ts');
  });

  it('returns 3 files when all features requested', () => {
    const files = BackendProvisioner.getScaffoldFiles(['db', 'auth', 'storage']);
    expect(files).toHaveLength(3);
  });
});

describe('BackendProvisioner.getPackages', () => {
  it('returns empty array for empty features', () => {
    expect(BackendProvisioner.getPackages([])).toHaveLength(0);
  });

  it('includes pg for "db" feature', () => {
    const pkgs = BackendProvisioner.getPackages(['db']);
    expect(pkgs).toContain('pg');
  });

  it('includes bcrypt and jsonwebtoken for "auth" feature', () => {
    const pkgs = BackendProvisioner.getPackages(['auth']);
    expect(pkgs).toContain('bcrypt');
    expect(pkgs).toContain('jsonwebtoken');
  });

  it('"storage" feature returns no packages', () => {
    expect(BackendProvisioner.getPackages(['storage'])).toHaveLength(0);
  });
});
