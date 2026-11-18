// WHEN ATHREE IS USED — the admin's three conditions, their precedence, and the stability of the random pick.
import { describe, it, expect } from 'vitest';
import { athreeMapIntent, mapProfileFor, pickLibraryMap } from './athreeMapIntent';
import { ALL_PROFILES, ATHREE_MAP, type LibraryMap } from './athreeMapLibrary';

const OTHER: LibraryMap = { id: 'desert-run', name: 'Desert Run map', profiles: ['racing'], aliases: ['desert run'], license: { spdx: 'X', evidenceUrl: 'x', attribution: 'x' }, recipe: 'generate_x', summary: 'x' };
const intent = (prompt: string, extra: object = {}) => athreeMapIntent({ prompt, ...extra });

describe('condition 1 — NAMED and really needed', () => {
  const named = [
    'athree map par ek racing game banao',
    'Make a 3D racing game and use the Athree map',
    'athree map use hona hai, open world game banao',
    'build a battle royale game on the a-three map',
    'a3 map par flight simulator banao',
    'एथ्री मैप पर रेसिंग गेम बनाओ',
    'ATHREE open world driving game',
  ];
  for (const p of named) it(`uses Athree: ${p}`, () => {
    const r = intent(p);
    expect(r).toMatchObject({ use: true, via: 'named', mapId: 'athree' });
    expect(r.profile).not.toBeNull();
  });

  it('picks the profile the game needs', () => {
    expect(intent('athree map par pubg jaisa game banao').profile).toBe('battle-royale');
    expect(intent('athree map par racing game banao').profile).toBe('racing');
    expect(intent('athree map par plane flight game').profile).toBe('flight');
    expect(intent('athree map open world explore karna hai').profile).toMatch(/open-world|explore/);
  });

  it('named but NOT needed: an honest "no map here", never a fake map', () => {
    for (const p of ['athree map use karke ek calculator banao', 'make a billing app with the athree map', 'athree map par 2D puzzle game banao', 'a3 map wala todo app']) {
      const r = intent(p);
      expect(r, p).toMatchObject({ use: false, via: 'named-not-needed', mapId: null });
      expect(r.reason).toMatch(/no world to put it on/);
    }
  });

  it('"A3" as a paper size is not the map', () => {
    expect(intent('make an A3 poster maker app')).toMatchObject({ use: false, via: 'none' });
  });
});

describe('condition 2 — a big map is really needed (Athree eligible)', () => {
  const needed = [
    'ek 3D racing game banao', 'build an open world game', 'pubg jaisa battle royale game', 'flight simulator banao',
    'explore karne wala 3D survival game', 'sport car driving game with a big map',
  ];
  for (const p of needed) it(`needs a map: ${p}`, () => {
    expect(mapProfileFor(p), p).not.toBeNull();
    const r = intent(p);
    expect(r.use).toBe(true);
    expect(r.via).toBe('needed'); // a pool of one: Athree is the only map the library has today
    expect(r.mapId).toBe('athree');
  });
  it('apps and small games need none', () => {
    for (const p of ['ek calculator banao', 'billing app', 'portfolio website', '2D snake game', 'quiz app banao', 'todo list']) {
      expect(mapProfileFor(p), p).toBeNull();
      expect(intent(p)).toMatchObject({ use: false, via: 'none' });
    }
  });
});

describe('condition 3 — the librarian picks at random, Athree always in the pool', () => {
  const maps = [ATHREE_MAP, OTHER];
  it('only among maps that FIT the request (a racing-only map never serves a flight game)', () => {
    for (let i = 0; i < 30; i++) {
      const r = intent('flight simulator banao ' + i, { maps });
      expect(r.mapId).toBe('athree');
      expect(r.via).toBe('needed'); // pool of one for flight
    }
  });
  it('racing: both maps fit, so the pick varies across different requests and Athree is among them', () => {
    const picks = new Set<string>();
    for (let i = 0; i < 60; i++) picks.add(intent('3D racing game number ' + i, { maps }).mapId!);
    expect(picks).toEqual(new Set(['athree', 'desert-run']));
    const r = intent('3D racing game number 5', { maps });
    expect(r.via).toBe('librarian');
  });
  it('the pick is DETERMINISTIC for one project (same seed → same map, every time)', () => {
    for (let i = 0; i < 10; i++) expect(intent('3D racing game', { maps, seedKey: 'ws-42' }).mapId).toBe(intent('3D racing game', { maps, seedKey: 'ws-42' }).mapId);
    expect(pickLibraryMap(maps, 'k1')).toBe(pickLibraryMap(maps, 'k1'));
    expect(pickLibraryMap([], 'k')).toBeNull();
  });
});

describe('precedence and stability', () => {
  const maps = [ATHREE_MAP, OTHER];
  it('a user-named OTHER map wins over everything, even when Athree is also named', () => {
    expect(intent('racing game on the Desert Run map', { maps })).toMatchObject({ use: false, via: 'other-map', mapId: 'desert-run' });
    expect(intent('athree map ya desert run map par racing game', { maps }).via).toBe('other-map');
  });
  it('an explicit refusal of Athree is obeyed', () => {
    expect(intent('racing game but do not use the athree map', { maps })).toMatchObject({ use: false, via: 'declined' });
    expect(intent('racing game, athree map nahi chahiye', { maps })).toMatchObject({ use: false, via: 'declined' });
  });
  it('the stored choice is kept on every later edit (the map never changes under a game)', () => {
    for (const edit of ['make the car faster', 'add a lap timer', 'change the colours', 'ek aur gaadi add karo']) {
      expect(intent(edit, { maps, stored: { mapId: 'athree' } })).toMatchObject({ use: true, via: 'stored', mapId: 'athree' });
      expect(intent(edit, { maps, stored: { mapId: 'desert-run' } })).toMatchObject({ use: false, via: 'stored', mapId: 'desert-run' });
    }
  });
  it('only an explicit request for a different map re-decides', () => {
    expect(intent('map badlo, doosra map lagao racing game me', { maps, stored: { mapId: 'athree' } }).via).not.toBe('stored');
    expect(intent('change the map', { maps, stored: { mapId: 'athree' } }).via).not.toBe('stored');
  });
});

describe('never throws, and the library has the map it names', () => {
  it('handles junk input', () => {
    for (const p of [undefined, null, '', '   ', 'x'.repeat(100000)]) expect(() => athreeMapIntent({ prompt: p as never })).not.toThrow();
    expect(athreeMapIntent({ prompt: '' })).toMatchObject({ use: false, via: 'none' });
  });
  it('Athree fits every profile and carries an owner licence record', () => {
    expect([...ATHREE_MAP.profiles].sort()).toEqual([...ALL_PROFILES].sort());
    expect(ATHREE_MAP.license.spdx).toBe('LicenseRef-NavBharatAI-own');
    expect(ATHREE_MAP.recipe).toBe('generate_athree_map');
  });
});

// Negative module intent must not be mistaken for rejecting the whole named map.
describe('component exclusions are not map refusal',()=>{
 it.each(['Athree open world with no cars','Athree map without trees','Athree map no roads','अथ्री ओपन वर्ल्ड में पेड़ नहीं'])('%s',prompt=>{expect(athreeMapIntent({prompt})).not.toMatchObject({via:'declined'});});
});

describe('target-local map refusals remain supported',()=>{
 it.each(['do not generate athree','do not want athree','athree map ko use nahi karo',"I do not want to use the Athree map",'अथ्री मैप नहीं चाहिए'])('%s',phrase=>expect(athreeMapIntent({prompt:'3D racing game, '+phrase})).toMatchObject({use:false,via:'declined'}));
});
