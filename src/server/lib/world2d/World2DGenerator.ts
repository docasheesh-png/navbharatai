// THE 2D WORLD RECIPE — a big map for 2D games, joined seamlessly from pre-made sample chunks (admin 2026-11-19).
//
// Admin, verbatim: *"jab user kahe bada map banao, to hamare paas already maps ke sample bane rakhe ho, woh user ke
// game me add hote jaye, aur perfect add hon ki ek hi lage!"* — and, for 2D games, nothing of the kind existed: the
// big world (Athree) is three.js, so a 2D game asked for a big map got whatever background the builder drew.
//
// WHAT IT WRITES (src/game/world2d/, plain TypeScript, no dependency):
//   samples.ts — the pre-made 16 x 16 sample chunks (meadow, forest, lake, village, desert), each keeping two
//                promises the tests check: an open-ground outer ring, and a soft road corridor.
//   world.ts   — createWorld2D: joins the samples into one endless (or bounded) map. Roads cross a chunk edge only
//                at its middle and each edge is decided once from its own coordinates, so a road always continues
//                into the next chunk; the ground colour is one smooth function of world position, so no line shows
//                between chunks. Tile queries, collision (moveWithCollision), spawn point, bounded chunk cache.
//   render.ts  — createWorldRenderer: draws only what is on screen, each chunk painted once onto its own canvas
//                and reused; a minimap.
// Honest limits: top-down maps only (a side-scrolling platformer world is not built); tiles are drawn shapes, not
// sprite art; no enemies, NPCs or quests — those are the game's own.
//
// PURE — no I/O.

import { WORLD2D_INDEX_SOURCE, WORLD2D_RENDER_SOURCE, WORLD2D_SAMPLES_SOURCE, WORLD2D_WORLD_SOURCE } from './world2dSource';

export const WORLD2D_DIR = 'src/game/world2d';

export interface World2DResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/** `AGENTV3_WORLD_2D=off` (or 0 / false / no) switches the recipe off. Default ON. */
export function world2dEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['off', '0', 'false', 'no'].includes(String(env.AGENTV3_WORLD_2D ?? '').trim().toLowerCase());
}

const EXAMPLE = [
  "import { createWorld2D, createWorldRenderer, moveWithCollision } from './game/world2d';",
  '',
  "const canvas = document.createElement('canvas');",
  'canvas.width = 800; canvas.height = 450;',
  "const ctx = canvas.getContext('2d')!;",
  'const world = createWorld2D({ seed: 7 }); // endless; pass sizeChunks: 24 for a bounded square map',
  'const view = createWorldRenderer(world);',
  'const player = { ...world.spawnPoint(), r: 10 }; // starts on a long road',
  '',
  'export function frame(dt: number, input: { x: number; y: number }): void {',
  '  const speed = world.isRoad(player.x, player.y) ? 220 : 140; // faster on the road',
  '  const next = moveWithCollision(world, player.x, player.y, input.x * speed * dt, input.y * speed * dt, player.r);',
  '  player.x = next.x; player.y = next.y; // trees, rocks, houses and water block; bridges carry',
  '  view.draw(ctx, player.x, player.y, canvas.width, canvas.height); // only what is on screen',
  '  const at = view.toScreen(player.x, player.y);',
  "  ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(at.x, at.y, player.r, 0, Math.PI * 2); ctx.fill();",
  '  view.drawMinimap(ctx, canvas.width - 130, 10, 120, player.x, player.y);',
  '}',
].join('\n');

export function generateWorld2D(): World2DResult {
  const files: Record<string, string> = {
    [`${WORLD2D_DIR}/samples.ts`]: WORLD2D_SAMPLES_SOURCE,
    [`${WORLD2D_DIR}/world.ts`]: WORLD2D_WORLD_SOURCE,
    [`${WORLD2D_DIR}/render.ts`]: WORLD2D_RENDER_SOURCE,
    [`${WORLD2D_DIR}/index.ts`]: WORLD2D_INDEX_SOURCE,
  };
  return {
    files,
    dependencies: [],
    instructions:
      `Added the 2D world (${Object.keys(files).length} files under ${WORLD2D_DIR}): a top-down map joined seamlessly from NavBharatAI's `
      + 'pre-made sample chunks (meadow, forest, lake, village, desert), endless by default. Roads continue from chunk to chunk, '
      + 'highways run straight every few chunks, the ground blends across chunk edges, and only the visible chunks are drawn.\n'
      + '```ts\n' + EXAMPLE + '\n```\n'
      + 'RULES: build the game ON this world. Never draw a fixed-size background or a hand-made map for it, and never limit the '
      + 'player to one screen: the camera follows the player (view.draw centred on them) and the world streams around them. '
      + 'Use moveWithCollision for every moving body, world.spawnPoint() for the start, world.isRoad / world.biomeAt for '
      + 'gameplay (speed on roads, what grows where), and view.toScreen to draw anything that lives in the world. For a bounded '
      + 'map pass sizeChunks (the edge is solid). Touch controls must move the player too. Not built: side-scrolling worlds, '
      + 'sprite art, enemies and NPCs (they are the game\'s own).',
  };
}
