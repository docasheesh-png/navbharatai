import { describe, it, expect } from 'vitest';
import { limitsForPlan, cloudRunResourceLimits, checkSourceSize, stripForbiddenFiles } from './backendLimits';

describe('backendLimits', () => {
  it('returns the managed tier for the known plan and for unknown/absent ids (never unlimited)', () => {
    const managed = limitsForPlan('managed_backend');
    expect(managed.maxInstances).toBeGreaterThan(0);
    expect(limitsForPlan(undefined)).toEqual(managed);
    expect(limitsForPlan('no-such-plan')).toEqual(managed);
  });

  it('maps limits to the exact Cloud Run v2 resources shape', () => {
    expect(cloudRunResourceLimits(limitsForPlan('managed_backend'))).toEqual({ cpu: '1', memory: '512Mi' });
  });

  it('accepts a small project and reports its true size', () => {
    const v = checkSourceSize({ 'a.js': 'x'.repeat(10), 'b.js': 'y' }, limitsForPlan('managed_backend'));
    expect(v.ok).toBe(true);
    expect(v.totalBytes).toBe(11);
    expect(v.fileCount).toBe(2);
  });

  it('rejects too many files, naming the count and the cap', () => {
    const limits = { ...limitsForPlan('managed_backend'), maxSourceFiles: 2 };
    const v = checkSourceSize({ a: '', b: '', c: '' }, limits);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('3 files');
    expect(v.reason).toContain('up to 2');
  });

  it('rejects an oversized project, naming the size and the cap', () => {
    const limits = { ...limitsForPlan('managed_backend'), maxSourceMi: 1 };
    const v = checkSourceSize({ 'big.bin': 'x'.repeat(1024 * 1024 + 1) }, limits);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('up to 1 MiB');
  });

  it('strips node_modules, .git and env files wherever they sit in the tree', () => {
    const { kept, dropped } = stripForbiddenFiles({
      'server.js': 'ok',
      'node_modules/express/index.js': 'no',
      'packages/api/node_modules/x.js': 'no',
      '.git/HEAD': 'no',
      '.env': 'SECRET=1',
      'src/.env.local': 'SECRET=2',
    });
    expect(Object.keys(kept)).toEqual(['server.js']);
    expect(dropped).toHaveLength(5);
  });
});
