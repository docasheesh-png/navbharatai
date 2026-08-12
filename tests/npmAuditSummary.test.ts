import { describe, it, expect } from 'vitest';
import { parseNpmAuditSummary, npmAuditNote, auditSeverity, looksLikeDependencyInstall } from '../src/server/AgentV3/npmAuditSummary';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. Four HIGH-severity vulnerabilities shipped into a
 * shop owner's inventory app, and the build report said nothing about it.
 *
 * The build's own install command printed:
 *
 *     added 182 packages, and audited 183 packages in 16s
 *     8 vulnerabilities (4 moderate, 4 high)
 *     To address issues that do not require attention, run:  npm audit fix
 *
 * The report contained no vulnerability finding of any kind. Not "we checked and it's fine", not "we
 * couldn't check" — nothing.
 *
 * The platform DOES have a dependency-health gate, and it was on. It asks the OSV API over the network
 * and — by its own documentation — returns '' (clean) when that API is unreachable. So "no
 * vulnerabilities" and "we never found out" produce byte-identical output. Silence proved nothing in
 * either direction, which is the same class of dishonesty the wallet rules forbid elsewhere: "free" and
 * "unmeasured" must stay separate outcomes.
 *
 * Meanwhile npm had already run the audit, already printed the answer, and we had already captured the
 * output. No network call, no model call, no extra command — the measurement was sitting in a log
 * nobody parsed.
 */

const DUKAAN_LOG = `
added 182 packages, and audited 183 packages in 16s

25 packages are looking for funding
  run \`npm fund\` for details

8 vulnerabilities (4 moderate, 4 high)

To address issues that do not require attention, run:
  npm audit fix
`;

describe('the answer npm had already given us', () => {
  it('reads the report\'s exact line', () => {
    expect(parseNpmAuditSummary(DUKAAN_LOG)).toEqual({ total: 8, critical: 0, high: 4, moderate: 4, low: 0, info: 0 });
  });

  it('the LAST install wins — only the final tree is the one that ships', () => {
    /**
     * The dukaan build installed twice and printed the summary twice. Two contradictory lines in one
     * report is worse than one: the reader has to guess which is current.
     */
    const twice = `${DUKAAN_LOG}\nadded 18 packages, and audited 201 packages in 2s\n\n3 vulnerabilities (1 low, 2 critical)\n`;
    expect(parseNpmAuditSummary(twice)).toEqual({ total: 3, critical: 2, high: 0, moderate: 0, low: 1, info: 0 });
  });

  it('reads npm 6, npm 7+, and the singular forms', () => {
    expect(parseNpmAuditSummary('found 12 vulnerabilities (3 low, 9 moderate)')!.total).toBe(12);
    expect(parseNpmAuditSummary('1 high severity vulnerability')).toMatchObject({ total: 1, high: 1 });
    expect(parseNpmAuditSummary('2 moderate severity vulnerabilities\n1 critical severity vulnerability'))
      .toMatchObject({ total: 3, moderate: 2, critical: 1 });
  });

  it('a CLEAN tree is a real measurement, not an absence of one', () => {
    // This is the distinction the OSV gate could not make. Zero is an answer; it just is not a finding.
    expect(parseNpmAuditSummary('found 0 vulnerabilities')).toEqual({ total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 });
    expect(npmAuditNote(parseNpmAuditSummary('found 0 vulnerabilities'))).toBeNull();
    expect(auditSeverity(parseNpmAuditSummary('found 0 vulnerabilities'))).toBeNull();
  });

  it('a log with no audit summary returns NULL, which is not zero', () => {
    /**
     * THE LINE THAT MATTERS. Conflating "nothing to report" with "we did not look" is the whole defect
     * being fixed; a parser that returned zeros here would rebuild it one layer down.
     */
    for (const log of ['', '   ', 'added 5 packages in 2s', undefined, null]) {
      expect(parseNpmAuditSummary(log as any), String(log)).toBeNull();
    }
  });
});

describe('what the user is told, and what they are not', () => {
  it('names the count, the severities, and the ONE safe command', () => {
    const n = npmAuditNote(parseNpmAuditSummary(DUKAAN_LOG))!;
    expect(n).toMatch(/8 known vulnerabilities/);
    expect(n).toMatch(/4 high, 4 moderate/); // severity-DESCENDING, not npm's arbitrary order
    expect(n).toMatch(/4 of them are high or critical/);
    expect(n).toMatch(/npm audit fix/);
  });

  it('never suggests --force', () => {
    /**
     * npm prints BOTH commands. `npm audit fix` is SemVer-compatible by npm's own contract; `--force`
     * applies breaking major upgrades and can take a working app down. Handing a non-technical user the
     * second one would be handing them a way to break their own app on our advice.
     */
    const n = npmAuditNote(parseNpmAuditSummary(DUKAAN_LOG))!;
    expect(n).not.toMatch(/--force/);
    expect(n).toMatch(/will not change how the app behaves/);
  });

  it('reads as English for a single vulnerability', () => {
    const n = npmAuditNote(parseNpmAuditSummary('1 high severity vulnerability'))!;
    expect(n).toMatch(/1 known vulnerability/);
    expect(n).toMatch(/1 of them is high or critical/);
  });

  it('names no provider or model — white-label law', () => {
    expect(npmAuditNote(parseNpmAuditSummary(DUKAAN_LOG))!).not.toMatch(/\b(glm|kimi|claude|anthropic|openai|gemini|grok|sonnet|opus)\b/i);
  });
});

describe('severity — loud enough to act on, never loud enough to block', () => {
  it('high or critical is a WARNING', () => {
    expect(auditSeverity(parseNpmAuditSummary(DUKAAN_LOG))).toBe('warning');
    expect(auditSeverity(parseNpmAuditSummary('1 critical severity vulnerability'))).toBe('warning');
  });

  it('moderate and low alone are INFO — a warning on every build is a warning nobody reads', () => {
    expect(auditSeverity(parseNpmAuditSummary('3 vulnerabilities (2 low, 1 moderate)'))).toBe('info');
  });

  it('it is never an ERROR anywhere in the module', () => {
    // A working app with a vulnerable transitive dependency still works. Blocking it would fail builds
    // over something we cannot safely fix on the user's behalf.
    for (const log of [DUKAAN_LOG, '9 vulnerabilities (9 critical)', 'found 0 vulnerabilities']) {
      expect(['warning', 'info', null]).toContain(auditSeverity(parseNpmAuditSummary(log)));
    }
  });
});

describe('it only looks at commands that could carry an audit', () => {
  it('recognises the real install forms', () => {
    for (const c of ['npm install express', 'npm i -D vitest', 'npm ci', 'npm audit', 'pnpm add react', 'yarn install', 'bun install']) {
      expect(looksLikeDependencyInstall(c), c).toBe(true);
    }
  });

  it('ignores everything else', () => {
    for (const c of ['npm run build', 'tsc --noEmit', 'ls -la', '', undefined, null]) {
      expect(looksLikeDependencyInstall(c as any), String(c)).toBe(false);
    }
  });
});

describe('WIRING — every install path, by construction', () => {
  const install = (stdout: string) => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm install express cors multer 2>&1', exitCode: 0, stdout, durationMs: 16_000 });
    return d.report().issues.filter((i) => i.code === 'DEPENDENCY_VULNERABILITIES');
  };

  it('an install that reports vulnerabilities produces a finding', () => {
    const found = install(DUKAAN_LOG);
    expect(found.length).toBe(1);
    expect(found[0].severity).toBe('warning');
    expect(found[0].autoResolved).toBe(false);
    expect(found[0].message).toMatch(/8 known vulnerabilities/);
  });

  it('a clean install produces none', () => {
    expect(install('added 5 packages\n\nfound 0 vulnerabilities\n').length).toBe(0);
  });

  it('a build that never installs anything produces none', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm run build', exitCode: 0, stdout: 'done', durationMs: 10 });
    expect(d.report().issues.filter((i) => i.code === 'DEPENDENCY_VULNERABILITIES').length).toBe(0);
  });

  it('a SECOND install replaces the first finding instead of stacking a contradiction', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm install a', exitCode: 0, stdout: '8 vulnerabilities (4 moderate, 4 high)' });
    d.recordCommand({ command: 'npm install b', exitCode: 0, stdout: '2 vulnerabilities (2 low)' });
    const found = d.report().issues.filter((i) => i.code === 'DEPENDENCY_VULNERABILITIES');
    expect(found.length).toBe(1);
    expect(found[0].message).toMatch(/2 known vulnerabilities/);
    expect(found[0].severity).toBe('info'); // low-only — the finding downgraded honestly with the tree
  });

  it('the command itself is still recorded exactly as before', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: 'npm install express', exitCode: 0, stdout: DUKAAN_LOG, durationMs: 16_000 });
    const cmds = d.report().commands ?? [];
    expect(cmds.length).toBe(1);
    expect(cmds[0].command).toBe('npm install express');
  });
});
