import { describe, it, expect } from 'vitest';
import { analyzeCiWorkflow, ciWorkflowSummary, repairCiWorkflow } from './ciWorkflowAnalysis';

const WF = '.github/workflows/ci.yml';
const wf = (run: string) => `name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n${run}\n`;

describe('analyzeCiWorkflow — deterministic CI breakages', () => {
  it('flags `npm ci` when no lockfile is committed', () => {
    const issues = analyzeCiWorkflow({ [WF]: wf('      - run: npm ci'), 'package.json': '{"name":"x"}' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'npm-ci-no-lockfile', autoFixable: true });
  });

  it('does NOT flag `npm ci` when a lockfile IS present (no false positive)', () => {
    const issues = analyzeCiWorkflow({ [WF]: wf('      - run: npm ci'), 'package-lock.json': '{}' });
    expect(issues.filter((i) => i.kind === 'npm-ci-no-lockfile')).toEqual([]);
  });

  it('flags a setup-node cache manager mismatch', () => {
    const files = { [WF]: wf("      - uses: actions/setup-node@v4\n        with:\n          cache: 'npm'"), 'pnpm-lock.yaml': '' };
    const issues = analyzeCiWorkflow(files);
    expect(issues.some((i) => i.kind === 'cache-manager-mismatch')).toBe(true);
  });

  it('flags an `npm run <script>` for a script package.json does not define', () => {
    const files = { [WF]: wf('      - run: npm run typecheck'), 'package.json': '{"scripts":{"build":"vite build"}}', 'package-lock.json': '{}' };
    const issues = analyzeCiWorkflow(files);
    expect(issues.some((i) => i.kind === 'missing-script' && i.message.includes('typecheck'))).toBe(true);
  });

  it('does NOT flag a script that exists', () => {
    const files = { [WF]: wf('      - run: npm run build'), 'package.json': '{"scripts":{"build":"vite build"}}', 'package-lock.json': '{}' };
    expect(analyzeCiWorkflow(files).filter((i) => i.kind === 'missing-script')).toEqual([]);
  });

  it('ignores non-workflow files and never throws on garbage', () => {
    expect(analyzeCiWorkflow({ 'src/a.ts': 'npm ci' })).toEqual([]);
    expect(analyzeCiWorkflow({ [WF]: wf('- run: npm ci'), 'package.json': '{bad json' })).toBeInstanceOf(Array);
    expect(analyzeCiWorkflow({})).toEqual([]);
  });
});

describe('repairCiWorkflow', () => {
  it('rewrites `npm ci` → `npm install` when no lockfile exists', () => {
    const files = { [WF]: wf('      - run: npm ci') };
    const r = repairCiWorkflow(WF, files);
    expect(r.content).toContain('npm install');
    expect(r.content).not.toMatch(/npm ci\b/);
    expect(r.fixes.length).toBe(1);
  });

  it('repoints a mismatched cache to the project’s real manager', () => {
    const files = { [WF]: wf("      - run: pnpm install\n        # cache: 'npm'\n      - uses: x\n        with:\n          cache: 'npm'"), 'pnpm-lock.yaml': '' };
    const r = repairCiWorkflow(WF, files);
    expect(r.content).toContain("cache: 'pnpm'");
    expect(r.fixes.some((f) => f.includes('pnpm'))).toBe(true);
  });

  it('is a no-op (no fixes) on a healthy workflow', () => {
    const files = { [WF]: wf('      - run: npm ci'), 'package-lock.json': '{}' };
    const r = repairCiWorkflow(WF, files);
    expect(r.fixes).toEqual([]);
    expect(r.content).toContain('npm ci');
  });
});

describe('ciWorkflowSummary', () => {
  it('is empty when clean, lists issues otherwise', () => {
    expect(ciWorkflowSummary([])).toBe('');
    const issues = analyzeCiWorkflow({ [WF]: wf('      - run: npm ci'), 'package.json': '{}' });
    expect(ciWorkflowSummary(issues)).toContain('CI workflow —');
  });
});

describe('analyzeCiWorkflow — GitLab CI + Jenkins (GA-14)', () => {
  it('flags `npm ci` with no lockfile in a .gitlab-ci.yml', () => {
    const files = { '.gitlab-ci.yml': 'build:\n  script:\n    - npm ci\n    - npm run build\n', 'package.json': '{"scripts":{"build":"vite build"}}' };
    const issues = analyzeCiWorkflow(files);
    expect(issues.some((i) => i.kind === 'npm-ci-no-lockfile' && i.file === '.gitlab-ci.yml')).toBe(true);
  });

  it('flags a missing npm script in a Jenkinsfile (// comments respected)', () => {
    const files = { 'Jenkinsfile': "pipeline {\n  stages {\n    stage('build') {\n      steps {\n        sh 'npm run typecheck' // was: lint\n      }\n    }\n  }\n}\n", 'package.json': '{"scripts":{"build":"x"}}', 'package-lock.json': '{}' };
    const issues = analyzeCiWorkflow(files);
    expect(issues.some((i) => i.kind === 'missing-script' && i.file === 'Jenkinsfile' && i.message.includes('typecheck'))).toBe(true);
  });

  it('does NOT apply the setup-node cache rule to GitLab/Jenkins (GitHub-only)', () => {
    const files = { '.gitlab-ci.yml': "job:\n  cache: 'npm'\n  script:\n    - echo hi\n", 'pnpm-lock.yaml': '' };
    expect(analyzeCiWorkflow(files).filter((i) => i.kind === 'cache-manager-mismatch')).toEqual([]);
  });

  it('repairs `npm ci` → `npm install` in a .gitlab-ci.yml', () => {
    const r = repairCiWorkflow('.gitlab-ci.yml', { '.gitlab-ci.yml': 'build:\n  script:\n    - npm ci\n' });
    expect(r.content).toContain('npm install');
    expect(r.fixes.length).toBe(1);
  });
});
