import { describe, it, expect } from 'vitest';
import {
  buildVersionSnapshot,
  appendVersionSnapshot,
  MAX_VERSION_SNAPSHOTS,
  type VersionSnapshot,
} from '../src/lib/versionSnapshot';

describe('buildVersionSnapshot', () => {
  it('returns null for empty files', () => {
    expect(buildVersionSnapshot('req', {})).toBeNull();
    expect(buildVersionSnapshot('req', null as any)).toBeNull();
  });

  it('builds a snapshot with id, name, timestamp from `now`', () => {
    const snap = buildVersionSnapshot('build a todo app', { 'index.html': '<h1>Hi</h1>' }, 1000);
    expect(snap).not.toBeNull();
    expect(snap!.id).toBe('1000');
    expect(snap!.timestamp).toBe(1000);
    expect(snap!.name).toBe('Build: build a todo app');
    expect(snap!.label).toBe('build');
  });

  it('truncates the build request name to 40 chars', () => {
    const longReq = 'x'.repeat(100);
    const snap = buildVersionSnapshot(longReq, { 'a.js': 'code' }, 1);
    // "Build: " + 40 chars
    expect(snap!.name).toBe('Build: ' + 'x'.repeat(40));
  });

  it('strips base64 image data-URLs from stored files', () => {
    const withImg = '<img src="data:image/png;base64,AAAABBBBCCCC=="/>';
    const snap = buildVersionSnapshot('req', { 'index.html': withImg }, 1);
    expect(snap!.files['index.html']).toBe('<img src="(image)"/>');
    expect(snap!.files['index.html']).not.toContain('base64');
  });

  it('uses index.html for the code preview when present', () => {
    const snap = buildVersionSnapshot('req', { 'index.html': '<h1>Home</h1>', 'app.js': 'x' }, 1);
    expect(snap!.code).toBe('<h1>Home</h1>');
  });

  it('falls back to concatenated content for code when no index.html', () => {
    const snap = buildVersionSnapshot('req', { 'a.js': 'AAA', 'b.js': 'BBB' }, 1);
    expect(snap!.code).toContain('AAA');
    expect(snap!.code).toContain('BBB');
  });

  it('caps the code preview at 5000 chars', () => {
    const big = 'z'.repeat(10000);
    const snap = buildVersionSnapshot('req', { 'index.html': big }, 1);
    expect(snap!.code.length).toBe(5000);
  });

  it('records total content size', () => {
    const snap = buildVersionSnapshot('req', { 'a.js': 'ABC', 'b.js': 'DE' }, 1);
    expect(snap!.size).toBe(5);
  });
});

describe('appendVersionSnapshot', () => {
  const mk = (id: string): VersionSnapshot => ({
    id, name: `Build ${id}`, code: '', files: {}, timestamp: Number(id), label: 'build', size: 0,
  });

  it('prepends the newest snapshot', () => {
    const result = appendVersionSnapshot(mk('2'), [mk('1')]);
    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('1');
  });

  it('does not mutate the existing array', () => {
    const existing = [mk('1')];
    appendVersionSnapshot(mk('2'), existing);
    expect(existing).toHaveLength(1);
    expect(existing[0].id).toBe('1');
  });

  it(`caps the list at ${MAX_VERSION_SNAPSHOTS} entries`, () => {
    const existing = Array.from({ length: MAX_VERSION_SNAPSHOTS }, (_, i) => mk(String(i)));
    const result = appendVersionSnapshot(mk('new'), existing);
    expect(result).toHaveLength(MAX_VERSION_SNAPSHOTS);
    expect(result[0].id).toBe('new');
  });

  it('respects a custom max', () => {
    const existing = [mk('1'), mk('2')];
    const result = appendVersionSnapshot(mk('3'), existing, 2);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.id)).toEqual(['3', '1']);
  });
});
