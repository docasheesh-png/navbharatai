// A MAP REQUEST IS READ BY ITS MEANING (map expansion plan, item 10: intent routing). Sentences that sound alike and mean
// different things — "ek aur map jodo" (one more, spread) and "jod ke ek world" (joined into one); "cricket ground chahiye"
// (a ground on the map) and "cricket game banao" (the game itself); "roads se jodo" (highways, nothing moves) — are told
// apart in English, Hinglish and Devanagari, and each is routed to the smallest change for THIS game, with the owner's
// decisions: a sports game gets a world only on request; a race moves onto city roads only after asking once; a battle
// royale stays an 8 km island. Unsure → ask, never edit.
import { describe, it, expect } from 'vitest';
import { mapGrowthIntent, mapGrowthRoute, mapGameTypeOf, mapGrowthNote, type MapGrowthKind } from '../src/server/AgentV3/mapGrowthIntent';

const kind = (s: string) => mapGrowthIntent(s).kind;
const cases = (k: MapGrowthKind, list: string[]) => it(`${k}: ${list.length} ways of saying it`, () => {
  for (const s of list) expect([s, kind(s)]).toEqual([s, k]);
});

describe('🧭 mapGrowthIntent: what the user wants done to the map', () => {
  cases('add-place', ['ek aur map jodo', 'ek naya map jodo', 'ek desert map jodo', 'aur maps jodo', 'ek aur shehar jodo', 'ek gaon add karo', 'add another city', 'add a village to the map', 'एक और नक्शा जोड़ो', 'एक नया शहर जोड़ो', 'ek aur gaon laga do']);
  cases('join-one', ['4 map jod ke ek world banao', '4 bade map jod ke ek bada world', 'sab maps ko mila ke ek kar do', 'ek hi map bana do', 'merge the maps into one world', 'join all the maps into one', 'चार मैप जोड़ के एक दुनिया बनाओ', 'सब नक्शे मिला कर एक कर दो', 'alag mat rakho, jod ke ek world banao']);
  cases('join-to', ['shehar ke bagal me registan', 'city se laga hua jungle', 'शहर के पास रेगिस्तान', 'gaon ke peeche pahad', 'a desert next to the city', 'snow beside the mountains']);
  cases('venue', ['cricket ground chahiye', 'cricket ground jodo', 'football ka maidan banao', 'शहर में स्टेडियम बनाओ', 'stadium next to the city', 'race track add karo', 'ek arena banao', 'क्रिकेट मैदान चाहिए', 'add a football field']);
  cases('game-itself', ['cricket game banao', 'football khelna hai', 'racing game banao', 'क्रिकेट गेम बनाओ', 'make a football game', 'फुटबॉल खेलना है']);
  cases('highways', ['sab shehron ko roads se jodo', 'roads se jodo', 'connect the cities with roads', 'सब शहरों को सड़क से जोड़ो', 'gaon ko highway se connect karo']);
  cases('grow-city', ['yeh shehar bada karo', 'city ko bada karo', 'शहर को बड़ा करो']);
  cases('grow-map', ['map bada karo', 'duniya badi karo', 'make the world bigger', 'नक्शा बड़ा करो', 'map ko badhao']);
  cases('multiply', ['is map ko 50x bigger banao', 'map 10 guna bada karo', 'मैप को 20 गुना बड़ा करो']);
  cases('universe', ['universe banao', 'ek pura brahmand bana do', 'ब्रह्मांड बनाओ']);
  cases('duplicate', ['isi map ko duplicate karke jodo', 'copy this map', 'इसी मैप की कॉपी जोड़ो']);
  cases('track-longer', ['track bada karo', 'race lambi karo', 'road jaldi khatam ho jati hai', 'ट्रैक लंबा करो']);
  cases('shrink', ['map chhota karo', 'make the map smaller', 'नक्शा छोटा करो']);
  cases('none', ['bada map nahi chahiye', 'map mat jodo', "don't add a city", 'stadium nahi chahiye', 'gaadi neeli karo', 'hello', '', 'बड़ा मैप नहीं चाहिए', 'jump button bada karo nahi', 'score dikhao']);
  cases('unsure', ['isko bada karo', 'bada karo']);

  it('the place and venue it names, and "beside"', () => {
    expect(mapGrowthIntent('shehar ke bagal me registan').place).toBe('desert');
    expect(mapGrowthIntent('a desert next to the city').place).toBe('desert');
    expect(mapGrowthIntent('gaon ke peeche pahad').place).toBe('mountain');
    expect(mapGrowthIntent('cricket ground chahiye')).toMatchObject({ venue: 'cricket-ground' });
    expect(mapGrowthIntent('cricket ground chahiye').beside).toBeUndefined();
    expect(mapGrowthIntent('stadium next to the city')).toMatchObject({ venue: 'stadium', beside: true });
    expect(mapGrowthIntent('शहर में स्टेडियम बनाओ')).toMatchObject({ venue: 'stadium', beside: true });
    expect(mapGrowthIntent('race track add karo').venue).toBe('race-circuit');
    expect(mapGrowthIntent('map 10 guna bada karo').times).toBe(10);
    expect(mapGrowthIntent('ek gaon add karo').place).toBe('village');
  });
  it('opposite classes stay apart', () => {
    expect(kind('ek aur map jodo')).not.toBe(kind('4 map jod ke ek world banao'));
    expect(kind('cricket ground chahiye')).not.toBe(kind('cricket game banao'));
    expect(kind('roads se jodo')).not.toBe(kind('map jod ke ek kar do'));
    expect(kind('track bada karo')).not.toBe(kind('map bada karo'));
    expect(kind('map bada karo')).not.toBe(kind('bada map nahi chahiye'));
    expect(kind('shehar ke bagal me registan')).not.toBe(kind('ek desert map jodo'));
  });
  it('never throws on odd input', () => {
    for (const s of [null, undefined, '🙂🙂', 'x'.repeat(20000), '((([[[', '50x', 'ek']) expect(() => mapGrowthIntent(s as string)).not.toThrow();
  });
});

describe('🧭 mapGrowthRoute: the smallest change for THIS game, with the owner\'s rules', () => {
  const route = (s: string, game: Parameters<typeof mapGrowthRoute>[1], caps = {}) => mapGrowthRoute(mapGrowthIntent(s), game, caps);
  it('open world: spread, joined, beside, venue, highways, bigger', () => {
    expect(route('ek aur map jodo', 'open-world')).toMatchObject({ action: 'edit' });
    expect(route('ek aur map jodo', 'open-world').note).toMatch(/NO joinTo/);
    expect(route('4 map jod ke ek world banao', 'open-world').note).toMatch(/joinTo: '<first region id>'/);
    expect(route('shehar ke bagal me registan', 'open-world').note).toMatch(/kind: 'desert', joinTo:/);
    expect(route('cricket ground chahiye', 'open-world').note).toMatch(/kind: 'venue', venue: 'cricket-ground'/);
    expect(route('cricket ground chahiye', 'open-world').note).not.toMatch(/joinTo/);
    expect(route('stadium next to the city', 'open-world').note).toMatch(/venue: 'stadium', joinTo:/);
    expect(route('roads se jodo', 'open-world')).toMatchObject({ action: 'tell' });
    expect(route('roads se jodo', 'open-world').note).toMatch(/Move nothing, add nothing/);
    expect(route('map bada karo', 'open-world').note).toMatch(/NEVER raise sizeMeters/);
    expect(route('cricket game banao', 'open-world')).toMatchObject({ action: 'tell' });
    expect(route('cricket game banao', 'open-world').note).toMatch(/do not add a venue/);
  });
  it('unsure or smaller → ASK, never edit', () => {
    for (const g of ['open-world', 'battle-royale', 'cricket', 'racing-library'] as const) {
      expect(route('isko bada karo', g).action).toBe('ask');
    }
    expect(route('map chhota karo', 'open-world').action).toBe('ask');
  });
  it('cricket / football: a world only when the user asks — and never on a guess', () => {
    expect(route('cricket game banao', 'cricket').action).toBe('none');
    expect(route('football khelna hai', 'football').action).toBe('none');
    expect(route('isko bada karo', 'cricket').action).toBe('ask');                                  // ground or world? asked
    expect(route('ek aur shehar jodo', 'cricket')).toMatchObject({ action: 'tell' });                 // not available yet: said
    expect(route('ek aur shehar jodo', 'cricket').note).toMatch(/change NOTHING about the match/);
    expect(route('map bada karo', 'football', { sportsWorld: true })).toMatchObject({ action: 'edit' });
    expect(route('map bada karo', 'football', { sportsWorld: true }).note).toMatch(/only on request/);
  });
  it('racing: a longer track stays finishKm; cities only after asking ONCE', () => {
    expect(route('track bada karo', 'racing-library')).toMatchObject({ action: 'edit' });
    expect(route('track bada karo', 'racing-library').note).toMatch(/TRACK\.finishKm/);
    expect(route('race lambi karo', 'racing-library').note).toMatch(/finishKm/);
    expect(route('ek aur shehar jodo', 'racing-library')).toMatchObject({ action: 'tell' });          // not available yet
    expect(route('ek aur shehar jodo', 'racing-library').note).toMatch(/offer a longer track/);
    const asked = route('ek aur shehar jodo', 'racing-library', { racingWorld: true });
    expect(asked.action).toBe('ask');
    expect(asked.note).toMatch(/change NOTHING this turn/);
    expect(asked.note).toMatch(/never ask again/);
    expect(route('racing game banao', 'racing-library').action).toBe('none');
  });
  it('battle royale: stays an 8 km island — places only on its dry land, the island never grows', () => {
    for (const s of ['map bada karo', 'is map ko 50x bigger banao', 'universe banao']) {
      const r = route(s, 'battle-royale');
      expect(r.action).toBe('tell');
      expect(r.note).toMatch(/stays an 8 km island/);
      expect(r.note).toMatch(/never raise sizeMeters/);
    }
    const add = route('ek aur gaon add karo', 'battle-royale');
    expect(add.action).toBe('edit');
    expect(add.note).toMatch(/only on the island's dry land/);
    expect(add.note).toMatch(/never drop one silently/);
  });
  it('a game with no map to grow gets no note', () => {
    expect(route('ek aur map jodo', 'other').action).toBe('none');
    expect(route('hello', 'open-world').action).toBe('none');
  });
});

describe('🧭 the game type, read from the game\'s own files', () => {
  const W = 'export const WORLD = { regions: [] };';
  it('open world, battle royale, racing, cricket, football, other', () => {
    expect(mapGameTypeOf({ 'src/game/world.ts': W })).toBe('open-world');
    expect(mapGameTypeOf({ 'src/game/world.ts': W, 'src/App.tsx': "<OpenWorldGame world={{ profile: 'battle-royale' }} />" })).toBe('battle-royale');
    expect(mapGameTypeOf({ 'src/App.tsx': '<RacingRoadGame />' })).toBe('racing-library');
    expect(mapGameTypeOf({ 'src/App.tsx': 'export default function App() { return <CricketMatch /> }' })).toBe('cricket');
    expect(mapGameTypeOf({ 'src/App.tsx': '<FootballGame />' })).toBe('football');
    expect(mapGameTypeOf({ 'src/App.tsx': '<Shop />' })).toBe('other');
    expect(mapGameTypeOf(null)).toBe('other');
  });
  it('the turn note: said for a map request in a game with a map, never otherwise', () => {
    const files = { 'src/game/world.ts': W };
    expect(mapGrowthNote('ek aur map jodo', files)).toMatch(/^🧭 MAP REQUEST READ AS: add-place .* open-world game → EDIT\./);
    expect(mapGrowthNote('score dikhao', files)).toBe('');
    expect(mapGrowthNote('ek aur map jodo', { 'src/App.tsx': '<Shop />' })).toBe('');
    expect(mapGrowthNote('ek aur map jodo', files)).toMatch(/never a reason to change what was not asked/);
  });
});

import { libraryActionsAtTurnStart, mapGrowthNoteAtTurnStart } from '../src/server/AgentV3/growthTurn';
describe('🧭 at the start of a turn', () => {
  const files = { 'src/game/world.ts': "export const WORLD = { regions: [\n    { id: 'main-city', kind: 'city' },\n  ] };\n" };
  const io = (prompt: string, extra: Record<string, unknown> = {}) => {
    const recorded: Array<{ code: string }> = [];
    return { recorded, io: { prompt, filesAtTurnStart: files, read: async (p: string) => (files as Record<string, string>)[p] ?? Promise.reject(new Error('not found')), write: async () => { throw new Error('must not write'); }, addModel: async () => '', record: (i: { code: string }) => recorded.push(i), ...extra } };
  };
  it('a map request in a game with a map: the builder is told what it means; nothing is written', async () => {
    const { io: x, recorded } = io('shehar ke bagal me registan');
    const handoff = await libraryActionsAtTurnStart(x as never);
    expect(handoff).toMatch(/MAP REQUEST READ AS: join-to/);
    expect(handoff).toMatch(/kind: 'desert', joinTo:/);
    expect(recorded.map((r) => r.code)).toEqual(['MAP_GROWTH_ROUTED']);
  });
  it('the library\'s own place pick keeps its own handoff (no second note)', async () => {
    const written: string[] = [];
    const { io: x } = io('Add this to my game (library map place: "village")', { write: async (p: string) => { written.push(p); } });
    const handoff = await libraryActionsAtTurnStart(x as never);
    expect(handoff).toMatch(/ALREADY DONE BY THE PLATFORM/);
    expect(handoff).not.toMatch(/MAP REQUEST READ AS/);
  });
  it('switched off, a long specification, no map, or not about the map: no note', () => {
    const rec = () => {};
    expect(mapGrowthNoteAtTurnStart({ prompt: 'ek aur map jodo', filesAtTurnStart: files, record: rec, env: { AGENTV3_MAP_GROWTH_NOTE: 'off' } })).toBe('');
    expect(mapGrowthNoteAtTurnStart({ prompt: 'ek aur map jodo ' + 'x '.repeat(400), filesAtTurnStart: files, record: rec, env: {} })).toBe('');
    expect(mapGrowthNoteAtTurnStart({ prompt: 'ek aur map jodo', filesAtTurnStart: null, record: rec, env: {} })).toBe('');
    expect(mapGrowthNoteAtTurnStart({ prompt: 'score dikhao', filesAtTurnStart: files, record: rec, env: {} })).toBe('');
    expect(mapGrowthNoteAtTurnStart({ prompt: 'ek aur map jodo', filesAtTurnStart: files, record: rec, env: {} })).toMatch(/add-place/);
  });
});
