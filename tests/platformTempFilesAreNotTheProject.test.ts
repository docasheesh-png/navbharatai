// failedbr #2496 (2026-11-22) — NavBharatAI's own temporary files are never the user's project, and a starter test
// is never written for NavBharatAI's own engine.
//
// The real report: READINESS_WARNING "1 hardcoded localhost URL(s) — first at
// .nbai-asset-bfb321b3993e3a3a120c3bf895134141a448a31b7b5d58b7ec8cc76f6b7708bc.mjs:29" and "1 hardcoded server
// port(s)", from the 3D-model browser proof's own 127.0.0.1 test server. The proof wrote its script at the project
// root through the dispatcher's recorded write door and removed it with `rm -f`; the rm is not a write, so the
// script stayed in the durable save, came back on every restore, and entered the build manifest. The same report:
// "Scaffolded 1 starter test (src/game/three/assetModels.test.ts)" — a skeleton for the loader add_library_models
// generated.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PLATFORM_SCRATCH_DIR, isListPrunedPath, isPlatformScratchPath } from '../src/server/lib/generatedDirs';
import { toDurableFileKey, normalizeFileMapKeys } from '../src/server/lib/workspacePath';
import { recordingActuator } from '../src/server/AgentV3/recordedWrites';
import { proveAssetInSandbox, assetBrowserProofModule, assetProofFiles, ASSET_PROOF_MARKER } from '../src/server/AgentV3/gameAssets/assetBrowserProof';
import { isUneditedGeneratedGameAssetFile, GENERATED_GAME_ASSET_PATHS } from '../src/server/AgentV3/gameAssets/generatedAssetFiles';
import { isPlatformSeededFile, modelAuthoredPaths } from '../src/server/AgentV3/platformAuthored';
import { planAutoTests, starterTestsNarration } from '../src/server/AgentV3/TestGenerationAgent';
import {
  GAME_ASSET_MODELS_PATH, generateAssetCustomizations, generateAssetModelLoader, generateGameAssetRuntime,
} from '../src/server/lib/GameAssetRuntimeGenerator';
import { generateWorldDressingModule } from '../src/server/AgentV3/gameAssets/worldDressing';

const REPORT_FILE = '.nbai-asset-bfb321b3993e3a3a120c3bf895134141a448a31b7b5d58b7ec8cc76f6b7708bc.mjs';
const MANIFEST_FILE = '.nbai-asset-2db4ad18412b2b0706cf01fb8db52a715ee2e42a451f2a11e708f49cf9db2d7b.mjs';

describe('a platform scratch file is invisible to every project door', () => {
  it.each([REPORT_FILE, MANIFEST_FILE, REPORT_FILE.replace('.mjs', '.glb'), `${REPORT_FILE}.log`, '.nbai-landing.tar.gz',
    `${PLATFORM_SCRATCH_DIR}/asset-x.mjs`, `./${REPORT_FILE}`])('%s is platform scratch: never stored, never listed', (p) => {
    expect(isPlatformScratchPath(p)).toBe(true);
    expect(toDurableFileKey(p)).toBeNull();
    expect(isListPrunedPath(p)).toBe(true);
  });

  it.each(['src/.nbai-asset-abc.mjs', '.nbai-asset-notahash.mjs', 'nbai-asset.ts', 'src/game/three/assetModels.ts', 'assets/.nbai-branding.json'])(
    '%s stays a project file', (p) => {
      expect(isPlatformScratchPath(p)).toBe(false);
      expect(toDurableFileKey(p)).not.toBeNull();
    });

  it('a store that already holds the report\'s proof script drops it on load (the heal)', () => {
    const { files } = normalizeFileMapKeys({ [REPORT_FILE]: 'x', 'src/App.tsx': 'y' });
    expect(Object.keys(files)).toEqual(['src/App.tsx']);
  });
});

describe('the recorded write door never notes a scratch file for the durable save', () => {
  it('a scratch write reaches the sandbox but is not recorded; a project write still is', async () => {
    const disk: Record<string, string> = {};
    const recorded: string[] = [];
    const inner = { writeFile: async (_ws: string, p: string, c: string) => { disk[p] = c; }, runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
    const act = recordingActuator(inner, 'ws', (p) => recorded.push(p));
    await act.writeFile('ws', `${PLATFORM_SCRATCH_DIR}/asset-a.mjs`, 'proof');
    await act.writeFile('ws', REPORT_FILE, 'legacy proof');
    await act.writeFile('ws', 'src/App.tsx', 'app');
    expect(Object.keys(disk)).toHaveLength(3);
    expect(recorded).toEqual(['src/App.tsx']);
  });
});

describe('the asset proof stages its files outside the project and cleans all of them', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const hash = createHash('sha256').update(bytes).digest('hex');

  function fakeWorkspace(proofLine: (cmd: string) => string) {
    const writes: string[] = [];
    const recorded: string[] = [];
    const commands: string[] = [];
    const inner = {
      writeFile: async (_ws: string, p: string) => { writes.push(p); },
      writeBinaryFile: async (_ws: string, p: string) => { writes.push(p); },
      runCommand: async (_ws: string, c: string) => { commands.push(c); return { exitCode: 0, stdout: proofLine(c), stderr: '' }; },
    };
    // Exactly what ToolDispatcher.addLibraryModelsForTool hands the seed: its recorded actuator.
    const recordedActuator = recordingActuator(inner, 'ws', (p) => recorded.push(p));
    return { workspace: recordedActuator, writes, recorded, commands };
  }

  it('every staged path is platform scratch, nothing is recorded, and the rm names the model, script and log', async () => {
    const w = fakeWorkspace((c) => c.includes('node ') ? `${ASSET_PROOF_MARKER}${JSON.stringify({ hash, rendered: true, animated: false })}` : '');
    await proveAssetInSandbox(w.workspace, 'ws', bytes, { subject: 'cow' });
    expect(w.writes).toHaveLength(2);
    for (const p of w.writes) expect(isPlatformScratchPath(p)).toBe(true);
    expect(w.writes.some((p) => p.startsWith('.nbai-'))).toBe(false);
    expect(w.recorded).toEqual([]);
    const rm = w.commands[w.commands.length - 1];
    for (const p of w.writes) expect(rm).toContain(p);
    expect(rm).toContain(`${w.writes.find((p) => p.endsWith('.mjs'))}.log`);
  });

  it('a failed proof still removes its files', async () => {
    const w = fakeWorkspace(() => '');
    await expect(proveAssetInSandbox(w.workspace, 'ws', bytes, { subject: 'cow' })).rejects.toThrow();
    expect(w.commands[w.commands.length - 1]).toMatch(/^rm -f -- node_modules\/\.cache\/nbai-scratch\//);
  });

  it('two proofs of the same bytes never share files (one model asked for with two animations)', () => {
    expect(assetProofFiles(hash, 'a').script).not.toBe(assetProofFiles(hash, 'b').script);
  });

  it('the script reads the model from the path it was given, and refuses a path a shell could misread', () => {
    const files = assetProofFiles(hash, 'n0nce');
    expect(assetBrowserProofModule(hash, undefined, undefined, undefined, files.model)).toContain(JSON.stringify(files.model));
    expect(() => assetBrowserProofModule(hash, undefined, undefined, undefined, '../x.glb')).toThrow();
    expect(() => assetBrowserProofModule(hash, undefined, undefined, undefined, 'a b.glb')).toThrow();
    // The offline admission checks keep their fixture layout.
    expect(assetBrowserProofModule(hash)).toContain(`.nbai-asset-${hash}.glb`);
  });
});

// The class: a platform script must never be staged in the project tree. Every in-sandbox browser script is run from
// /tmp or from the scratch dir, and no source writes a `.nbai-` name through a project write door.
describe('census — no platform script lives in the user\'s project tree', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
    }
  };
  walk(join(process.cwd(), 'src/server'));

  it('every browserScriptRunLine scriptPath is under /tmp or the scratch dir', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/browserScriptRunLine\(\{[^}]*scriptPath:\s*([^,}]+)/g)) {
        const arg = m[1].trim();
        if (!/^['`]\/tmp\//.test(arg) && arg !== 'files.script') offenders.push(`${f}: ${arg}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no source writes a .nbai- file through writeFile / writeBinaryFile', () => {
    const offenders = files.filter((f) => /write(?:Binary)?File\([^)\n]*\.nbai-/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('the model library\'s generated files are the platform\'s code (starter tests skip them)', () => {
  const models = { villager: { sha256: 'a'.repeat(64), height: 1.8, yaw: 0, lod: false, animation: 'Idle', roles: { walk: 'Walk' } } };
  const loader = generateAssetModelLoader(models);

  it('an unedited generated loader, runtime, customization and dressing module are recognised; one changed byte is the user\'s', () => {
    expect(isUneditedGeneratedGameAssetFile(GAME_ASSET_MODELS_PATH, loader)).toBe(true);
    expect(isPlatformSeededFile(GAME_ASSET_MODELS_PATH, loader)).toBe(true);
    expect(isPlatformSeededFile(GAME_ASSET_MODELS_PATH, `${loader}// mine\n`)).toBe(false);
    expect(isPlatformSeededFile('src/game/three/externalAssets.ts', generateGameAssetRuntime())).toBe(true);
    expect(isPlatformSeededFile('src/game/three/assetCustomizations.ts', generateAssetCustomizations(['villager', 'cow']))).toBe(true);
    expect(isPlatformSeededFile('src/game/three/assetCustomizations.ts', generateAssetCustomizations([]))).toBe(true);
    expect(isPlatformSeededFile('src/game/three/worldDressing.ts', generateWorldDressingModule(['tree', 'rock'], 'village'))).toBe(true);
    expect(isPlatformSeededFile('src/other.ts', loader)).toBe(false);
    expect(GENERATED_GAME_ASSET_PATHS.length).toBeGreaterThanOrEqual(5);
  });

  it('the report\'s case: a generated loader gets no starter test; the builder\'s own file still does', () => {
    const player = "import { loadRequestedAsset } from './three/assetModels';\nexport function spawnPlayer(scene: unknown) { return loadRequestedAsset('villager', () => scene as never); }\n";
    const files = [{ path: GAME_ASSET_MODELS_PATH, content: loader }, { path: 'src/game/player.ts', content: player }];
    const without = planAutoTests(files, { limit: 3 });
    expect(without.map((p) => p.testPath)).toContain('src/game/three/assetModels.test.ts'); // the bug, without the gate
    const plan = planAutoTests(files, { limit: 3, platformOwned: isPlatformSeededFile });
    expect(plan.map((p) => p.testPath)).toEqual(['src/game/player.test.ts']);
    expect(modelAuthoredPaths(new Map(files.map((f) => [f.path, f.content])))).toEqual(['src/game/player.ts']);
  });

  it('the route passes the platform gate to the starter-test plan', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/planAutoTests\(sourceFiles, \{[^}]*platformOwned: isPlatformSeededFile/);
  });

  it('the narration says when the result comes, so a later suite PASS does not contradict it', () => {
    const note = starterTestsNarration(['src/a.test.ts'], JSON.stringify({ devDependencies: { vitest: '^3' } }));
    expect(note).toContain('installation and execution are not verified yet');
    expect(note).toContain('the final checks run the project\'s test suite');
  });
});
