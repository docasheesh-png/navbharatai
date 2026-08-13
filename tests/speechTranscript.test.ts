/**
 * The reported failure, encoded exactly.
 *
 * ADMIN REPORT 2026-08-13, with a screenshot from a real Android phone: dictating into the free chat
 * produced every intermediate state of the sentence, concatenated —
 *
 *   "voicevoice typingvoice typing Meinvoice typing Mein Kuchh…"
 *
 * The first test below replays that precise event sequence. It fails against the old
 * `Array.from(e.results).map(r => r[0].transcript).join('')` reading and passes against this module,
 * which is the whole point: the bug class cannot come back silently.
 */

import { describe, it, expect } from 'vitest';
import {
  accumulateSpeech,
  emptyAccumulator,
  joinFragments,
  transcriptText,
  speechLang,
  type SpeechEventLike,
} from '../src/lib/speechTranscript';

/** Build an event the way a browser would. */
const ev = (results: Array<[string, boolean]>, resultIndex = 0): SpeechEventLike => ({
  resultIndex,
  results: results.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })),
});

/** Run a whole dictation and return what the box would show. */
function dictate(events: SpeechEventLike[], base = ''): string {
  let acc = emptyAccumulator();
  for (const e of events) acc = accumulateSpeech(acc, e);
  return transcriptText(base, acc);
}

describe('🔒 THE REPORTED BUG — Android’s cumulative interim results', () => {
  it('replays the exact screenshot sequence and produces the sentence ONCE', () => {
    // Android Chrome adds a NEW result entry per revision, each carrying the CUMULATIVE text, and
    // points resultIndex at it. The old code joined the whole list and reproduced the wall of text.
    const phrases = [
      'voice',
      'voice typing',
      'voice typing Mein',
      'voice typing Mein Kuchh',
      'voice typing Mein Kuchh Bhi',
      'voice typing Mein Kuchh Bhi poochhne',
      'voice typing Mein Kuchh Bhi poochhne per',
      'voice typing Mein Kuchh Bhi poochhne per yah',
      'voice typing Mein Kuchh Bhi poochhne per yah typing',
      'voice typing Mein Kuchh Bhi poochhne per yah typing galat',
      'voice typing Mein Kuchh Bhi poochhne per yah typing galat Kyon',
      'voice typing Mein Kuchh Bhi poochhne per yah typing galat Kyon Jaati',
      'voice typing Mein Kuchh Bhi poochhne per yah typing galat Kyon Jaati Hai',
    ];
    const events = phrases.map((p, i) =>
      ev([...phrases.slice(0, i).map((q) => [q, false] as [string, boolean]), [p, i === phrases.length - 1]], i),
    );
    expect(dictate(events)).toBe('voice typing Mein Kuchh Bhi poochhne per yah typing galat Kyon Jaati Hai');
  });

  it('🔒 the OLD reading of the same events is what produced the report', () => {
    // Kept as executable proof that the fixture reproduces the real bug rather than a made-up one.
    const phrases = ['voice', 'voice typing', 'voice typing Mein'];
    const results = phrases.map((p) => ({ isFinal: false, 0: { transcript: p } }));
    const oldWay = results.map((r) => r[0].transcript).join('');
    expect(oldWay).toBe('voicevoice typingvoice typing Mein');   // the bug, verbatim
    expect(dictate([ev(phrases.map((p) => [p, false]), 0)])).toBe('voice typing Mein');
  });

  it('a word spoken once appears once, however many revisions it took', () => {
    const out = dictate([
      ev([['hello', false]], 0),
      ev([['hello wor', false]], 0),
      ev([['hello world', true]], 0),
    ]);
    expect(out).toBe('hello world');
    expect(out.match(/hello/g)).toHaveLength(1);
  });
});

describe('the standard (desktop) path still works', () => {
  it('accumulates separate final phrases', () => {
    // Desktop Chrome: each phrase is its own result and resultIndex advances.
    const out = dictate([
      ev([['make me an app', true]], 0),
      ev([['make me an app', true], ['with a login page', true]], 1),
    ]);
    expect(out).toBe('make me an app with a login page');
  });

  it('🔒 never re-reads results before resultIndex — that is what duplicates committed text', () => {
    const acc1 = accumulateSpeech(emptyAccumulator(), ev([['first', true]], 0));
    // A second event that still carries result 0 but points past it must not re-commit "first".
    const acc2 = accumulateSpeech(acc1, ev([['first', true], ['second', true]], 1));
    expect(acc2.final).toBe('first second');
  });

  it('interim text is REPLACED, never appended', () => {
    let acc = accumulateSpeech(emptyAccumulator(), ev([['tell me a', false]], 0));
    acc = accumulateSpeech(acc, ev([['tell me a story', false]], 0));
    expect(acc.interim).toBe('tell me a story');
    expect(acc.final).toBe('');
  });

  it('interim disappears once the phrase goes final', () => {
    let acc = accumulateSpeech(emptyAccumulator(), ev([['open the', false]], 0));
    acc = accumulateSpeech(acc, ev([['open the door', true]], 0));
    expect(acc.final).toBe('open the door');
    expect(acc.interim).toBe('');
  });
});

describe('joinFragments', () => {
  it('replaces on a revision, joins on a genuinely new phrase', () => {
    expect(joinFragments('voice', 'voice typing')).toBe('voice typing');
    expect(joinFragments('hello', 'world')).toBe('hello world');
  });

  it('is case- and spacing-insensitive, because recognisers re-punctuate as they revise', () => {
    expect(joinFragments('voice typing', 'Voice  Typing Mein')).toBe('Voice  Typing Mein');
    expect(joinFragments('Hello', 'hello')).toBe('hello');
  });

  it('ignores a shorter re-send of what we already have', () => {
    expect(joinFragments('voice typing Mein', 'voice typing')).toBe('voice typing Mein');
  });

  it('handles empties without producing stray spaces', () => {
    expect(joinFragments('', 'a')).toBe('a');
    expect(joinFragments('a', '')).toBe('a');
    expect(joinFragments('', '')).toBe('');
    expect(joinFragments('  ', '  ')).toBe('');
  });
});

describe('transcriptText — dictating into a half-written message', () => {
  it('🔒 keeps what the user already typed instead of wiping it', () => {
    // Two of the four surfaces used to overwrite the box wholesale; v5 did not. Now none do.
    expect(transcriptText('Build me ', { final: 'a login page', interim: '' })).toBe('Build me a login page');
  });

  it('shows the live tail after the committed text', () => {
    expect(transcriptText('', { final: 'make an app', interim: 'with dark' })).toBe('make an app with dark');
  });

  it('an empty dictation leaves the typed text alone', () => {
    expect(transcriptText('hello', emptyAccumulator())).toBe('hello');
    expect(transcriptText('', emptyAccumulator())).toBe('');
  });
});

describe('🔒 language is the DEVICE’s, not hardcoded English', () => {
  it('follows the device', () => {
    // Two surfaces pinned 'en-IN', so a Hindi speaker was transcribed by an English recogniser --
    // in an India-first product, on the two screens most likely to be used in Hindi.
    expect(speechLang('hi-IN')).toBe('hi-IN');
    expect(speechLang('bn-IN')).toBe('bn-IN');
    expect(speechLang('en-GB')).toBe('en-GB');
  });

  it('falls back to en-IN only when the device says nothing', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(speechLang(empty as never), String(empty)).toBe('en-IN');
    }
  });
});

describe('🔒 it can never throw into a voice session', () => {
  it('survives a malformed event rather than killing dictation mid-sentence', () => {
    const acc = emptyAccumulator();
    expect(accumulateSpeech(acc, {} as never)).toBe(acc);
    expect(accumulateSpeech(acc, { results: null } as never)).toBe(acc);
    expect(accumulateSpeech(acc, { results: [] } as never)).toEqual({ final: '', interim: '' });
    expect(() => accumulateSpeech(acc, { resultIndex: 99, results: [] } as never)).not.toThrow();
    expect(() => accumulateSpeech(acc, { resultIndex: -5, results: [{ isFinal: true }] } as never)).not.toThrow();
  });

  it('skips entries with no transcript instead of emitting undefined', () => {
    const acc = accumulateSpeech(emptyAccumulator(), {
      resultIndex: 0,
      results: [{ isFinal: true, 0: {} }, { isFinal: true, 0: { transcript: 'real' } }],
    } as never);
    expect(acc.final).toBe('real');
    expect(acc.final).not.toContain('undefined');
  });
});
