import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { resolve } from 'node:path';
import { lintBuiltApp, shippedDesignText } from '../src/server/AgentV3/buildQualityLint';
import { lintDesign } from '../src/server/AppMakerLab/intelligence/DesignLinter';
import { BR1954_PROMPT } from './fixtures/br1954';
import { buildGameContract, gameContractBlock, scopeMatch } from '../src/server/AgentV3/gameIntent';
import { gameScopeVerdict } from '../src/server/AgentV3/gamePlaytest';
import { gameTurnHandoff } from '../src/server/AgentV3/gameKitSeed';
import { extractExportedDeclaration, kitTypeContract, KIT_CONTRACT_FILES } from '../src/server/lib/kitTypeContract';
import { declaredMembers } from '../src/server/AgentV3/typeMembers';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

const files = Object.fromEntries([...recipeFilePool()].map(([p, entry]) => [p, entry.content]));
const run = { writingRun: true, moduleTurn: false, importTurn: false, stopped: false };
const mechanics = ['auto-run', 'lane-change', 'jump', 'slide', 'obstacles', 'currency-counters', 'character-shop', 'currency-unlocks', 'high-score', 'collision-game-over'];

describe('BR1954 — retain the real request before the first generated file', () => {
  it('reads Endless Running, not only the word runner, from the exact Hindi request', () => {
    const c = buildGameContract(BR1954_PROMPT);
    expect(c.genre).toBe('runner');
    expect(c.dimension).toBe('3d');
    expect(c.controls).toContain('touch');
    expect(c.runnerMechanics).toEqual(mechanics);
    expect(c.collectibles).toEqual(['coins', 'diamonds']);
    expect(c.minimumUnlockableCharacters).toBe(5);
    expect(c.requiredFeatures).toEqual(['score', 'sound', 'restart']);
    expect(c.winLoseNamed).toBe(true);
  });
  it.each([
    ['English', 'Build a 3D endless running game. Swipe left and right, jump, slide, obstacles, coins and diamonds, coin counters, character shop. At least 5 unlockable characters. High score. Collision causes game over.'],
    ['Hinglish', '3D endless runner game banao. Swipe left and right, jump aur slide, obstacles; coins aur diamonds, coin counters, character shop; minimum 5 unlockable characters, high score, collision game over.'],
    ['Hindi', 'एक 3D एंडलेस रनर गेम बनाओ। जंप, स्लाइड, बाधाएं, सिक्के और हीरे, काउंटर, कैरेक्टर शॉप। कम से कम ५ अलग-अलग Unlockable Characters। हाई स्कोर। टक्कर पर Game Over।'],
  ])('keeps explicit %s mechanics and independent currencies', (_name, prompt) => {
    const c = buildGameContract(prompt);
    expect(c.genre).toBe('runner');
    expect(c.runnerMechanics).toEqual(expect.arrayContaining(['jump', 'slide', 'obstacles', 'character-shop', 'high-score', 'collision-game-over']));
    expect(c.collectibles).toEqual(['coins', 'diamonds']);
    expect(c.minimumUnlockableCharacters).toBe(5);
  });
  it.each([
    'Make an endless runner. No jump, slide, coins or character shop.',
    'Make an endless runner. Remove jump; delete slide; hide character shop.',
    'एक endless runner गेम। Jump मत जोड़ो। Slide नहीं चाहिए। Coins नहीं चाहिए। Character Shop हटाओ।',
  ])('does not turn explicitly declined/removed mechanics into required work: %s', (prompt) => {
    const c = buildGameContract(prompt);
    expect(c.runnerMechanics ?? []).not.toEqual(expect.arrayContaining(['jump']));
    expect(c.runnerMechanics ?? []).not.toContain('slide');
    expect(c.runnerMechanics ?? []).not.toContain('character-shop');
    expect(c.collectibles ?? []).not.toContain('coins');
  });
  it('a bare runner or score counter does not acquire a shop, currencies, a minimum roster or power-ups', () => {
    const c = buildGameContract('Build an endless runner with a score counter');
    expect(c.collectibles).toBeUndefined();
    expect(c.minimumUnlockableCharacters).toBeUndefined();
    expect(c.runnerMechanics).not.toContain('currency-counters');
    expect(c.requiredFeatures).toEqual(['score']);
  });
  it('coins are collectibles, not invented power-ups; genuine power-ups remain required', () => {
    expect(buildGameContract('runner with coins').requiredFeatures).not.toContain('powerups');
    expect(buildGameContract('runner with coins').collectibles).toEqual(['coins']);
    expect(buildGameContract('runner with power-ups and coins').requiredFeatures).toContain('powerups');
  });
  it('does not infer spending or locked characters from coins and an ordinary roster', () => {
    const c = buildGameContract('endless runner with coins; at least 5 characters and a score counter');
    expect(c.runnerMechanics ?? []).not.toContain('currency-unlocks');
    expect(c.minimumUnlockableCharacters).toBeUndefined();
  });
  it('keeps a stated roster above 100 without generating or capping an array', () => {
    expect(buildGameContract('endless runner; at least 101 unlockable characters').minimumUnlockableCharacters).toBe(101);
  });
  it('gives the builder the complete named economy, movement and five-character requirement', () => {
    const block = gameContractBlock(buildGameContract(BR1954_PROMPT));
    for (const requirement of [...mechanics, 'coins, diamonds', 'At least 5 distinct unlockable characters']) expect(block).toContain(requirement);
    expect(block).toContain('not permission to invent power-ups or real-money purchases');
  });
  it('labels code-only mechanics unverified even if every token and ordinary feature is present', () => {
    const c = buildGameContract(BR1954_PROMPT);
    const project = { 'src/App.tsx': '// score sound restart ' + mechanics.join(' ') + ' coins diamonds 5 unlockable characters' };
    expect(scopeMatch(c, project).unverified).toEqual([...mechanics, 'coins', 'diamonds', '5 unlockable characters']);
    const verdict = gameScopeVerdict(c, project)!;
    expect(verdict.code).toBe('GAME_SCOPE_GAP');
    expect(verdict.message).toContain('NOT functionally verified');
    expect(verdict.message).toContain('not a gameplay pass');
  });
});

describe('BR1954 — the existing source/API contract is a prerequisite, not conditional on seeding', () => {
  it('hands an existing game its scope and actual APIs without any recipe or mutation', () => {
    const before = JSON.stringify(files);
    const handoff = gameTurnHandoff(BR1954_PROMPT, files, run, {});
    expect(handoff.contract?.genre).toBe('runner');
    expect(handoff.block).toContain('GAME SCOPE CONTRACT');
    expect(handoff.block).toContain('GAME KIT API SNAPSHOT');
    expect(handoff.block).toContain('NOT a fresh sandbox read');
    expect(JSON.stringify(files)).toBe(before);
  });
  it('still retains the request when no seed or API file exists', () => {
    const h = gameTurnHandoff(BR1954_PROMPT, {}, run, {});
    expect(h.contract?.minimumUnlockableCharacters).toBe(5);
    expect(h.block).toContain('GAME SCOPE CONTRACT');
    expect(h.block).not.toContain('GAME KIT API SNAPSHOT');
  });
  it.each(['writingRun', 'moduleTurn', 'importTurn', 'stopped'] as const)('does not cross %s ownership or resume a cancellation', (key) => {
    const guarded = { ...run, [key]: key !== 'writingRun' };
    expect(gameTurnHandoff(BR1954_PROMPT, files, guarded, {})).toEqual({ contract: null, block: '' });
  });
  it('does not pull the kit into non-games; scope-off leaves the independent API snapshot available', () => {
    expect(gameTurnHandoff('build a notes app', files, run, {})).toEqual({ contract: null, block: '' });
    const h = gameTurnHandoff(BR1954_PROMPT, files, run, { AGENTV3_GAME_SCOPE_CONTRACT: 'off' });
    expect(h.contract).toBeNull();
    expect(h.block).not.toContain('GAME SCOPE CONTRACT');
    expect(h.block).toContain('GAME KIT API SNAPSHOT');
  });
  it('uses supplied user-modified signatures, not the generator version or arbitrary project source', () => {
    const h = gameTurnHandoff(BR1954_PROMPT, {
      'src/game/core/input.ts': 'export class Input { custom(value: number): boolean { return true; } }',
      'src/private.ts': 'PRIVATE_MARKER_DO_NOT_DUMP',
    }, run, {});
    expect(h.block).toContain('custom(value: number): boolean;');
    expect(h.block).not.toContain('wasPressed');
    expect(h.block).not.toContain('PRIVATE_MARKER_DO_NOT_DUMP');
  });
  it('the real route binds the contract/ref and prepends it exactly once before either generation lane', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route.match(/gameTurnHandoff\(prompt,/g) ?? []).toHaveLength(1);
    const at = route.indexOf('const gameHandoff = gameTurnHandoff(');
    const lanes = route.indexOf('// ── ONE-SHOT FAST LANE', at);
    expect(at).toBeGreaterThan(0);
    expect(lanes).toBeGreaterThan(at);
    const body = route.slice(at, lanes);
    expect(body).toContain('requestContractRef.contract = gameContract');
    expect(body).toContain('buildPrompt = `${gameHandoff.block}');
    expect(body).toContain('stopped: abort.signal.aborted');
    expect(route.match(/gameContract = buildGameContract\(/g) ?? []).toHaveLength(0);
    expect(route).toContain('gameKitHandoffBlock(kitResults, { flat: !wantsSceneObjects(prompt) })');
    // Preservation gates remain independently required; handoff cannot make an edit a fresh seed.
    expect(route).toContain("if (intent === 'new_build' && !projectModuleRef && !isImportTurn)");
    expect(route).toContain("if (intent === 'edit_existing' && !isImportTurn && !projectModuleRef && projectFilesAtTurnStart");
  });
});

describe('BR1954 — known compiler API errors are prevented by a source-derived public surface', () => {
  it.each([
    ['src/game/core/input.ts', 'Input', 'wasPressed(action: string): boolean;', 'bind('],
    ['src/game/core/events.ts', 'EventBus', 'on(event: GameEvent | string, handler: Handler): () => void;', 'off('],
    ['src/game/three/camera.ts', 'CameraRig', 'readonly camera: THREE.PerspectiveCamera;', '\n  object:'],
    ['src/game/three/humanoid.ts', 'createHumanoid', 'createHumanoid(options: HumanoidOptions = {}): Humanoid;', 'return'],
    ['src/game/three/world.ts', 'scatterInstances', 'scatterInstances(', 'for ('],
    ['src/game/three/objects.ts', 'createRoad', 'createRoad(options: RoadOptions = {}): THREE.Group;', 'return'],
    ['src/game/three/materials.ts', 'sharedMaterial', 'sharedMaterial(kind: MaterialKind, color: number): THREE.Material;', 'return'],
  ])('carries the actual %s/%s declaration, not its guessed sibling', (path, name, expected, guessed) => {
    const declaration = extractExportedDeclaration(files[path], name);
    expect(declaration).not.toBeNull();
    expect(declaration).toContain(expected);
    expect(declaration).not.toContain(guessed);
    expect(kitTypeContract(files)).toContain(name);
  });
  it.each([
    ['src/game/core/input.ts', 'Input'], ['src/game/core/events.ts', 'EventBus'], ['src/game/three/camera.ts', 'CameraRig'],
  ])('census: every public declared member of %s/%s survives without private members', (path, name) => {
    const members = declaredMembers(files[path], name)!;
    expect(members.length).toBeGreaterThan(0);
    const surface = extractExportedDeclaration(files[path], name)!;
    expect(surface).not.toBeNull();
    for (const member of members) expect(surface).toContain(member.split('(')[0]);
    expect(surface).not.toMatch(/\b(?:private|protected)\b/);
  });
  it('preserves typed defaults, nested types, static members and overloads, never exposes private implementations', () => {
    const source = `export class Sample {
      private secret = 1;
      protected hidden(): void {}
      readonly value: { a: number } = { a: 1 };
      constructor(options: { count: number } = { count: 1 }) {}
      static make(n: number): Sample { return new Sample(); }
      read(n: string): string;
      read(n: number): number;
      read(n: string | number): string | number { return n; }
    }`;
    const surface = extractExportedDeclaration(source, 'Sample')!;
    expect(surface).not.toBeNull();
    expect(surface).toContain('constructor(options: { count: number } = { count: 1 });');
    expect(surface).toContain('readonly value: { a: number };');
    expect(surface).toContain('static make(n: number): Sample;');
    expect(surface).not.toMatch(/secret|hidden|return n/);
    expect(surface).toContain('read(n: string): string;');
    expect(surface).toContain('read(n: number): number;');
  });
  it('never invents inferred return types or emits malformed/unexported callable declarations', () => {
    const surface = extractExportedDeclaration('export class A { infer() { return { actual: 1 }; } }', 'A')!;
    expect(surface).not.toBeNull();
    expect(surface).toContain('inferred shape not established');
    expect(surface).toContain('return { actual: 1 }');
    expect(extractExportedDeclaration('class A { x(): void {} }', 'A')).toBeNull();
    expect(extractExportedDeclaration('export class A { bad(', 'A')).toBeNull();
    expect(extractExportedDeclaration('export class A {}', '[')).toBeNull();
  });
  it('bounds the API snapshot without promising an exhaustive inventory or cutting a declaration silently', () => {
    expect(kitTypeContract(files).length).toBeLessThanOrEqual(12_000);
    const small = kitTypeContract(files, 1000);
    expect(small.length).toBeLessThanOrEqual(1000);
    expect(small).toContain('INCOMPLETE API snapshot');
    expect(kitTypeContract(files)).toContain('an unlisted name is not proof of absence');
    expect(KIT_CONTRACT_FILES).toContain('src/game/core/input.ts');
    expect(KIT_CONTRACT_FILES).toContain('src/game/three/humanoid.ts');
  });
});


/** Synthetic consumer compiler proof, not historical app reconstruction/provider replay.
 * Like aRecipeExampleCompiles, external THREE members are stubbed: we assert KIT names/options,
 * not the third-party library's complete structural types or producer-body diagnostics.
 */
function consumerDiagnostics(consumer: string): ts.Diagnostic[] {
  const root = resolve('.br1954-virtual-compiler');
  const names = new Set([...Object.values(files), consumer].flatMap((s) => [...s.matchAll(/THREE\.([A-Za-z_]\w*)/g)].map((m) => m[1])));
  const shim = `declare module 'three' { ${[...names].map((n) => `export const ${n}: any; export type ${n}<A = any, B = any, C = any, D = any> = any;`).join('\n')} }`;
  const source = new Map(Object.entries({ ...files, 'three-shim.d.ts': shim, 'consumer.ts': consumer }).map(([p, text]) => [resolve(root, p), text]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, noEmit: true, allowSyntheticDefaultImports: true };
  const host = ts.createCompilerHost(options);
  const exists = host.fileExists.bind(host), read = host.readFile.bind(host), get = host.getSourceFile.bind(host);
  const directory = host.directoryExists?.bind(host);
  host.fileExists = (p) => source.has(resolve(p)) || exists(p);
  host.readFile = (p) => source.get(resolve(p)) ?? read(p);
  host.directoryExists = (p) => [...source.keys()].some((f) => f.startsWith(resolve(p) + '/')) || !!directory?.(p);
  host.getSourceFile = (p, version, onError, create) => source.has(resolve(p))
    ? ts.createSourceFile(p, source.get(resolve(p))!, version, true, p.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    : get(p, version, onError, create);
  const program = ts.createProgram([resolve(root, 'consumer.ts'), resolve(root, 'three-shim.d.ts')], options, host);
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].filter((d) => d.file?.fileName === resolve(root, 'consumer.ts'));
}

it('the source-described correct APIs compile, while the retained error classes are rejected', () => {
  const good = `import * as THREE from 'three';
import { Input } from './src/game/core/input';
import { events } from './src/game/core/events';
import { CameraRig } from './src/game/three/camera';
import { createHumanoid } from './src/game/three/humanoid';
import { scatterInstances } from './src/game/three/world';
void scatterInstances;
import { createRoad, createHouse, createTree, createMountain, createMotorcycle } from './src/game/three/objects';
import { sharedMaterial } from './src/game/three/materials';
const input = new Input(window, { left: ['ArrowLeft'] }); input.wasPressed('left');
const off = events.on('jump', () => {}); off();
const camera = new CameraRig(); camera.camera.position.set(0, 1, 2);
const root: THREE.Object3D = createMotorcycle().root;
createHumanoid({ height: 1.8 }).root.position.set(0, 0, 0);
createRoad({ lanes: 3 }); createHouse({ roof: 'tile' }); createTree({ height: 2 }); createMountain({ size: 5 });
sharedMaterial('metal', 0xffffff); void root;`;
  const diagnostics = consumerDiagnostics(good);
  expect(diagnostics.map((d) => `${d.file?.fileName}: ${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)).toEqual([]);
  const bad = good.replace("import { createHumanoid } from './src/game/three/humanoid';", "import { createHumanoid, createBoat, createAirplane } from './src/game/three/objects';")
    .replace("import { scatterInstances } from './src/game/three/world';", "import { scatterInstances } from './src/game/three/objects';")
    .replace("input.wasPressed('left')", "input.bind('left', 'ArrowLeft')")
    .replace("const off = events.on('jump', () => {}); off();", "events.off('jump', () => {});")
    .replace('camera.camera.position', 'camera.object.position')
    .replace('createMotorcycle().root', 'createMotorcycle()')
    .replace("createHouse({ roof: 'tile' })", 'createHouse({ height: 2 })')
    .replace('createTree({ height: 2 })', 'createTree({ trunkHeight: 2 })')
    .replace('createMountain({ size: 5 })', 'createMountain({ segments: 2 })');
  const errors = consumerDiagnostics(bad);
  const codes = new Set(errors.map((d) => d.code));
  for (const code of [2305, 2339, 2353]) expect(codes.has(code)).toBe(true);
  const messages = errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');
  for (const symbol of ['createHumanoid', 'createBoat', 'createAirplane', 'scatterInstances', 'bind', 'off', 'object', 'trunkHeight', 'segments']) expect(messages).toContain(symbol);
}, 30_000);

describe('BR1954/Q-2311 — a platform kit palette is not user design debt', () => {
  it('excludes only reviewed byte-identical kit colours, not the entire file or accessibility/spacing', () => {
    const path = 'src/game/ui/Hud.tsx';
    expect(files[path]).toBeTruthy();
    const raw = lintDesign(shippedDesignText(path, files[path]));
    expect(raw.stats.colors).toBeGreaterThan(0);
    const result = lintBuiltApp({ [path]: files[path] })!;
    expect(result.design.stats.colors).toBe(0);
    expect(result.fileCount).toBe(1);
    expect(result.a11y).toEqual(lintBuiltApp({ 'src/CustomHud.tsx': files[path] })!.a11y);
    expect(result.design.stats.offGridSpacing).toBe(raw.stats.offGridSpacing);
    expect(result.design.stats.fonts).toBe(raw.stats.fonts);
  });
  it('does not use a path allowlist or globally exempt colours matching a kit colour', () => {
    const path = 'src/game/ui/Hud.tsx';
    const edited = files[path] + '\n// one byte of user authorship changes ownership\n';
    expect(lintBuiltApp({ [path]: edited })!.design.stats.colors).toBeGreaterThan(0);
    const matching = /#[0-9a-fA-F]{3,8}\b/.exec(shippedDesignText(path, files[path]))![0];
    expect(lintBuiltApp({ [path]: files[path], 'src/app.css': `.authored{color:${matching}}` })!.design.stats.colors).toBe(1);
    const colors = Array.from({ length: 14 }, (_, i) => `#${(0x112233 + i * 12345).toString(16).padStart(6, '0')}`);
    const css = colors.map((c, i) => `.c${i}{color:${c}}`).join('\n');
    const result = lintBuiltApp({ ...files, 'src/app.css': css })!;
    expect(result.design.violations.some((v) => v.type === 'color-count')).toBe(true);
    expect(result.offenders['color-count']).toContainEqual({ path: 'src/app.css', count: 14 });
    expect(lintBuiltApp({ 'src/not-the-kit.tsx': files[path] })!.design.stats.colors).toBeGreaterThan(0);
  });
  it('the standalone anonymous-code linter retains its existing colour policy', () => {
    const code = Array.from({ length: 13 }, (_, i) => `.x${i}{color:#${(0x123456 + i * 1000).toString(16)}}`).join('');
    expect(lintDesign(code).violations.some((v) => v.type === 'color-count')).toBe(true);
    // Only palette ownership is separate; non-colour rules still see the original code.
    const result = lintDesign(code + '<img src="x"><button></button>', { colorCode: '' });
    expect(result.stats.colors).toBe(0);
  });
});


it('never advertises a class overload implementation as an extra public callable', () => {
  const text = extractExportedDeclaration(`export class Overloads {
    constructor(value: string); constructor(value: number); constructor(value: string | number) {}
    do(value: string): string; do(value: number): number; do(value: string | number): string | number { return value; }
    static do(value: boolean): boolean { return value; }
  }`, 'Overloads')!;
  expect(text).toContain('constructor(value: string);');
  expect(text).toContain('constructor(value: number);');
  expect(text).toContain('do(value: string): string;');
  expect(text).toContain('do(value: number): number;');
  expect(text).toContain('static do(value: boolean): boolean;');
  expect(text).not.toContain('string | number');
});


it('an explicit unlockable roster alone never invents currency purchases or affordability', () => {
  const c = buildGameContract('endless runner with at least 5 unlockable characters');
  expect(c.minimumUnlockableCharacters).toBe(5);
  expect(c.runnerMechanics ?? []).not.toContain('currency-unlocks');
  const block = gameContractBlock(c);
  expect(block).toContain('At least 5 distinct unlockable characters');
  expect(block).toContain('actual unlock conditions and selection behavior');
  expect(block).not.toMatch(/affordable|purchase|spend/);
});
