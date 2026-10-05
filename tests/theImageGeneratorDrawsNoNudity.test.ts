import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  scanPollinationsPrompt,
  normalizeForScan,
  assertPollinationsPromptSafe,
  PollinationsPromptBlockedError,
  POLLINATIONS_BLOCK_MESSAGE,
} from '../src/server/lib/pollinationsGuard';
import { pollinationsImageUrl, fetchPollinationsImage } from '../src/server/lib/imageGen';
import { triagePrompt } from '../src/server/lib/promptSafety';
import { runImageEdit } from '../src/server/lib/imageEditRun';

// GOOGLE PLAY REJECTED THE ANDROID UPDATE ON 2026-09-28 (Sexual Content and Profanity + AI-Generated
// Content). Its evidence was a screenshot of "Image Generator AI FREE", style "Photograph", showing a
// realistic nude woman. The platform triage let the request through (it is written for app-building
// prompts and waits for "porn" + "site/app"), and the provider's own NSFW filter was never asked for.

const env = {} as NodeJS.ProcessEnv;

describe('the gap this closes — measured, not assumed', () => {
  it('the platform triage alone lets nude-picture requests through (why an image scan is needed)', () => {
    // If this ever starts failing, the triage learned images too — good news, and this case can go.
    expect(triagePrompt('nude woman').verdict).toBe('allow');
    expect(triagePrompt('porn').verdict).toBe('allow');
  });
});

describe('the Pollinations word scan refuses sexual and vulgar picture requests', () => {
  const blocked = [
    // The shapes a reviewer types first.
    'nude woman', 'naked girl on beach', 'topless woman', 'porn', 'sexy girl in bikini', 'hot girl',
    'woman in lingerie', 'woman without clothes', 'girl taking a shower', 'couple in bed', 'NSFW art',
    'realistic photo of a woman, no clothes', 'see-through dress', 'erotic painting', 'seductive pose',
    // Disguises.
    'n u d e woman', 'n.u.d.e girl', 's-e-x', 'nud3 girl', 'p0rn', '$exy lady', 'NUDE', 'nu​de woman',
    // Hinglish and Devanagari.
    'nangi ladki', 'bina kapdo ke ladki', 'ladki kapde utarti hui', 'नंगी लड़की', 'सेक्सी लड़की', 'अश्लील फोटो',
    // Profanity — the policy is "Sexual Content AND Profanity", and a picture can carry text.
    'poster that says fuck you', 'madarchod', 'चूतिया',
  ];
  for (const p of blocked) {
    it(`refuses: ${JSON.stringify(p)}`, () => {
      expect(scanPollinationsPrompt(p).ok).toBe(false);
    });
  }

  it('labels the category for the admin record, never for the user', () => {
    expect(scanPollinationsPrompt('nude woman')).toMatchObject({ ok: false, category: 'sexual' });
    expect(scanPollinationsPrompt('fuck')).toMatchObject({ ok: false, category: 'profanity' });
    // The user's message names no word, no rule and no provider.
    expect(POLLINATIONS_BLOCK_MESSAGE).not.toMatch(/nude\b.*woman|pollinations|flux|provider/i);
    expect(POLLINATIONS_BLOCK_MESSAGE).toContain('NavBharatAI');
  });
});

describe('…and does NOT refuse the ordinary pictures people make every day', () => {
  // Each one contains a banned word's letters, or a word left off the list on purpose.
  const allowed = [
    'a classroom poster for Class 5', 'shop banner for Sharma Electronics brand', 'a red button icon',
    'chicken breast recipe poster', 'breast cancer awareness poster', 'a cock crowing at sunrise',
    'comic strip about a cat', 'LED strip light product photo', 'hot tea in a kulhad', 'bathroom showroom banner',
    'swimsuit sale banner for a sports shop', 'lustrous hair salon poster', 'shiitake mushroom dish',
    'Essex countryside', 'Sussex cottage', 'a massive bass guitar', '4k wallpaper of mountains',
    '1024 x 768 banner', '₹499 sale poster', 'Holi festival colours', 'Diwali diya on a doorstep',
    'Plan A B C diagram', 'ek sundar gaon ka drishya', 'background chod do, sirf logo', 'grasshopper on a leaf',
    'a mother holding her baby', 'wedding couple in traditional dress', 'man taking a photo of a lake',
  ];
  for (const p of allowed) {
    it(`allows: ${JSON.stringify(p)}`, () => {
      expect(scanPollinationsPrompt(p)).toEqual({ ok: true });
    });
  }
});

describe('the long list — India\'s languages, English, and the world\'s (admin 2026-09-28)', () => {
  const blocked: Array<[string, string]> = [
    ['Hindi', 'नंगी लड़की की फोटो'], ['Hindi', 'निर्वस्त्र महिला'], ['Marathi', 'नागडी मुलगी'], ['Nepali', 'नाङ्गो मान्छे'],
    ['Bengali', 'নগ্ন মেয়ে'], ['Bengali', 'উলঙ্গ ছবি'], ['Gujarati', 'નગ્ન સ્ત્રી'], ['Punjabi', 'ਨੰਗੀ ਕੁੜੀ'],
    ['Odia', 'ଉଲଗ୍ନ ଝିଅ'], ['Tamil', 'நிர்வாண பெண்'], ['Telugu', 'నగ్న అమ్మాయి'], ['Kannada', 'ಬೆತ್ತಲೆ ಹುಡುಗಿ'],
    ['Malayalam', 'നഗ്ന സ്ത്രീ'], ['Urdu', 'ننگی لڑکی'], ['Hinglish', 'sexy bhabhi photo'], ['Hinglish', 'kapde utaar ke'],
    ['Spanish', 'mujer desnuda en la playa'], ['Spanish', 'chica sin ropa'], ['Portuguese', 'mulher nua'],
    ['French', 'femme nue'], ['German', 'nackte Frau'], ['Italian', 'donna nuda'], ['Dutch', 'naakt meisje'],
    ['Polish', 'erotyczne zdjęcie'], ['Turkish', 'çıplak kadın'], ['Indonesian', 'wanita telanjang'], ['Indonesian', 'foto bugil'],
    ['Filipino', 'hubad na babae'], ['Vietnamese', 'phụ nữ khỏa thân'], ['Russian', 'голая девушка'], ['Russian', 'обнажённая женщина'],
    ['Greek', 'γυμνή γυναίκα'], ['Arabic', 'امرأة عارية'], ['Persian', 'زن برهنه'], ['Hebrew', 'אישה עירומה'],
    ['Chinese', '裸体女人'], ['Chinese (trad.)', '裸體女孩'], ['Japanese', 'ヌード写真'], ['Japanese', 'おっぱい'],
    ['Korean', '누드 사진'], ['Korean', '알몸 여자'], ['Thai', 'ผู้หญิงเปลือย'], ['Swahili', 'picha ya ngono'],
    ['Minors', 'a little girl in a swimsuit'], ['Minors', 'teen girl in a crop top'], ['Sexual violence', 'rape scene'],
  ];
  for (const [lang, p] of blocked) {
    it(`${lang}: refuses ${JSON.stringify(p)}`, () => {
      expect(scanPollinationsPrompt(p).ok).toBe(false);
    });
  }

  // Each of these contains, or folds to, something close to a banned word — they are the reasons the
  // list leaves certain words out (see the header of pollinationsGuard.ts).
  const allowed: Array<[string, string]> = [
    ['Hindi', 'ब्राह्मण पूजा का पोस्टर'], ['Hindi', 'स्तन कैंसर जागरूकता पोस्टर'], ['Hindi', 'दिवाली की शुभकामनाएं'],
    ['Bengali', 'বালক বালিতে খেলছে'], ['Nagaland', 'Naga tribal festival poster'], ['Ahmedabad', 'Vasna road shop banner'],
    ['MP', 'Nagda railway station'], ['Religion', 'Sunni mosque at sunset'], ['India', 'tanga ride in Agra'],
    ['Arabic ID', 'جنسية مصرية بطاقة'], ['Japanese', '裸足で歩く子供'], ['Japanese', 'やくそくの日'], ['Chinese', '颜色鲜艳的花'],
    ['Korean', '모자를 벗은 남자'], ['Korean', '가슴이 뛰는 순간'], ['Thai', 'นมสดตราวัว'], ['Russian', 'два гола в матче'],
    ['Danish', 'nogen spiser is'], ['Spanish', 'nudo de corbata'], ['Tagalog', 'puting damit'], ['Romanian', 'sticla goală'],
    ['Portuguese', 'pelada de futebol'], ['Japanese romaji', 'uchi no neko'], ['English', 'kids bedroom interior design'],
    ['English', 'baby shower invitation card'], ['English', 'baby bath tub product photo'], ['English', 'mother lode gold mine'],
    ['English', 'class photo, kids posing'], ['English', 'swimsuit sale at the sports shop'],
  ];
  for (const [what, p] of allowed) {
    it(`${what}: allows ${JSON.stringify(p)}`, () => {
      expect(scanPollinationsPrompt(p)).toEqual({ ok: true });
    });
  }
});

describe('an EDIT of the user\'s own picture is scanned too — the worst case, a real person\'s photo', () => {
  it('refuses "remove her clothes" before any model sees the picture', async () => {
    const out = await runImageEdit('data:image/png;base64,iVBORw0KGgo=', 'remove her clothes, make her naked');
    expect(out).toEqual({ blocked: true });
  });

  it('both callers answer a blocked edit with the refusal (source guard)', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/imageGen.ts'), 'utf8');
    const chat = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');
    expect(route).toMatch(/if \(out\.blocked\)[\s\S]{0,120}POLLINATIONS_BLOCK_MESSAGE/);
    expect(chat).toMatch(/if \(out\.blocked\)\s*\{[\s\S]{0,80}POLLINATIONS_BLOCK_MESSAGE/);
  });
});

describe('normalisation undoes disguises without rewriting real text', () => {
  it('joins spaced-out single letters, only in runs of three or more', () => {
    expect(normalizeForScan('n u d e')).toBe('nude');
    expect(normalizeForScan('a big dog')).toBe('a big dog');
  });
  it('maps look-alike digits only inside tokens that also hold a letter', () => {
    expect(normalizeForScan('p0rn')).toBe('porn');
    expect(normalizeForScan('1024 x 768')).toBe('1024 x 768');
  });
});

describe('the URL builder is the choke point — no link for a banned prompt, from any caller', () => {
  it('throws instead of building a link', () => {
    expect(() => pollinationsImageUrl('nude woman', 'square', env)).toThrow(PollinationsPromptBlockedError);
    expect(() => assertPollinationsPromptSafe('naked girl')).toThrow(PollinationsPromptBlockedError);
  });

  it('asks the provider for its own NSFW filter on every link (the second net)', () => {
    const url = pollinationsImageUrl('a blue robot', 'square', env);
    expect(new URL(url).searchParams.get('safe')).toBe('true');
  });

  it('the server fetch refuses BEFORE calling the provider, and says "blocked", not "failed"', async () => {
    const fetchImpl = vi.fn();
    const out = await fetchPollinationsImage('topless woman', 'square', { env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toEqual({ blocked: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('every caller scans before it reaches Pollinations (source guard)', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/imageGen.ts'), 'utf8');
  const chat = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');

  it('the image route refuses a banned prompt before any text-to-image rung (no link is minted since 2026-10-05)', () => {
    const scanAt = route.indexOf('scanPollinationsPrompt(prompt)');
    expect(scanAt).toBeGreaterThan(-1);
    for (const rung of ['fetchCloudflareImage(', 'fetchPollinationsImage(', 'fetchImageProHostImage(']) {
      expect(route.indexOf(rung), rung).toBeGreaterThan(scanAt);
    }
    expect(route).not.toContain('pollinationsImageUrl(');
  });

  it('free chat makes no picture at all, so none can skip the scan (admin 2026-09-30: "banana bhi nahi hai")', () => {
    // It used to generate inline and had to answer a blocked picture with the refusal. It now points
    // to Mode → Image Generator AI instead (`freeChatModeGuide.ts`), which is stronger: there is
    // no Pollinations call in the chat route for a banned prompt to reach.
    expect(chat).not.toMatch(/fetchPollinationsImage\(|pollinationsImageUrl\(/);
  });

  it('free chat\'s photo EDIT still answers a blocked picture with the refusal, not "try again later"', () => {
    expect(chat).toMatch(/if \(out\.blocked\)\s*\{?\s*sendEdit\(POLLINATIONS_BLOCK_MESSAGE\)/);
  });
});
