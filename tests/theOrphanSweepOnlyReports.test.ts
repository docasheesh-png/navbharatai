import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildOrphanReport } from '../src/server/lib/orphanReport';
import type { ProviderAdapter } from '../src/server/providers/types';

const ad = (key: string, list?: () => Promise<Array<{ resourceRef: string }>>): ProviderAdapter => ({
  key, mode: 'managed', available: () => ({ ok: true, reason: '' }),
  provision: async () => ({ ok: false, retryable: false, status: 501, error: 'n/a' }),
  ...(list ? { listOwned: list } : {}),
});

describe('orphan report (PR 17)', () => {
  it('finds orphans and dangling records per provider', async () => {
    const r = await buildOrphanReport([ad('db', async () => [{ resourceRef: 'a' }, { resourceRef: 'x' }])], [
      { providerKey: 'db', resourceRef: 'a', uid: 'u1' }, { providerKey: 'db', resourceRef: 'b', uid: 'u2' },
    ]);
    expect(r.orphans.map((o) => o.resourceRef)).toEqual(['x']);
    expect(r.dangling.map((o) => o.resourceRef)).toEqual(['b']);
  });
  it('a failed listing is skipped, not reported as everything dangling', async () => {
    const r = await buildOrphanReport([ad('db', async () => { throw new Error('boom'); }), ad('nolist')], [{ providerKey: 'db', resourceRef: 'a', uid: 'u' }]);
    expect(r.dangling).toEqual([]);
    expect(r.skipped.map((s) => s.providerKey)).toEqual(['db', 'nolist']);
  });
  it('the module has no way to delete anything', () => {
    const src = readFileSync('src/server/lib/orphanReport.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/deprovision|delete|remove|destroy/i);
  });
});
