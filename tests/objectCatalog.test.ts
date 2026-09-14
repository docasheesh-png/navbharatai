// THE THREE THINGS THE ADMIN ASKED FOR, 2026-09-14.
//
//   1. *"generally kisi app me kya kya object chahiye hote hai — uski ek detailed list banao… list
//      jitni badi hogi NavBharatAI ko utni hi asani hogi."*
//   2. *"sabhi object ko real dab realistic game me kaise add karna hai, NavBharatAI ko sikhao."*
//   3. *"koi aisa object jo apni list me hai hi nahi, to provider se banwao — ek dam realistic aur
//      game fit hona chahiye."*
//
// All three come from one screenshot: a bike racing game whose bike was a capsule on two cylinders.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OBJECT_CATALOG } from '../src/server/lib/objectCatalog';
import { PLACEMENT, compileMatch, type ObjectCategory } from '../src/server/lib/objectCatalogTypes';
import { heroObjectContract, heroObjectIds, findInCatalog, HERO_OBJECTS } from '../src/server/lib/heroObjectSpec';
import {
  parseProviderSpec, resolveObjectSpec, specPrompt, specKey, genericObjectProtocol, renderSpec, memoryCache,
} from '../src/server/lib/objectSpecProvider';

describe('1 · THE LIST — big, and every entry actually usable', () => {
  it('carries 100+ objects across every kind a game is made of', () => {
    expect(OBJECT_CATALOG.length).toBeGreaterThanOrEqual(100);
    const cats = new Set(OBJECT_CATALOG.map((e) => e.category));
    expect(cats.size).toBeGreaterThanOrEqual(15);
  });

  it('covers the things the admin listed by name', () => {
    // Their own words: "bike, car, train, plan, ground, nadi, talab, admi, animals, cycle, badal, road, tree".
    for (const [prompt, id] of [
      ['3d bike game', 'motorcycle'], ['car racing', 'car'], ['train simulator', 'train'],
      ['plane flying game', 'aeroplane'], ['open ground level', 'ground'], ['nadi ke paas', 'river'],
      ['talab wala village', 'pond'], ['aadmi chalta hua', 'human'], ['horse riding', 'horse'],
      ['cycle race', 'bicycle'], ['badal aur suraj', 'cloud'], ['road racing', 'road'],
      ['tree forest 3d', 'tree'],
    ] as const) {
      expect(heroObjectIds(prompt), prompt).toContain(id);
    }
  });

  it('🔒 every entry is complete — a half-written spec is worse than none', () => {
    const ids = new Set<string>();
    for (const e of OBJECT_CATALOG) {
      expect(ids.has(e.id), 'duplicate id ' + e.id).toBe(false);
      ids.add(e.id);
      expect(e.name.trim(), e.id).not.toBe('');
      // The numbers ARE the value: "about 2 m long" makes a toy, "1.35 m wheelbase" makes a bike.
      expect(e.dims, e.id).toMatch(/\d/);
      // km is allowed and correct for exactly one kind of thing: clouds really are km-scale,
      // and that entry gives the in-scene size in units beside it.
      expect(e.dims, e.id).toMatch(/\bm\b|\bkm\b|metre|%|degree/);
      expect(e.parts.length, e.id).toBeGreaterThanOrEqual(3);
      expect(e.tell.length, e.id).toBeGreaterThan(30);
      expect(PLACEMENT[e.category], e.id).toBeDefined();
    }
  });

  it('🔴 matches Devanagari — the bug that made the Hindi half of a catalogue dead code', () => {
    // `\b` is defined on ASCII word characters, so it can never sit beside a Devanagari letter: the
    // boundary inverts and the alternative silently never fires. Building the pattern centrally is
    // what makes that unrepeatable, so this asserts the builder, not one entry.
    const re = compileMatch({ words: 'motorcycle', hi: 'बाइक' });
    expect(re.test('ek बाइक game banao')).toBe(true);
    expect(re.test('a motorcycle game')).toBe(true);
    for (const [prompt, id] of [['हाथी वाला गेम', 'elephant'], ['नदी और पेड़', 'river'], ['बादल', 'cloud']] as const) {
      expect(heroObjectIds(prompt), prompt).toContain(id);
    }
  });

  it('and still says nothing where it does not belong', () => {
    for (const p of ['build a 3d portfolio site', 'make a chess game', 'an invoicing app', '']) {
      expect(heroObjectContract(p).block, p).toBe('');
    }
  });
});

describe('2 · HOW TO ADD IT — placement is taught, per kind, not per object', () => {
  it('every category has real, concrete placement rules', () => {
    for (const c of Object.keys(PLACEMENT) as ObjectCategory[]) {
      expect(PLACEMENT[c].headline.length, c).toBeGreaterThan(25);
      expect(PLACEMENT[c].rules.length, c).toBeGreaterThanOrEqual(4);
      for (const r of PLACEMENT[c].rules) expect(r.length, c).toBeGreaterThan(40);
    }
  });

  it('a bike game is told to ground it, shadow it and roll the wheels', () => {
    const block = heroObjectContract('3d bike racing game').block;
    expect(block).toContain('HOW TO PLACE THEM');
    expect(block).toContain('RAYCAST the ground');
    expect(block).toContain('castShadow AND receiveShadow');
    expect(block).toContain('Roll the wheels');
  });

  it('the teaching follows the KIND — water, sky and vegetation each get their own', () => {
    expect(heroObjectContract('3d river level').block).toContain('must MOVE');
    expect(heroObjectContract('badal aur sky 3d game').block).toContain('Never castShadow');
    expect(heroObjectContract('3d forest with trees').block).toContain('InstancedMesh');
  });

  it('🔒 placement applies on the CHEAP tier too, and the block says why', () => {
    // A floating, unshadowed object looks broken at every detail level, and fixing it costs no frames.
    const lite = heroObjectContract('simple 3d car game');
    expect(lite.tier).toBe('lite');
    expect(lite.block).toContain('every placement rule still apply');
    expect(lite.block).toContain('costs no frames on a phone');
  });

  it('never dumps every category into one prompt', () => {
    const c = heroObjectContract('3d game with a car bike tree river cloud house cow bird boat plane');
    expect(c.specs.length).toBeLessThanOrEqual(6);
    expect(c.block.split('▸').length - 1).toBeLessThanOrEqual(4);
  });
});

describe('3 · NOT IN THE LIST — the engine makes the spec, and it is checked before it is believed', () => {
  const good = JSON.stringify({
    name: 'bullock cart',
    dims: '2.8 m long, 1.5 m wide, wheel radius 0.55 m, bed 0.9 m off the ground',
    parts: ['two large spoked wooden wheels', 'an open flat bed', 'two shafts reaching forward', 'a wooden axle'],
    tell: 'Enormous thin spoked wheels relative to a small bed; small wheels make it a trolley.',
  });

  it('the catalogue answers first — free, instant, human-checked', async () => {
    const spec = await resolveObjectSpec('motorcycle', {
      findInCatalog,
      ask: async () => { throw new Error('the engine must not be called for a known object'); },
    });
    expect(spec.source).toBe('catalog');
    expect(spec.dims).toContain('1.35 m');
  });

  it('an unknown object is generated by the engine and cached for the next build', async () => {
    memoryCache.clear();
    let calls = 0;
    const deps = {
      findInCatalog,
      cacheGet: memoryCache.get,
      cacheSet: memoryCache.set,
      ask: async () => { calls++; return good; },
    };
    const first = await resolveObjectSpec('palanquin', deps);
    expect(first.source).toBe('provider');
    expect(first.parts.length).toBeGreaterThanOrEqual(4);
    const second = await resolveObjectSpec('Palanquin', deps);   // same object, typed differently
    expect(second.source).toBe('cache');
    expect(calls).toBe(1);
  });

  it('🔴 STRICT — rubbish never reaches a build, because the model would build to it', async () => {
    for (const bad of [
      '',
      'sure! here is your object',
      JSON.stringify({ name: 'thing', dims: 'about the size of a car', parts: ['a', 'b', 'c', 'd'], tell: 'x'.repeat(40) }),
      JSON.stringify({ name: 'thing', dims: '2.8 m long, 1.5 m wide overall', parts: ['one', 'two'], tell: 'x'.repeat(40) }),
      JSON.stringify({ name: 'thing', dims: '2.8 m long, 1.5 m wide overall', parts: ['one', 'two', 'three', 'four'], tell: 'nice' }),
    ]) {
      expect(parseProviderSpec(bad), bad.slice(0, 40)).toBeNull();
    }
    expect(parseProviderSpec(good)).not.toBeNull();
    expect(parseProviderSpec('```json\n' + good + '\n```')).not.toBeNull();   // fences are normal
  });

  it('🔒 IT CAN NEVER FAIL A BUILD — every failure lands on the spec-first protocol', async () => {
    for (const ask of [
      async () => { throw new Error('provider down'); },
      async () => null,
      async () => 'total nonsense',
    ]) {
      // Deliberately an object the 100-entry catalogue does NOT carry — a bullock cart does.
      const spec = await resolveObjectSpec('palanquin', { findInCatalog, ask });
      expect(spec.source).toBe('protocol');
      expect(renderSpec(spec)).toContain('SPEC FIRST, THEN MODEL');
    }
    // …and with no engine wired at all.
    expect((await resolveObjectSpec('x', { findInCatalog })).source).toBe('protocol');
  });

  it('the protocol itself is a real instruction, not a shrug', () => {
    const p = genericObjectProtocol('bullock cart');
    expect(p).toContain('REAL size in metres');
    expect(p).toContain('never go straight to primitives');
    expect(p).toContain('Two or three primitives stuck together is never an acceptable answer');
  });

  it('the request asks for the four fields that actually matter', () => {
    const p = specPrompt('auto rickshaw');
    expect(p).toContain('auto rickshaw');
    expect(p).toContain('METRES');
    expect(p).toContain('"tell"');
    expect(p).toContain('Real measurements, not round numbers chosen to look tidy');
  });

  it('the cache key ignores how the user typed it', () => {
    expect(specKey('Auto  Rickshaw!')).toBe(specKey('auto-rickshaw'));
    expect(specKey('')).toBe('');
  });
});

describe('the wiring — the model can reach all three from a real build', () => {
  const cat = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolCatalog.ts'), 'utf8');
  const dis = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('object_spec is a registered, described tool', () => {
    expect(cat).toContain("name: 'object_spec'");
    expect(cat).toContain("  'object_spec',");
  });

  it('the dispatcher walks the ladder cheapest-first and never throws', () => {
    expect(dis).toContain("case 'object_spec': {");
    expect(dis).toContain('const known = findInCatalog(wanted);');
    expect(dis).toContain('cacheGet: memoryCache.get');
    // The FREE namespace never reaches Claude, which keeps this inside the weak-tier rule.
    expect(dis).toContain("aiRouter.routeDetailed(prompt, [], 'navbharat'");
    expect(dis).toContain('OBJECT_SPEC_LEARNED');
  });

  it('the contract still reaches the build prompt, behind the 3D/game gate', () => {
    expect(route).toContain('const hero = heroObjectContract(prompt);');
    expect(route).toContain("code: 'HERO_OBJECTS'");
  });

  it('and the contract points the model at the tool for anything it does not carry', () => {
    expect(heroObjectContract('3d bike game').block).toContain('call the object_spec tool');
  });

  it('every builder the catalogue names really exists in the generator', () => {
    const gen = readFileSync(join(process.cwd(), 'src/server/lib/Game3DGenerator.ts'), 'utf8');
    for (const e of HERO_OBJECTS) {
      if (e.builder) expect(gen, e.id).toContain(e.builder.replace(/\(.*/, ''));
    }
  });
});
