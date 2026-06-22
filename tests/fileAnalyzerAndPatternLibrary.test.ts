/**
 * Tests for FileAnalyzer (TypeScript AST analysis) and PATTERN_LIBRARY (static data).
 * FileAnalyzer reads real temp files; PatternLibrary tests verify static shape.
 */
import { describe, it, expect } from 'vitest';
import { FileAnalyzer } from '../src/server/AppMakerLab/intelligence/FileAnalyzer';
import { PATTERN_LIBRARY } from '../src/server/AppMakerLab/intelligence/PatternLibrary';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── FileAnalyzer ─────────────────────────────────────────────────────────────

function withTempTs(name: string, content: string, fn: (p: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return fn(file).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

describe('FileAnalyzer', () => {
  it('extracts the file path and contentHash', async () => {
    await withTempTs('sample.ts', 'export const x = 1;', async (fp) => {
      const analyzer = new FileAnalyzer();
      const result = await analyzer.analyze(fp);
      expect(result.path).toBe(fp);
      expect(typeof result.contentHash).toBe('string');
      expect(result.contentHash.length).toBe(64); // sha256 hex
    });
  });

  it('extracts class symbols', async () => {
    await withTempTs('cls.ts', 'export class MyService { }', async (fp) => {
      const analyzer = new FileAnalyzer();
      const result = await analyzer.analyze(fp);
      expect(result.symbols.some((s: any) => s.type === 'class' && s.name === 'MyService')).toBe(true);
    });
  });

  it('extracts function symbols', async () => {
    await withTempTs('fn.ts', 'export function doWork() { return 42; }', async (fp) => {
      const analyzer = new FileAnalyzer();
      const result = await analyzer.analyze(fp);
      expect(result.symbols.some((s: any) => s.type === 'function' && s.name === 'doWork')).toBe(true);
    });
  });

  it('extracts interface symbols', async () => {
    await withTempTs('iface.ts', 'export interface MyModel { id: string; }', async (fp) => {
      const analyzer = new FileAnalyzer();
      const result = await analyzer.analyze(fp);
      expect(result.symbols.some((s: any) => s.type === 'interface' && s.name === 'MyModel')).toBe(true);
    });
  });

  it('extracts import dependencies', async () => {
    await withTempTs('imports.ts', "import { foo } from 'some-lib'; import './local';", async (fp) => {
      const analyzer = new FileAnalyzer();
      const result = await analyzer.analyze(fp);
      expect(result.dependencies).toContain('some-lib');
      expect(result.dependencies).toContain('./local');
    });
  });

  it('identifies tech from file extension', async () => {
    await withTempTs('app.ts', 'export const x = 1;', async (fp) => {
      const analyzer = new FileAnalyzer();
      const result = await analyzer.analyze(fp);
      expect(result.tech).toContain('ts');
    });
  });

  it('returns empty symbols and deps for empty file', async () => {
    await withTempTs('empty.ts', '', async (fp) => {
      const analyzer = new FileAnalyzer();
      const result = await analyzer.analyze(fp);
      expect(result.symbols).toEqual([]);
      expect(result.dependencies).toEqual([]);
    });
  });
});

// ── PatternLibrary ─────────────────────────────────────────────────────────────

describe('PATTERN_LIBRARY', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(PATTERN_LIBRARY)).toBe(true);
    expect(PATTERN_LIBRARY.length).toBeGreaterThan(0);
  });

  it('every pattern has required fields', () => {
    for (const pattern of PATTERN_LIBRARY) {
      expect(typeof pattern.id).toBe('string');
      expect(typeof pattern.description).toBe('string');
      expect(Array.isArray(pattern.supportsFrontend)).toBe(true);
      expect(Array.isArray(pattern.supportsBackend)).toBe(true);
      expect(typeof pattern.requiresDatabase).toBe('boolean');
      expect(typeof pattern.supportsRealtime).toBe('boolean');
      expect(pattern.defaultStack).toBeDefined();
    }
  });

  it('contains a web-standard pattern', () => {
    const wp = PATTERN_LIBRARY.find(p => p.id === 'web-standard');
    expect(wp).toBeDefined();
    expect(wp?.supportsFrontend).toContain('React');
  });

  it('web-realtime pattern supports realtime', () => {
    const rt = PATTERN_LIBRARY.find(p => p.id === 'web-realtime');
    expect(rt?.supportsRealtime).toBe(true);
  });

  it('all pattern ids are unique', () => {
    const ids = PATTERN_LIBRARY.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
