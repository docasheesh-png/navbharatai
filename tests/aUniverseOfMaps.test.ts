// A UNIVERSE OF MAPS (admin 2026-11-22: "navbharatai abhi bhi 2 map jod ke ek bada giant map nahi bana pa raha hai — mujhe chahiye
// 10—100 maps jod kar bahut bada universe bhi bana sake"; failedbr #2490: "is map ko 50x bigger banao … duplicate kar ke merge
// karo" became sizeMeters stretched to the 1000 km cap — the SAME land 7× wider — and 12 places, all near the start).
// 🧬 Classes: (1) a hard cap of 12; (2) every place's whole city built at start, so more places = a slower game; (3) "bigger" read
// as "stretch". The map holds 100 places and lands, builds a city only when the player nears it, and the rule says bigger = more.
import { describe, it, expect } from 'vitest';
import { GAME_WORLD_RULE } from '../src/server/AgentV3/gameKitSeed';
import { MAX_PLACES, appendPlace, placeNotAddedHandoff } from '../src/server/AgentV3/worldGrow';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

describe('🌌 the limits and the rule', () => {
  it('a map holds 100 places and lands — the kit and the platform agree', () => {
    expect(MAX_PLACES).toBe(100);
    const bridge = recipeFilePool().get('src/game/play/openWorld.ts')!.content;
    expect(bridge).toContain('export const MAX_REGIONS = 100;');
    expect(bridge).toMatch(/planned\.length \+ landList\.length >= MAX_REGIONS/);
    expect(bridge).toMatch(/if \(Math\.hypot\(at\.x - p\.centre\.x, at\.z - p\.centre\.z\) < p\.reach \+ BUILD_AHEAD\) \{ buildPlace\(p\); break; \}/);
  });
  it('bigger means MORE places (a mix, every direction) — never a stretched sizeMeters; duplicate means copies with new ids', () => {
    expect(GAME_WORLD_RULE).toMatch(/Up to 100 regions/);
    expect(GAME_WORLD_RULE).toMatch(/NEVER raise sizeMeters to make the map bigger/);
    expect(GAME_WORLD_RULE).toMatch(/duplicate karke jodo" → add copies of the existing regions with new ids/);
    expect(GAME_WORLD_RULE).not.toMatch(/Up to 12/);
  });
  it('the library adds places until 100, then says the map is full', () => {
    const entries = Array.from({ length: 99 }, (_, i) => `    { id: 'p${i}', kind: 'village' },`).join('\n');
    const src = `export const WORLD = {\n  regions: [\n${entries}\n  ],\n};\n`;
    const one = appendPlace(src, 'jungle');
    expect(one.ok && one.count).toBe(100);
    if (!one.ok) return;
    const full = appendPlace(one.source, 'city');
    expect(full).toEqual({ ok: false, reason: 'full' });
    expect(placeNotAddedHandoff('city')).toContain('100 places');
  });
});
