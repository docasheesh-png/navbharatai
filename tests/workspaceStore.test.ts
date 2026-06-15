import { describe, it, expect } from 'vitest';
import { encodeWorkspace, decodeWorkspace, DEFAULT_CHUNK_SIZE } from '../src/server/project/WorkspaceStore';

describe('Workspace persistence codec', () => {
  it('round-trips a small workspace in a single chunk', () => {
    const ws = { sessions: [{ id: 's1', files: { 'index.html': '<h1>hi</h1>' } }], lastApp: 'x' };
    const enc = encodeWorkspace(ws);
    expect(enc.manifest.chunkCount).toBe(1);
    expect(decodeWorkspace(enc.chunks)).toEqual(ws);
  });

  it('splits a large workspace into multiple chunks and reassembles losslessly', () => {
    // 2.5 MB of content — would blow the old 800KB cap and drop >60KB files
    const big = 'x'.repeat(2_500_000);
    const ws = { sessions: [{ id: 's1', files: { 'big.js': big } }] };
    const enc = encodeWorkspace(ws);
    expect(enc.manifest.chunkCount).toBeGreaterThan(1);
    enc.chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(DEFAULT_CHUNK_SIZE));
    const decoded = decodeWorkspace<typeof ws>(enc.chunks);
    expect(decoded.sessions[0].files['big.js'].length).toBe(2_500_000);
    expect(decoded).toEqual(ws);
  });

  it('respects a custom chunk size and preserves order', () => {
    const ws = { data: 'abcdefghij'.repeat(100) }; // 1000 chars
    const enc = encodeWorkspace(ws, 100);
    expect(enc.chunks.length).toBe(Math.ceil(JSON.stringify(ws).length / 100));
    expect(decodeWorkspace(enc.chunks)).toEqual(ws);
  });

  it('handles empty / null payloads', () => {
    const enc = encodeWorkspace(null);
    expect(enc.manifest.chunkCount).toBe(1);
    expect(decodeWorkspace(enc.chunks)).toBeNull();
    expect(decodeWorkspace([])).toBeNull();
  });

  it('records accurate byte totals', () => {
    const ws = { a: 'héllo' };
    const enc = encodeWorkspace(ws);
    expect(enc.manifest.totalBytes).toBe(Buffer.byteLength(JSON.stringify(ws), 'utf8'));
  });
});
