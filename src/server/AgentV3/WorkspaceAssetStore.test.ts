// WorkspaceAssetStore — the pure materialization layer. Under VITEST the Firestore layer is
// skipped by design (getDb() → null), so save/load are no-ops here; what matters is that a stored
// data-URI asset is decoded to REAL BYTES and written through the actuator's writeBinaryFile, and
// that a corrupt/non-data-URI entry is skipped rather than corrupting a file or throwing.

import { describe, it, expect } from 'vitest';
import { materializeAssets, restoreWorkspaceAssets, saveWorkspaceAssets, loadWorkspaceAssets } from './WorkspaceAssetStore';

/** Records every writeBinaryFile call so the test can assert the decoded bytes. */
class FakeSink {
  writes: Array<{ path: string; base64: string }> = [];
  failOn: string | null = null;
  async writeBinaryFile(_workspaceId: string, filePath: string, base64: string): Promise<void> {
    if (this.failOn === filePath) throw new Error('sandbox write failed');
    this.writes.push({ path: filePath, base64 });
  }
}

const png = Buffer.alloc(64, 5).toString('base64');

describe('materializeAssets', () => {
  it('decodes each data URI and writes the raw base64 through writeBinaryFile', async () => {
    const sink = new FakeSink();
    const n = await materializeAssets(sink, 'ws-1', {
      'public/logo.png': `data:image/png;base64,${png}`,
      'public/favicon.ico': 'data:image/x-icon;base64,QUJD',
    });
    expect(n).toBe(2);
    expect(sink.writes).toContainEqual({ path: 'public/logo.png', base64: png });
    expect(sink.writes).toContainEqual({ path: 'public/favicon.ico', base64: 'QUJD' });
  });

  it('skips a non-data-URI entry instead of writing garbage', async () => {
    const sink = new FakeSink();
    const n = await materializeAssets(sink, 'ws-1', { 'a.png': 'not-a-data-uri', 'b.png': `data:image/png;base64,${png}` });
    expect(n).toBe(1);
    expect(sink.writes.map((w) => w.path)).toEqual(['b.png']);
  });

  it('a single failed write never blocks the rest (best-effort)', async () => {
    const sink = new FakeSink();
    sink.failOn = 'bad.png';
    const n = await materializeAssets(sink, 'ws-1', {
      'bad.png': `data:image/png;base64,${png}`,
      'good.png': `data:image/png;base64,${png}`,
    });
    expect(n).toBe(1);
    expect(sink.writes.map((w) => w.path)).toEqual(['good.png']);
  });

  it('handles an empty asset map', async () => {
    expect(await materializeAssets(new FakeSink(), 'ws-1', {})).toBe(0);
  });
});

describe('Firestore layer is safely dormant under test', () => {
  it('save/load/restore never throw and return empty without Firestore', async () => {
    await expect(saveWorkspaceAssets('ws-x', { 'a.png': 'data:image/png;base64,AA' })).resolves.toBeUndefined();
    await expect(loadWorkspaceAssets('ws-x')).resolves.toEqual({});
    await expect(restoreWorkspaceAssets(new FakeSink(), 'ws-x')).resolves.toBe(0);
  });
});
