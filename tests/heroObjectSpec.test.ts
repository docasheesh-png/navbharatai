// THE CONDITION, NOT THE INSTANCE — admin screenshot 2026-09-14.
//
// A `createMotorcycle` fixes bikes. It does not fix the reason the bike was fake: an N-builder library
// meets its N+1th request every day, and at that moment the standing order "build every object with
// objects.ts, never hand-model" becomes an order the model cannot obey. It hand-models with no spec,
// and three primitives is what free-form hand-modelling produces at every detail level — because
// `setDetailLevel` only reaches objects.ts builders.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heroObjectContract, heroObjectIds, HERO_OBJECTS } from '../src/server/lib/heroObjectSpec';

describe('🔴 the reported game gets a bike spec, and it names the builder', () => {
  it('THE SCREENSHOT: "bike racing game"', () => {
    const c = heroObjectContract('make me a 3d bike racing game');
    expect(c.specs.map((s) => s.id)).toContain('motorcycle');
    expect(c.block).toContain('createMotorcycle');
    expect(c.block).toContain('1.35 m');            // the wheelbase, which is most of the silhouette
    expect(c.block).toContain('RAKED');
  });

  it('a builder that EXISTS is ordered used, never hand-modelled — the inverse of the reported bug', () => {
    for (const id of ['motorcycle', 'car', 'human', 'bicycle']) {
      const spec = HERO_OBJECTS.find((s) => s.id === id)!;
      expect(spec.builder).toBeTruthy();
      const block = heroObjectContract('a 3d game with a ' + spec.name).block;
      expect(block).toContain('Do NOT hand-model it');
    }
  });

  it.each([
    ['bike racing game', 'motorcycle'],
    ['ek motorcycle racing game banao', 'motorcycle'],
    ['scooty wala game', 'motorcycle'],
    ['बाइक रेसिंग गेम', 'motorcycle'],
    ['cycle race 3d', 'bicycle'],
    ['car racing game', 'car'],
    ['auto rickshaw driving game', 'auto-rickshaw'],
    ['tuk tuk game', 'auto-rickshaw'],
    ['tractor farming game 3d', 'tractor'],
    ['helicopter rescue game', 'helicopter'],
    ['fishing boat game', 'boat'],
    ['3d cricket game', 'cricket'],
    ['ghoda racing game', 'horse'],
    ['हाथी वाला गेम', 'elephant'],
  ])('reads the object out of "%s"', (prompt, id) => {
    expect(heroObjectIds(prompt)).toContain(id);
  });
});

describe('🔒 THE CLASS FIX — an object with NO builder still gets a real spec', () => {
  // This is the whole point. The library will never have everything; what it must never do again is
  // leave the model with nothing but the word.
  it.each(['auto-rickshaw', 'tractor', 'helicopter', 'boat', 'tank', 'drone', 'house'])(
    '%s has no builder, and gets dimensions, parts and a tell instead', (id) => {
      const spec = HERO_OBJECTS.find((s) => s.id === id)!;
      expect(spec.builder).toBeUndefined();
      expect(spec.dims).toMatch(/\bm\b/);            // real metres, not "about the right size"
      expect(spec.parts.length).toBeGreaterThanOrEqual(4);
      expect(spec.tell.length).toBeGreaterThan(40);
    });

  it('and the block tells the model to model it to THAT spec rather than improvise', () => {
    const block = heroObjectContract('3d auto rickshaw driving game').block;
    expect(block).toContain('HAND-MODEL it to this spec');
    expect(block).toContain('never as two or three primitives stuck together');
    expect(block).toContain('THREE wheels');
  });

  it('every entry is well formed — a half-written spec is worse than none', () => {
    const ids = new Set<string>();
    for (const s of HERO_OBJECTS) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.name.trim()).not.toBe('');
      expect(s.dims).toMatch(/\d/);                  // every spec carries real numbers
      expect(s.parts.length).toBeGreaterThanOrEqual(3);
      expect(s.tell.length).toBeGreaterThan(30);
    }
    expect(HERO_OBJECTS.length).toBeGreaterThanOrEqual(20);
  });
});

describe('the REALISM tier still decides how much of the spec is built', () => {
  it('"real" demands every part and forbids the word photorealistic', () => {
    const c = heroObjectContract('make a REALISTIC 3d bike racing game, bilkul asli');
    expect(c.tier).toBe('real');
    expect(c.block).toContain('build EVERY part listed above');
    expect(c.block).toContain('never "photorealistic", which this cannot deliver');
  });

  it('plain 3D keeps the SIZES even though the parts may be simplified', () => {
    // The insight that makes this worth doing on the cheap tier too: a wrong-proportioned object looks
    // broken at every detail level, and the silhouette costs no frames on a phone.
    const c = heroObjectContract('simple 3d bike game');
    expect(c.tier).toBe('lite');
    expect(c.block).toContain('the SIZES and');
    expect(c.block).toContain('costs no frames on a phone');
  });

  it('a stylised ask stays lite even with a realism word in it', () => {
    expect(heroObjectContract('realistic low-poly bike game').tier).toBe('lite');
  });
});

describe('⚠️ it must stay quiet where it does not belong', () => {
  it('says nothing when the prompt names no hero object', () => {
    for (const p of ['build a 3d portfolio site', 'make a chess game', '', '   ']) {
      expect(heroObjectContract(p).block).toBe('');
    }
  });

  it('never dumps more than a handful of specs into one prompt', () => {
    const everything = HERO_OBJECTS.map((s) => s.name).join(' ') + ' car bike bus truck plane boat tank';
    expect(heroObjectContract(everything).specs.length).toBeLessThanOrEqual(4);
  });
});

describe('the wiring — it reaches a real build, behind the SAME 3D gate as the realism tier', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('is prepended to the build prompt', () => {
    expect(route).toContain('const hero = heroObjectContract(prompt);');
    expect(route).toContain('buildPrompt = `${hero.block}\\n\\n${buildPrompt}`;');
  });

  it('🔒 lives INSIDE the 3D/game gate — a billing app that mentions a "cab" must not get wheel radii', () => {
    const gateAt = route.indexOf("if (/\\b(?:3\\s*-?\\s*d|three\\s*-?\\s*dimensional|game|khel)\\b/i.test(prompt)) {");
    const heroAt = route.indexOf('const hero = heroObjectContract(prompt);');
    expect(gateAt).toBeGreaterThan(-1);
    expect(heroAt).toBeGreaterThan(gateAt);
    // …and still inside that block, i.e. before the next top-level comment that follows it.
    const closeAt = route.indexOf('// C1 — the project’s OWN rules', gateAt) >= 0
      ? route.indexOf('// C1 — the project’s OWN rules', gateAt)
      : route.indexOf("// C1 — the project's OWN rules", gateAt);
    expect(closeAt).toBeGreaterThan(heroAt);
  });

  it('records what it applied, so the admin can see it fire', () => {
    expect(route).toContain("code: 'HERO_OBJECTS'");
  });

  it('the object library and the tool description agree that a bike exists', () => {
    const cat = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolCatalog.ts'), 'utf8');
    const gen = readFileSync(join(process.cwd(), 'src/server/lib/Game3DGenerator.ts'), 'utf8');
    // A builder the model is never told about is a builder that does not exist — which is the
    // reported bug restated, so both surfaces are pinned.
    expect(cat).toContain('createMotorcycle');
    expect(gen).toContain('createMotorcycle');
    for (const s of HERO_OBJECTS) {
      if (s.builder) expect(gen).toContain(s.builder.replace(/\(.*/, ''));
    }
  });
});
