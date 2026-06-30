import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// P-CGE.7 — Lint Fix Generator (auto-fix pass).
//
// LintEvaluator runs ESLint and REPORTS errors, after which a failed build went straight to the
// AutoRepairEngine — an expensive LLM round-trip even for trivial lint nits (unused imports, missing
// semicolons, quote style). This lightweight step runs `eslint --fix` (via the project's own lint
// script when present) FIRST, resolving the bulk of auto-fixable errors with ZERO LLM cost, so the
// LLM repair only handles what's genuinely left. Best-effort, bounded — never throws, never blocks.

/** How long the auto-fix may run before we give up (ms). */
const FIX_TIMEOUT_MS = 60_000;

export interface LintFixResult {
  ran: boolean;
  command: string;
  note: string;
}

/**
 * Pure: choose the auto-fix command for a project. Prefer the project's OWN lint script (its config),
 * falling back to a direct `eslint --fix` (no-install, so it uses the project's eslint if installed and
 * fails gracefully otherwise). Returns the command string. Pure + testable.
 */
export function chooseLintFixCommand(pkg: { scripts?: Record<string, unknown> } | null | undefined): string {
  const hasLint = !!pkg && typeof pkg === 'object' && !!pkg.scripts && typeof pkg.scripts.lint === 'string';
  return hasLint
    ? 'npm run lint -- --fix'
    : 'npx --no-install eslint . --ext .ts,.tsx,.js,.jsx,.mjs,.cjs --fix';
}

export class LintFixGenerator {
  /**
   * Run the auto-fix pass in the workspace. `ran:true` means the command executed (it may still leave
   * un-auto-fixable errors for the LLM repair — eslint exits non-zero in that case, which is NOT a
   * failure for us: it still wrote the fixes it could). Best-effort — never throws.
   */
  async fix(workspaceId: string): Promise<LintFixResult> {
    let pkg: { scripts?: Record<string, unknown> } | null = null;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(workspaceId, 'package.json'), 'utf8'));
    } catch {
      return { ran: false, command: '', note: 'no package.json — skipped lint auto-fix' };
    }
    const command = chooseLintFixCommand(pkg);
    try {
      await execPromise(command, { cwd: workspaceId, timeout: FIX_TIMEOUT_MS });
      return { ran: true, command, note: 'lint auto-fix applied (clean exit)' };
    } catch (e: any) {
      // eslint --fix exits non-zero when un-auto-fixable errors remain — but it STILL wrote the fixes
      // it could. Treat "command executed" as ran:true so the orchestrator rebuilds before the LLM repair.
      const executed = typeof e?.code === 'number' || typeof e?.stdout === 'string' || typeof e?.stderr === 'string';
      return { ran: executed, command, note: executed ? 'lint auto-fix applied (residual errors remain)' : `lint auto-fix could not run: ${e?.message || e}` };
    }
  }
}
