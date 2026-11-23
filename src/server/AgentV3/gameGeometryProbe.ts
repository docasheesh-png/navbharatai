/**
 * 🔎 THE PLAYTEST'S GEOMETRY LOOK (admin 2026-11-23: "NavBharatAI ko perfectionist banao — jo bhi banaye real lage, aise
 * glitch na ho"). The maps-do-not-join autopsy found glitches no screenshot score catches: a flat grass plane the game laid
 * that hills poke through and that floats over valleys, road ribbons whose faces point down (so from above they are not
 * drawn), the player standing in the air. The kit's open world now answers, read-only, what is drawn
 * (window.__nbWorld.geometry in openWorld.ts) and the kit's Game what models are still loading (window.__nbKit.models).
 *
 * This file turns that answer into findings and a repair note FOR THE BUILDER ONLY. It is advisory: it never changes the
 * score, never gates a release, never starts a repair or a paid call, and never reaches the user (its diag code is on the
 * never-suggest list). Every number from the page is clamped and every name stripped to letters, digits and a few marks,
 * because the page runs the game's code. Kill switch: AGENTV3_GAME_GEOMETRY_PROBE=off. PURE except the env read.
 */

export const GAME_GEOMETRY_CODE = 'GAME_GEOMETRY_FINDINGS';

export interface GeometryRead {
  terrain?: { samples?: number; off?: number; worst?: number } | null;
  slabs?: Array<{ name?: string; size?: number; above?: number; below?: number }> | null;
  roads?: Array<{ name?: string; down?: number; faces?: number }> | null;
  player?: number | null;
  ms?: number;
}
export interface ModelsRead { pending?: number; stuck?: number }

export function gameGeometryProbeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_GEOMETRY_PROBE ?? '').trim().toLowerCase() !== 'off';
}

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const name = (v: unknown): string => {
  const s = String(v ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 40);
  return s || 'a mesh';
};

/** How far the player's feet may be from the ground before it reads as floating (a jump, a step) or sunk. */
export const PLAYER_FLOAT_M = 3;
export const PLAYER_SUNK_M = -1.5;

/**
 * The findings, one plain line each with its fix, written for the builder. Empty when nothing looks wrong or nothing was
 * measured. At most 6 lines. PURE.
 */
export function geometryFindings(geometry: GeometryRead | null | undefined, models?: ModelsRead | null): string[] {
  const out: string[] = [];
  const g = geometry && typeof geometry === 'object' ? geometry : null;
  if (g) {
    const off = num(g.terrain?.off, 0, 1e6) ?? 0, worst = num(g.terrain?.worst, 0, 1e5) ?? 0;
    if (off > 0 && worst > 0.5) out.push(`The drawn terrain is up to ${worst.toFixed(1)} m away from map.world.heightAt at ${off} sampled points — the ground was changed after it was drawn. Call levelGround/addRoad before the world's first update (at the top of the world file), never from a feature.`);
    for (const s of (Array.isArray(g.slabs) ? g.slabs : []).slice(0, 3)) {
      const size = num(s?.size, 0, 1e6) ?? 0, above = num(s?.above, -1e5, 1e5) ?? 0, below = num(s?.below, -1e5, 1e5) ?? 0;
      out.push(`"${name(s?.name)}" is a flat ${Math.round(size)} m mesh the game added that does not follow the land: it floats up to ${Math.max(0, above).toFixed(1)} m above the ground and the ground pokes up to ${Math.max(0, below).toFixed(1)} m through it. Make it follow the land, or leave the ground to the open world, which already draws it; for a flat place, use world.levelGround on that spot before the first update. (If it is water on purpose, ignore this.)`);
    }
    for (const r of (Array.isArray(g.roads) ? g.roads : []).slice(0, 2)) {
      const down = num(r?.down, 0, 1e6) ?? 0, faces = num(r?.faces, 0, 1e6) ?? 0;
      out.push(`"${name(r?.name)}": ${down} of ${faces} sampled road faces point DOWN, so from above the road is not drawn. Flip the triangle order (a, c, b instead of a, b, c), or use the kit's map.world.addRoad which draws roads facing up.`);
    }
    const p = num(g.player, -1e5, 1e5);
    if (p !== null && (p > PLAYER_FLOAT_M || p < PLAYER_SUNK_M)) out.push(p > 0 ? `The player stood ${p.toFixed(1)} m ABOVE the ground at the start. Spawn on map.world.heightAt(x, z) and let the kit's character keep it on the ground.` : `The player stood ${Math.abs(p).toFixed(1)} m UNDER the ground at the start. Spawn on map.world.heightAt(x, z), not at a fixed y.`);
  }
  const stuck = num(models?.stuck, 0, 1e4) ?? 0;
  if (stuck > 0) out.push(`${stuck} model${stuck === 1 ? '' : 's'} never got past 0% loading after a round of play. Check the model's path exists under public/models and that it is loaded once, through the kit's loader.`);
  return out.slice(0, 6);
}

/** The admin line recorded as GAME_GEOMETRY_FINDINGS ('' when there is nothing to say). PURE. */
export function geometryFindingsMessage(findings: readonly string[]): string {
  if (!findings.length) return '';
  return `Geometry look (advisory, builder-only): ${findings.map((f, i) => `(${i + 1}) ${f}`).join(' ')}`.slice(0, 2000);
}

interface IssueLike { code?: unknown; message?: unknown }
/**
 * The builder's repair note for the NEXT turn, from the last build report's GAME_GEOMETRY_FINDINGS line, or null.
 * It goes into the builder's prompt only — never to the user. PURE.
 */
export function geometryRepairNote(issues: ReadonlyArray<IssueLike> | null | undefined): string | null {
  const list = Array.isArray(issues) ? issues : [];
  const hit = [...list].reverse().find((i) => String(i?.code ?? '') === GAME_GEOMETRY_CODE);
  const msg = hit ? String(hit.message ?? '').replace(/^Geometry look \(advisory, builder-only\):\s*/, '').trim() : '';
  if (!msg) return null;
  return [
    'GEOMETRY LOOK FROM THE LAST PLAYTEST (builder-only; do not mention it to the user). The game was looked at after the last turn, read-only, and these looked wrong in what was drawn:',
    msg.slice(0, 1800),
    'If this turn touches the world or these meshes, fix them as said so the world looks real. Do not change unrelated files for it, and never remove the kit\'s own ground, places or highways.',
  ].join('\n');
}
