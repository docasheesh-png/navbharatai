import { describe, it, expect } from 'vitest';
import {
  extractEnvRefs,
  parseEnvKeys,
  analyzeEnvVars,
  envVarSummary,
} from './EnvVarAnalysis';

describe('extractEnvRefs', () => {
  it('finds process.env.FOO dot form', () => {
    expect(extractEnvRefs('src/app.ts', 'const k = process.env.FOO;')).toEqual(['FOO']);
  });

  it("finds process.env['BAR'] and double-quote bracket forms", () => {
    expect(extractEnvRefs('src/app.ts', "const a = process.env['BAR'];")).toEqual(['BAR']);
    expect(extractEnvRefs('src/app.ts', 'const a = process.env["BAZ"];')).toEqual(['BAZ']);
  });

  it('finds import.meta.env.VITE_X (Vite) and bracket form', () => {
    expect(extractEnvRefs('src/main.ts', 'const u = import.meta.env.VITE_API_URL;')).toEqual([
      'VITE_API_URL',
    ]);
    expect(extractEnvRefs('src/main.ts', "const u = import.meta.env['VITE_KEY'];")).toEqual([
      'VITE_KEY',
    ]);
  });

  it('de-dupes repeated references within a file', () => {
    const src = 'const a = process.env.TOKEN; const b = process.env.TOKEN;';
    expect(extractEnvRefs('src/app.ts', src)).toEqual(['TOKEN']);
  });

  it('collects multiple distinct names', () => {
    const src = 'process.env.A; process.env.B; import.meta.env.VITE_C;';
    expect(new Set(extractEnvRefs('src/app.ts', src))).toEqual(new Set(['A', 'B', 'VITE_C']));
  });

  it('ignores lowercase and dynamic accesses', () => {
    const src = 'process.env.lowercase; process.env[someVar]; process.env[key + "X"];';
    expect(extractEnvRefs('src/app.ts', src)).toEqual([]);
  });

  it('returns [] for an .env-pathed file (not code)', () => {
    expect(extractEnvRefs('.env', 'process.env.FOO')).toEqual([]);
    expect(extractEnvRefs('.env.example', 'process.env.FOO')).toEqual([]);
  });

  it('returns [] for test and node_modules paths', () => {
    expect(extractEnvRefs('src/app.test.ts', 'process.env.FOO')).toEqual([]);
    expect(extractEnvRefs('node_modules/pkg/index.js', 'process.env.FOO')).toEqual([]);
  });
});

describe('parseEnvKeys', () => {
  it('parses KEY=val lines', () => {
    expect(parseEnvKeys('FOO=1\nBAR=hello')).toEqual(new Set(['FOO', 'BAR']));
  });

  it('parses export KEY=val', () => {
    expect(parseEnvKeys('export TOKEN=abc')).toEqual(new Set(['TOKEN']));
  });

  it('skips comments and blank lines', () => {
    const content = '# a comment\n\nFOO=1\n   # indented comment\nBAR=2\n';
    expect(parseEnvKeys(content)).toEqual(new Set(['FOO', 'BAR']));
  });

  it('returns empty set for null or empty', () => {
    expect(parseEnvKeys(null)).toEqual(new Set());
    expect(parseEnvKeys('')).toEqual(new Set());
  });
});

describe('analyzeEnvVars', () => {
  it('flags an undocumented referenced var as high', () => {
    const issues = analyzeEnvVars(['API_KEY'], new Set());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ name: 'API_KEY', severity: 'high' });
    expect(issues[0].detail).toContain('.env.example');
  });

  it('does NOT flag a documented var', () => {
    expect(analyzeEnvVars(['API_KEY'], new Set(['API_KEY']))).toEqual([]);
  });

  it('does NOT flag allowlisted NODE_ENV / PORT', () => {
    expect(analyzeEnvVars(['NODE_ENV', 'PORT'], new Set())).toEqual([]);
  });

  it('does NOT flag Vite builtins or npm_ runtime vars', () => {
    expect(analyzeEnvVars(['MODE', 'BASE_URL', 'npm_package_version'], new Set())).toEqual([]);
  });

  it('de-dupes referenced names', () => {
    expect(analyzeEnvVars(['X', 'X'], new Set())).toHaveLength(1);
  });
});

describe('envVarSummary', () => {
  it('reports the all-documented case', () => {
    expect(envVarSummary([])).toContain('✓');
  });

  it('reports undocumented variables with a hint', () => {
    const out = envVarSummary(analyzeEnvVars(['API_KEY'], new Set()));
    expect(out).toContain('API_KEY');
    expect(out).toContain('Add these to .env.example');
  });
});
