/**
 * 🌄 REAL 3D GRAPHICS WHEN THE USER ASKS (admin 2026-11-26, list #20: "real 3D graphics jab user kahe").
 *
 * Root cause: every game had one look — the kit's filmic tone mapping on flat lights, no reflections, hard shadows — and a
 * request for "realistic / HD / asli jaisa graphics" had nowhere to go: the builder either ignored it or bolted a post-
 * processing chain onto the game loop by hand (the wrong render call, no resize, a phone at 8 fps).
 *
 * `src/game/three/realism.ts`, used by the shell when GameOptions.graphics is 'real':
 *   • every device: image-based lighting from a studio environment made in code (RoomEnvironment through PMREM — no download),
 *     so metal, glass, paint and wet roads reflect; soft shadows (PCF soft) from every directional light;
 *   • a capable device (geometryTier 'full', not a software renderer): ambient occlusion (GTAO) in the corners and contact
 *     shadows, and a SUBTLE bloom on the brightest highlights only (strength 0.25, threshold 0.9) — heavy bloom is the classic
 *     first-WebGL tell; then the output pass (tone mapping and colour space);
 *   • a weak device keeps the lighting and shadows and skips the passes, so "real" never turns a phone into a slideshow.
 *
 * String.raw: no backticks and no dollar-brace sequences inside the module text.
 */
export const GAME_REALISM_PATH = 'src/game/three/realism.ts';

export const GAME_REALISM = String.raw`import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { geometryTier, softwareRenderer, type GeometryTier } from './surfaces';

export interface RealismOptions {
  /** 'full' runs the post passes; 'light' keeps the lighting and shadows only. Default: geometryTier(). */
  tier?: GeometryTier;
  /** Bloom strength on the brightest highlights (0–1, default 0.25). 0 turns bloom off. */
  bloom?: number;
  /** Ambient occlusion in corners and under things (default true on 'full'). */
  ao?: boolean;
  /** The lighting environment. Left out: a studio made in code (RoomEnvironment). null: none (tests, a sky of your own). */
  environment?: THREE.Texture | null;
}

export interface Realism {
  /** True when the post passes run (a capable device). */
  readonly post: boolean;
  /** The passes in order, by name (for a settings screen or a test). */
  readonly passes: string[];
  /** Draw the frame (the shell calls this instead of renderer.render). */
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  /** Follow the canvas size. */
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** Shadow map size by tier: sharp on a capable device, cheap on a weak one. */
export const REALISM_SHADOW_SIZE: Record<GeometryTier, number> = { full: 2048, light: 1024 };

/** Turn the real look on for this renderer and scene. Safe to call once per game. */
export function applyRealism(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, options: RealismOptions = {}): Realism {
  const tier: GeometryTier = options.tier === 'full' || options.tier === 'light' ? options.tier : geometryTier();
  let software = false;
  try { software = softwareRenderer(); } catch { software = false; }
  const post = tier === 'full' && !software;
  // Lighting: a studio environment every standard material reflects (not the background — the game's sky stays).
  let pmrem: THREE.PMREMGenerator | null = null;
  let env: THREE.Texture | null = null;
  if (options.environment === undefined) {
    pmrem = new THREE.PMREMGenerator(renderer);
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  } else env = options.environment;
  const previousEnvironment = scene.environment;
  if (env) scene.environment = env;
  // Shadows: soft, from every directional light, sized for the device.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const size = REALISM_SHADOW_SIZE[tier];
  scene.traverse((o) => {
    const light = o as THREE.DirectionalLight;
    if (light.isDirectionalLight) { light.castShadow = true; light.shadow.mapSize.set(size, size); light.shadow.bias = -0.0004; light.shadow.normalBias = 0.02; }
  });
  const passes: string[] = [];
  let composer: EffectComposer | null = null;
  if (post) {
    const sz = renderer.getSize(new THREE.Vector2());
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera)); passes.push('render');
    if (options.ao !== false) { composer.addPass(new GTAOPass(scene, camera, sz.x, sz.y)); passes.push('ao'); }
    const bloom = Math.max(0, Math.min(1, options.bloom ?? 0.25));
    if (bloom > 0) { composer.addPass(new UnrealBloomPass(new THREE.Vector2(sz.x, sz.y), bloom, 0.4, 0.9)); passes.push('bloom'); }
    composer.addPass(new OutputPass()); passes.push('output');
  }
  return {
    post, passes,
    render(s, c) { if (composer) composer.render(); else renderer.render(s, c); },
    setSize(w, h) { composer?.setSize(w, h); },
    dispose() {
      composer?.dispose();
      if (env && scene.environment === env) scene.environment = previousEnvironment;
      if (pmrem) { env?.dispose(); pmrem.dispose(); }
    },
  };
}
`;

/**
 * The user asked for real / realistic / high graphics (admin 2026-11-26 #20). PURE. A refusal ("realistic nahi chahiye",
 * "simple graphics") is not a request.
 */
export function realGraphicsWanted(prompt: string | null | undefined): boolean {
  const t = String(prompt ?? '');
  const asks = /\b(?:realistic|real\s*(?:3d\s*)?graphics?|real\s+3d|photo\s*-?\s*real\w*|hd\s+graphics?|high\s*(?:-|\s)?(?:end\s+)?graphics?|ultra\s+graphics?|aaa\s+graphics?|next\s*-?\s*gen|asli\s+jaisa|asli\s+jaise|real\s+jaisa|real\s+jaise|console\s+(?:jaisa|jaise|quality)|best\s+graphics?)\b/i;
  if (!asks.test(t)) return false;
  return !/\b(?:no|not|don'?t|without|bina|nahi|nahin|mat)\b[^.!?\n]{0,20}\b(?:realistic|graphics?|hd)\b|\b(?:realistic|graphics?)\b[^.!?\n]{0,16}\b(?:nahi|nahin|mat)\b|\bsimple\s+graphics?\b/i.test(t);
}
