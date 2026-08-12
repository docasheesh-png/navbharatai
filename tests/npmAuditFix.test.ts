import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldRunAuditFix, auditFixEnabled, auditFixOutcome, auditFixSeverity, AUDIT_FIX_COMMAND } from '../src/server/AgentV3/npmAuditFix';
import { parseNpmAuditSummary, type NpmAuditSummary } from '../src/server/AgentV3/npmAuditSummary';

/**
 * ADMIN 2026-08-12, on the dukaan stock app shipping 8 vulnerabilities (4 high): "in dono ko aap fix
 * kar sakte ho?"
 *
 * The reporting half shipped in #2304 — the build now SAYS what npm found. This is the remediation
 * half: actually applying the fixes.
 *
 * WHAT IS SAFE TO RUN. npm prints two suggestions on every vulnerable tree:
 *
 *     npm audit fix           ← updates only WITHIN the SemVer ranges package.json already declares
 *     npm audit fix --force   ← applies BREAKING major upgrades
 *
 * Only the first is defensible unattended. It changes nothing the next ordinary `npm install` would
 * not change anyway, so it cannot introduce an incompatibility the project had not already accepted.
 * `--force` can swap a dependency for a major version whose API the generated code was never written
 * against — running that on a user's behalf is a way to break a working app while claiming to secure
 * it. It is not offered, not configurable, and not one flag away.
 */

const on = { AGENTV3_AUDIT_FIX: 'on' } as NodeJS.ProcessEnv;
const sum = (p: Partial<NpmAuditSummary>): NpmAuditSummary =>
  ({ total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0, ...p });

describe('the one command, and the one it will never run', () => {
  it('is `npm audit fix`, without --force', () => {
    expect(AUDIT_FIX_COMMAND).toBe('npm audit fix');
  });

  it('--force appears NOWHERE in the module', () => {
    // Not a flag, not an env, not a fallback. The safety is structural, not a default someone can flip.
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/npmAuditFix.ts'), 'utf8');
    expect(src.replace(/^\s*\/[/*].*$/gm, '')).not.toMatch(/--force/);
  });
});

describe('when it runs — and, mostly, when it does not', () => {
  it('is OFF unless the admin switches it on', () => {
    /**
     * This step MUTATES THE LOCKFILE of every app it touches. Every other behaviour-changing gate in
     * this engine shipped default-off and was enabled after real builds proved it clean; a larger step
     * earns the same discipline, not less of it.
     */
    expect(auditFixEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(auditFixEnabled({ AGENTV3_AUDIT_FIX: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(auditFixEnabled({ AGENTV3_AUDIT_FIX: 'true' } as NodeJS.ProcessEnv)).toBe(false); // exactly 'on'
    expect(auditFixEnabled(on)).toBe(true);
  });

  it('runs for the report\'s exact case — 4 high', () => {
    expect(shouldRunAuditFix(parseNpmAuditSummary('8 vulnerabilities (4 moderate, 4 high)'), on)).toBe(true);
  });

  it('does NOT run for moderate/low alone', () => {
    /**
     * A lockfile rewrite costs real seconds on every build and carries a small, real regression risk.
     * Spending that on a low advisory in a transitive test-only dependency is a bad trade — the risk
     * is taken exactly where the payoff is.
     */
    expect(shouldRunAuditFix(sum({ total: 5, moderate: 3, low: 2 }), on)).toBe(false);
  });

  it('does NOT run on a clean tree, or on one we never measured', () => {
    // Null means "we never found out", and acting on ignorance rewrites a lockfile for no reason.
    expect(shouldRunAuditFix(sum({ total: 0 }), on)).toBe(false);
    expect(shouldRunAuditFix(null, on)).toBe(false);
    expect(shouldRunAuditFix(undefined, on)).toBe(false);
  });

  it('the switch beats the finding, never the other way round', () => {
    expect(shouldRunAuditFix(sum({ total: 9, critical: 9 }), {} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('what the report says afterwards — including the unflattering outcomes', () => {
  const before = sum({ total: 8, high: 4, moderate: 4 });

  it('all clear says all clear', () => {
    const n = auditFixOutcome(before, sum({ total: 0 }), true)!;
    expect(n).toMatch(/Fixed all 8 known vulnerabilities/);
    expect(n).toMatch(/no breaking upgrades/);
  });

  it('a partial fix names both numbers', () => {
    const n = auditFixOutcome(before, sum({ total: 3, high: 1, low: 2 }), true)!;
    expect(n).toMatch(/Fixed 5 of 8/);
    expect(n).toMatch(/3 remain \(1 high\/critical\)/);
    expect(n).toMatch(/breaking major upgrade/);
  });

  it('a fix that changed NOTHING says so plainly', () => {
    /**
     * The most tempting outcome to round up. "Ran the fix" reads like success; it is not, and the
     * count the admin sees afterwards is the one they will trust.
     */
    const n = auditFixOutcome(before, before, true)!;
    expect(n).toMatch(/could not fix any of the 8/);
    expect(n).toMatch(/a decision for a person, not a build/);
  });

  it('an UNREADABLE result is never reported as fixed', () => {
    // An unverified claim about security is the one kind this engine must not make.
    const n = auditFixOutcome(before, null, true)!;
    expect(n).toMatch(/could not be re-read/);
    expect(n).toMatch(/UNKNOWN/);
    expect(n).not.toMatch(/Fixed \d/);
  });

  it('when the fix did NOT run, it says they shipped — and how to change that', () => {
    const n = auditFixOutcome(before, null, false)!;
    expect(n).toMatch(/did NOT run/);
    expect(n).toMatch(/the app shipped with them/);
    expect(n).toMatch(/AGENTV3_AUDIT_FIX=on/);
  });

  it('says nothing at all when there was nothing to fix', () => {
    expect(auditFixOutcome(sum({ total: 0 }), sum({ total: 0 }), true)).toBeNull();
    expect(auditFixOutcome(null, null, true)).toBeNull();
  });

  it('severity: only a genuinely clean, verified result is informational', () => {
    expect(auditFixSeverity(sum({ total: 0 }), true)).toBe('info');
    expect(auditFixSeverity(sum({ total: 2, low: 2 }), true)).toBe('info');
    expect(auditFixSeverity(sum({ total: 1, high: 1 }), true)).toBe('warning');
    expect(auditFixSeverity(null, true)).toBe('warning');   // unverified is not clean
    expect(auditFixSeverity(sum({ total: 0 }), false)).toBe('warning'); // did not run ⇒ they shipped
  });

  it('names no provider or model — white-label law', () => {
    expect(auditFixOutcome(before, sum({ total: 0 }), true)!).not.toMatch(/\b(glm|kimi|claude|anthropic|openai|gemini|grok|sonnet|opus)\b/i);
  });
});

describe('WIRING — the agent\'s own install is where the vulnerabilities came from', () => {
  const dispatcher = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
  const actuator = readFileSync(join(process.cwd(), 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

  it('hooks the AGENT\'s bash install — the dukaan report\'s actual source', () => {
    expect(dispatcher).toContain('if (exitCode === 0 && looksLikeDependencyInstall(command))');
    expect(dispatcher).toContain('if (shouldRunAuditFix(before))');
  });

  it('only after a SUCCESSFUL command — a broken install has no tree worth fixing', () => {
    expect(dispatcher).toContain('exitCode === 0 && looksLikeDependencyInstall');
  });

  it('the fix is recorded like any other command, so the count comes from the SHIPPED tree', () => {
    // One reporting route, not two: the post-fix summary replaces the pre-fix one through the same
    // path every install already uses.
    expect(dispatcher).toContain('command: AUDIT_FIX_COMMAND, exitCode: fix ? fix.exitCode : null');
  });

  it('the PLATFORM\'s own installs are covered too', () => {
    // Fixing only the path that happened to fail this time is how a sibling failure comes back.
    expect(actuator).toContain('const withAuditFix = async (log: string): Promise<string> =>');
    expect(actuator).toContain('if (!shouldRunAuditFix(parseNpmAuditSummary(log))) return log;');
  });

  it('a failed platform install skips it', () => {
    expect(actuator).toContain('log: retry.exitCode === 0 ? await withAuditFix(combined) : combined,');
  });

  it('every path is best-effort — a security step can never fail a working build', () => {
    expect(dispatcher).toContain('catch { /* a security step must never break the command it followed */ }');
    expect(actuator).toContain('return log; // a security step that breaks the install would be worse than the vulnerability');
  });
});
