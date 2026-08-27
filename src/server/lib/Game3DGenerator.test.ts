import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGame3D, GAME_3D_MODULES } from './Game3DGenerator';

/**
 * WHY A THREE.JS SCENE LOOKS BAD — and it is almost never the models.
 *
 * The same low-poly geometry can read as deliberate and expensive or as flat and unfinished. The
 * difference lives in a handful of settings that have nothing to do with assets, and every one of them
 * is a specific, nameable mistake. These tests assert the generated scene does not make them, because
 * that is the whole value of shipping a 3D layer rather than letting the model improvise one.
 */
const all = generateGame3D();
const file = (name: string) => all.files[`src/game/three/${name}.ts`];

describe('colour management — the mistake that makes every scene look wrong', () => {
  const renderer = file('renderer');

  it('sets sRGB output AND a filmic tone map', () => {
    // three.js renders linear. Without both of these a scene is washed out or blown out, and it is the
    // most common reason a WebGL project "looks off" in a way nobody can name.
    expect(renderer).toContain('outputColorSpace = THREE.SRGBColorSpace');
    expect(renderer).toContain('toneMapping = THREE.ACESFilmicToneMapping');
  });

  it('CAPS the pixel ratio — a 3x phone screen otherwise renders 9x the pixels', () => {
    // The frame rate is gone before a single model loads. This is a performance decision made once,
    // by default, rather than a later optimisation pass.
    expect(renderer).toContain('Math.min(window.devicePixelRatio || 1, options.maxPixelRatio ?? 2)');
  });

  it('uses soft shadows — hard-edged ones read as cheap', () => {
    expect(renderer).toContain('THREE.PCFSoftShadowMap');
  });

  it('updates the projection matrix on resize, or the view stays stretched after a rotate', () => {
    expect(renderer).toContain('camera.updateProjectionMatrix()');
    expect(renderer).toContain("addEventListener('orientationchange'");
  });

  it('sizes to the CONTAINER when embedded, not to the window', () => {
    // window.innerWidth is right for a fullscreen game and wrong for every embedded one: the canvas
    // overflows its panel and the view is stretched.
    expect(renderer).toContain('container?: HTMLElement | null');
    expect(renderer).toContain('container.getBoundingClientRect()');
    expect(renderer).toContain('renderer.setSize(size.w, size.h, !container)');
  });

  it('observes the container — a sidebar collapse never fires a window resize', () => {
    expect(renderer).toContain('new ResizeObserver(onResize)');
    expect(renderer).toContain("typeof ResizeObserver !== 'undefined'");
    expect(renderer).toContain('observer?.disconnect()');
  });

  it('sizes on the FIRST frame, not only after something resizes', () => {
    expect(renderer).toContain('onResize(); // size correctly on the first frame');
  });

  it('a zero-sized container keeps the last good size instead of blanking forever', () => {
    // An unopened tab or display:none gives 0×0; dividing by it makes aspect NaN and the canvas never
    // recovers even after it becomes visible.
    expect(renderer).toContain('if (r.width > 0 && r.height > 0)');
  });
});

describe('lighting — the biggest single lever on how a scene feels', () => {
  const lighting = file('lighting');

  it('every preset is hemisphere + key + ambient, not one lonely light', () => {
    // One light gives flat shading and pure-black shadows: "3D shapes", not "a place".
    expect(lighting).toContain('THREE.HemisphereLight');
    expect(lighting).toContain('THREE.DirectionalLight');
    expect(lighting).toContain('THREE.AmbientLight');
  });

  it('fog COLOUR matches the background in every preset', () => {
    // Mismatched fog puts a visible seam where the world ends. Checked across all presets, not one.
    const block = lighting.slice(lighting.indexOf('LIGHTING_PRESETS'), lighting.indexOf('export interface AppliedLighting'));
    const rows = [...block.matchAll(/background: (0x[0-9a-f]+), fog: \{ color: (0x[0-9a-f]+)/g)];
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const [, bg, fog] of rows) expect(fog).toBe(bg);
  });

  it('FITS the shadow camera instead of leaving the default box', () => {
    // Too big and shadows are blocky mush; too small and they vanish at the edges.
    expect(lighting).toContain('cam.left = -shadowRadius');
    expect(lighting).toContain('cam.updateProjectionMatrix()');
  });

  it('sets BOTH shadow biases — acne and stripe self-shadowing are different bugs', () => {
    expect(lighting).toContain('key.shadow.bias');
    expect(lighting).toContain('key.shadow.normalBias');
  });

  it('can follow the player, or shadows blur out as they walk away on a big map', () => {
    expect(lighting).toContain('export function followShadow');
  });
});

describe('materials — consistency is what art direction actually means', () => {
  const materials = file('materials');

  it('ships palettes, so a scene is drawn from ONE set of colours', () => {
    // Per-object hand-picked colours are what make a world look like a parts bin.
    for (const p of ['indianVillage', 'forest', 'desert', 'neon']) expect(materials).toContain(p);
  });

  it('roughness/metalness are believable, not everything at 0.5', () => {
    // Real dielectrics are metalness 0; only actual metal is 1. 0.5/0.5 everywhere is the plastic look.
    expect(materials).toContain("case 'metal':    return new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 1 })");
    expect(materials).toContain("case 'ground':   return new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 })");
  });

  it('emissive is UNLIT — a lit emissive reads as a grey object with glow stuck on', () => {
    expect(materials).toContain("case 'emissive': return new THREE.MeshBasicMaterial({ color })");
  });

  it('SHARES materials — a thousand trees must not be a thousand shader binds', () => {
    expect(materials).toContain('export function sharedMaterial');
    expect(materials).toContain('cache.set(key, mat)');
  });

  it('palette lookup is DETERMINISTIC — a world that reshuffles cannot be art-directed', () => {
    expect(materials).toContain('list[Math.abs(Math.floor(index)) % list.length]');
  });
});

describe('camera rigs', () => {
  const camera = file('camera');

  it('damps with exp decay, not a per-frame lerp', () => {
    // `a + (b-a)*0.1` moves twice as fast at 120fps: the camera literally feels different per monitor.
    expect(camera).toContain("import { damp } from '../core/feel'");
    expect(camera).toContain('damp(this.camera.position.x');
  });

  it('third-person casts a ray so the camera cannot end up inside a wall', () => {
    expect(camera).toContain('this.ray.intersectObjects(this.collidables, true)');
    expect(camera).toContain('Math.max(0.6, hit.distance - 0.3)');
  });

  it('pitch is clamped short of vertical, where the view would flip', () => {
    expect(camera).toContain('Math.max(-1.45, Math.min(1.45, this.pitch))');
  });

  it('accepts the runtime\'s shake without disturbing its own target', () => {
    expect(camera).toContain('applyShake');
  });
});

describe('procedural world — an environment with no asset library', () => {
  const world = file('world');

  it('terrain uses SMOOTH noise, not per-vertex random', () => {
    // Random heights give television static. Interpolated noise gives hills.
    expect(world).toContain('export function valueNoise2D');
    expect(world).toContain('const smooth = (t: number) => t * t * (3 - 2 * t)');
  });

  it('recomputes normals, or the hills are invisible under flat lighting', () => {
    expect(world).toContain('geo.computeVertexNormals()');
  });

  it('scatter uses InstancedMesh — a thousand trees is ONE draw call', () => {
    expect(world).toContain('new THREE.InstancedMesh');
  });

  it('never draws uninitialised instances (they spike at the origin)', () => {
    expect(world).toContain('mesh.count = placed');
  });

  it('placement is bounded, so a strict accept() cannot spin forever', () => {
    expect(world).toContain('attempts < count * 12');
  });

  it('accept() exists — unconditional scatter puts trees through buildings', () => {
    expect(world).toContain('accept?: (x: number, z: number) => boolean');
  });

  it('everything is SEEDED, so the same world rebuilds identically', () => {
    expect(world).toContain('export function makeRng');
    const code = world.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toContain('Math.random');
  });
});

describe('the pack itself', () => {
  it('takes exactly ONE dependency, and only for 3D', () => {
    expect(all.dependencies).toEqual([{ name: 'three', version: '^0.180.0' }]);
  });

  it('emits every advertised module', () => {
    expect(Object.keys(all.files)).toHaveLength(GAME_3D_MODULES.length);
    for (const m of GAME_3D_MODULES) expect(all.files[`src/game/three/${m}.ts`]).toBeTruthy();
  });

  it('a subset that would not compile pulls in what it imports', () => {
    expect(Object.keys(generateGame3D(['world']).files)).toContain('src/game/three/materials.ts');
  });

  it('an unmatched or empty filter falls back to the full pack; junk never throws', () => {
    expect(Object.keys(generateGame3D(['nope']).files)).toHaveLength(GAME_3D_MODULES.length);
    for (const bad of [undefined, [], ['', ' '], [null as unknown as string]]) {
      expect(() => generateGame3D(bad)).not.toThrow();
    }
  });

  it('the instructions teach the craft, not just the API', () => {
    const { instructions } = generateGame3D();
    expect(instructions).toContain('Use ONE palette');
    expect(instructions).toContain('ONE draw call');
    expect(instructions).toContain('Keep bloom subtle');
  });
});

/**
 * THE WIRING. Three times this session a capability shipped that nothing could reach. A generator the
 * builder cannot invoke is dead code.
 */
describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');

  it('is registered in BOTH the definition and the exposed list', () => {
    expect(catalog).toContain("name: 'generate_game_3d'");
    expect(catalog).toContain("  'generate_game_3d',");
  });

  it('the dispatcher handles it, writes the files AND names the dependency', () => {
    expect(dispatcher).toContain("case 'generate_game_3d': {");
    expect(dispatcher).toContain('generateGame3D(g3Include)');
    // A 3D layer whose `three` install is never mentioned produces an app that will not build.
    expect(dispatcher).toContain('g3Deps');
  });

  it('the description points the model at the runtime first', () => {
    const at = catalog.indexOf("name: 'generate_game_3d'");
    expect(catalog.slice(at, at + 2000)).toContain('generate_game_runtime');
  });
});

/**
 * THE REALISM TRIO (admin 2026-08-26: a "realistic 3D game" came back looking flat).
 *
 * The audit found the lighting was ALREADY correct — sRGB, ACES, a fitted shadow camera — and that
 * three things underneath it were missing: nothing to reflect, no surface detail, and a capsule for a
 * body. These tests pin each one, and pin the honesty boundary that stops the fix being oversold.
 */
describe('generateGame3D — environment, surfaces and humanoid', () => {
  const all = generateGame3D();

  it('emits all three new modules by default', () => {
    expect(all.files['src/game/three/environment.ts']).toBeTruthy();
    expect(all.files['src/game/three/surfaces.ts']).toBeTruthy();
    expect(all.files['src/game/three/humanoid.ts']).toBeTruthy();
    expect(GAME_3D_MODULES).toEqual(
      expect.arrayContaining(['environment', 'surfaces', 'humanoid']),
    );
  });

  it('ENVIRONMENT builds a real IBL and can free it — PMREM does not GC itself', () => {
    const env = all.files['src/game/three/environment.ts'];
    expect(env).toContain('PMREMGenerator');
    expect(env).toContain('scene.environment');
    expect(env).toContain('export function disposeEnvironment');
    // Cached per preset: regenerating PMREM per frame or per material is the classic stutter leak.
    expect(env).toContain('envCache');
  });

  it('🔒 SURFACES tags ONLY the colour map as sRGB — the trap that makes maps worse than none', () => {
    const surf = all.files['src/game/three/surfaces.ts'];
    // Normal/roughness/AO are raw numbers; gamma-decoding them pushes normals the wrong way.
    expect(surf).toContain('THREE.NoColorSpace');
    expect(surf).toContain('THREE.SRGBColorSpace');
    expect(surf).toContain('srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace');
  });

  it('SURFACES emits a full PBR map set, cached so forty brick walls generate brick once', () => {
    const surf = all.files['src/game/three/surfaces.ts'];
    for (const map of ['map', 'normalMap', 'roughnessMap', 'aoMap']) expect(surf).toContain(map);
    expect(surf).toContain('surfaceCache');
    expect(surf).toContain('export function enableAO');
  });

  it('HUMANOID is a real hierarchy with named joints, not a capsule', () => {
    const h = all.files['src/game/three/humanoid.ts'];
    for (const joint of ['hips', 'spine', 'chest', 'neck', 'head', 'leftKnee', 'rightShoulder']) {
      expect(h).toContain(joint);
    }
    expect(h).toContain('export function createHumanoid');
    expect(h).not.toContain('CapsuleGeometry');
  });

  it('HUMANOID gets the three things that make a walk read as a walk', () => {
    const h = all.files['src/game/three/humanoid.ts'];
    // A knee only bends one way — without the clamp you get the backwards-knee look.
    expect(h).toContain('Math.max(0, -s * swing * 1.5)');
    // Arms swing OPPOSITE the legs.
    expect(h).toMatch(/left\.shoulder\.rotation\.x = c \*/);
    expect(h).toMatch(/right\.shoulder\.rotation\.x = s \*/);
    // A body in the air stops walking.
    expect(h).toContain('if (!grounded)');
  });

  it('🔒 asking for surfaces PULLS IN environment — detail with nothing to reflect is a downgrade', () => {
    const only = generateGame3D(['surfaces']);
    expect(only.files['src/game/three/surfaces.ts']).toBeTruthy();
    expect(only.files['src/game/three/environment.ts']).toBeTruthy();
  });

  it('the instructions make the environment call the loudest item, not a footnote', () => {
    expect(all.instructions).toContain('applyEnvironment');
    expect(all.instructions).toContain('surfaceMaterial');
    expect(all.instructions).toContain('createHumanoid');
    expect(all.instructions).toMatch(/BIGGEST ONE/);
  });

  it('still takes exactly ONE dependency — the fix adds no packages', () => {
    // Every map, the sky and the character are generated in code. No asset CDN to 404, no licence.
    expect(all.dependencies).toEqual([{ name: 'three', version: '^0.180.0' }]);
  });
});

describe('the builder is told what "realistic" actually requires', () => {
  it('the system prompt states the three-point checklist AND the honest ceiling', () => {
    const prompt = readFileSync(join(__dirname, '..', 'AgentV3', 'systemPrompt.ts'), 'utf8');
    expect(prompt).toContain('REALISM CHECKLIST');
    expect(prompt).toContain('applyEnvironment(scene, renderer, preset)');
    expect(prompt).toContain('surfaceMaterial(kind)');
    expect(prompt).toContain('createHumanoid()');
    // No photorealism promise — the ceiling is stated where the model will read it.
    expect(prompt).toContain('STYLISED-REALISTIC');
    expect(prompt).toMatch(/rather than promising photorealism/);
  });
});
