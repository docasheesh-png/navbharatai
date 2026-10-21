// Autopsy b4173fb7 (2026-10-21): the one-shot lane wrote a package.json declaring `@types/react-dropzone@^14.2.7`
// (never published). The platform's `npm install … || npm install … --legacy-peer-deps` died on ETARGET, the next
// "install 3 missing packages" step re-ran the same broken manifest, no node_modules ever landed, and the gate
// counted three build-breaking blockers. CLASS: a manifest-driven install that cannot succeed was retried
// unchanged, and the registry's answer (which npmVersionHint already reads) only ever reached a model.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isBareManifestInstall, repairUnavailableRanges, manifestRepairNote } from '../src/server/AgentV3/manifestRangeRepair';
import { missingRanges } from '../src/server/AgentV3/npmVersionHint';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

// The two real log lines of the report.
const NPM_LOG = 'npm error code ETARGET\nnpm error notarget No matching version found for @types/react-dropzone@^14.2.7.\nnpm error notarget In most cases you or one of your dependencies are requesting\nnpm error notarget a package version that doesn\'t exist.\n';
const BARE = 'npm install --no-audit --no-fund || npm install --no-audit --no-fund --legacy-peer-deps';
const MANIFEST = JSON.stringify({ name: 'p', dependencies: { react: '^18.3.1', 'react-dropzone': '^14.2.3' }, devDependencies: { '@types/react-dropzone': '^14.2.7', typescript: '^5.5.3' } }, null, 2);

describe('which installs the platform may repair', () => {
  it('a manifest-driven install, however it is chained', () => {
    for (const c of [BARE, 'npm install', 'npm ci', 'cd app && npm install --no-audit', 'npm i && npm run build']) expect(isBareManifestInstall(c), c).toBe(true);
  });
  it('an install that NAMES packages is a model\'s guess and keeps its hint', () => {
    for (const c of ['npm install cors@^4', 'npm install --no-audit clsx lucide-react', 'npm install -D vitest', 'npm add zod', 'npm run build', 'ls']) expect(isBareManifestInstall(c), c).toBe(false);
  });
});

describe('the repair itself', () => {
  const missing = missingRanges(NPM_LOG);
  it('npm\'s own words name the package and the range', () => {
    expect(missing).toEqual([{ name: '@types/react-dropzone', range: '^14.2.7' }]);
  });
  it('a package npm has at another version gets that version', () => {
    const r = repairUnavailableRanges(MANIFEST, missing, new Map([['@types/react-dropzone', '4.2.2']]));
    expect(JSON.parse(r.text as string).devDependencies['@types/react-dropzone']).toBe('^4.2.2');
    expect(r.changes[0]).toMatch(/does not exist/);
  });
  it('a package npm has never heard of is removed — nothing can import it', () => {
    const r = repairUnavailableRanges(MANIFEST, missing, new Map());
    const parsed = JSON.parse(r.text as string);
    expect('@types/react-dropzone' in parsed.devDependencies).toBe(false);
    expect(parsed.dependencies['react-dropzone']).toBe('^14.2.3'); // its sibling is untouched
    expect(r.changes[0]).toMatch(/not on npm at all/);
  });
  it('nothing to do ⇒ no rewrite; unreadable manifest ⇒ no rewrite and no throw', () => {
    expect(repairUnavailableRanges(MANIFEST, [{ name: 'left-pad', range: '^9' }], new Map()).text).toBeNull();
    expect(repairUnavailableRanges('{not json', missing, new Map()).text).toBeNull();
    expect(repairUnavailableRanges('[]', missing, new Map()).text).toBeNull();
  });
  it('the note says whether the second install worked', () => {
    expect(manifestRepairNote(['x'], true)).toMatch(/succeeded/);
    expect(manifestRepairNote(['x'], false)).toMatch(/still failed/);
    expect(manifestRepairNote([], true)).toBe('');
  });
});

class Act implements ActuatorPort {
  files = new Map<string, string>([['package.json', MANIFEST]]);
  installs = 0;
  registry: string;
  constructor(registry = 'NBAI_LATEST @types/react-dropzone=4.2.2') { this.registry = registry; }
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand(_w: string, cmd: string) {
    if (cmd.includes('NBAI_LATEST')) return { exitCode: 0, stdout: `${this.registry}\n`, stderr: '' };
    if (/npm install/.test(cmd)) {
      this.installs++;
      const ok = !/@types\/react-dropzone"\s*:\s*"\^14\.2\.7"/.test(this.files.get('package.json') ?? '');
      return ok ? { exitCode: 0, stdout: 'added 120 packages', stderr: '' } : { exitCode: 1, stdout: '', stderr: NPM_LOG };
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(_w: string, port: number) { return `https://x-${port}.dev`; }
}
const run = async (act: Act, command: string) => {
  const recorded = new Map<string, string>();
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(act, 'ws-range', new WorkspaceState(stream), stream, undefined, undefined, undefined, undefined, undefined, undefined, (p, c) => { recorded.set(p, c); });
  const res = await d.dispatch({ id: 't', name: 'bash', input: { command } }, 'frontend');
  return { res: String(res.content), recorded };
};

describe('the install a build runs', () => {
  it('the real report: ETARGET → package.json repaired, saved, the install runs again and succeeds', async () => {
    const act = new Act();
    const { res, recorded } = await run(act, BARE);
    expect(res).toMatch(/exit=0/);
    expect(res).toMatch(/\[manifest repaired\]/);
    expect(JSON.parse(act.files.get('package.json') as string).devDependencies['@types/react-dropzone']).toBe('^4.2.2');
    expect(recorded.get('package.json')).toBe(act.files.get('package.json'));
  });
  it('a package npm does not know is dropped and the install succeeds', async () => {
    const act = new Act('');
    const { res } = await run(act, BARE);
    expect(res).toMatch(/exit=0/);
    expect('@types/react-dropzone' in JSON.parse(act.files.get('package.json') as string).devDependencies).toBe(false);
  });
  it('an install that names packages is left alone (the model gets its version hint as before)', async () => {
    const act = new Act();
    const { res } = await run(act, 'npm install --no-audit clsx');
    expect(res).not.toMatch(/\[manifest repaired\]/);
    expect(act.files.get('package.json')).toBe(MANIFEST);
  });
  it('the wiring: the dispatcher repairs before it reports', () => {
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toMatch(/manifestRangeRepairEnabled\(\) && isBareManifestInstall\(command\)/);
  });
});

// The sibling door: the actuator's own install (preview boot, hydration, publish) had the same blind retry.
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

describe('the actuator\'s install repairs the same manifest', () => {
  it('ETARGET on `npm install` → registry lookup, package.json rewritten, one more install, success', async () => {
    let manifest = MANIFEST;
    let installs = 0;
    const sandbox = {
      sandboxId: 'sbx-range',
      commands: {
        run: async (cmd: string) => {
          if (cmd.includes('NBAI_LATEST')) return { exitCode: 0, stdout: 'NBAI_LATEST @types/react-dropzone=4.2.2\n', stderr: '' };
          if (/^npm (?:ci|install)\b/.test(cmd)) {
            installs++;
            return /"\^14\.2\.7"/.test(manifest) ? { exitCode: 1, stdout: '', stderr: NPM_LOG } : { exitCode: 0, stdout: 'ok', stderr: '' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      },
      files: {
        exists: async () => false,
        read: async () => manifest,
        write: async (_p: string, c: string) => { manifest = c; },
        list: async () => [],
      },
    };
    const act = new E2BActuator('test-key') as unknown as { _npmInstallLocked: (s: unknown) => Promise<{ success: boolean; log: string }> };
    const r = await act._npmInstallLocked(sandbox);
    expect(r.success).toBe(true);
    expect(installs).toBe(2);
    expect(JSON.parse(manifest).devDependencies['@types/react-dropzone']).toBe('^4.2.2');
    expect(r.log).toMatch(/\[manifest repaired\]/);
  });
});
