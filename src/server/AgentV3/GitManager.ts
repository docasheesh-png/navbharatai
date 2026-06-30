import type { GitCheckpoint } from './types';

/** The slice of the actuator GitManager needs (real sandboxes only). */
export interface CommandRunner {
  runCommand(
    workspaceId: string,
    command: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/** Anything that can create a checkpoint (GitManager, or a no-op in tests). */
export interface Checkpointer {
  checkpoint(message: string): Promise<GitCheckpoint | null>;
}

/**
 * GitManager — makes the sandbox a real Git repo so checkpoints, History and
 * restore are real commits (not modelled). Best-effort: on a sandbox without a
 * shell (LocalActuator rejects runCommand) every method degrades to a no-op /
 * null, so the engine still runs — it just has no git history there.
 */
export class GitManager implements Checkpointer {
  private ready = false;

  constructor(
    private readonly runner: CommandRunner,
    private readonly workspaceId: string,
  ) {}

  /** Initialise the repo (idempotent). Returns false when git is unavailable. */
  async ensureRepo(): Promise<boolean> {
    try {
      // 1) Ensure a .gitignore exists BEFORE anything is staged. Each checkpoint runs
      //    `git add -A`; without ignoring node_modules/build output, that staged THOUSANDS
      //    of dependency files on every single file write → ~45s per commit → the build blew
      //    past the wall-clock cap and "timed out". We append only the patterns that are
      //    missing, so a real project .gitignore is preserved, never clobbered.
      await this.run(ENSURE_GITIGNORE_CMD);
      // 2) Initialise the repo + identity (idempotent).
      await this.run(
        'git rev-parse --git-dir >/dev/null 2>&1 || ' +
          '( git init -q && git config user.email "agent@navbharatai.dev" ' +
          '&& git config user.name "NavBharatAI v3.0" )',
      );
      // 3) Untrack heavy dirs an OLDER sandbox may have committed before this .gitignore
      //    existed, so future checkpoints stay fast. Best-effort — a no-op on a fresh repo.
      await this.run(
        'git rm -r --cached --quiet node_modules dist build .next out coverage .venv 2>/dev/null || true',
      );
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  /** Stage everything and commit. Returns the real checkpoint, or null if nothing changed / git unavailable. */
  async checkpoint(message: string): Promise<GitCheckpoint | null> {
    if (!this.ready) return null;
    const safe = sanitizeMessage(message);
    try {
      // Commit; `|| true` so "nothing to commit" is not an error.
      await this.run(`git add -A && (git commit -q -m "${safe}" || true)`);
      const head = await this.run('git rev-parse HEAD 2>/dev/null || true');
      const sha = head.stdout.trim();
      if (!sha) return null;
      return { id: `cp_${Date.now()}`, sha, message: safe, ts: Date.now() };
    } catch {
      return null;
    }
  }

  /**
   * Restore the workspace files to a checkpoint SHA (used by History → restore).
   * Uses `git checkout <sha> -- .` so the working tree matches that commit
   * without detaching HEAD; the user can then continue building from there.
   */
  async restore(sha: string): Promise<boolean> {
    if (!this.ready || !/^[0-9a-f]{4,40}$/i.test(sha)) return false;
    try {
      const r = await this.run(`git checkout ${sha} -- .`);
      return r.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Real working-tree status from `git status --porcelain` — how many files changed since the last
   * checkpoint, plus the current HEAD. Returns null when git is unavailable (cold/shell-less sandbox),
   * so callers can show an honest "not active" state instead of a fake "clean". Best-effort.
   */
  async status(): Promise<{ clean: boolean; changed: number; head: string } | null> {
    if (!this.ready) return null;
    try {
      const r = await this.run('git status --porcelain 2>/dev/null');
      if (r.exitCode !== 0) return null;
      const changed = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).length;
      const head = (await this.run('git rev-parse --short HEAD 2>/dev/null || true')).stdout.trim();
      return { clean: changed === 0, changed, head };
    } catch {
      return null;
    }
  }

  private async run(command: string) {
    const r = await this.runner.runCommand(this.workspaceId, command);
    return r;
  }
}

function sanitizeMessage(message: string): string {
  return message.replace(/["`$\\]/g, '').replace(/\r?\n/g, ' ').slice(0, 200) || 'checkpoint';
}

/**
 * Append any MISSING ignore patterns to .gitignore (creating it if absent), without clobbering an
 * existing project .gitignore. Keeping node_modules / build output out of `git add -A` is what
 * makes a checkpoint cost milliseconds instead of ~45s. POSIX sh: `grep -qxF` = exact full-line
 * match, so a pattern is added at most once.
 */
const GITIGNORE_PATTERNS = [
  'node_modules/', 'dist/', 'build/', '.next/', 'out/', 'coverage/',
  '.venv/', '__pycache__/', '.cache/', '.e-checkpoints/', '.DS_Store', '*.log',
];
const ENSURE_GITIGNORE_CMD =
  'touch .gitignore; ' +
  GITIGNORE_PATTERNS.map(
    (p) => `grep -qxF '${p}' .gitignore 2>/dev/null || echo '${p}' >> .gitignore`,
  ).join('; ');
