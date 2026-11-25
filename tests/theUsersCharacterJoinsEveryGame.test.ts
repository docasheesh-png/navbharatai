// "USE AS MY CHARACTER" WORKS IN EVERY GAME, NOT ONLY THE OPEN WORLD (admin 2026-11-22: the user's own .glb/.gltf/.obj or zip,
// or a model from the game library, put in as the character they play — "100%, all games").
//
// 🧬 THE CLASS: a capability wired into ONE game. The open-world starter applied src/game/player.ts itself, only its mount
// wrote that file, and the platform's library step returned NOTHING for a game without it — so a boxing game, the endless
// runner or any game the builder wrote on the shell could not take the user's character. The swap lives in the shell and
// each starter now (play/playerBody.ts reads src/game/player.ts by itself); the platform creates the file where the shell
// reads it and says plainly where a game has no character (a racing car, first person). Runs the REAL generated kit
// headless, with the real runner and the real three.js animation mixer.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { GAME_STARTERS } from '../src/server/lib/gameStarters';
import { GAME_PLAYER_BODY_PATH, GAME_PLAYER_FILE, GAME_PLAYER_FILE_PATH } from '../src/server/lib/GamePlayerBodyGenerator';
import { clipForMove as serverClipForMove, PLAYER_MOVES, playerMovesOf } from '../src/server/lib/playerMoves';
import { setLibraryCharacterAtTurnStart } from '../src/server/AgentV3/growthTurn';
import { setPlayerModel, libraryMovesOf, characterNotSwappable, librarySubjectOf, PLAYER_FILE_PATH } from '../src/server/AgentV3/characterSwap';
import { useAsCharacterPrompt, libraryBrowseRows } from '../src/server/AgentV3/gameAssets/libraryThumbnails';
import { projectGrowthRules, GAME_PLAYER_RULE } from '../src/server/AgentV3/gameKitSeed';
import { userModelNote } from '../src/server/AgentV3/gameAssets/userModels';

/** The user's own file, as three's GLTFLoader would hand it over: a 3 m figure, off-centre, with the clips named here. */
const FILES = new Map<string, { clips: string[]; height: number }>();
function fakeGltf(url: string) {
  const spec = FILES.get(url);
  if (!spec) throw new Error('404 ' + url);
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, spec.height, 0.4));
  mesh.position.set(2, spec.height / 2 - 0.7, -1);       // off-centre, feet 0.7 m below its origin
  mesh.name = 'Body';
  scene.add(mesh);
  const track = (name: string) => new THREE.AnimationClip(name, 0.5, [new THREE.NumberKeyframeTrack('Body.position[y]', [0, 0.5], [0, 0.1])]);
  return { scene, animations: spec.clips.map(track) };
}
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { async loadAsync(url: string) { return fakeGltf(url); } } }));

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const DIR = join(__dirname, `.tmp-character-every-game-${process.pid}`);
const pool = recipeFilePool();
/* eslint-disable @typescript-eslint/no-explicit-any */
let PB: any; let R: any; let S: any; let E: any; let CH: any; let HU: any;
const hints: Array<{ id: string; text: string }> = [];
beforeAll(async () => {
  const g = globalThis as any;
  g.window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const [p, f] of pool) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  // The game's own player file — read by the game BY ITSELF (nothing passes it).
  writeFileSync(join(DIR, GAME_PLAYER_FILE_PATH), GAME_PLAYER_FILE.replace('file: null', "file: '/models/boxer.glb'").replace('look: { shirt: 0x2e5a87 }', 'look: { shirt: 0xaa0000 }'));
  PB = await import(join(DIR, GAME_PLAYER_BODY_PATH));
  R = await import(join(DIR, 'src/game/LaneRunnerGame.tsx'));
  S = await import(join(DIR, 'src/game/core/state.ts'));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  HU = await import(join(DIR, 'src/game/three/humanoid.ts'));
  E.events.on('HINT', (p: { id: string; text: string }) => hints.push(p));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const quiet = () => { const w = vi.spyOn(console, 'warn').mockImplementation(() => {}); const e = vi.spyOn(console, 'error').mockImplementation(() => {}); return () => { w.mockRestore(); e.mockRestore(); }; };
/** Every clip name the real three.js mixer was asked to play. */
function watchClips() {
  const played: string[] = [];
  const original = THREE.AnimationMixer.prototype.clipAction;
  const spy = vi.spyOn(THREE.AnimationMixer.prototype, 'clipAction').mockImplementation(function (this: THREE.AnimationMixer, clip: any, ...rest: any[]) { played.push(clip.name); return (original as any).call(this, clip, ...rest); });
  return { played, stop: () => spy.mockRestore() };
}
const shellGame = () => {
  const player = new CH.CharacterController({});
  const hero = HU.createHumanoid({ height: 1.75 });
  player.object.add(hero.root);
  return { player, hero, ctx: { player, hero } as any };
};

describe('🔒 census: every game the kit mounts takes the user\'s character from src/game/player.ts', () => {
  it('the shell reads the file by itself and applies it before the game\'s setup — so ANY game built on it (boxing, shooter, the builder\'s own) swaps its body', () => {
    const shell = pool.get('src/game/Game.ts')!.content;
    expect(shell).toMatch(/this\.playerChoice = resolvePlayerChoice\(options\.player\)/);
    const applied = shell.indexOf('this.playerModel = applyPlayerChoice(this.context, this.playerChoice)');
    expect(applied).toBeGreaterThan(0);
    expect(applied).toBeLessThan(shell.indexOf('options.setup?.(this.context)'));
    expect(shell).toMatch(/this\.playerModel\?\.update\(delta\)/);
    expect(shell).toMatch(/safe\(\(\) => this\.playerModel\?\.dispose\(\)\)/);
  });
  it('the body ships with the shell whatever subset is asked for (the shell imports it)', () => {
    for (const include of [undefined, ['game'], ['gamecanvas'], ['lanerunnergame'], ['racingroadgame'], ['hud']]) {
      const files = generateGameShell(include as string[] | undefined).files;
      if (files['src/game/Game.ts']) expect(Object.keys(files), String(include)).toContain(GAME_PLAYER_BODY_PATH);
    }
  });
  it('every ready starter reads the player file — or is a game whose player is not a body (named here, with the reason)', () => {
    // A NEW starter added to GAME_STARTERS without the hook fails here until it reads the file or is listed with its reason.
    const NOT_A_BODY: Record<string, string> = { RacingRoadGame: 'the player is the car (the racing car path is separate work)' };
    for (const s of GAME_STARTERS) {
      const src = [...pool.entries()].find(([p]) => p === `src/game/${s.name}.tsx`)?.[1].content ?? '';
      expect(src, s.name).not.toBe('');
      if (NOT_A_BODY[s.name]) continue;
      const readsFile = /resolvePlayerChoice\(/.test(src) || /\.\.\.\(player \? \{ player \} : \{\}\)/.test(src);   // its own, or handed to the shell
      expect(readsFile, `${s.name} must take the user's character from src/game/player.ts`).toBe(true);
    }
  });
});

describe('🧍 the user\'s OWN model file becomes the player', () => {
  it('stands at its height, feet on the ground, centred where the player stands, turned when it faces backwards', async () => {
    FILES.set('/models/hero.glb', { clips: ['Idle', 'Walking'], height: 3 });
    const holder = new THREE.Group();
    let shown = 0;
    const c = PB.createPlayerCharacter(holder, { file: '/models/hero.glb', modelHeight: 2, turn: 180 }, () => { shown++; });
    expect(c.showing).toBe('person');                       // never a missing player while it loads
    await settle();
    expect(c.showing).toBe('model');
    expect(shown).toBe(1);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    expect(box.max.y - box.min.y).toBeCloseTo(2, 3);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 3);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 3);
    expect(c.root.children[0].rotation.y).toBeCloseTo(Math.PI);
    c.dispose();
    expect(holder.children).toEqual([]);
  });
  it('a path outside the project, or not a .glb, is refused — the kit person stays and the game says why', async () => {
    const restore = quiet();
    expect(PB.playerFileUrl('/models/hero.glb')).toBe('/models/hero.glb');
    expect(PB.playerFileUrl('public/models/hero.glb')).toBe('/models/hero.glb');
    for (const bad of ['../secret.glb', 'https://evil.example/x.glb', '/models/hero.png', '', '/models/../../x.glb']) expect(PB.playerFileUrl(bad), bad).toBeNull();
    const holder = new THREE.Group();
    const c = PB.createPlayerCharacter(holder, { file: 'https://evil.example/x.glb' });
    const missing = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/nowhere.glb' });
    await settle();
    expect(c.showing).toBe('person');
    expect(missing.showing).toBe('person');
    expect(holder.children).toEqual([]);
    expect(hints.some((h) => h.id === 'player-model-missing')).toBe(true);
    restore();
  });
});

describe('🥊 moves are the model\'s OWN clips — and a move it lacks is SAID, never faked', () => {
  it('a boxer with punch and block but no kick: punch and block play their clips; kick is told on screen once', async () => {
    const restore = quiet();
    FILES.set('/models/boxer-a.glb', { clips: ['CharacterArmature|Idle', 'Walk', 'Run', 'Punch_Right', 'Guard_Up', 'HitReact', 'Death'], height: 1.8 });
    const clips = watchClips();
    const c = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/boxer-a.glb' });
    await settle();
    expect(c.move('idle')).toBe(true);
    expect(c.act('punch')).toBe(true);
    expect(c.act('block')).toBe(true);
    hints.length = 0;
    expect(c.act('kick')).toBe(false);
    expect(c.act('kick')).toBe(false);
    clips.stop();
    expect(clips.played).toEqual(expect.arrayContaining(['CharacterArmature|Idle', 'Punch_Right', 'Guard_Up']));
    expect(hints.filter((h) => /kick/.test(h.text))).toHaveLength(1);
    expect(hints[0].text).toMatch(/no kick move/);
    restore();
  });
  it('a model with NO punch clip in a fighting game says so (no fake animation); a missing run plays its real walk and says that', async () => {
    const restore = quiet();
    FILES.set('/models/statue.glb', { clips: ['Idle', 'Walk'], height: 1.7 });
    const c = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/statue.glb' });
    await settle();
    hints.length = 0;
    expect(c.act('punch')).toBe(false);
    expect(c.move('run')).toBe(false);
    expect(hints.map((h) => h.text).join(' | ')).toMatch(/no punch move[\s\S]*not animated[\s\S]*no run move[\s\S]*plays its walk instead/);
    restore();
  });
  it('a model with no animations at all says it once, and nothing else', async () => {
    const restore = quiet();
    FILES.set('/models/rock.glb', { clips: [], height: 1 });
    hints.length = 0;
    const c = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/rock.glb' });
    await settle();
    c.act('punch'); c.move('run');
    expect(hints.map((h) => h.id)).toEqual(['player-moves-none']);
    restore();
  });
  it('PLAYER.moves names a clip the kit cannot recognise', () => {
    expect(PB.clipForMove(['A_01', 'Zap'], 'punch')).toBeNull();
    expect(PB.clipForMove(['A_01', 'Zap'], 'punch', 'Zap')).toBe('Zap');
  });
  it('the kit and the server find the same clip for every move (one table, two readers — never drifting)', () => {
    const corpus = [['Idle', 'Walking', 'Running', 'Jump', 'Punch_Left', 'Punch_Right', 'Kick', 'Block', 'HitReact', 'Death', 'Shoot', 'Sword_Slash', 'Throw', 'Interact', 'Roll'],
      ['mixamo.com'], ['Armature|Standing_Idle', 'Armature|Run_Back', 'Armature|Run', 'Armature|Jog'], ['RUN', 'idle_breathing', 'Uppercut', 'KnockOut'], []];
    for (const names of corpus) for (const move of PLAYER_MOVES) expect(PB.clipForMove(names, move), `${move} in ${names.join(',')}`).toBe(serverClipForMove(names, move));
    expect(serverClipForMove(['Armature|Run_Back', 'Armature|Run'], 'run')).toBe('Armature|Run');
  });
});

describe('🎮 on the shell: every pose the game plays on the kit person is played by the model', () => {
  it('ctx.hero.act / die / revive reach the model; playMove plays a move with no button pose; a second apply changes nothing', async () => {
    const restore = quiet();
    FILES.set('/models/fighter.glb', { clips: ['Idle', 'Walk', 'Punch', 'Kick', 'Block', 'Death'], height: 1.8 });
    const g = shellGame();
    const loads = vi.fn(async (url: string) => fakeGltf(url));
    const body = PB.applyPlayerChoice(g.ctx, { file: '/models/fighter.glb' }, { file: loads });
    const again = PB.applyPlayerChoice(g.ctx, { file: '/models/fighter.glb' }, { file: loads });
    await settle();
    expect(loads).toHaveBeenCalledTimes(1);
    expect(body.showing).toBe('model');
    expect(again.showing).toBe('model');
    expect(g.hero.root.scale.x).toBeLessThan(0.001);
    const clips = watchClips();
    g.hero.act('kick');
    expect(PB.playMove(g.ctx, 'block')).toBe(true);
    hints.length = 0;
    g.hero.act('fire');                                     // the fighter has no gun clip: said, not faked
    expect(hints.map((h) => h.text).join(' ')).toMatch(/no fire move/);
    g.hero.die();
    expect(g.hero.act('punch')).toBeUndefined();            // down: no move plays until revive
    clips.stop();
    expect(clips.played).toEqual(['Kick', 'Block', 'Death']);
    g.hero.revive();
    body.dispose();
    expect(g.hero.root.scale.x).toBe(1);
    expect(PB.playMove(g.ctx, 'block')).toBe(false);
    restore();
  });
  it('a game with no visible body (first-person, or its own) says the character is not shown — never a silent no-op', () => {
    const restore = quiet();
    hints.length = 0;
    const ctx = { player: new CH.CharacterController({}), hero: null };
    expect(PB.applyPlayerChoice(ctx, { model: 'knight' }).showing).toBe('person');
    expect(hints.map((h) => h.id)).toEqual(['player-no-body']);
    restore();
  });
  it('the game reads src/game/player.ts BY ITSELF: nothing is passed, and a passed choice still wins', () => {
    expect(PB.resolvePlayerChoice()).toMatchObject({ file: '/models/boxer.glb', model: null });
    expect(PB.resolvePlayerChoice({ model: 'knight' })).toEqual({ model: 'knight' });
    expect(PB.resolvePlayerChoice(null)).toBeUndefined();
  });
});

describe('🏃 the endless runner runs as the user\'s character', () => {
  it('reads src/game/player.ts itself; the kit runner steps aside; run, jump and fall play the model\'s clips; a missing slide is said', async () => {
    const restore = quiet();
    FILES.set('/models/boxer.glb', { clips: ['Idle', 'Run', 'Jump', 'Death'], height: 2.4 });
    const fake = () => { const pressed = new Set<string>(); return { press: (a: string) => pressed.add(a), wasPressed: (a: string) => pressed.has(a), endFrame: () => pressed.clear(), isDown: () => false, axis: () => ({ x: 0, y: 0 }) }; };
    const input = fake();
    const scene = new THREE.Scene();
    const ctx: any = { scene, input, follow: () => {} };
    const clips = watchClips();
    const game = R.createLaneRunnerScene({ seed: 3 });
    await settle();
    game.setup(ctx);
    S.setStatus('playing');
    const root = scene.getObjectByName('Lane runner')!;
    const body = root.getObjectByName('Player character')!;
    expect(body.children.length).toBe(1);                   // the user's model, sized
    const runnerBody = root.children.find((c) => c !== body && c.children.length > 0 && c.visible === false);
    expect(runnerBody).toBeDefined();                        // the kit runner is hidden
    hints.length = 0;
    for (let i = 0; i < 6; i++) game.update(ctx, 1 / 60);
    input.press('jump'); game.update(ctx, 1 / 60); input.endFrame();
    input.press('down'); for (let i = 0; i < 30; i++) game.update(ctx, 1 / 60);
    for (let i = 0; i < 60 * 30 && game.run.alive; i++) game.update(ctx, 1 / 60);   // standing still crashes
    clips.stop();
    expect(game.run.alive).toBe(false);
    expect(clips.played).toEqual(expect.arrayContaining(['Run', 'Jump', 'Death']));
    expect(body.position.z).toBeCloseTo(game.run.distance, 3);
    expect(hints.map((h) => h.text).join(' ')).toMatch(/no slide move/);
    game.dispose();
    S.setStatus('menu');
    restore();
  });
});

describe('📚 the platform sets the library character in every game on the kit — and says where it cannot', () => {
  const row = libraryBrowseRows(undefined, () => false)[0];
  const subject = librarySubjectOf(row.id)!;
  const added = `Added to the game from the NavBharatAI library: ${subject}. Use them with: …`;
  const shell = pool.get('src/game/Game.ts')!.content;
  function turn(files: Record<string, string>, live: Record<string, string> = files) {
    const disk = new Map(Object.entries(live));
    const addModel = vi.fn(async () => added);
    const write = vi.fn(async (p: string, c: string) => { disk.set(p, c); });
    const codes: string[] = [];
    const io = { prompt: useAsCharacterPrompt(row)!, filesAtTurnStart: files, read: async (p: string) => { const c = disk.get(p); if (c === undefined) throw new Error('ENOENT'); return c; }, write, addModel, record: (i: { code: string }) => { codes.push(i.code); } };
    return { io, disk, addModel, write, codes };
  }
  it('a boxing game on the shell with no player file yet: the model is added and the file is CREATED, already set', async () => {
    const files = { 'src/App.tsx': "import { BoxingGame } from './game/BoxingGame';", 'src/game/Game.ts': shell };
    const t = turn(files);
    const handoff = await setLibraryCharacterAtTurnStart(t.io);
    expect(t.addModel).toHaveBeenCalledWith(row.id);
    expect(t.disk.get(PLAYER_FILE_PATH)).toBe(GAME_PLAYER_FILE.replace('model: null', `model: '${subject}'`));
    expect(handoff).toContain('DONE BY THE PLATFORM');
    expect(handoff).toMatch(/its own moves|NO animations/);
    expect(t.codes).toEqual(['PLAYER_CHARACTER_SET']);
  });
  it('the runner game, which already has the file, is set like the open world', async () => {
    const t = turn({ 'src/App.tsx': '<LaneRunnerGame title="Dash" />', 'src/game/Game.ts': shell, [PLAYER_FILE_PATH]: GAME_PLAYER_FILE });
    expect(await setLibraryCharacterAtTurnStart(t.io)).toContain('DONE BY THE PLATFORM');
    expect(t.disk.get(PLAYER_FILE_PATH)).toContain(`model: '${subject}'`);
  });
  it('a racing game (its player is the car) and the first-person royale are TOLD so; nothing is added or written', async () => {
    for (const app of ['<RacingRoadGame title="x" />', '<RoyalePractice />', '<RoyaleGame />']) {
      const t = turn({ 'src/App.tsx': app, 'src/game/Game.ts': shell, [PLAYER_FILE_PATH]: GAME_PLAYER_FILE });
      const handoff = await setLibraryCharacterAtTurnStart(t.io);
      expect(handoff, app).toContain('NOT DONE');
      expect(t.addModel).not.toHaveBeenCalled();
      expect(t.write).not.toHaveBeenCalled();
    }
    expect(characterNotSwappable({ 'src/App.tsx': '<RacingRoadGame />' })).toMatch(/car/);
    expect(characterNotSwappable({ 'src/App.tsx': '<OpenWorldGame />' })).toBeNull();
  });
  it('picking a library model clears the user\'s own file (which would otherwise win), every other byte kept', () => {
    const own = GAME_PLAYER_FILE.replace('file: null', "file: '/models/me.glb'");
    const set = setPlayerModel(own, 'knight');
    expect(set.ok && set.source).toBe(GAME_PLAYER_FILE.replace('model: null', "model: 'knight'"));
    expect(setPlayerModel(own + "\nexport const X = {\n  file: null,\n};\n", 'knight').ok).toBe(false);   // two file lines: no guess
  });
  it('the moves the builder tells the user are the model\'s real ones', () => {
    const moves = libraryMovesOf('x', [{ id: 'x', animationRoles: { idle: 'I', walk: 'W', punch: 'P' } }])!;
    expect(moves.has).toEqual(['idle', 'walk', 'punch']);
    expect(moves.lacks).toContain('kick');
    expect(moves.lacks).not.toContain('land');
    expect(libraryMovesOf('nope', [])).toBeNull();
  });
});

describe('🗣️ the builder is told how, in every game that has the file', () => {
  it('the rule rides on every turn of ANY game with src/game/player.ts and covers attached files, the library and plain words', () => {
    expect(projectGrowthRules({ 'src/App.tsx': '<LaneRunnerGame />', [GAME_PLAYER_FILE_PATH]: GAME_PLAYER_FILE })).toContain(GAME_PLAYER_RULE);
    expect(GAME_PLAYER_RULE).toMatch(/PLAYER\.file = '\/models\/hero\.glb'/);
    expect(GAME_PLAYER_RULE).toMatch(/mera character ye wala/);
    expect(GAME_PLAYER_RULE).toMatch(/boxer ko ye model do/);
    expect(GAME_PLAYER_RULE).toMatch(/never faked/);
    expect(GAME_PLAYER_RULE).toMatch(/playMove\(ctx, 'block'\)/);
  });
  it('an attached model\'s note says how to make it the player and which moves it has and lacks', () => {
    const note = userModelNote([{ from: 'Boxer.glb', subject: 'boxer', path: 'public/models/boxer.glb', bytes: new Uint8Array(), sha256: 'a'.repeat(64), triangles: 10, animations: ['Idle', 'Punch_Right'], materials: [], parts: [], warnings: [] }], []);
    expect(note).toMatch(/AS THE PLAYER[\s\S]*PLAYER\.file = '\/models\/boxer\.glb'/);
    expect(note).toMatch(/punch \("Punch_Right"\)/);
    // Admin 2026-11-24: a missing punch/kick/swing/throw/fire/use is MADE from the skeleton; the rest stays unanimated (playerMoves.lackedMovesClause).
    expect(note).toMatch(/kick, fire, swing, throw, use are not in its own clips, so NavBharatAI makes them from its skeleton/);
    expect(note).toMatch(/walk, run, jump, block, hit, die, slide are not animated/);
    expect(playerMovesOf([]).has).toEqual([]);
  });
  it('the shell recipe creates the file once (never replaces it), and says so', () => {
    const src = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(src).toMatch(/gsh\.files\['src\/game\/Game\.ts'\] \? await this\.ensurePlayerFile\(agent, 'generate_game_shell'\)/);
    expect(pool.has(GAME_PLAYER_FILE_PATH)).toBe(false);    // never a kit file: a refresh must not reset the user's character
  });
});
