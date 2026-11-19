// THE BIG-WORLD WISH IS READ BY MEANING, NOT BY ONE WORD (admin 2026-11-19: "sirf word par nahi, intension par trigger
// ho!!"). See src/server/AgentV3/largeWorldIntent.ts. Before this, only "big map" / "huge world" / "open world" in
// English opened a big world; "bada map banao", "kahin bhi ghoom sakun" and "map bahut chhota hai" did not.
import { describe, it, expect } from 'vitest';
import { largeWorldIntent, largeWorldIntentLine } from '../src/server/AgentV3/largeWorldIntent';
import { mapProfileFor, athreeMapIntent } from '../src/server/lib/athreeMap/athreeMapIntent';

describe('each shape of the wish is read, in English, Hinglish and Devanagari, in any word order', () => {
  it.each([
    ['ek car game banao, bada map banao', 'big-space'],
    ['3d game jisme map bada ho', 'big-space'],
    ['bahut bada map wala game banao', 'big-space'],
    ['विशाल नक्शे वाला गेम बनाओ', 'big-space'],
    ['I want to explore a huge land', 'big-space'],
    ['lambi sadak par truck chalana hai', 'big-space'],
    ['aisi duniya banao jisme kahin bhi ghoom sakun', 'free-roam'],
    ['ऐसा गेम जिसमें कहीं भी घूम सकूँ', 'free-roam'],
    ['open world game', 'free-roam'],
    ['road khatam hi na ho aisa racing game', 'never-ending'],
    ['सड़क कभी खत्म न हो', 'never-ending'],
    ['door door tak gaadi chalaun', 'never-ending'],
    ['car game ka map bahut chhota hai, bada karo', 'too-small'],
    ['race 10 second me khatam ho jata hai', 'too-small'],
    ['make the world bigger', 'too-small'],
    ['the map is too small', 'too-small'],
    ['50 km ka registan', 'distance'],
  ])('%s → %s', (prompt, wish) => {
    const r = largeWorldIntent(prompt);
    expect(r.wants, prompt).toBe(true);
    expect(r.wish, prompt).toBe(wish);
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(largeWorldIntentLine(r)).toMatch(/gets a big world/);
  });
});

describe('no wish is invented', () => {
  it.each([
    'ek calculator banao', 'make a todo app with big buttons', 'I need a large font', 'long list of products',
    'big score counter', '2D snake game', 'quiz app banao', 'game kabhi band na ho', 'endless runner game', '', '   ',
  ])('%s → not a big world', (prompt) => {
    expect(largeWorldIntent(prompt).wants).toBe(false);
  });
  it.each(['chhota map banao', 'a tiny arena shooter', 'bada map nahi chahiye', 'no big map please'])('a SMALL world on purpose is obeyed: %s', (prompt) => {
    const r = largeWorldIntent(prompt);
    expect(r.wants).toBe(false);
    expect(r.smallOnPurpose).toBe(true);
  });
  it('never throws on junk', () => {
    for (const p of [undefined, null, 'x'.repeat(100_000), '🙂🙂🙂']) expect(() => largeWorldIntent(p as never)).not.toThrow();
  });
  // Found while building this: `बड़ा\s*(?:\S+\s*){0,2}नहीं` backtracked catastrophically on a long run of Devanagari
  // with no spaces (a request read on every build, so a hung request thread). Every repeat is bounded now.
  it('reads in linear time: long runs of every Devanagari keyword and random keyword soup stay fast', () => {
    const slow: string[] = [];
    for (const w of ['बड़ा', 'छोटा', 'खत्म', 'कहीं', 'बहुत', 'दूर', 'सड़क', 'bada', 'khatam', 'kahin']) {
      const t = Date.now(); largeWorldIntent(w.repeat(6000)); if (Date.now() - t > 250) slow.push(w);
    }
    const words = ['बड़ा', 'नक्शा', 'map', 'bada', 'chhota', 'khatam', 'na', 'ho', 'kahin', 'bhi', 'नहीं', 'खत्म', 'दूर', 'तक', ' ', '\n'];
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let k = 0; k < 40; k++) {
      let s = ''; while (s.length < 20_000) s += words[Math.floor(rnd() * words.length)] + (rnd() < 0.3 ? '' : ' ');
      const t = Date.now(); largeWorldIntent(s); if (Date.now() - t > 250) slow.push(`soup ${k}`);
    }
    expect(slow).toEqual([]);
  });
});

describe('the wish opens the 3D world only for a game', () => {
  it.each([
    'ek 3D game banao jiska map bahut bada ho',
    'aisa game banao jisme kahin bhi ghoom sakun',
    'mere game ka map bahut chhota hai, bada karo',
    'विशाल दुनिया वाला गेम बनाओ',
  ])('a game: %s → a world profile, and the Athree map is used', (prompt) => {
    expect(mapProfileFor(prompt)).toMatch(/open-world|explore/);
    expect(athreeMapIntent({ prompt })).toMatchObject({ use: true, mapId: 'athree' });
  });
  it.each(['make a todo app with big buttons', 'ek bada calculator banao', 'long list of products', 'endless runner game'])('not a world: %s', (prompt) => {
    expect(mapProfileFor(prompt)).toBeNull();
  });
  it('a 2D game is not given the 3D world (the 2D world serves it)', () => {
    expect(mapProfileFor('2D game banao jiska map bahut bada ho')).toBeNull();
  });
});
