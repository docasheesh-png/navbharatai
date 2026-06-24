import { describe, it, expect } from 'vitest';
import { scanViteEnvExposure, hasCustomEnvPrefix, viteEnvSummary } from './ViteEnvAnalysis';

describe('scanViteEnvExposure', () => {
  it('flags a non-VITE_ import.meta.env reference', () => {
    const issues = scanViteEnvExposure('src/api.ts', 'const key = import.meta.env.API_KEY;');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'src/api.ts', line: 1, name: 'API_KEY' });
  });

  it('flags the bracket form too', () => {
    const issues = scanViteEnvExposure('a.ts', 'const u = import.meta.env["BACKEND_URL"];');
    expect(issues[0].name).toBe('BACKEND_URL');
  });

  it('does NOT flag VITE_-prefixed vars or Vite builtins', () => {
    expect(scanViteEnvExposure('a.ts', 'const u = import.meta.env.VITE_API_URL;')).toEqual([]);
    expect(scanViteEnvExposure('a.ts', 'if (import.meta.env.DEV) log();')).toEqual([]);
    expect(scanViteEnvExposure('a.ts', 'const m = import.meta.env.MODE, b = import.meta.env.BASE_URL;')).toEqual([]);
  });

  it('does NOT flag process.env (server) references', () => {
    expect(scanViteEnvExposure('a.ts', 'const k = process.env.API_KEY;')).toEqual([]);
  });

  it('ignores comments and non-code files', () => {
    expect(scanViteEnvExposure('a.ts', '// import.meta.env.API_KEY is a note')).toEqual([]);
    expect(scanViteEnvExposure('README.md', 'import.meta.env.API_KEY')).toEqual([]);
  });

  it('reports the correct line and multiple refs', () => {
    const src = 'const a = 1;\nconst k = import.meta.env.SECRET_KEY;\nconst t = import.meta.env.TOKEN;';
    const issues = scanViteEnvExposure('s.ts', src);
    expect(issues.map((i) => `${i.name}:${i.line}`)).toEqual(['SECRET_KEY:2', 'TOKEN:3']);
  });
});

describe('hasCustomEnvPrefix', () => {
  it('is true when vite config sets envPrefix, false otherwise', () => {
    expect(hasCustomEnvPrefix("export default { envPrefix: ['VITE_', 'APP_'] }")).toBe(true);
    expect(hasCustomEnvPrefix('export default { plugins: [react()] }')).toBe(false);
    expect(hasCustomEnvPrefix(null)).toBe(false);
  });
});

describe('viteEnvSummary', () => {
  it('renders the clean line when there are no issues', () => {
    expect(viteEnvSummary([])).toContain('✓');
  });
  it('lists each ref with the VITE_ rename hint', () => {
    const out = viteEnvSummary(scanViteEnvExposure('src/api.ts', 'const k = import.meta.env.API_KEY;'));
    expect(out).toContain('src/api.ts:1');
    expect(out).toContain('VITE_API_KEY');
  });
});
