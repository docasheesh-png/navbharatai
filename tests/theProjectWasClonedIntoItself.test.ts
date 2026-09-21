import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  cloneDestination,
  shouldRefuseClone,
  cloneGuardMessage,
  defaultCloneDirName,
} from '../src/server/AgentV3/gitCloneGuard';

/**
 * THE PROJECT WAS CLONED INTO ITSELF (autopsy `c5fd6ad1` + `bff0bf23`, 2026-09-21).
 *
 * 🔴 WHAT HAPPENED. The prompt was *"Import this app from my GitHub repository and give me a short
 * survey … **Do not change any files yet.**"* The platform imported it correctly (175 files, count
 * verified). The architect delegated the survey to the fullstack sub-agent, which ran
 * `git clone <the same repo> workspace/mitrify` — and since every shell command runs with
 * `cwd: /home/user/workspace`, that put a second complete copy of the user's app inside their app.
 *
 * The next turn's report is the proof of cost: `INTEGRITY_DUPLICATE_ENTRY` (two files mounting a
 * React root), `INTEGRITY_DUPLICATE_STYLESHEET`, `INTEGRITY_FOCUS_CONFLICT`, 175 → 352 "source
 * files", and an integrity heal that spent ~3.5 minutes and 10 model calls editing the copy the
 * engine itself had created — on a turn where the user had only said "preview nahi chala".
 *
 * 🔑 TWO CAUSES, ONE IN EACH HALF OF THE 50/50 LAW:
 *   1. The sub-agent that ran the clone is never handed the architect's `[APP IMPORT — already
 *      completed] … NEVER scaffold a new app over them` block. It knew the file COUNT and not that
 *      the files were on its own disk.
 *   2. Nothing refused the command. The guard family in the bash dispatcher (`scaffoldGuard`,
 *      `previewGuard`, destructive-delete, dependency-mutation) was missing this member — and
 *      `scaffoldGuard`'s own docblock already states why a prompt cannot be the answer.
 */

const SRC = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('where a clone would land', () => {
  it('a RELATIVE target is inside the workspace — this is the exact command from the report', () => {
    const d = cloneDestination('git clone https://github.com/aashishcpmt093-ui/mitrify workspace/mitrify');
    expect(d.kind).toBe('inside');
    expect(d).toMatchObject({ target: 'workspace/mitrify' });
  });

  it('no destination at all still lands inside — it becomes the repo name in the cwd', () => {
    const d = cloneDestination('git clone https://github.com/acme/widgets.git');
    expect(d.kind).toBe('inside');
    expect(d).toMatchObject({ target: 'widgets' });
  });

  it('`.` is inside — a clone straight over the workspace root', () => {
    expect(cloneDestination('git clone https://github.com/acme/widgets .').kind).toBe('inside');
  });

  it("the PLATFORM's own import clone is OUTSIDE by construction, not by an exception list", () => {
    // GitRepoSync.ts clones to /tmp/nbhydrate. It must never be caught by this guard, and it is not
    // named anywhere in it — the path decides.
    const d = cloneDestination('git clone --depth 1 "https://x@github.com/a/b" /tmp/nbhydrate');
    expect(d.kind).toBe('outside');
  });

  it('an absolute path under the workspace root is inside', () => {
    expect(cloneDestination('git clone https://github.com/a/b /home/user/workspace/vendor').kind).toBe('inside');
    expect(cloneDestination('git clone https://github.com/a/b /home/user/workspace').kind).toBe('inside');
  });

  it('a command with no clone in it is not a clone', () => {
    for (const cmd of ['npm install', 'git status', 'git push origin main', 'npm run dev', '']) {
      expect(cloneDestination(cmd).kind).toBe('none');
    }
  });

  it('finds the clone after a shell separator, which is how the report\'s siblings were written', () => {
    expect(cloneDestination('cd /tmp && git clone https://github.com/a/b work').kind).toBe('inside');
    expect(cloneDestination('mkdir -p x; git clone https://github.com/a/b /tmp/y').kind).toBe('outside');
  });

  it('a flag that takes a SEPARATE value never gets read as the destination', () => {
    // `-b main` — reading `main` as the target would classify a /tmp clone as inside.
    expect(cloneDestination('git clone -b main https://github.com/a/b /tmp/z').kind).toBe('outside');
    expect(cloneDestination('git clone --depth 1 https://github.com/a/b /tmp/z').kind).toBe('outside');
    expect(cloneDestination('git clone -c core.x=y https://github.com/a/b /tmp/z').kind).toBe('outside');
  });

  it('a long --flag=value form carries its own value and is skipped', () => {
    expect(cloneDestination('git clone --depth=1 --single-branch https://github.com/a/b /tmp/z').kind).toBe('outside');
  });

  it('a quoted destination with a space stays one token', () => {
    const d = cloneDestination('git clone https://github.com/a/b "my repo"');
    expect(d).toMatchObject({ kind: 'inside', target: 'my repo' });
  });

  it('a second positional that is itself a URL is not treated as a path', () => {
    const d = cloneDestination('git clone https://github.com/a/b https://github.com/c/d');
    expect(d).toMatchObject({ kind: 'inside', target: 'b' });
  });

  it('derives the default directory the way git does', () => {
    expect(defaultCloneDirName('https://github.com/acme/widgets.git')).toBe('widgets');
    expect(defaultCloneDirName('https://github.com/acme/widgets/')).toBe('widgets');
    expect(defaultCloneDirName('git@github.com:acme/widgets.git')).toBe('widgets');
    expect(defaultCloneDirName('https://github.com/acme/widgets?x=1')).toBe('widgets');
  });
});

describe('when it is refused', () => {
  const inside = cloneDestination('git clone https://github.com/a/mitrify workspace/mitrify');
  const outside = cloneDestination('git clone https://github.com/a/b /tmp/nbhydrate');

  it('refuses the report\'s command when the project is already in the workspace', () => {
    expect(shouldRefuseClone({ destination: inside, projectFileCount: 175 })).toBe(true);
  });

  it('🔒 ALLOWS it on an EMPTY workspace — the July import-rescue clone still runs', () => {
    // `shouldRetryImportAnonymously` records a real incident where the platform's own authenticated
    // clone of THIS repository brought in nothing while the model's plain clone exited 0. An import
    // that lands nothing leaves no project, so the count is 0 and the rescue is untouched.
    expect(shouldRefuseClone({ destination: inside, projectFileCount: 0 })).toBe(false);
  });

  it('never refuses a clone outside the workspace, whatever the project holds', () => {
    expect(shouldRefuseClone({ destination: outside, projectFileCount: 175 })).toBe(false);
    expect(shouldRefuseClone({ destination: { kind: 'none' }, projectFileCount: 175 })).toBe(false);
  });

  it('the message names the target, the real file count, and a way forward', () => {
    const msg = cloneGuardMessage('workspace/mitrify', 175);
    expect(msg).toContain('workspace/mitrify');
    expect(msg).toContain('175');
    // A stop that only forbids leaves the model nowhere to go — the READ_LOOP_LIMIT lesson.
    expect(msg).toContain('read_file');
    expect(msg).toContain('glob');
    expect(msg).toContain('/tmp');
  });

  it('the message never blames the user, and does not name a vendor', () => {
    const msg = cloneGuardMessage('workspace/mitrify', 175).toLowerCase();
    for (const vendor of ['glm', 'kimi', 'claude', 'gemini', 'grok', 'openai', 'nemotron']) {
      expect(msg).not.toContain(vendor);
    }
  });
});

/**
 * Source-level guards. `tsc` and `vitest` cannot see a guard that was never called, nor a prompt line
 * that was deleted — which is exactly how the missing member of the guard family survived. Each of
 * these was proven by reverting the thing it protects.
 */
describe('the wiring itself', () => {
  const dispatcher = SRC('src/server/AgentV3/ToolDispatcher.ts');
  const subAgent = SRC('src/server/AgentV3/SubAgent.ts');

  it('the bash dispatcher really consults the guard', () => {
    expect(dispatcher).toContain("from './gitCloneGuard'");
    expect(dispatcher).toMatch(/cloneDestination\(command\)/);
    expect(dispatcher).toMatch(/shouldRefuseClone\(\{/);
  });

  it('it is checked BEFORE the command is run', () => {
    const guardAt = dispatcher.indexOf('shouldRefuseClone({');
    const runAt = dispatcher.indexOf('await this.actuator.runCommand(this.workspaceId, effectiveCommand)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(runAt);
  });

  it('it has a kill switch, like every guard beside it', () => {
    expect(dispatcher).toContain("AGENTV3_CLONE_GUARD");
  });

  it('🔒 the project graph is only consulted for a clone that lands inside — an ordinary command pays nothing', () => {
    // The count lookup must sit behind the `kind === 'inside'` test, or every bash command in every
    // build pays for it.
    const insideTest = dispatcher.indexOf("cloneDest.kind === 'inside'");
    const countRead = dispatcher.indexOf('graph().files.length');
    expect(insideTest).toBeGreaterThan(-1);
    expect(countRead).toBeGreaterThan(insideTest);
  });

  it('🔒 BOTH LANES ARE COVERED BY CONSTRUCTION — the sub-agent builds the same dispatcher CLASS', () => {
    // This is the property that makes the fix complete rather than one-lane. The clone in the report
    // was run by the fullstack SUB-AGENT, and yesterday's autopsy (53d43c18) was a guard wired into
    // one of two lanes. A second dispatcher implementation here would silently re-open that.
    expect(subAgent).toContain('new ToolDispatcher(');
    expect(subAgent).toContain("import { ToolDispatcher } from './ToolDispatcher'");
  });

  it('the sub-agent is told the project is already on its disk', () => {
    expect(subAgent).toContain('ALREADY in your workspace');
    expect(subAgent).toMatch(/Never `git clone` this project/);
  });

  it('🔒 that line is emitted only when the graph really holds files', () => {
    // Told to a from-scratch build, the sentence would simply be false.
    const block = subAgent.slice(subAgent.indexOf('const contextBlocks = ['), subAgent.indexOf('.filter(Boolean)'));
    expect(block).toMatch(/projectMap\s*\n?\s*\?\s*'These files are ALREADY in your workspace/);
  });
});
