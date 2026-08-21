import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { secretFindings, configFindings, countFindings, scanVerdict, SCAN_STAGES } from './securityScan';

describe('secretFindings — real findings from real files', () => {
  it('finds a hardcoded key and points at the exact line', () => {
    const f = secretFindings({ 'src/api.ts': 'const x = 1;\nconst KEY = "sk-9f8a7b6c5d4e3f2a1b0c9d8e";\n' });
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].file).toBe('src/api.ts');
    expect(f[0].line).toBe(2);
  });

  it('does NOT cry wolf over an env lookup or a placeholder', () => {
    // A false "you leaked a key" is worse than a missed one: it teaches people to ignore the report.
    const f = secretFindings({
      'src/a.ts': 'const KEY = process.env.API_KEY;\n',
      'src/b.ts': 'const KEY = "your-api-key-here";\n',
    });
    expect(f).toEqual([]);
  });

  it('leaves out the smells that are real but are not SECURITY', () => {
    // Padding a security report with "you left a console.log" is how it stops being read.
    const f = secretFindings({ 'src/a.ts': 'console.log("debug");\n// TODO: finish this\n' });
    expect(f).toEqual([]);
  });
});

describe('configFindings — provable from the files themselves', () => {
  it('flags a committed .env with real content, and ignores an empty one', () => {
    expect(configFindings({ '.env': 'SECRET=abc123\n' })[0].severity).toBe('critical');
    expect(configFindings({ '.env': '   ' })).toEqual([]);
  });

  it('flags a dependency that accepts ANY future version', () => {
    const f = configFindings({ 'package.json': JSON.stringify({ dependencies: { lodash: '*' } }, null, 2) });
    expect(f.some((x) => x.problem.includes('lodash') && x.severity === 'high')).toBe(true);
  });

  it('accepts a normal pinned range without complaint', () => {
    const f = configFindings({
      'package.json': JSON.stringify({ dependencies: { react: '^18.2.0' } }, null, 2),
      'package-lock.json': '{}',
    });
    expect(f).toEqual([]);
  });

  it('flags an install hook — the usual way malicious code runs on a developer machine', () => {
    const f = configFindings({
      'package.json': JSON.stringify({ scripts: { postinstall: 'node setup.js' } }, null, 2),
      'yarn.lock': '',
    });
    expect(f.some((x) => x.problem.includes('postinstall'))).toBe(true);
  });

  it('flags a missing lockfile, and is satisfied by any of the three', () => {
    expect(configFindings({ 'package.json': '{}' }).some((f) => f.problem.includes('lockfile'))).toBe(true);
    for (const lock of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
      expect(configFindings({ 'package.json': '{}', [lock]: '' }).some((f) => f.problem.includes('lockfile'))).toBe(false);
    }
  });

  it('says a manifest could not be READ rather than reporting it clean', () => {
    // "No issues" about a file we could not parse is the same class of lie as the fake progress bar.
    const f = configFindings({ 'package.json': '{ not json', 'yarn.lock': '' });
    expect(f.some((x) => x.problem.includes('could not be read'))).toBe(true);
  });

  it('finds nothing in a project that has nothing wrong', () => {
    expect(configFindings({ 'src/app.ts': 'export const x = 1;\n' })).toEqual([]);
  });
});

describe('scanVerdict — never lets a partial scan read like a clean bill of health', () => {
  const none = countFindings([]);

  it('says so when every check ran and found nothing', () => {
    expect(scanVerdict(none, 3, 3)).toBe('No issues found in the automatic checks');
  });

  it('admits how many checks completed when one did not', () => {
    expect(scanVerdict(none, 2, 3)).toContain('2 of 3 checks completed');
  });

  it('leads with the worst thing found', () => {
    const counts = countFindings([
      { severity: 'critical', file: 'a', line: 1, problem: '', suggestion: '' },
      { severity: 'low', file: 'b', line: 1, problem: '', suggestion: '' },
    ]);
    expect(scanVerdict(counts, 3, 3)).toContain('1 critical issue');
  });
});

// ── The guard on the thing that was actually broken ──────────────────────────
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (p: string) => codeOnly(readFileSync(join(process.cwd(), p), 'utf8'));

describe('the progress bar reports work, not time', () => {
  const screen = src('src/components/ide/SecurityScan.tsx');
  const route = src('src/server/routes/audit.ts');

  it('the invented phase names are gone', () => {
    // "Phase 3: Static Analysis (SAST) Patterns…" named a check that never ran.
    expect(screen).not.toContain('Static Analysis (SAST)');
    expect(screen).not.toMatch(/Phase \d:/);
  });

  it('nothing advances the bar on a timer any more', () => {
    expect(screen).not.toContain('setInterval');
  });

  it('the bar moves only on a stage the SERVER says finished', () => {
    expect(screen).toContain('(ev.done / ev.total) * 100');
  });

  it('the server runs the stages it names, and emits one event per finished stage', () => {
    expect(route).toContain('secretFindings(');
    expect(route).toContain('configFindings(');
    expect(route).toContain("type: 'stage'");
    expect(SCAN_STAGES).toHaveLength(3);
  });

  it('a failed AI review is reported, with the deterministic findings still shown', () => {
    // Those findings are real and already earned; throwing them away because the last stage failed
    // would lose the only part of the report that cannot be wrong.
    expect(route).toContain('reviewOk');
    expect(screen).toContain('could not run');
  });

  it('a dropped connection is not shown as a finished, clean scan', () => {
    expect(screen).toContain('The connection ended before the scan finished');
  });
});
