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
      await this.run(
        'git rev-parse --git-dir >/dev/null 2>&1 || ' +
          '( git init -q && git config user.email "agent@navbharatai.dev" ' +
          '&& git config user.name "NavBharatAI v3.0" )',
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

  private async run(command: string) {
    const r = await this.runner.runCommand(this.workspaceId, command);
    return r;
  }
}

function sanitizeMessage(message: string): string {
  return message.replace(/["`$\\]/g, '').replace(/\r?\n/g, ' ').slice(0, 200) || 'checkpoint';
}
