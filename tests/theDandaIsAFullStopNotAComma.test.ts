/**
 * WHY `।` IS NOT A LIST SEPARATOR — the measurement, locked (2026-09-20).
 *
 * This looks like an omission and will be proposed as a fix again. Both counters exist to read
 * requests the English signals cannot read, and `।` (U+0964) is what Hindi, Bengali, Marathi and
 * Nepali actually type — so "the counter does not know the danda" reads like an India-first bug.
 *
 * It was measured before it was believed, on the same 8-feature school-ERP request in four forms,
 * and the measurement says LEAVE IT ALONE:
 *
 *   1. **Indic script is not the blind spot.** A comma-separated Hindi or Bengali list already
 *      counts correctly — and the comma is what these scripts use for lists.
 *   2. **The danda is the Indic FULL STOP.** Admitting it would score six sentences of Hindi PROSE
 *      as six features while the identical English prose scores one, because the English full stop
 *      is deliberately not a separator here either. That is a penalty aimed at exactly the users it
 *      would be "for" — a fix that trades one problem for a worse one.
 *
 * The gap left behind is real and narrow: someone who writes their LIST with dandas rather than
 * commas is under-counted. That is cheaper than the asymmetry, and it is recorded rather than hidden.
 *
 * ⚠️ `countEnumeratedFeatures` gates Software Project Mode and the mega-roadmap, both of which spend
 * a real planner call — so a false 8 there is charged to somebody describing their shop.
 */
import { describe, it, expect } from 'vitest';
import { countEnumeratedFeatures } from '../src/server/AgentV3/enumeratedFeatures';
import { enumeratedParts } from '../src/server/AgentV3/RequestAnalyser';

const LIST_EN = 'Build a school ERP. students, teachers, attendance, fees, exams, timetable, library, transport';
const LIST_HI = 'स्कूल ईआरपी बनाओ जिसमें छात्र, शिक्षक, उपस्थिति, फीस, परीक्षा, समय सारणी, पुस्तकालय, परिवहन हो।';
const LIST_BN = 'স্কুল ইআরপি বানাও যাতে ছাত্র, শিক্ষক, উপস্থিতি, ফি, পরীক্ষা, সময়সূচী, গ্রন্থাগার, পরিবহন থাকে।';

const PROSE_EN = 'I want an app for my shop. It should look modern. My customers are local. I am not technical. Please keep it simple. Make it fast.';
const PROSE_HI = 'मुझे अपनी दुकान के लिए ऐप चाहिए। यह आधुनिक दिखना चाहिए। मेरे ग्राहक स्थानीय हैं। मैं तकनीकी नहीं हूँ। कृपया इसे सरल रखें। इसे तेज़ बनाएं।';
const PROSE_BN = 'আমার দোকানের জন্য একটি অ্যাপ চাই। এটি আধুনিক দেখতে হবে। আমার গ্রাহকরা স্থানীয়। আমি প্রযুক্তিবিদ নই। দয়া করে সহজ রাখুন। দ্রুত বানান।';

describe('the danda is a full stop, not a comma', () => {
  it('an Indic list written with COMMAS already counts — the script is not the blind spot', () => {
    expect(countEnumeratedFeatures(LIST_EN)).toBeGreaterThanOrEqual(6);
    expect(countEnumeratedFeatures(LIST_HI)).toBeGreaterThanOrEqual(6);
    expect(countEnumeratedFeatures(LIST_BN)).toBeGreaterThanOrEqual(6);
    for (const list of [LIST_EN, LIST_HI, LIST_BN]) expect(enumeratedParts(list)).toBeGreaterThanOrEqual(6);
  });

  it('🔒 PROSE scores the SAME in every script — this is what admitting `।` would break', () => {
    // The asymmetry guard. If a later change teaches either counter the danda, the Indic rows jump
    // to 6 while English stays at 1, and these expectations are what say so.
    expect(enumeratedParts(PROSE_EN)).toBe(1);
    expect(enumeratedParts(PROSE_HI)).toBe(1);
    expect(enumeratedParts(PROSE_BN)).toBe(1);
    expect(countEnumeratedFeatures(PROSE_EN)).toBe(0);
    expect(countEnumeratedFeatures(PROSE_HI)).toBe(0);
    expect(countEnumeratedFeatures(PROSE_BN)).toBe(0);
  });

  it('states the parity as one claim, so a drift in EITHER direction fails', () => {
    // English and Indic prose must agree, whatever the number is. Written as a comparison rather
    // than two constants so a future change that moves both stays green and one that splits them
    // cannot.
    expect(enumeratedParts(PROSE_HI)).toBe(enumeratedParts(PROSE_EN));
    expect(enumeratedParts(PROSE_BN)).toBe(enumeratedParts(PROSE_EN));
    expect(countEnumeratedFeatures(PROSE_HI)).toBe(countEnumeratedFeatures(PROSE_EN));
    expect(countEnumeratedFeatures(PROSE_BN)).toBe(countEnumeratedFeatures(PROSE_EN));
  });

  it('the reason is recorded where the change would be made, not only here', () => {
    // A doc claim in a test file is not read by someone editing a regex. Both separator sites carry
    // the measurement, so the proposal meets it before it is written.
    const { readFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const ra = readFileSync(join(__dirname, '..', 'src/server/AgentV3/RequestAnalyser.ts'), 'utf8');
    const ef = readFileSync(join(__dirname, '..', 'src/server/AgentV3/enumeratedFeatures.ts'), 'utf8');
    expect(ra).toContain('THE DANDA `।` IS DELIBERATELY NOT HERE');
    expect(ef).toContain('NO DANDA `।` HERE EITHER');
  });
});
