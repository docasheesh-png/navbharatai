import { describe, expect, it } from 'vitest';
import { findSyntaxErrors } from '../SyntaxCheck';
import { checkPreviewCompiles } from '../../runtime/PreviewCompileCheck';
import { goldenScaffoldFiles } from '../goldenScaffolds/registry';
import { GAME_LIBRARY, gameScaffold, materializeGame } from './registry';
import { gameMatchPrompt, matchGameLibrary, parseGameReply, resolveBuildScaffold, type GameAsk } from './match';

const reply = (id: string, confidence: number, title?: string): GameAsk => async () => ({
  text: JSON.stringify({ id, confidence, title, accent: '#112233' }),
  inputTokens: 20,
  outputTokens: 12,
});

const FIXTURES: Array<[string, string]> = [
  ['bacchon ke liye ginti wala khel', 'bell-round'],
  ['एक दौड़ वाला खेल जहाँ तीन लेन हों', 'lane-dash'],
  ['பாட்டி வீட்டு பகடை விளையாட்டு', 'courtyard'],
  ['বাচ্চাদের জন্য ক্রিকেট খেলা', 'gully-innings'],
  ['बच्चन खातिर टाइल जोड़े वाला खेल', 'stack-tiles'],
  ['ఒక రేసింగ్ గేమ్ కావాలి', 'ring-rally'],
];

describe('game library matching', () => {
  it('uses the model reply for requests in several languages and scripts', async () => {
    for (const [request, id] of FIXTURES) {
      const sent: string[] = [];
      const ask: GameAsk = async (prompt) => {
        sent.push(prompt);
        return { text: JSON.stringify({ id, confidence: 0.91, title: 'Custom Cup', accent: '#112233' }), inputTokens: 30, outputTokens: 10 };
      };
      const match = await matchGameLibrary(request, ask);
      expect(match?.id, request).toBe(id);
      expect(sent[0]).toContain(request);
      expect(gameMatchPrompt(request)).not.toMatch(/subway|candy crush|ludo king/i);
    }
  });

  it('a low score or an unknown id falls back to from-scratch', async () => {
    expect(await matchGameLibrary('something vague', reply('lane-dash', 0.4))).toBeNull();
    expect(await matchGameLibrary('something vague', reply('not-a-game', 0.99))).toBeNull();
    expect(parseGameReply('{"id":"none","confidence":0.99}')).toBeNull();
  });

  it('removing a template from the list drops it, and the others stay', async () => {
    const library = GAME_LIBRARY.filter((game) => game.id !== 'courtyard');
    const ask: GameAsk = async () => ({ text: '{"id":"courtyard","confidence":0.95}' });
    expect(await matchGameLibrary('board game', ask, library)).toBeNull();
    expect(library.map((game) => game.id)).toEqual(['lane-dash', 'gully-innings', 'stack-tiles', 'ring-rally', 'bell-round']);
  });

  it('an exact starter chip is not sent to the game model', async () => {
    let called = false;
    const ask: GameAsk = async () => { called = true; return { text: '{"id":"lane-dash","confidence":0.99}' }; };
    const scaffold = await resolveBuildScaffold('Build a calculator', ask);
    expect(called).toBe(false);
    expect(scaffold?.id).toBe('calculator');
  });

  it('a confident match customizes the title and still compiles', async () => {
    const scaffold = await resolveBuildScaffold('பாட்டி வீட்டு பகடை விளையாட்டு', reply('courtyard', 0.88, 'Home Dice'));
    expect(scaffold?.title).toBe('Home Dice');
    expect(scaffold?.appTsx).toContain('Home Dice');
    expect(scaffold?.appTsx).not.toContain('__TITLE__');
  });
});

describe('the first six games compile', () => {
  for (const game of GAME_LIBRARY) {
    it(game.title + ' is a complete preview app', async () => {
      const source = materializeGame(game);
      expect(source).toContain('Play again');
      expect(source).toContain('खेल खत्म');
      expect(source).toContain('localStorage');
      expect(source).toContain('AudioContext');
      expect(source.toLowerCase()).not.toMatch(/subway surfers|ludo king|candy crush|temple run/);
      const files = goldenScaffoldFiles(gameScaffold(game));
      expect(await findSyntaxErrors(files)).toEqual([]);
      const preview = checkPreviewCompiles(files);
      expect(preview.errors).toEqual([]);
      expect(preview.ok).toBe(true);
    });
  }
});
