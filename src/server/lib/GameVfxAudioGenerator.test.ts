import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGameVfxAudio, GAME_FX_MODULES } from './GameVfxAudioGenerator';

/**
 * WHY AN ACTION FEELS LIKE NOTHING HAPPENED.
 *
 * A hit that plays only an animation reads as a glitch. The same hit with a particle, a sound, a frame
 * of hit-stop and a nudge of camera shake reads as force — and the geometry did not change. Every
 * assertion below names the specific mistake it is preventing, because each one is a real thing a
 * from-scratch attempt gets wrong and nobody can name afterwards.
 */
const all = generateGameVfxAudio();
const particles = all.files['src/game/fx/particles.ts'];
const audio = all.files['src/game/fx/audio.ts'];
const feedback = all.files['src/game/fx/feedback.ts'];

/** Comments describe the mistake; only real code may satisfy an assertion about avoiding it. */
const code = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('particles — the difference between an effect and a frame-rate bug', () => {
  it('is ONE Points per blend layer, never a mesh per particle', () => {
    // A thousand sparks as a thousand meshes is a thousand draw calls and a thousand GC objects; the
    // frame rate is gone long before the effect looks good.
    expect(particles).toContain('new THREE.Points(geo, mat)');
    expect(code(particles)).not.toContain('new THREE.Mesh');
  });

  it('PREALLOCATES and recycles slots — a burst must allocate nothing', () => {
    // Allocating per burst is what turns a firefight into a stutter every time the GC runs.
    expect(particles).toContain('new Float32Array(max * 3)');
    expect(particles).toContain('this.cursor = (this.cursor + 1) % this.max');
  });

  it('additive particles do NOT write depth', () => {
    // With depthWrite on, the nearest particle punches a hole through the ones behind it and the
    // effect flickers apart.
    expect(particles).toContain('depthWrite: false');
  });

  it('SMOKE AND BLOOD ARE NOT ADDITIVE — the preset picks its own layer', () => {
    // The bug this replaced: `additive` was a field on every preset that nothing ever read, because one
    // material fixes the blend mode at construction. Dust, smoke and blood came out glowing like neon.
    expect(particles).toContain('const layer = spec.additive ? this.additive : this.normal');
    expect(particles).toContain('blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending');
    expect(particles).toContain('new ParticleLayer(Math.max(1, Math.ceil(max * 0.7)), true)');
    expect(particles).toContain('new ParticleLayer(Math.max(1, Math.ceil(max * 0.3)), false)');
  });

  it('exposes addTo(), so a caller cannot add just one layer and lose half the effects', () => {
    expect(particles).toContain('addTo(parent: THREE.Object3D)');
    expect(particles).toContain('get objects(): THREE.Points[]');
  });

  it('disables frustum culling — bursts happen anywhere, initial bounds are meaningless', () => {
    // Left on, an explosion across the map is culled by bounds computed when the buffer was empty.
    expect(particles).toContain('frustumCulled = false');
  });

  it('flags the buffers dirty, or nothing on screen ever moves', () => {
    for (const attr of ['position', 'color', 'size']) {
      expect(particles).toContain(`getAttribute('${attr}') as THREE.BufferAttribute).needsUpdate = true`);
    }
  });

  it('fades COLOUR as well as size, so a burst is not switched off mid-air', () => {
    expect(particles).toContain('col.lerp(end, t)');
  });

  it('drag is EXPONENTIAL — a fixed subtraction reverses velocity at low speed', () => {
    expect(particles).toContain('const drag = Math.exp(-(s.spec.drag ?? 1) * delta)');
  });

  it('is SEEDED, so the same scene replays identically', () => {
    expect(code(particles)).not.toContain('Math.random');
    expect(particles).toContain('private seed = 12345');
  });

  it('an unknown preset falls back instead of throwing mid-fight', () => {
    expect(particles).toContain('PARTICLE_PRESETS[preset] ?? PARTICLE_PRESETS.impact');
  });

  it('every preset is complete — a missing field is a silently invisible effect', () => {
    const block = particles.slice(
      particles.indexOf('PARTICLE_PRESETS: Record<ParticlePreset, ParticleSpec>'),
      particles.indexOf('interface Slot'),
    );
    const names = [...block.matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);
    expect(names).toHaveLength(9);
    for (const required of ['count', 'color', 'size', 'life', 'speed', 'spread', 'gravity', 'additive']) {
      const rows = [...block.matchAll(new RegExp(`${required}:`, 'g'))];
      expect(rows.length).toBeGreaterThanOrEqual(names.length);
    }
    // A zero-life or zero-count preset renders nothing at all.
    for (const [, life] of block.matchAll(/life: ([\d.]+)/g)) expect(Number(life)).toBeGreaterThan(0);
    for (const [, count] of block.matchAll(/count: (\d+)/g)) expect(Number(count)).toBeGreaterThan(0);
  });
});

describe('audio — why a web game has no sound', () => {
  it('UNLOCKS on a real user gesture', () => {
    // THE reason "there is no sound in my web game": every browser suspends the AudioContext until a
    // gesture. The code is fine; the context was never resumed.
    expect(audio).toContain('unlock(): void');
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      expect(audio).toContain(`window.addEventListener('${ev}', resume)`);
      expect(audio).toContain(`window.removeEventListener('${ev}', resume)`);
    }
  });

  it('uses Web Audio, NOT <audio> elements', () => {
    // <audio> carries tens of milliseconds of latency and browsers cap concurrent playback: the
    // gunshot lands after the muzzle flash and the tenth footstep is silent.
    expect(audio).toContain('createBufferSource()');
    expect(code(audio)).not.toContain('new Audio(');
    expect(code(audio)).not.toContain("createElement('audio')");
  });

  it('DETUNES repeated sfx — identical playback reads as a machine', () => {
    expect(audio).toContain('src.detune.value = (this.rand() * 2 - 1) * spread');
    expect(audio).toContain("category === 'sfx' ? 120 : 0");
  });

  it('CAPS voices — fifty explosions clip the master into mud', () => {
    expect(audio).toContain('this.playing.size >= this.maxVoices');
    expect(audio).toContain('maxVoices = 32');
  });

  it('releases finished voices, or the cap silences the game after a few minutes', () => {
    // Without onended the set only grows and every later play() is refused.
    expect(audio).toContain('src.onended = () => { this.playing.delete(src); }');
  });

  it('routes through category buses, so music and sfx are separately mixable', () => {
    expect(audio).toContain("buses: Record<SoundCategory, GainNode | null>");
    expect(audio).toContain("setVolume(category: SoundCategory | 'master'");
  });

  it('moves the LISTENER, or 3D audio pans from wherever the camera started', () => {
    expect(audio).toContain('setListener(x: number, y: number, z: number)');
  });

  it('a missing sound file NEVER breaks the game and never pretends it played', () => {
    expect(audio).toContain('console.warn');
    expect(audio).toContain('return false;');
  });

  it('survives a browser with no Web Audio at all — silent, not crashed', () => {
    expect(audio).toContain('if (!Ctor) return;');
  });
});

describe('feedback — the actual point of this phase', () => {
  it('is ONE table, so a reaction cannot be half-authored', () => {
    // Scattered through gameplay, reactions drift: someone adds the sound and forgets the shake, and
    // half the game feels weaker than the other half for no nameable reason.
    expect(feedback).toContain('export const FEEDBACK: Partial<Record<GameEvent, FeedbackSpec>>');
  });

  it('every heavy event fires particle + sound + shake TOGETHER', () => {
    const table = feedback.slice(feedback.indexOf('export const FEEDBACK'), feedback.indexOf('export interface FeedbackContext'));
    for (const ev of ['PROJECTILE_HIT', 'ENEMY_DIED', 'PLAYER_DAMAGED', 'BOSS_DEFEATED']) {
      const row = table.split('\n').find((l) => l.trim().startsWith(ev));
      expect(row, `${ev} missing from the table`).toBeTruthy();
      expect(row).toContain('particle:');
      expect(row).toContain('sound:');
      expect(row).toContain('trauma:');
    }
  });

  it('trauma scales with the event — a pickup must not shake like a boss kill', () => {
    const table = feedback.slice(feedback.indexOf('export const FEEDBACK'), feedback.indexOf('export interface FeedbackContext'));
    const trauma = (ev: string) => {
      const row = table.split('\n').find((l) => l.trim().startsWith(ev)) || '';
      return Number((row.match(/trauma: ([\d.]+)/) || [])[1] ?? 0);
    };
    expect(trauma('PLAYER_LANDED')).toBeLessThan(trauma('ENEMY_DAMAGED'));
    expect(trauma('ENEMY_DAMAGED')).toBeLessThan(trauma('ENEMY_DIED'));
    expect(trauma('ENEMY_DIED')).toBeLessThan(trauma('PLAYER_DIED'));
    expect(trauma('BOSS_DEFEATED')).toBeLessThanOrEqual(1); // trauma is 0..1; above that it just clamps
  });

  it('NO POSITION means NO PARTICLE — a burst at the origin looks like a bug elsewhere', () => {
    expect(feedback).toContain('if (spec.particle && ctx.particles && pos)');
  });

  it('returns an unsubscribe, or the next scene plays two sounds per hit', () => {
    expect(feedback).toContain('return () => { for (const off of offs) off(); }');
  });

  it('gameplay stays clean — it emits, it does not import VFX', () => {
    expect(feedback).toContain("import { events, type GameEvent } from '../core/events'");
    expect(feedback).toContain('bindGameFeedback(ctx: FeedbackContext, table = FEEDBACK)');
  });

  it('every event it reacts to really EXISTS in the runtime union', () => {
    // A typo here is silent: the handler simply never fires, and nobody notices until playtest.
    const runtime = readFileSync(join(__dirname, 'GameRuntimeGenerator.ts'), 'utf8');
    const union = runtime.slice(runtime.indexOf('export type GameEvent ='), runtime.indexOf('type Handler ='));
    const table = feedback.slice(feedback.indexOf('export const FEEDBACK'), feedback.indexOf('export interface FeedbackContext'));
    const used = [...table.matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1]);
    expect(used.length).toBeGreaterThanOrEqual(11);
    for (const ev of used) expect(union, `${ev} is not a GameEvent`).toContain(`'${ev}'`);
  });

  it('every particle it names really EXISTS as a preset', () => {
    const table = feedback.slice(feedback.indexOf('export const FEEDBACK'), feedback.indexOf('export interface FeedbackContext'));
    const used = new Set([...table.matchAll(/particle: '(\w+)'/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThanOrEqual(6);
    for (const p of used) expect(particles, `${p} is not a preset`).toContain(`  ${p}:`);
  });

  it('uses the runtime feel API by its real names, or shake silently never happens', () => {
    const runtime = readFileSync(join(__dirname, 'GameRuntimeGenerator.ts'), 'utf8');
    expect(runtime).toContain('addTrauma(amount: number)');
    expect(runtime).toContain('addHitStop(seconds: number)');
    expect(feedback).toContain('ctx.feel.addTrauma(spec.trauma)');
    expect(feedback).toContain('ctx.feel.addHitStop(spec.hitStop)');
  });
});

describe('the pack itself', () => {
  it('adds NO dependency — three comes from the 3D layer, audio is the browser', () => {
    expect(all.dependencies).toEqual([]);
  });

  it('emits every advertised module', () => {
    expect(Object.keys(all.files)).toHaveLength(GAME_FX_MODULES.length);
    for (const m of GAME_FX_MODULES) expect(all.files[`src/game/fx/${m}.ts`]).toBeTruthy();
  });

  it('a subset that would not compile pulls in what it imports', () => {
    const only = Object.keys(generateGameVfxAudio(['feedback']).files);
    expect(only).toContain('src/game/fx/particles.ts');
    expect(only).toContain('src/game/fx/audio.ts');
  });

  it('an unmatched or empty filter falls back to the full pack; junk never throws', () => {
    expect(Object.keys(generateGameVfxAudio(['nope']).files)).toHaveLength(GAME_FX_MODULES.length);
    for (const bad of [undefined, [], ['', ' '], [null as unknown as string]]) {
      expect(() => generateGameVfxAudio(bad)).not.toThrow();
      expect(Object.keys(generateGameVfxAudio(bad).files).length).toBeGreaterThan(0);
    }
  });

  it('the instructions name the unlock trap and the one-table rule', () => {
    const { instructions } = generateGameVfxAudio();
    expect(instructions).toContain('audio.unlock()');
    expect(instructions).toContain('particles.addTo(scene)');
    expect(instructions).toContain('ONE table');
  });
});

/**
 * THE WIRING. Repeatedly this session a capability shipped that nothing could reach. A generator the
 * builder cannot invoke is dead code.
 */
describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');

  it('is registered in BOTH the definition and the exposed list', () => {
    expect(catalog).toContain("name: 'generate_game_vfx'");
    expect(catalog).toContain("  'generate_game_vfx',");
  });

  it('the dispatcher handles it and writes the files', () => {
    expect(dispatcher).toContain("case 'generate_game_vfx': {");
    expect(dispatcher).toContain('generateGameVfxAudio(gfxInclude)');
  });

  it('the description tells the model to bind the table rather than call VFX inline', () => {
    const at = catalog.indexOf("name: 'generate_game_vfx'");
    const def = catalog.slice(at, at + 2000);
    expect(def).toContain('bindGameFeedback');
    expect(def).toContain('generate_game_runtime');
  });
});
