import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGameRoyale, GAME_ROYALE_MODULES } from './GameRoyaleGenerator';
import { generateGameSystems } from './GameSystemsGenerator';

/**
 * THESE TESTS RUN THE GENERATED CODE. A match is pure arithmetic over a seeded generator, so its rules are proven by
 * playing whole matches — hundreds of simulated seconds, up to 99 bots — rather than by reading the source.
 */
const files = generateGameRoyale().files;

function loadAll(src: Record<string, string> = files): Record<string, Record<string, any>> {
  const cache: Record<string, Record<string, any>> = {};
  const resolve = (from: string, spec: string): string => {
    const parts = from.split('/').slice(0, -1);
    for (const seg of spec.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
    return parts.join('/') + '.ts';
  };
  const load = (path: string): Record<string, any> => {
    if (cache[path]) return cache[path];
    expect(src[path], path + ' was not emitted').toBeTruthy();
    const js = ts.transpileModule(src[path], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, any> = {};
    cache[path] = exports;
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', js)(exports, (id: string) => load(resolve(path, id)));
    return exports;
  };
  for (const p of Object.keys(src)) load(p);
  return cache;
}

const mods = loadAll();
const { Zone, DEFAULT_PHASES, sanitizePhases } = mods['src/game/royale/zone.ts'];
const { spawnLoot, LootField, Inventory, WEAPON_SLOTS, MAX_HEALS, MAX_ARMOR, MAX_AMMO, MAX_LOOT } = mods['src/game/royale/loot.ts'];
const { BOT_WEAPONS, hitChance } = mods['src/game/royale/bots.ts'];
const { Match } = mods['src/game/royale/match.ts'];
const { RoyaleRng } = mods['src/game/royale/rng.ts'];

const inside = (inner: any, outer: any) => Math.hypot(inner.x - outer.x, inner.z - outer.z) + inner.r <= outer.r + 1e-6;
const play = (m: any, seconds: number, step = 0.1) => { for (let t = 0; t < seconds && m.status === 'playing'; t += step) m.update(step); };
const events = (opts: Record<string, unknown> = {}) => { const log: Array<[string, any]> = []; return { log, opts: { ...opts, onEvent: (n: string, p: any) => log.push([n, p]) } }; };

describe('the zone only shrinks, never jumps, and always closes', () => {
  it('the safe radius never grows, from the first second to the last', () => {
    const z = new Zone(500, 3);
    let prev = z.circle.r;
    for (let t = 0; t < z.totalSeconds + 10; t += 0.5) {
      z.update(0.5);
      expect(z.circle.r).toBeLessThanOrEqual(prev + 1e-9);
      prev = z.circle.r;
    }
    expect(z.circle.r).toBe(0);
  });

  it('every announced circle lies ENTIRELY inside the circle it will replace — across many seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const z = new Zone(500, seed);
      let announced = 0;
      let before = z.circle;
      let to = z.next;
      expect(inside(to, before), 'seed ' + seed + ' first circle').toBe(true);
      for (let t = 0; t < z.totalSeconds + 5; t += 0.25) {
        const ev = z.update(0.25);
        if (ev.includes('announced')) {
          announced++;
          expect(inside(z.next, z.circle), 'seed ' + seed + ' circle ' + announced).toBe(true);
        }
        expect(inside(z.circle, before) || before.r === z.circle.r, 'seed ' + seed + ' shrank outside').toBe(true);
        before = before.r >= z.circle.r ? before : z.circle;
      }
      expect(announced).toBe(DEFAULT_PHASES.length);
    }
  });

  it('the circle moves smoothly — it never jumps more than the shrink allows in one step', () => {
    const z = new Zone(500, 9);
    let c = z.circle;
    for (let t = 0; t < z.totalSeconds; t += 0.1) {
      z.update(0.1);
      const n = z.circle;
      expect(Math.hypot(n.x - c.x, n.z - c.z)).toBeLessThan(5);
      expect(Math.abs(n.r - c.r)).toBeLessThan(5);
      c = n;
    }
  });

  it('hurts outside the circle only, and harder in later phases', () => {
    const z = new Zone(500, 4);
    expect(z.damagePerSecond(0, 0)).toBe(0);
    expect(z.damagePerSecond(10_000, 0)).toBe(DEFAULT_PHASES[0].damage);
    let last = 0;
    for (let t = 0; t < z.totalSeconds; t += 1) {
      z.update(1);
      const d = z.damagePerSecond(10_000, 10_000);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    expect(last).toBeGreaterThan(DEFAULT_PHASES[0].damage);
  });

  it('passes through waiting, shrinking and final in order, and announces before it closes', () => {
    const z = new Zone(500, 5);
    expect(z.status).toBe('waiting');
    expect(z.next).not.toBeNull();
    const seen: string[] = [];
    for (let t = 0; t < z.totalSeconds + 5; t += 0.5) { z.update(0.5); if (seen[seen.length - 1] !== z.status) seen.push(z.status); }
    expect(seen[0]).toBe('waiting');
    expect(seen).toContain('shrinking');
    expect(seen[seen.length - 1]).toBe('final');
    expect(z.next).toBeNull();
    expect(z.contains(0, 0)).toBe(false);
  });

  it('is deterministic from its seed, and different seeds differ', () => {
    const run = (seed: number) => { const z = new Zone(500, seed); z.update(5); const n = z.next; return JSON.stringify([n, z.circle]); };
    expect(run(8)).toBe(run(8));
    expect(run(8)).not.toBe(run(9));
  });

  it('refuses bad phases: not shrinking, out of range, NaN — falls back to the defaults', () => {
    expect(sanitizePhases([{ wait: 10, shrink: 10, radius: 0.5, damage: 1 }, { wait: 10, shrink: 10, radius: 0.7, damage: 1 }]).length).toBe(1);
    expect(sanitizePhases([{ wait: NaN, shrink: -3, radius: 2, damage: 1 }])).toEqual(DEFAULT_PHASES.map((p: any) => ({ ...p })));
    expect(sanitizePhases(undefined).length).toBe(DEFAULT_PHASES.length);
    const many = Array.from({ length: 40 }, (_, i) => ({ wait: 5, shrink: 5, radius: 0.9 - i * 0.02, damage: 1 }));
    expect(sanitizePhases(many).length).toBeLessThanOrEqual(12);
  });

  it('ignores a NaN, negative or zero step', () => {
    const z = new Zone(500, 2);
    const before = JSON.stringify(z.circle);
    z.update(NaN); z.update(-5); z.update(0);
    expect(JSON.stringify(z.circle)).toBe(before);
    expect(() => z.update(1e12)).not.toThrow();
  });
});

describe('loot — scattered fairly, picked up atomically', () => {
  it('is inside the map, apart from each other, unique and deterministic', () => {
    const items = spawnLoot(new RoyaleRng(5), 500, 150, 8);
    expect(items.length).toBeGreaterThan(100);
    expect(new Set(items.map((i: any) => i.id)).size).toBe(items.length);
    for (const it of items) expect(Math.hypot(it.x, it.z)).toBeLessThanOrEqual(500 * 0.95 + 1e-6);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      expect(Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z)).toBeGreaterThanOrEqual(8 - 1e-6);
    }
    expect(JSON.stringify(spawnLoot(new RoyaleRng(5), 500, 150, 8))).toBe(JSON.stringify(items));
  });

  it('is bounded, and a crowded request returns fewer items instead of looping', () => {
    expect(spawnLoot(new RoyaleRng(1), 500, 100_000).length).toBeLessThanOrEqual(MAX_LOOT);
    expect(spawnLoot(new RoyaleRng(1), 500, -5)).toEqual([]);
    expect(spawnLoot(new RoyaleRng(1), 500, NaN)).toEqual([]);
    expect(spawnLoot(new RoyaleRng(1), 12, 300, 50).length).toBeLessThan(300);
  });

  it('weapons are the shooter kit kinds, rarer is stronger, commons outnumber epics', () => {
    const items = spawnLoot(new RoyaleRng(2), 2000, 500, 5);
    const kinds = new Set(['pistol', 'rifle', 'smg', 'shotgun', 'sniper', 'bow']);
    for (const it of items.filter((i: any) => i.kind === 'weapon' || i.kind === 'ammo')) expect(kinds.has(it.weapon)).toBe(true);
    const count = (r: string) => items.filter((i: any) => i.rarity === r).length;
    expect(count('common')).toBeGreaterThan(count('epic') * 3);
    expect(items.filter((i: any) => i.kind === 'weapon' && i.weapon === 'sniper').every((i: any) => i.rarity === 'epic')).toBe(true);
  });

  const item = (over: Record<string, unknown>) => ({ id: 1, kind: 'weapon', rarity: 'common', x: 0, z: 0, weapon: 'rifle', amount: 1, ...over });

  it('a full inventory refuses with a reason, and every limit holds', () => {
    const inv = new Inventory();
    for (const w of ['pistol', 'rifle', 'smg']) inv.add(item({ weapon: w }));
    expect(inv.weapons.length).toBe(WEAPON_SLOTS);
    expect(inv.accepts(item({ weapon: 'sniper' }))).toEqual({ ok: false, reason: 'slots_full' });
    expect(inv.accepts(item({ weapon: 'rifle' }))).toEqual({ ok: false, reason: 'already_have' });
    for (let i = 0; i < 20; i++) if (inv.accepts(item({ kind: 'heal' })).ok) inv.add(item({ kind: 'heal' }));
    expect(inv.heals).toBe(MAX_HEALS);
    expect(inv.accepts(item({ kind: 'heal' }))).toEqual({ ok: false, reason: 'heals_full' });
    for (let i = 0; i < 20; i++) if (inv.accepts(item({ kind: 'armor', amount: 50 })).ok) inv.add(item({ kind: 'armor', amount: 50 }));
    expect(inv.armor).toBe(MAX_ARMOR);
    expect(inv.accepts(item({ kind: 'armor' }))).toEqual({ ok: false, reason: 'armor_full' });
    for (let i = 0; i < 20; i++) if (inv.accepts(item({ kind: 'ammo', weapon: 'rifle', amount: 60 })).ok) inv.add(item({ kind: 'ammo', weapon: 'rifle', amount: 60 }));
    expect(inv.ammo.rifle).toBe(MAX_AMMO);
    expect(inv.accepts(item({ kind: 'ammo', weapon: 'rifle' }))).toEqual({ ok: false, reason: 'ammo_full' });
  });

  it('ATOMIC pickup: a refused item stays on the ground, an accepted one is gone', () => {
    const field = new LootField([item({ id: 1 }), item({ id: 2, weapon: 'smg' })]);
    const inv = new Inventory();
    expect(field.pickUp(inv, 1).ok).toBe(true);
    expect(field.remaining()).toBe(1);
    expect(field.pickUp(inv, 1)).toEqual({ ok: false, reason: 'nothing_there' }); // gone — cannot be taken twice
    inv.add(item({ weapon: 'pistol' })); inv.add(item({ weapon: 'shotgun' }));
    expect(inv.weapons.length).toBe(WEAPON_SLOTS);
    expect(field.pickUp(inv, 2)).toEqual({ ok: false, reason: 'slots_full' });
    expect(field.remaining()).toBe(1); // still there
    expect(field.get(2)).toBeTruthy();
    expect(field.pickUp(inv, 999)).toEqual({ ok: false, reason: 'nothing_there' });
  });

  it('CONSERVATION: across hundreds of random pickups by three players every item is on the ground or taken once', () => {
    const rng = new RoyaleRng(11);
    const all = spawnLoot(new RoyaleRng(3), 300, 300, 4);
    const field = new LootField(all);
    const invs = [new Inventory(), new Inventory(), new Inventory()];
    const taken = new Set<number>();
    for (let i = 0; i < 1500; i++) {
      const id = 1 + Math.floor(rng.next() * (all.length + 20));
      const r = field.pickUp(invs[i % 3], id);
      if (r.ok) { expect(taken.has(id)).toBe(false); taken.add(id); }
    }
    const ground = new Set(field.list().map((x: any) => x.id));
    for (const it of all) expect(ground.has(it.id) !== taken.has(it.id), 'item ' + it.id).toBe(true);
    expect(ground.size + taken.size).toBe(all.length);
  });

  it('nearest() is deterministic and respects the radius', () => {
    const field = new LootField([item({ id: 1, x: 10 }), item({ id: 2, x: -10 }), item({ id: 3, x: 50 })]);
    expect(field.nearest(0, 0, 5)).toBeNull();
    expect(field.nearest(0, 0, 20)!.id).toBe(1);
    expect(field.nearest(45, 0, 20)!.id).toBe(3);
  });
});

describe('bots', () => {
  it('the hit chance falls with distance, is bounded, and skill scales it', () => {
    let prev = 1;
    for (let d = 0; d <= 200; d += 5) {
      const c = hitChance(d, 70, 0.7);
      expect(c).toBeLessThanOrEqual(prev + 1e-12);
      expect(c).toBeGreaterThanOrEqual(0.04);
      expect(c).toBeLessThanOrEqual(0.92);
      prev = c;
    }
    expect(hitChance(10, 70, 0.9)).toBeGreaterThan(hitChance(10, 70, 0.4));
    for (const bad of [NaN, -5, Infinity]) expect(Number.isNaN(hitChance(bad, 70, 0.7))).toBe(false);
  });

  it('DRIFT GUARD: a bot weapon has exactly the shooter kit weapon numbers', () => {
    const src = generateGameSystems().files['src/game/systems/weapon.ts'];
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, any> = {};
    const stub = new Proxy({}, { get: () => class {} });
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', js)(exports, () => stub);
    const WEAPONS = exports.WEAPONS as Record<string, { damage: number; fireRate: number; pellets: number }>;
    expect(Object.keys(BOT_WEAPONS).sort()).toEqual(Object.keys(WEAPONS).sort());
    for (const k of Object.keys(WEAPONS)) {
      expect(BOT_WEAPONS[k].damage, k + ' damage').toBe(WEAPONS[k].damage);
      expect(BOT_WEAPONS[k].fireRate, k + ' fire rate').toBe(WEAPONS[k].fireRate);
      expect(BOT_WEAPONS[k].pellets, k + ' pellets').toBe(WEAPONS[k].pellets);
    }
  });
});

describe('a match always ends, and ranks add up', () => {
  it('with nobody moving, every match ends in bounded time — across seeds and bot counts', () => {
    for (const botCount of [1, 5, 19, 40]) {
      for (let seed = 1; seed <= 5; seed++) {
        const m = new Match({ seed, botCount, mapRadius: 400 });
        play(m, m.zone.totalSeconds + 30);
        expect(m.status, 'seed ' + seed + ' bots ' + botCount + ' alive ' + m.aliveCount()).toBe('ended');
        expect(m.aliveCount()).toBeLessThanOrEqual(1);
      }
    }
  });

  it('ranks are unique and complete: 1..N, 1 for the last one standing', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = new Match({ seed, botCount: 19, mapRadius: 400 });
      play(m, m.zone.totalSeconds + 30);
      expect(m.status).toBe('ended');
      const ranks: number[] = [];
      for (let id = 0; id <= 19; id++) { const r = m.rankOf(id); expect(r, 'fighter ' + id).not.toBeNull(); ranks.push(r as number); }
      expect([...ranks].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(m.rankOf(m.winner as number)).toBe(1);
    }
  });

  it('a player standing in the open dies to the zone, with a rank worse than 1, and the match still ends', () => {
    const { log, opts } = events({ seed: 3, botCount: 9, mapRadius: 400, start: { x: 390, z: 0 } });
    const m = new Match(opts);
    play(m, m.zone.totalSeconds + 30);
    expect(m.player.alive).toBe(false);
    expect(m.playerRank()).toBeGreaterThan(1);
    const died = log.find(([n]) => n === 'PLAYER_DIED')![1];
    expect(died.rank).toBe(m.playerRank());
    expect(m.status).toBe('ended');
    expect(log.filter(([n]) => n === 'PLAYER_DIED').length).toBe(1);
    expect(log.filter(([n]) => n === 'MATCH_ENDED').length).toBe(1);
  });

  it('a death is recorded exactly once however many hits land', () => {
    const { log, opts } = events({ seed: 4, botCount: 3 });
    const m = new Match(opts);
    for (let i = 0; i < 10; i++) m.hitBot(1, 500);
    expect(log.filter(([n, p]) => n === 'KILL' && p.victim === 1).length).toBe(1);
    expect(m.rankOf(1)).toBe(4);
  });

  it('the damage step itself records a death once, even if two hits reach a fighter who is already dead', () => {
    const { log, opts } = events({ seed: 4, botCount: 4 });
    const m = new Match(opts) as any;
    const victim = m.bots[0];
    m.damage(victim, 500, m.player, 'rifle');
    m.damage(victim, 500, m.player, 'rifle'); // a second hit in the same step must not be a second death
    expect(log.filter(([n, p]) => n === 'KILL' && p.victim === victim.id).length).toBe(1);
    expect(m.player.kills).toBe(1);
    expect(m.rankOf(victim.id)).toBe(5);
  });

  it('is deterministic — the same seed replays the same match', () => {
    const run = () => { const { log, opts } = events({ seed: 12, botCount: 19, mapRadius: 400 }); const m = new Match(opts); play(m, 300); return JSON.stringify([m.snapshot(), log.map(([n]) => n)]); };
    expect(run()).toBe(run());
  });

  it('after it has ended nothing changes', () => {
    const m = new Match({ seed: 2, botCount: 3, mapRadius: 300 });
    play(m, m.zone.totalSeconds + 30);
    const snap = JSON.stringify(m.snapshot());
    m.update(10); m.movePlayer(5, 5); m.hitBot(1, 50);
    expect(m.pickUp().ok).toBe(false);
    expect(m.heal().ok).toBe(false);
    expect(JSON.stringify(m.snapshot())).toBe(snap);
  });

  it('even a full 99-bot match ends, quickly', () => {
    const t = Date.now();
    const m = new Match({ seed: 5, botCount: 99, lootCount: 300, mapRadius: 800 });
    play(m, m.zone.totalSeconds + 60);
    expect(m.status).toBe('ended');
    expect(Date.now() - t).toBeLessThan(30_000);
  });
});

describe('the bots really play', () => {
  it('they pick up weapons, shoot each other, and some die to bots and some to the zone', () => {
    const { log, opts } = events({ seed: 21, botCount: 30, lootCount: 200, mapRadius: 350 });
    const m = new Match(opts);
    play(m, m.zone.totalSeconds + 30);
    const pickedWeapon = log.filter(([n, p]) => n === 'LOOT_PICKED' && p.kind === 'weapon').length;
    expect(pickedWeapon).toBeGreaterThan(10);
    const kills = log.filter(([n]) => n === 'KILL').map(([, p]) => p);
    expect(kills.some((k) => k.weapon !== 'zone' && k.killer !== null)).toBe(true);
    expect(kills.some((k) => k.weapon === 'zone')).toBe(true);
  });

  it('they never leave the map and never produce NaN', () => {
    const m = new Match({ seed: 6, botCount: 40, mapRadius: 300 });
    for (let i = 0; i < 4000 && m.status === 'playing'; i++) {
      m.update(0.1);
      if (i % 40 === 0) for (const b of m.snapshot().bots) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.z)).toBe(true);
        expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(300 + 1e-6);
      }
    }
  });

  it('they run for the safe circle: most survivors are inside it late in the match', () => {
    const m = new Match({ seed: 7, botCount: 30, mapRadius: 400 });
    play(m, 250);
    const s = m.snapshot();
    const alive = s.bots.filter((b: any) => b.alive);
    const inCircle = alive.filter((b: any) => Math.hypot(b.x - s.zone.circle.x, b.z - s.zone.circle.z) <= s.zone.circle.r).length;
    expect(alive.length).toBeGreaterThan(0);
    expect(inCircle / alive.length).toBeGreaterThan(0.5);
  });
});

describe('what the game can do to the match', () => {
  it('movePlayer is clamped to the map and ignores NaN', () => {
    const m = new Match({ seed: 1, botCount: 2, mapRadius: 100 });
    m.movePlayer(1e9, 0);
    expect(Math.hypot(m.player.x, m.player.z)).toBeLessThanOrEqual(100 + 1e-6);
    const before = [m.player.x, m.player.z];
    m.movePlayer(NaN, 5); m.movePlayer(5, Infinity);
    expect([m.player.x, m.player.z]).toEqual(before);
  });

  it('the player picks up what is at their feet, and a full pack says why', () => {
    const { log, opts } = events({ seed: 8, botCount: 2, lootCount: 60, mapRadius: 300 });
    const m = new Match(opts);
    expect(m.pickUp()).toMatchObject({ ok: false, message: 'Nothing to pick up here.' });
    const weapons = m.loot.list().filter((i: any) => i.kind === 'weapon');
    let picked = 0;
    for (const w of weapons) {
      m.movePlayer(w.x, w.z);
      const r = m.pickUp();
      if (r.ok) picked++;
      else expect(r.message.length).toBeGreaterThan(5);
    }
    expect(picked).toBe(WEAPON_SLOTS);
    expect(m.player.inv.weapons.length).toBe(WEAPON_SLOTS);
    expect(log.filter(([n]) => n === 'LOOT_PICKED').length).toBeGreaterThanOrEqual(WEAPON_SLOTS);
  });

  it('heal needs a bandage and missing health, and heals 40', () => {
    const m = new Match({ seed: 1, botCount: 1 });
    expect(m.heal()).toMatchObject({ ok: false, message: 'You have no bandages.' });
    m.player.inv.heals = 2;
    expect(m.heal()).toMatchObject({ ok: false, message: 'Your health is already full.' });
    m.player.hp = 30;
    expect(m.heal().ok).toBe(true);
    expect(m.player.hp).toBe(70);
    expect(m.player.inv.heals).toBe(1);
  });

  it('hitBot kills, counts the kill, ranks the victim, and rejects bad input', () => {
    const { log, opts } = events({ seed: 4, botCount: 5 });
    const m = new Match(opts);
    expect(m.hitBot(999, 10)).toEqual({ hit: false, killed: false });
    expect(m.hitBot(1, -5)).toEqual({ hit: false, killed: false });
    expect(m.hitBot(1, NaN)).toEqual({ hit: false, killed: false });
    expect(m.hitBot(1, 50).killed).toBe(false);
    expect(m.hitBot(1, 60).killed).toBe(true);
    expect(m.player.kills).toBe(1);
    expect(m.rankOf(1)).toBe(6);
    expect(m.hitBot(1, 10)).toEqual({ hit: false, killed: false });
    expect(log.some(([n, p]) => n === 'KILL' && p.killer === 0 && p.victim === 1)).toBe(true);
  });

  it('armor soaks 60% of a hit until it is gone, and the rest comes off health', () => {
    const m = new Match({ seed: 3, botCount: 3, mapRadius: 400 }) as any;
    const bot = m.bots[0];
    bot.inv.armor = 50;
    m.hitBot(bot.id, 100); // soaks min(50, 60) = 50, so 50 reaches health
    expect(bot.hp).toBe(50);
    expect(bot.inv.armor).toBe(0);
    m.hitBot(bot.id, 10); // no armor left: all 10 reaches health
    expect(bot.hp).toBe(40);
    const other = m.bots[1];
    other.inv.armor = 100;
    m.hitBot(other.id, 50); // soaks min(100, 30) = 30, so 20 reaches health
    expect(other.hp).toBe(80);
    expect(other.inv.armor).toBe(70);
  });

  it('armor also slows the zone: the same player in the open loses less with armor on', () => {
    const hurt = (armor: number) => {
      // two bots: the match needs two alive to keep going. One is taken out so the rest of the run is the zone and a single bot
      // whose choices do not depend on the player's health — both runs draw the same random numbers, so armor is the only difference.
      const m = new Match({ seed: 3, botCount: 2, mapRadius: 400, start: { x: 399, z: 0 } }) as any;
      m.bots[0].alive = false;
      m.player.inv.armor = armor;
      for (let i = 0; i < 1500; i++) m.update(0.1); // 150 s: well past the first wait, with the circle closing on the edge
      return 100 - m.player.hp;
    };
    expect(hurt(0)).toBeGreaterThan(0);
    expect(hurt(100)).toBeLessThan(hurt(0));
  });

  it('listeners that throw cannot corrupt the match', () => {
    const m = new Match({ seed: 3, botCount: 9, mapRadius: 300, onEvent: () => { throw new Error('boom'); } });
    expect(() => play(m, 400)).not.toThrow();
    expect(m.status).toBe('ended');
  });

  it('is bounded: too many bots, loot or a huge map are clamped', () => {
    const m = new Match({ seed: 1, botCount: 100_000, lootCount: 100_000, mapRadius: 1e12 });
    const s = m.snapshot();
    expect(s.bots.length).toBe(99);
    expect(s.loot.length).toBeLessThanOrEqual(MAX_LOOT);
    expect(s.zone.circle.r).toBe(20000);
  });

  it('update ignores a NaN, negative or zero step', () => {
    const m = new Match({ seed: 1, botCount: 5 });
    const snap = JSON.stringify(m.snapshot());
    m.update(NaN); m.update(-3); m.update(0);
    expect(JSON.stringify(m.snapshot())).toBe(snap);
  });

  it('targetsNear lists alive bots nearest first', () => {
    const m = new Match({ seed: 2, botCount: 12, mapRadius: 100 });
    const t = m.targetsNear(1000);
    expect(t.length).toBe(12);
    for (let i = 1; i < t.length; i++) expect(t[i].distance).toBeGreaterThanOrEqual(t[i - 1].distance);
    m.hitBot(t[0].id, 1000);
    expect(m.targetsNear(1000).length).toBe(11);
  });
});

describe('the emitted kit', () => {
  it('declares exactly the modules it emits, has no dependency, and imports only itself', () => {
    const names = Object.keys(files).map((f) => (f.split('/').pop() ?? '').replace(/\.ts$/, '')).sort();
    expect(names).toEqual([...GAME_ROYALE_MODULES].sort());
    expect(generateGameRoyale().dependencies).toEqual([]);
    for (const [path, src] of Object.entries(files)) {
      for (const m of src.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        expect(m[1].startsWith('./'), path + ' imports ' + m[1]).toBe(true);
        expect(Object.keys(files), path + ' imports ' + m[1]).toContain('src/game/royale/' + m[1].slice(2) + '.ts');
      }
    }
  });

  it('every subset is import-closed and loads', () => {
    for (const include of [['rng'], ['zone'], ['loot'], ['bots'], ['match'], ['index'], ['nonsense']]) {
      const sub = generateGameRoyale(include).files;
      for (const [path, src] of Object.entries(sub)) {
        for (const m of src.matchAll(/from\s*['"]([^'"]+)['"]/g)) expect(Object.keys(sub), include + ': ' + path + ' imports ' + m[1]).toContain('src/game/royale/' + m[1].slice(2) + '.ts');
      }
      expect(() => loadAll(sub)).not.toThrow();
    }
  });

  it('every file parses as real TypeScript', () => {
    for (const [path, src] of Object.entries(files)) {
      const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')), path).toEqual([]);
    }
  });

  it('type-checks under strict, noUnusedLocals and noUnusedParameters', () => {
    const options: ts.CompilerOptions = {
      strict: true, noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true, noEmit: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts'], skipLibCheck: true, isolatedModules: true,
    };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host);
    const exists = host.fileExists.bind(host);
    const isDir = host.directoryExists?.bind(host);
    const mem = new Map(Object.entries(files).map(([p, c]) => ['/virtual/' + p, c]));
    host.directoryExists = (d) => [...mem.keys()].some((k) => k.startsWith(d.endsWith('/') ? d : d + '/')) || (isDir ? isDir(d) : false);
    host.fileExists = (f) => mem.has(f) || exists(f);
    host.readFile = (f) => mem.get(f) ?? read(f);
    host.getSourceFile = (f, lang) => {
      const text = mem.get(f) ?? read(f);
      return text === undefined ? undefined : ts.createSourceFile(f, text, lang, true);
    };
    const program = ts.createProgram([...mem.keys()], options, host);
    const errors = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    expect(errors).toEqual([]);
  });
});

describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');
  const prompt = readFileSync(join(__dirname, '../AgentV3/systemPrompt.ts'), 'utf8');
  const layers = readFileSync(join(__dirname, './gameRecipeLayers.ts'), 'utf8');
  const knowledge = readFileSync(join(__dirname, '../AppContext/AppKnowledgeBase.ts'), 'utf8');

  it('is registered as a definition, in BOTH exposed lists, and in the recipe map', () => {
    expect(catalog).toContain("name: 'generate_game_royale'");
    expect(catalog.match(/^ {2}'generate_game_royale',$/gm)?.length).toBe(2);
    expect(layers).toContain('generate_game_royale: generateGameRoyale');
  });

  it('the dispatcher handles it, the prompt names it, the description gives the rules, every AI can explain it', () => {
    expect(dispatcher).toContain("case 'generate_game_royale': {");
    expect(dispatcher).toContain('generateGameRoyale(grlInclude)');
    expect(prompt).toContain('run_recipe({ name: "generate_game_royale" })');
    const at = catalog.indexOf("name: 'generate_game_royale'");
    const def = catalog.slice(at, at + 3200);
    for (const word of ['SHRINKS', 'atomic', 'rank', 'SINGLE-PLAYER', 'ENDS']) expect(def, word).toContain(word);
    expect(knowledge).toContain('generate_game_royale');
  });
});
