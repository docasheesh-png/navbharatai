import { exec } from 'child_process';
import { promises as fsPromises } from 'fs';
import path from 'path';
import util from 'util';
import { WorkspaceManager } from '../../AppMakerLab/WorkspaceManager';
import { IEngineerActuator } from './IEngineerActuator';

const execPromise = util.promisify(exec);
const NAMESPACE = 'engineer';
const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT
  ? path.join(process.env.WORKSPACES_ROOT, NAMESPACE)
  : `/workspaces/${NAMESPACE}`;

// Max time for a single bash command (60 s) and for build (3 min)
const CMD_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 3 * 60_000;
const MAX_BUFFER = 10 * 1024 * 1024;
// Safety cap — never send more than this many file paths to the AI prompt
const MAX_LIST_FILES = 500;

// Directories skipped at the walk level — never entered, so node_modules with
// 50 k+ files cannot cause a multi-minute hang on every agent step.
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', 'build',
  '__pycache__', '.venv', '.cache', 'coverage', 'out',
]);

/**
 * Process-level actuator (Cloud Run / local dev).
 * bash commands are run inside the workspace dir with a hard timeout.
 * For stricter isolation upgrade to E2BActuator (set E2B_API_KEY).
 */
export class LocalActuator implements IEngineerActuator {
  private workspaceManager = new WorkspaceManager(NAMESPACE);

  async ensureWorkspace(workspaceId: string, _projectType?: string, _resumeSandboxId?: string): Promise<void> {
    // No remote sandbox to resume — the local directory IS the persistent state.
    const workspacePath = path.join(WORKSPACES_ROOT, workspaceId);
    await fsPromises.mkdir(workspacePath, { recursive: true });
  }

  writeFile(workspaceId: string, filePath: string, content: string): Promise<void> {
    return this.workspaceManager.writeFile(workspaceId, filePath, content);
  }

  readFile(workspaceId: string, filePath: string): Promise<string> {
    return this.workspaceManager.readFile(workspaceId, filePath);
  }

  /**
   * BUG FIX (E1 — critical): The old implementation called WorkspaceManager.listFiles()
   * which recursively walks EVERYTHING including node_modules BEFORE filtering.
   * A workspace with node_modules has 50 k+ files — that walk took minutes and
   * caused the "no reply" symptom. Now we filter AT the walk level so ignored
   * directories are never entered.
   */
  async listFiles(workspaceId: string): Promise<string[]> {
    const workspacePath = path.join(WORKSPACES_ROOT, workspaceId);
    const files: string[] = [];

    const walk = async (dir: string, prefix: string): Promise<void> => {
      if (files.length >= MAX_LIST_FILES) return;
      let names: string[];
      try {
        names = await fsPromises.readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (files.length >= MAX_LIST_FILES) break;
        if (IGNORED_DIRS.has(name)) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        const full = path.join(dir, name);
        let stat;
        try { stat = await fsPromises.stat(full); } catch { continue; }
        if (stat.isDirectory()) {
          await walk(full, rel);
        } else {
          files.push(rel);
        }
      }
    };

    await walk(workspacePath, '');
    return files;
  }

  async build(workspaceId: string): Promise<{ success: boolean; logs: string }> {
    const workspacePath = path.join(WORKSPACES_ROOT, workspaceId);
    const opts = { cwd: workspacePath, timeout: BUILD_TIMEOUT_MS, maxBuffer: MAX_BUFFER };
    try {
      // BUG FIX (E2): Skip npm install when node_modules already exists — saves 30-60s
      // per build() call and prevents the done handler from hanging on reinstall.
      let installLog = '';
      try {
        await fsPromises.access(path.join(workspacePath, 'node_modules'));
      } catch {
        const install = await execPromise('npm install', opts);
        installLog = install.stdout + install.stderr;
      }
      const build = await execPromise('npm run build', opts);
      return { success: true, logs: installLog + build.stdout + build.stderr };
    } catch (err: any) {
      return { success: false, logs: `${err.stdout || ''}${err.stderr || ''}${err.message || String(err)}` };
    }
  }

  async runCommand(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const workspacePath = path.join(WORKSPACES_ROOT, workspaceId);
    try {
      const { stdout, stderr } = await execPromise(command, {
        cwd: workspacePath,
        timeout: CMD_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      });
      return { exitCode: 0, stdout, stderr };
    } catch (err: any) {
      return {
        exitCode: typeof err.code === 'number' ? err.code : 1,
        stdout: err.stdout || '',
        stderr: err.stderr || err.message || String(err),
      };
    }
  }

  async browseUrl(_workspaceId: string, _url: string): Promise<{ html: string }> {
    throw new Error(
      'URL browsing requires a real sandbox (set E2B_API_KEY). LocalActuator cannot run Playwright.'
    );
  }

  async getPortUrl(_workspaceId: string, port: number): Promise<string> {
    return `http://localhost:${port}`;
  }

  async screenshot(_workspaceId: string, _url: string): Promise<{ base64: string; mimeType: 'image/png' }> {
    throw new Error(
      'Screenshots require a real sandbox (set E2B_API_KEY). LocalActuator cannot run a headless browser.'
    );
  }

  async browserAction(
    _workspaceId: string,
    _action: 'click' | 'type' | 'navigate' | 'scroll' | 'press' | 'wait',
    _args: { selector?: string; text?: string; url?: string; direction?: 'up' | 'down' },
  ): Promise<{ screenshot: string; result: string; cursorX?: number; cursorY?: number }> {
    throw new Error(
      'Browser interaction requires a real sandbox (set E2B_API_KEY). LocalActuator cannot run a headless browser.'
    );
  }

  async getConsoleErrors(
    _workspaceId: string,
    _sinceMs: number,
  ): Promise<{ errors: { t: number; kind: string; text: string }[] }> {
    // No browser session in LocalActuator — nothing to report.
    return { errors: [] };
  }

  async getSandboxId(_workspaceId: string): Promise<string | null> {
    // The on-disk directory persists across sessions; there is no sandbox ID.
    return null;
  }

  async pauseSandbox(_sandboxId: string): Promise<boolean> {
    // Nothing to pause — local processes/directories aren't billed per-second.
    return false;
  }

  // Checkpoints root — sibling dir to individual workspace dirs.
  private static readonly CKPT_ROOT = path.join(WORKSPACES_ROOT, '.e-checkpoints');

  async checkpoint(workspaceId: string, triggeredBy = 'manual'): Promise<string> {
    const wsPath = path.join(WORKSPACES_ROOT, workspaceId);
    const id = `ckpt_${Date.now()}`;
    const dir = path.join(LocalActuator.CKPT_ROOT, workspaceId);
    await fsPromises.mkdir(dir, { recursive: true });
    const tarPath = path.join(dir, `${id}.tar.gz`);
    await execPromise(
      `tar --exclude=./node_modules --exclude=./dist --exclude=./.git --exclude=./.next --exclude=./.e-checkpoints -czf "${tarPath}" -C "${wsPath}" .`,
      { timeout: 30_000, maxBuffer: MAX_BUFFER },
    ).catch(() => { /* non-fatal — best-effort checkpoint */ });
    await fsPromises.writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify({ id, createdAt: Date.now(), triggeredBy: triggeredBy.slice(0, 80) }),
    ).catch(() => {});
    return id;
  }

  async restore(workspaceId: string, checkpointId: string): Promise<void> {
    const wsPath = path.join(WORKSPACES_ROOT, workspaceId);
    const tarPath = path.join(LocalActuator.CKPT_ROOT, workspaceId, `${checkpointId}.tar.gz`);
    try { await fsPromises.access(tarPath); } catch {
      throw new Error(`Checkpoint ${checkpointId} not found.`);
    }
    const result = await execPromise(
      `tar -xzf "${tarPath}" -C "${wsPath}" --overwrite`,
      { timeout: 30_000, maxBuffer: MAX_BUFFER },
    );
    // execPromise throws on non-zero exit — if we reach here the restore succeeded.
    void result;
  }

  async searchFiles(workspaceId: string, terms: string[]): Promise<string[]> {
    if (terms.length === 0) return [];
    const wsPath = path.join(WORKSPACES_ROOT, workspaceId);
    try {
      // grep -rl: find files containing any term, skip heavy dirs
      const termArgs = terms.slice(0, 8).map(t => `-e ${JSON.stringify(t)}`).join(' ');
      const { stdout } = await execPromise(
        `grep -rl ${termArgs} \
          --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
          --include="*.py" --include="*.css" --include="*.json" --include="*.html" \
          --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
          --exclude-dir=.next --exclude-dir=build --exclude-dir=__pycache__ \
          . 2>/dev/null | head -40`,
        { cwd: wsPath, timeout: 10_000, maxBuffer: MAX_BUFFER }
      );
      return stdout
        .split('\n')
        .map(p => p.trim().replace(/^\.\//, ''))
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}
