/**
 * WE ADVISED A COMMAND WE HAD ALREADY RUN, AND THAT COULD NOT WORK — build `1ef27cd7`, 2026-09-14.
 *
 * `DEPENDENCY_VULNERABILITIES` read *"Running `npm audit fix` applies the compatible fixes"*. But
 * `AGENTV3_AUDIT_FIX=on` is set in production, so the build RAN `npm audit fix` itself (exit 1), and
 * npm's own output said the remaining four need `npm audit fix --force` — a breaking major upgrade.
 *
 * Worse: `looksLikeDependencyInstall` matches `audit`, so the note was RE-PARSED from that very output
 * and still advised the command that had just been run to no effect.
 *
 * ⚠️ THE FLAG IS READ FROM THE COMMAND LOG, NOT FROM THE ENV. A build where the fix was skipped for
 * time must still get the advice — what the note describes is what happened in THIS run.
 */
import { describe, it, expect } from 'vitest';
import { npmAuditNote } from '../src/server/AgentV3/npmAuditSummary';

// The exact tree from report 1ef27cd7, after `npm audit fix` had already run.
const after = { total: 4, critical: 0, high: 1, moderate: 3, low: 0, info: 0 };

describe('🔴 the vulnerability note must not advise what the build already did', () => {
  it('when the compatible fix already ran, it says so instead of re-advising it', () => {
    const note = npmAuditNote(after, { compatibleFixAlreadyRun: true })!;
    expect(note).toContain('4 known vulnerabilities');
    expect(note).toContain('1 of them is high or critical');
    expect(note).toContain('already applied automatically during this build');
    expect(note).toContain('major-version upgrade');
    expect(note).not.toMatch(/Running `npm audit fix` applies/);
  });

  it('when it did NOT run, the original advice is unchanged', () => {
    const note = npmAuditNote(after)!;
    expect(note).toContain('Running `npm audit fix` applies the compatible fixes');
    expect(note).not.toContain('already applied');
  });

  it('🔒 `--force` is never suggested, on either branch', () => {
    // It applies breaking major upgrades — a way to take a working app down while claiming to secure
    // it. The honest line names the situation and leaves the judgement with the app's owner.
    for (const opts of [undefined, { compatibleFixAlreadyRun: true }]) {
      expect(npmAuditNote(after, opts)).not.toContain('--force');
    }
  });

  it('a clean tree still says nothing at all, either way', () => {
    const clean = { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
    expect(npmAuditNote(clean, { compatibleFixAlreadyRun: true })).toBeNull();
    expect(npmAuditNote(null, { compatibleFixAlreadyRun: true })).toBeNull();
  });
});

describe('🔒 the flag is wired from the COMMAND LOG', () => {
  const src = require('fs').readFileSync(
    require('path').join(process.cwd(), 'src/server/AgentV3/BuildDiagnostics.ts'), 'utf8',
  ) as string;

  it('recordCommand detects the compatible fix and passes it to the note', () => {
    expect(src).toContain('compatibleAuditFixRan');
    expect(src).toContain('npmAuditNote(audit, { compatibleFixAlreadyRun: this.compatibleAuditFixRan })');
  });

  it('a `--force` run does NOT count as the compatible fix', () => {
    // We never run --force ourselves; if a user's own command shows up in the log, it is a different
    // thing entirely and must not silence the honest advice.
    expect(src).toContain('!/--force/.test(rec.command)');
  });
});
