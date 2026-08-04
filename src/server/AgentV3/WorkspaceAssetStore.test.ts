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

// MEASURED regression (mitrify autopsy 2026-08-04, build cb03bdde). materializeAssets awaited ONE
// write at a time. Every write is a network round-trip to the sandbox, so an import carrying 129
// assets + 22 large images cost ~151 sequential trips — 100 SECONDS of a 624-second build. The report
// shows it exactly: source files landed at 22s, the import did not report success until 122s.
//
// This was the FOURTH instance of one bug class in this repo (sandbox landing 648s, Firestore merge,
// collectWorkspaceFiles 13-min stall). These tests close the class here rather than letting it return.
describe('materializeAssets — writes concurrently (serial awaits over a network, 4th instance)', () => {
  const png = 'data:image/png;base64,aGVsbG8=';

  const mkSink = (opts?: { failOn?: string }) => {
    let inFlight = 0;
    const peak = { n: 0 };
    const written: string[] = [];
    return {
      peak,
      written,
      sink: {
        writeBinaryFile: async (_ws: string, p: string, _b64: string) => {
          inFlight++; peak.n = Math.max(peak.n, inFlight);
          await new Promise((r) => setTimeout(r, 5)); // stands in for the network round-trip
          inFlight--;
          if (opts?.failOn === p) throw new Error('sandbox write failed');
          written.push(p);
        },
      },
    };
  };

  const many = (n: number): Record<string, string> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`assets/img${i}.png`, png]));

  it('actually writes concurrently — the whole point of the fix', async () => {
    const h = mkSink();
    await materializeAssets(h.sink, 'ws', many(40));
    expect(h.peak.n).toBeGreaterThan(1); // the old serial loop peaked at exactly 1
  });

  it('writes every asset exactly once and counts them honestly', async () => {
    const h = mkSink();
    const n = await materializeAssets(h.sink, 'ws', many(25));
    expect(n).toBe(25);
    expect(new Set(h.written).size).toBe(25);
  });

  it('one broken asset never blocks the rest — the app still runs, that image just 404s', async () => {
    const h = mkSink({ failOn: 'assets/img3.png' });
    const n = await materializeAssets(h.sink, 'ws', many(10));
    expect(n).toBe(9);
    expect(h.written).not.toContain('assets/img3.png');
  });

  it('skips anything that is not a usable data URI instead of throwing', async () => {
    const h = mkSink();
    const n = await materializeAssets(h.sink, 'ws', { 'a.png': png, 'b.png': 'not-a-data-uri', 'c.png': '' });
    expect(n).toBe(1);
  });

  it('an empty asset map is a no-op', async () => {
    const h = mkSink();
    expect(await materializeAssets(h.sink, 'ws', {})).toBe(0);
    expect(h.written).toEqual([]);
  });
});
