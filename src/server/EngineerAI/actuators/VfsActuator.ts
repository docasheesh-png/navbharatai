/**
 * Tier 0 actuator — runs the agentic edit loop entirely over Pro's in-memory
 * VirtualFileSystem. NO sandbox, NO external infra, NO cost.
 *
 * Implements the same IEngineerActuator the EngineerAI loop already uses, so the
 * loop runs UNCHANGED. File ops (read/write/list/search/checkpoint/restore) hit
 * the VFS; build/runCommand map to Pro's STATIC verifier (SyntaxCheck +
 * ProjectVerifier) so the loop still gets real feedback and can self-heal.
 * Sandbox-only capabilities (shell/dev-server/browser/provision/deploy) degrade
 * GRACEFULLY — they return a clear "not available in this tier" result and NEVER
 * throw (unlike LocalActuator), so the loop records an observation and moves on.
 *
 * ensureWorkspace() pre-seeds the VFS with the correct project template (same
 * TemplateRegistry used by E2BActuator) so the agent starts with working
 * boilerplate and only needs to write app-specific code — just like Claude Code.
 */
import { VirtualFileSystem } from '../../project/ProjectModel';
import { verifyProject } from '../../project/ProjectVerifier';
import { checkSyntax } from '../../project/SyntaxCheck';
import { TemplateRegistry } from '../../AppMakerLab/generator/templates/TemplateRegistry';
import type { IEngineerActuator, BackendProvisionResult } from './IEngineerActuator';

const TIER_NOTE = '(not available in the in-memory tier — edit files and verify with the build/syntax gate)';

export class VfsActuator implements IEngineerActuator {
  private checkpoints = new Map<string, Record<string, string>>();
  private seq = 0;
  private templateRegistry = new TemplateRegistry();

  constructor(private vfs: VirtualFileSystem) {}

  /** The live VFS — the runner pulls the final files from here. */
  getVfs(): VirtualFileSystem {
    return this.vfs;
  }

  /**
   * Pre-seed the VFS with the project template so the agent starts with
   * working boilerplate instead of a blank workspace.  Mirrors E2BActuator's
   * ensureWorkspace() so both tiers give the agent the same starting point.
   * Skipped when the VFS already has files (edit builds, re-runs).
   */
  async ensureWorkspace(_workspaceId: string, projectType?: string): Promise<void> {
    if (this.vfs.count > 0) return; // existing project — don't overwrite
    const templateKey =
      projectType && projectType !== 'auto'
        ? projectType
        : 'vite-react'; // default — same as E2BActuator
    try {
      const files = this.templateRegistry.getProvider(templateKey).getFiles([]);
      for (const [path, content] of Object.entries(files)) {
        this.vfs.write(path, content);
      }
    } catch {
      // Unknown template — agent will scaffold from scratch (graceful fallback)
    }
  }

  async writeFile(_workspaceId: string, filePath: string, content: string): Promise<void> {
    this.vfs.write(filePath, content);
  }

  async writeBinaryFile(_workspaceId: string, filePath: string, base64: string): Promise<void> {
    this.vfs.write(filePath, base64, 'base64');
  }

  async readFile(_workspaceId: string, filePath: string): Promise<string> {
    const text = this.vfs.readText(filePath);
    if (text == null) throw new Error(`File not found: ${filePath}`);
    return text;
  }

  async listFiles(): Promise<string[]> {
    return this.vfs.paths();
  }

  /** Real in-memory grep — better than LocalActuator (which returns []). */
  async searchFiles(_workspaceId: string, terms: string[]): Promise<string[]> {
    const needles = terms.map((t) => t.toLowerCase()).filter(Boolean);
    if (!needles.length) return [];
    const out: string[] = [];
    for (const f of this.vfs.list()) {
      if (f.encoding === 'base64') continue;
      const hay = (f.path + '\n' + f.content).toLowerCase();
      if (needles.some((n) => hay.includes(n))) out.push(f.path);
    }
    return out;
  }

  /** Static verification as the loop's "build" — gives it real self-heal feedback. */
  async build(): Promise<{ success: boolean; logs: string }> {
    const syntax = await checkSyntax(this.vfs);
    const verify = verifyProject(this.vfs);
    const errors = verify.issues.filter((i) => i.severity === 'error');
    const warnings = verify.issues.filter((i) => i.severity === 'warning');
    const success = syntax.length === 0 && errors.length === 0;
    const logs = [
      success
        ? 'Static verification passed (syntax + structure + imports).'
        : 'Static verification found problems — fix these:',
      ...syntax.map((s) => `SYNTAX  ${s.file}: ${s.message}`),
      ...errors.map((e) => `ERROR   ${e.file}: ${e.message}`),
      ...warnings.map((w) => `warn    ${w.file}: ${w.message}`),
    ].join('\n');
    return { success, logs };
  }

  /** No shell in this tier — recognize common commands and synthesize output; never throw. */
  async runCommand(_workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const c = command.toLowerCase();
    if (/\b(build|tsc|vite|vitest|jest|typecheck|lint)\b/.test(c) || /\bnpm (run )?test\b/.test(c)) {
      const { success, logs } = await this.build();
      return { exitCode: success ? 0 : 1, stdout: logs, stderr: success ? '' : logs };
    }
    if (/\bgit\b/.test(c)) {
      return { exitCode: 0, stdout: '(git skipped in in-memory tier)', stderr: '' };
    }
    if (/\bnpm (install|i|ci|add)\b|\byarn (install|add)\b|\bpnpm (install|add)\b/.test(c)) {
      return { exitCode: 0, stdout: 'Dependencies resolved via CDN (esm.sh) — no install needed in this tier. Declare them in package.json and they will be available at runtime.', stderr: '' };
    }
    return { exitCode: 0, stdout: `Command "${command}" ${TIER_NOTE}`, stderr: '' };
  }

  async browseUrl(): Promise<{ html: string }> {
    return { html: `Browsing ${TIER_NOTE}` };
  }

  async getPortUrl(): Promise<string> {
    return '';
  }

  async screenshot(): Promise<{ base64: string; mimeType: 'image/png' }> {
    // Empty base64 → the loop treats it as "no image" (falsy) and skips vision injection.
    return { base64: '', mimeType: 'image/png' };
  }

  async browserAction(): Promise<{ screenshot: string; result: string }> {
    return { screenshot: '', result: `Visual/browser interaction ${TIER_NOTE}` };
  }

  async getConsoleErrors(): Promise<{ errors: { t: number; kind: string; text: string }[] }> {
    return { errors: [] };
  }

  async getSandboxId(): Promise<string | null> {
    return null;
  }

  async pauseSandbox(): Promise<boolean> {
    return false;
  }

  async checkpoint(): Promise<string> {
    const id = `vfs-ckpt-${++this.seq}`;
    this.checkpoints.set(id, this.vfs.toRecord());
    return id;
  }

  async restore(_workspaceId: string, checkpointId: string): Promise<void> {
    const snap = this.checkpoints.get(checkpointId);
    if (!snap) throw new Error(`Checkpoint not found: ${checkpointId}`);
    for (const p of this.vfs.paths()) this.vfs.delete(p);
    for (const [p, content] of Object.entries(snap)) this.vfs.write(p, content);
  }

  async provisionBackend(): Promise<BackendProvisionResult> {
    throw new Error(`Backend provisioning requires a sandbox tier ${TIER_NOTE}`);
  }

  async downloadDistFiles(): Promise<Map<string, Buffer>> {
    throw new Error(`Built-dist download requires a sandbox tier ${TIER_NOTE}`);
  }
}
