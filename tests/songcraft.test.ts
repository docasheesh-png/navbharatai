import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isSongRequest, songcraftFor, SONGCRAFT_DIRECTIVE } from '../src/server/AI/songcraft';

/**
 * ADMIN ASK 2026-08-08: "agar koi user gaana likhwaye to user ke man ke mutabik realistic gane likhe —
 * emotions, joy, aur rhythm itni acchi ho ki log madhosh ho jaye."
 *
 * A model asked plainly for Hindi lyrics reaches for the same rhymes every time and NAMES emotions
 * instead of showing them. The directive encodes the craft that actually moves a listener; these tests
 * lock (a) that it fires on a real request in the languages users type, (b) that it never fires on a
 * passing mention — a conversation that is not about writing a song must cost exactly what it costs
 * today, and (c) that the rules which do the work are present.
 */

describe('isSongRequest — fires on a real request, in the languages users actually type', () => {
  it('English', () => {
    expect(isSongRequest('write me a song about my mother')).toBe(true);
    expect(isSongRequest('can you compose lyrics for a wedding')).toBe(true);
  });

  it('Hinglish (romanized) — the most common way our users ask', () => {
    expect(isSongRequest('ek gaana likh do mere dost ke liye')).toBe(true);
    expect(isSongRequest('mujhe ek sad geet chahiye')).toBe(true);
    expect(isSongRequest('bhajan banao')).toBe(true);
  });

  it('Devanagari', () => {
    expect(isSongRequest('मेरे लिए एक गाना लिखो')).toBe(true);
    expect(isSongRequest('एक प्यारी सी लोरी बनाओ')).toBe(true);
  });

  it('a short message centred on a song word is a request even without a verb', () => {
    expect(isSongRequest('ek gaana')).toBe(true);
    expect(isSongRequest('lyrics please')).toBe(true);
  });
});

describe('isSongRequest — never fires on a passing mention (cost + no prompt drift)', () => {
  it('talking ABOUT songs is not asking for one', () => {
    expect(isSongRequest(
      'I listened to a beautiful song yesterday at my cousin\'s wedding and it reminded me of the trip we took to Goa last winter with the whole family',
    )).toBe(false);
  });

  it('unrelated messages', () => {
    expect(isSongRequest('build me a grocery app')).toBe(false);
    expect(isSongRequest('mera app kaise banega')).toBe(false);
    expect(isSongRequest('')).toBe(false);
    expect(isSongRequest('   ')).toBe(false);
  });

  it('a substring is not a match — tokens only', () => {
    expect(isSongRequest('who is the best songwriter in India and what makes their work last so long over decades')).toBe(false);
  });
});

describe('songcraftFor — injected only when asked', () => {
  it('returns the directive for a song request and NOTHING otherwise', () => {
    expect(songcraftFor('gaana likh do')).toContain('SONGWRITING');
    expect(songcraftFor('build me an app')).toBe('');
  });
});

describe('the directive encodes CHECKABLE craft, not vibes', () => {
  it('demands a real singable structure', () => {
    expect(SONGCRAFT_DIRECTIVE).toMatch(/Mukhda/);
    expect(SONGCRAFT_DIRECTIVE).toMatch(/Antara/);
  });

  it('demands rhythm a model can actually obey (syllable count + rhyme scheme)', () => {
    expect(SONGCRAFT_DIRECTIVE).toMatch(/syllable count/i);
    expect(SONGCRAFT_DIRECTIVE).toMatch(/AABB|ABAB/);
  });

  it('demands SHOWN emotion — one concrete image per line, never the emotion word', () => {
    expect(SONGCRAFT_DIRECTIVE).toMatch(/ONE concrete physical image per line/);
    expect(SONGCRAFT_DIRECTIVE).toMatch(/Never write the name of the emotion/);
  });

  it('bans the automatic rhymes that make lyrics sound machine-written', () => {
    for (const cliche of ['pyaar/bahaar', 'dil/manzil', 'chaand/raat']) {
      expect(SONGCRAFT_DIRECTIVE).toContain(cliche);
    }
  });

  it('honours the platform rule: WRITE it, never interrogate the user first', () => {
    expect(SONGCRAFT_DIRECTIVE).toMatch(/Do not ask clarifying questions first/);
  });

  it("matches the user's own language and script rather than translating their request", () => {
    expect(SONGCRAFT_DIRECTIVE).toMatch(/Language \+ script exactly as they used/);
  });

  it('names no AI vendor (the white-label law applies to every user-facing surface)', () => {
    expect(SONGCRAFT_DIRECTIVE).not.toMatch(/\b(gemini|claude|anthropic|glm|kimi|grok|openai|gpt|bedrock|vertex)\b/i);
  });
});

// Source contract: a directive nobody injects is dead prose.
describe('wiring — chat.ts appends it, and only for the message that asked', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');

  it('is appended to the assembled system prompt', () => {
    expect(SRC).toContain('songcraftFor(message)');
  });

  it('rides the SHARED assembly point, so every chat tier gets it (a free user too)', () => {
    const at = SRC.indexOf('songcraftFor(message)');
    const creator = SRC.indexOf('CREATOR_IDENTITY}`');
    expect(at).toBeGreaterThan(-1);
    expect(creator).toBeGreaterThan(at); // sits in the same tier-agnostic block
  });
});
