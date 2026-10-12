/**
 * A PICTURE ASKED FOR IN ANY INDIAN LANGUAGE IS ANSWERED AS A PICTURE, NOT BUILT AS AN APP (autopsy 15e69839).
 *
 * The real conversation (Tamil, 2026-10-12):
 *   1. "ஒரு மரத்தில் ஒரு 17 வயது பையன் சாய்ந்திருப்பது மாதிரி உருவாக்கப்படும்" — like a 17-year-old boy leaning on a tree.
 *      The reply said it did not understand, "for example, a shop billing app with GST".
 *   2. "ஓகே ஒருவன் ஜிஎஸ்டி பில் போடுவது மாதிரி கடையில்" — OK, like a man making a GST bill in a shop.
 *      An app was offered; "ஆம்" built a GST billing app for 8 minutes.
 * Three defects, one class — a picture request outside Latin/Devanagari had nowhere to go:
 *   • `detectImageIntent` read only Latin and Devanagari;
 *   • the intention reader, the one part that reads Tamil, had no "picture" answer;
 *   • the clarifying reply planted an app example the user copied.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectImageIntent } from '../src/server/lib/imageIntent';
import { isPictureRequest, CLARIFY_WHAT_TO_MAKE_STEER } from '../src/server/AgentV3/pictureRequest';
import { classifyIntentSmartDetailed } from '../src/server/AgentV3/IntentClassifier';

const REAL_1 = 'ஒரு மரத்தில் ஒரு 17 வயது பையன் சாய்ந்திருப்பது மாதிரி உருவாக்கப்படும்';
const REAL_2 = 'ஓகே ஒருவன் ஜிஎஸ்டி பில் போடுவது மாதிரி கடையில்';

describe('the detector reads the nine other Indian scripts', () => {
  it.each([
    ['ta', 'ஒரு படம் உருவாக்கு'],
    ['ta', 'மரத்தின் கீழ் ஒரு பையன் படம் உருவாக்கவும்'],
    ['te', 'ఒక ఫోటో తయారు చేయండి'],
    ['bn', 'একটি ছবি বানাও'],
    ['gu', 'એક ફોટો બનાવો'],
    ['kn', 'ಒಂದು ಚಿತ್ರ ರಚಿಸಿ'],
    ['ml', 'ഒരു ചിത്രം ഉണ്ടാക്കൂ'],
    ['pa', 'ਇੱਕ ਤਸਵੀਰ ਬਣਾਓ'],
    ['ur', 'ایک تصویر بنا دو'],
  ])('%s: "%s" is a picture request', (_s, text) => {
    expect(detectImageIntent(text).wants).toBe(true);
    expect(isPictureRequest(text)).toBe(true);
  });

  it('🔒 naming an APP in that script keeps it a build — "a picture app" is software', () => {
    expect(isPictureRequest('படம் எடிட் செய்யும் ஆப் உருவாக்கு')).toBe(false);
    expect(isPictureRequest('ఫోటో యాప్ తయారు చేయండి')).toBe(false);
  });

  it('a picture noun with no make verb is not an order', () => {
    expect(detectImageIntent('இந்த படம் நல்லா இருக்கு').wants).toBe(false);
  });
});

describe('the intention reader has a picture answer', () => {
  it('🔒 the real first message, read as "picture", comes back flagged — the keyword intent untouched', async () => {
    const r = await classifyIntentSmartDetailed(REAL_1, async () => 'picture');
    expect(r.picture).toBe(true);
    expect(r.unclear).toBe(false);
    expect(r.intent).toBe('chat');
  });

  it('the reader is told what a scene is, and that "picture" is an answer', async () => {
    let asked = '';
    await classifyIntentSmartDetailed(REAL_2, async (p) => { asked = p; return 'picture'; });
    expect(asked).toMatch(/picture — they want a PICTURE made/);
    expect(asked).toMatch(/A DESCRIPTION OF A SCENE/);
    expect(asked).toMatch(/chat, help, build, edit, unclear, or picture/);
  });

  it('every earlier answer is unchanged', async () => {
    expect((await classifyIntentSmartDetailed(REAL_2, async () => 'build')).intent).toBe('new_build');
    expect((await classifyIntentSmartDetailed(REAL_2, async () => 'unclear')).unclear).toBe(true);
    expect((await classifyIntentSmartDetailed(REAL_2, async () => 'chat')).picture).toBeUndefined();
  });
});

describe('the route answers it before any offer to build', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('🔒 a reader-seen picture turns the turn into chat BEFORE the build offer is considered', () => {
    const picAt = route.indexOf('const readerPicture = readerSaysPicture');
    const offerAt = route.indexOf('const buildCheck = buildConfirmationEnabled()');
    expect(picAt).toBeGreaterThan(0);
    expect(picAt).toBeLessThan(offerAt);
    expect(route).toMatch(/const readerPicture = readerSaysPicture && pictureAnswerEnabled\(\) && !userAppExists && !importingThisTurn;/);
    expect(route).toMatch(/!answerSpreadsheet && \(readerPicture \|\| shouldAnswerPictureRequest\(/);
  });

  it('an accepted offer or an answered framework question clears the flag — they are not new requests', () => {
    expect(route.match(/^\s+readerSaysPicture = false;/gm)?.length).toBe(2);
  });
});

describe('the clarifying reply never plants one shape', () => {
  it('🔒 it asks app OR picture, with an example of each, and says where pictures are made', () => {
    expect(CLARIFY_WHAT_TO_MAKE_STEER).toMatch(/an APP built here or a PICTURE made/);
    expect(CLARIFY_WHAT_TO_MAKE_STEER).toMatch(/example of each, never just one/);
    expect(CLARIFY_WHAT_TO_MAKE_STEER).toMatch(/AI Image Gen/);
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('(clarifyWhatToBuild ? CLARIFY_WHAT_TO_MAKE_STEER');
    expect(route).not.toMatch(/for instance a shop billing app "\s*\+\s*"with GST\)/);
  });
});
