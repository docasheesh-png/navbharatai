/**
 * 🔴 A REQUEST NONE OF THE SIGNALS CAN READ IS NOT A GREETING (autopsy d98dae01, 2026-09-17).
 *
 * `RequestAnalyser`'s every signal is an ASCII pattern, so a request in Devanagari, Telugu, Bengali,
 * Tamil, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu or Arabic matched none of them, fell
 * through `detectTaskType`'s final `return 'chat'`, and scored **5** — the same 5 as the word "hi".
 *
 * Two halves, and only one of them existed before this suite:
 *
 *   • `complexityRouting.ts` already BOUGHT a second opinion for such a request (2026-09-17, earlier
 *     the same day) — a good fix for its own question, and a workaround for everyone else's, because
 *     the module that could not read went on returning `ambiguous: false`, i.e. *"I am confident"*.
 *   • This suite pins the other half: the scorer now SAYS it could not read (`unreadable`, and
 *     `ambiguous` with it), and floors the score on evidence that survives in every script — so the
 *     answer that "stands" when no classifier is available is no longer a 5.
 *
 * ⚠️ THE ENGLISH PATH MUST BE BYTE-IDENTICAL. Half of what follows exists to prove that, because the
 * cheap band is where a calculator belongs and a regression there would cost every ordinary build.
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeRequest,
  signalsCouldNotRead,
  enumeratedParts,
  scriptNeutralFloor,
  UNREADABLE_LETTER_SHARE,
  MIN_LETTERS_TO_JUDGE_SCRIPT,
  FLOOR_PARTS_MANY,
  FLOOR_PARTS_FEW,
} from '../src/server/AgentV3/RequestAnalyser';
import { scorerCouldNotRead, needsSecondOpinion } from '../src/server/AgentV3/complexityRouting';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/** The real report's shape: a multi-feature spec, comma-separated, in one Indian script. */
const HINDI_HOSPITAL = 'एक अस्पताल प्रबंधन ऐप बनाओ जिसमें डॉक्टर लॉगिन, मरीज़ रिकॉर्ड, अपॉइंटमेंट बुकिंग, बिलिंग, दवा स्टॉक, लैब रिपोर्ट, स्टाफ हाज़िरी और एडमिन डैशबोर्ड हों';
const TELUGU_CALCULATOR = 'ఒక సాధారణ కాలిక్యులేటర్ యాప్ తయారు చేయండి';

describe('🔒 ONE implementation of "could the signals read this?", not two that agree today', () => {
  it('complexityRouting\'s name is RequestAnalyser\'s function — the same object, not a copy', () => {
    // A copy would pass every behavioural test on the day it was written. Identity is the only
    // assertion that keeps failing once someone re-inlines it. (CLAUDE.md: four drifted copies of
    // `safeRelPath` → one shared module.)
    expect(scorerCouldNotRead).toBe(signalsCouldNotRead);
  });

  it('and the routing question it was written for still gets the same answer', () => {
    expect(needsSecondOpinion(analyzeRequest({ prompt: HINDI_HOSPITAL }).complexityScore, HINDI_HOSPITAL)).toBe(true);
  });
});

describe('signalsCouldNotRead — script-agnostic, because India is not one script', () => {
  it('says so for every Indian script a real user might type in', () => {
    for (const p of [
      HINDI_HOSPITAL,
      'એક હોસ્પિટલ મેનેજમેન્ટ એપ બનાવો',            // Gujarati
      'একটি হাসপাতাল ব্যবস্থাপনা অ্যাপ তৈরি করুন',      // Bengali
      'ஒரு மருத்துவமனை மேலாண்மை செயலியை உருவாக்கவும்',   // Tamil
      'ಒಂದು ಆಸ್ಪತ್ರೆ ನಿರ್ವಹಣೆ ಅಪ್ಲಿಕೇಶನ್ ಮಾಡಿ',              // Kannada
      TELUGU_CALCULATOR,
    ]) expect(signalsCouldNotRead(p), p).toBe(true);
  });

  it('🔒 romanized Hinglish is READABLE and must stay false — the patterns really do read it', () => {
    expect(signalsCouldNotRead('ek todo app banao jisme login ho')).toBe(false);
    expect(signalsCouldNotRead('mujhe ek hospital management app chahiye with billing')).toBe(false);
    expect(signalsCouldNotRead('build me a hospital management app with billing')).toBe(false);
  });

  it('one foreign-script word inside an English sentence is not an unread request', () => {
    expect(signalsCouldNotRead('build a todo app, call it मेरा ऐप')).toBe(false);
  });

  it('two words are not a sample, and emoji are not letters', () => {
    expect(signalsCouldNotRead('ऐप')).toBe(false);
    expect(signalsCouldNotRead('')).toBe(false);
    expect(signalsCouldNotRead('🎨🎨🎨🎨🎨🎨🎨🎨🎨🎨🎨🎨🎨🎨')).toBe(false);
    expect(MIN_LETTERS_TO_JUDGE_SCRIPT).toBe(12);
    expect(UNREADABLE_LETTER_SHARE).toBe(0.25);
  });
});

describe('enumeratedParts — counting without reading a word', () => {
  it('counts a comma list in a script it cannot read', () => {
    expect(enumeratedParts(HINDI_HOSPITAL)).toBeGreaterThanOrEqual(FLOOR_PARTS_MANY);
  });

  it('counts bullet lines and numbered lines the same way', () => {
    expect(enumeratedParts('- लॉगिन\n- रिकॉर्ड\n- बिलिंग\n- रिपोर्ट')).toBe(4);
    expect(enumeratedParts('1. लॉगिन\n2. रिकॉर्ड\n3. बिलिंग')).toBe(3);
  });

  it('a single request is one part, and punctuation does not inflate the count', () => {
    expect(enumeratedParts(TELUGU_CALCULATOR)).toBe(1);
    expect(enumeratedParts('कैलकुलेटर,,,  , .')).toBe(1);
  });
});

describe('scriptNeutralFloor — evidence, or nothing at all', () => {
  it('no size evidence ⇒ no floor, so a small foreign-script app stays as cheap as today', () => {
    expect(scriptNeutralFloor(TELUGU_CALCULATOR)).toBe(0);
  });

  it(`${FLOOR_PARTS_FEW}+ enumerated parts ⇒ out of the cheapest band, nowhere near the heaviest`, () => {
    const few = 'एक ऐप बनाओ: लॉगिन, रिकॉर्ड, रिपोर्ट';
    expect(enumeratedParts(few)).toBeGreaterThanOrEqual(FLOOR_PARTS_FEW);
    expect(enumeratedParts(few)).toBeLessThan(FLOOR_PARTS_MANY);
    expect(scriptNeutralFloor(few)).toBe(30); // BASE_SCORE.coding — an existing band, not a new one
  });

  it(`${FLOOR_PARTS_MANY}+ parts ⇒ the band its ENGLISH equivalent already lands in`, () => {
    expect(scriptNeutralFloor(HINDI_HOSPITAL)).toBe(58); // BASE_SCORE.complex_app
    // …and a long spec qualifies on length alone, however it is punctuated.
    expect(scriptNeutralFloor('अ'.repeat(900))).toBe(58);
  });
});

describe('🔴 analyzeRequest finally tells the truth about what it read', () => {
  it('THE DEFECT: the biggest app in this file no longer scores like small talk', () => {
    const a = analyzeRequest({ prompt: HINDI_HOSPITAL });
    // REVERSION GUARD. Before this change the number here was 5 and `ambiguous` was false.
    expect(a.complexityScore).not.toBe(5);
    expect(a.complexityScore).toBeGreaterThanOrEqual(58);
    expect(a.unreadable).toBe(true);
    expect(a.ambiguous).toBe(true);
    expect(a.startTier).toBe('sonnet');
    expect(a.reasoning).toContain('cannot read this script');
  });

  it('🔒 it lands in the band its English equivalent already lands in — no new path', () => {
    const english = analyzeRequest({ prompt: 'build a hospital management system with doctor login, patient records, appointment booking, billing, pharmacy stock, lab reports, staff attendance and an admin dashboard' });
    const hindi = analyzeRequest({ prompt: HINDI_HOSPITAL });
    expect(hindi.startTier).toBe(english.startTier);
    expect(hindi.escalationPath).toEqual(english.escalationPath);
  });

  it('a SHORT foreign-script request stays cheap — the floor needs evidence, not a script', () => {
    const a = analyzeRequest({ prompt: TELUGU_CALCULATOR });
    expect(a.complexityScore).toBe(5);    // unchanged: no size evidence to floor on
    expect(a.startTier).toBe('gemini');   // still the cheapest band
    expect(a.unreadable).toBe(true);      // …but it no longer CLAIMS it understood the request
    expect(a.ambiguous).toBe(true);       // so a caller may buy a cheap second opinion
    expect(a.reasoning).toContain('no script-neutral size evidence');
  });

  it('the floor only ever RAISES — a readable heavy signal is never talked back down', () => {
    // Mostly Devanagari, so `signalsCouldNotRead` is true, but `architecture` still matched.
    const a = analyzeRequest({ prompt: 'एक स्केलेबल microservice architecture डिज़ाइन करो जिसमें बहुत सारे मॉड्यूल हों' });
    expect(a.unreadable).toBe(true);
    expect(a.complexityScore).toBeGreaterThanOrEqual(80);
  });
});

describe('🔒 the English / Hinglish path is byte-identical', () => {
  const cases: [string, number, string][] = [
    ['make a calculator', 15, 'gemini'],
    ['hello there', 5, 'gemini'],
    ['write a react component for a button', 30, 'haiku'],
    ['design a scalable microservice architecture', 95, 'sonnet'],
    ['ek todo app banao', 15, 'gemini'],
  ];
  for (const [prompt, score, tier] of cases) {
    it(`"${prompt}" → ${score} / ${tier}, and never marked unreadable`, () => {
      const a = analyzeRequest({ prompt });
      expect(a.complexityScore).toBe(score);
      expect(a.startTier).toBe(tier);
      expect(a.unreadable).toBe(false);
      expect(a.reasoning).not.toContain('cannot read this script');
    });
  }

  it('a pinned PAID tier still bypasses the ladder, and still reports honestly', () => {
    const a = analyzeRequest({ prompt: HINDI_HOSPITAL, powerMode: true, pinnedModel: 'sonnet' });
    expect(a.startTier).toBe('sonnet');
    expect(a.complexityScore).toBe(100);
    expect(a.ambiguous).toBe(false);   // nothing to refine — the tier is pinned
    expect(a.unreadable).toBe(true);   // …but the report must not claim we read it
  });
});

describe('🔒 the report says when the scorer could not read the request', () => {
  it('records the flag for an unreadable prompt', () => {
    const d = new BuildDiagnostics('w1', 'b1');
    d.setRequestAnalysis(analyzeRequest({ prompt: HINDI_HOSPITAL }));
    expect(d.report().requestAnalysis?.signalsCouldNotRead).toBe(true);
  });

  it('and leaves an ordinary English build byte-identical — the key is ABSENT, not false', () => {
    const d = new BuildDiagnostics('w2', 'b2');
    d.setRequestAnalysis(analyzeRequest({ prompt: 'make a calculator' }));
    const ra = d.report().requestAnalysis;
    expect(ra?.taskType).toBe('simple_app');
    expect(Object.prototype.hasOwnProperty.call(ra ?? {}, 'signalsCouldNotRead')).toBe(false);
  });
});
