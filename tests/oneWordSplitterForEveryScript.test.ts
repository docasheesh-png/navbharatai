/**
 * ONE WORD SPLITTER FOR A USER'S TEXT, AND IT READS EVERY SCRIPT (autopsy 15e69839, 2026-10-12).
 *
 * Three private copies split user text on `/[^a-z0-9ऀ-ॿ]+/` — Latin and Devanagari kept, every other letter a
 * separator — so a Tamil request came out as `["17"]`. The sibling of the picture-intent fix in the same autopsy:
 * a deterministic reader of user text that sees only two scripts. One shared `textWords`, and this census.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { textWords } from '../src/server/AgentV3/textWords';
import { instructionWords } from '../src/server/AgentV3/buildableInput';
import { subjectStems } from '../src/server/AgentV3/unrelatedRequest';
import { significantWords } from '../src/server/AgentV3/offTopicSummary';

const REAL = 'ஒரு மரத்தில் ஒரு 17 வயது பையன் சாய்ந்திருப்பது மாதிரி உருவாக்கப்படும்';

describe('textWords', () => {
  it('🔒 keeps Tamil words whole — vowel signs are marks, not separators', () => {
    expect(textWords(REAL)).toEqual(['ஒரு', 'மரத்தில்', 'ஒரு', '17', 'வயது', 'பையன்', 'சாய்ந்திருப்பது', 'மாதிரி', 'உருவாக்கப்படும்']);
  });

  it.each([
    ['te', 'ఒక బిల్లింగ్ యాప్', 3], ['bn', 'একটি বিলিং অ্যাপ', 3], ['gu', 'એક બિલિંગ એપ', 3],
    ['kn', 'ಒಂದು ಬಿಲ್ಲಿಂಗ್ ಆಪ್', 3], ['ml', 'ഒരു ബില്ലിംഗ് ആപ്പ്', 3], ['pa', 'ਇੱਕ ਬਿਲਿੰਗ ਐਪ', 3],
    ['or', 'ଗୋଟିଏ ବିଲିଂ ଆପ୍', 3], ['ur', 'ایک بلنگ ایپ', 3], ['hi', 'एक बिलिंग ऐप बनाओ।', 4], ['en', "a shop's billing app", 5],
  ])('%s: %s → %i words', (_s, text, n) => {
    expect(textWords(text as string)).toHaveLength(n as number);
  });

  it('the danda ends a word', () => {
    expect(textWords('ऐप बनाओ।ठीक')).toEqual(['ऐप', 'बनाओ', 'ठीक']);
  });
});

describe('every reader of user text uses it', () => {
  it('🔒 the real Tamil request is no longer read as one word', () => {
    expect(instructionWords(REAL).length).toBeGreaterThan(5);
    expect(subjectStems(REAL).size).toBeGreaterThan(2);
    expect(significantWords('ஜிஎஸ்டி பில் செயலி')).toContain('ஜிஎஸ்டி');
  });

  it('🔒 census: no private copy of the Latin+Devanagari-only splitter in server code', () => {
    const offenders = globSync('src/server/**/*.ts', { ignore: ['**/*.test.ts', 'src/server/AgentV3/textWords.ts'] })
      .filter((f) => /\[\^a-z0-9ऀ-ॿ\]/.test(readFileSync(f, 'utf8')));
    expect(offenders, 'use textWords (src/server/AgentV3/textWords.ts)').toEqual([]);
  });
});
