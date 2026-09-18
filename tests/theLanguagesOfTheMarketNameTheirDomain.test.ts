import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  INDIC_DOMAIN_TERMS, indicDomainKeys, indicDomainMatches, usesIndicScript,
} from '../src/server/lib/indicDomainTerms';
import { analyzeRequirementGaps, detectIndiaContext } from '../src/server/lib/RequirementGapAnalyzer';
import { namesBusinessDomain } from '../src/server/lib/appComplexitySignals';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';

/**
 * 🔴 THE BUG: A HOSPITAL SYSTEM ASKED FOR IN TAMIL SCORED 5 — THE SCORE OF "hi".
 *
 * `RequirementGapAnalyzer`'s domain regexes were English, with romanised Hindi and then Devanagari
 * appended by hand. A prompt in Bengali, Tamil, Telugu, Urdu, Gujarati, Kannada, Malayalam, Punjabi or
 * Odia therefore named NO domain: `analyzeRequirementGaps` returned `general`, `namesBusinessDomain`
 * returned false, and `RequestAnalyser` — whose last resort asks exactly that question — fell to `chat`
 * at `BASE_SCORE` 5. Everything that reads the score followed it down: 80 steps instead of 150, no
 * blueprint, a small-app ETA, and the cheap flash rung instead of Kimi.
 *
 * Second bug, same file, same cause: `INDIA_CONTEXT_RE` names the languages in ENGLISH ("hindi",
 * "tamil"), so a prompt typed entirely IN one of those scripts was not recognised as an Indian-market
 * prompt and `indiaFirstGuidance` (₹, UPI, DD/MM/YYYY) never reached the builder.
 *
 * Both are fixed in `indicDomainTerms.ts`. This file pins the corpus — the INFLECTED forms people
 * actually type, and the ordinary words that CONTAIN a domain term and must never fire.
 */

const ROOT = process.cwd();
const analyzerSource = readFileSync(join(ROOT, 'src/server/lib/RequirementGapAnalyzer.ts'), 'utf8');

/** Domain keys as WRITTEN in the analyzer, so a typo in the terms table cannot become a dead language. */
function domainKeysInSource(): string[] {
  const block = analyzerSource.slice(
    analyzerSource.indexOf('const DOMAINS: DomainDef[]'),
    analyzerSource.indexOf('const GENERIC_FEATURES'),
  );
  return [...block.matchAll(/^\s{4}key: '([a-z-]+)',$/gm)].map((m) => m[1]);
}

describe('the table is wired to the real domains, not to names nobody reads', () => {
  it('every key in the terms table is a domain the analyzer actually defines', () => {
    const real = domainKeysInSource();
    expect(real.length).toBeGreaterThanOrEqual(13);
    for (const key of indicDomainKeys()) expect(real, `unknown domain key '${key}'`).toContain(key);
  });

  it('the domains left out are left out ON PURPOSE — acronym-led, and named in the header', () => {
    // `saas` / `crm` / `productivity` are carried by English acronyms and phrases ("B2B", "sales
    // pipeline", "kanban") that Indic-language prompts write in English anyway. Their absence is a
    // decision recorded in the module header; this asserts the decision, so adding one is deliberate.
    for (const key of ['saas', 'crm', 'productivity']) expect(indicDomainKeys()).not.toContain(key);
  });

  it('no term is ASCII-only, blank, padded or duplicated within its domain', () => {
    for (const [key, terms] of Object.entries(INDIC_DOMAIN_TERMS)) {
      expect(new Set(terms).size, `${key} repeats a term`).toBe(terms.length);
      for (const t of terms) {
        expect(t.trim(), `${key}: '${t}' is padded or blank`).toBe(t);
        expect(t.replace(/\+$/, '').length, `${key}: '${t}' is too short to be safe`).toBeGreaterThan(1);
        expect(/^[\x20-\x7F]+$/.test(t), `${key}: '${t}' is ASCII — it belongs in the regex literal`).toBe(false);
      }
    }
  });

  it('🔒 ONE place decides a domain, and it is the place that asks about the languages', () => {
    // Both readers (the analyzer and the suggestion bulb) used to carry the same filter+reduce inline.
    // If a reader ever goes back to its own copy, every language silently stops reaching it.
    expect(analyzerSource).toContain('indicDomainMatches(d.key, text)');
    expect(analyzerSource.match(/selectDomain\(text\)/g) ?? []).toHaveLength(2);
    expect(analyzerSource).not.toContain('.filter((d) => d.re.test(text))');
  });
});

/** The INFLECTED forms, because a case suffix is how these languages actually attach a noun to a phrase. */
const POSITIVES: ReadonlyArray<readonly [string, string]> = [
  ['healthcare', 'হাসপাতালের রোগীদের জন্য একটি অ্যাপ'],
  ['healthcare', 'மருத்துவமனையில் நோயாளிகளின் பதிவு'],
  ['healthcare', 'ఆసుపత్రిలో రోగుల నిర్వహణ'],
  ['healthcare', 'ہسپتال کے مریضوں کے لیے ایپ'],
  ['healthcare', 'ആശുപത്രിയിലെ രോഗികളുടെ ആപ്പ്'],
  ['healthcare', 'ಆಸ್ಪತ್ರೆಯ ರೋಗಿಗಳ ನಿರ್ವಹಣೆ'],
  ['healthcare', 'દવાખાનાનું સંચાલન અને દર્દીની નોંધ'],
  ['healthcare', 'ଡାକ୍ତରଖାନାର ରୋଗୀ ପଞ୍ଜିକରଣ'],
  ['healthcare', 'ਹਸਪਤਾਲ ਦੇ ਮਰੀਜ਼ਾਂ ਦੀ ਐਪ'],
  ['healthcare', 'रुग्णालयातील रुग्णांची नोंद'],
  ['ecommerce', 'আমার দোকানের জন্য একটি অ্যাপ'],
  ['ecommerce', 'எனது கடை மற்றும் விற்பனையை நிர்வகிக்க'],
  ['ecommerce', 'నా దుకాణంలో అమ్మకాల యాప్'],
  ['ecommerce', 'ನನ್ನ ಅಂಗಡಿಯ ಮಾರುಕಟ್ಟೆ ಆ್ಯಪ್'],
  ['ecommerce', 'મારી દુકાનની ઓર્ડર સિસ્ટમ'],
  ['ecommerce', 'ମୋ ଦୁକାନ ପାଇଁ ଏକ ଆପ୍'],
  ['ecommerce', 'ਮੇਰੀ ਦੁਕਾਨ ਲਈ ਇੱਕ ਐਪ'],
  ['ecommerce', 'دکان کے آرڈر کا نظام'],
  ['education', 'স্কুলের ছাত্রদের হাজিরা'],
  ['education', 'பள்ளியின் மாணவர்களுக்கான செயலி'],
  ['education', 'పాఠశాలలో విద్యార్థుల హాజరు'],
  ['education', 'ಶಾಲೆಯ ವಿದ್ಯಾರ್ಥಿಗಳ ಹಾಜರಾತಿ'],
  ['education', 'സ്കൂളിലെ വിദ്യാർത്ഥികളുടെ ഹാജർ'],
  ['education', 'शाळेतील विद्यार्थ्यांची हजेरी'],
  ['education', 'શાળાના વિદ્યાર્થીઓની હાજરી'],
  ['education', 'ବିଦ୍ୟାଳୟର ଛାତ୍ରମାନଙ୍କ ହାଜରି'],
  ['education', 'اسکول کے طلبہ کی حاضری'],
  ['restaurant', 'রেস্টুরেন্টের মেনুতে নতুন খাবার'],
  ['restaurant', 'உணவகத்தில் மெனு மற்றும் சமையல்'],
  ['restaurant', 'ഭക്ഷണത്തിന്റെ മെനു ആപ്പ്'],
  ['restaurant', 'ਰੈਸਟੋਰੈਂਟ ਦਾ ਮੇਨੂ'],
  ['logistics', 'ডেলিভারির জন্য ট্র্যাকিং'],
  ['logistics', 'விநியோகத்தை கண்காணிக்க'],
  ['logistics', 'ಗೋದಾಮಿನ ಸಾಗಣೆ ಆ್ಯಪ್'],
  ['logistics', 'ڈیلیوری کی ٹریکنگ'],
  ['fintech', 'খাতায় ঋণের হিসাব'],
  ['fintech', 'కడ ఖాతాలో వడ్డీ లెక్క'],
  ['fintech', 'ಖಾತೆಯ ಬಡ್ಡಿ ಲೆಕ್ಕ'],
  ['fintech', 'വായ്പയുടെ പലിശ കണക്ക്'],
  ['fintech', 'கடன்களுக்கு வட்டி கணக்கு'],
  ['fintech', 'ادھار کھاتہ ایپ'],
  ['real-estate', 'ভাড়ার ফ্ল্যাটের তালিকা'],
  ['real-estate', 'வாடகைக்கு வீடு பட்டியல்'],
  ['real-estate', 'అద్దెకు ఇళ్ల జాబితా'],
  ['real-estate', 'ಬಾಡಿಗೆಯ ಮನೆಗಳ ಪಟ್ಟಿ'],
  ['real-estate', 'भाड्याच्या घरांची यादी'],
  ['real-estate', 'کرایہ کے مکان کی لسٹنگ'],
  ['events', 'বিয়ের অনুষ্ঠান পরিকল্পনা'],
  ['events', 'திருமணத்திற்கான செயலி'],
  ['events', 'పెళ్లికి ఆహ్వానం యాప్'],
  ['events', 'ಮದುವೆಯ ಸಮಾರಂಭ ಆ್ಯಪ್'],
  ['events', 'വിവാഹത്തിനുള്ള ആപ്പ്'],
  ['events', 'लग्नाची तयारी करणारे अ‍ॅप'],
  ['jobs', 'চাকরির জন্য একটি অ্যাপ'],
  ['jobs', 'வேலைக்கான செயலி'],
  ['jobs', 'ఉద్యోగాల కోసం యాప్'],
  ['jobs', 'ಉದ್ಯೋಗಗಳ ಆ್ಯಪ್'],
  ['jobs', 'ജോലിക്കുള്ള ആപ്പ്'],
  ['jobs', 'नोकऱ्यांची यादी'],
  ['jobs', 'ਨੌਕਰੀਆਂ ਦੀ ਐਪ'],
  ['social', 'বন্ধুদের সাথে চ্যাট'],
  ['social', 'நண்பர்களுடன் அரட்டை'],
  ['social', 'ಸ್ನೇಹಿತರ ಸಂದೇಶ ಆ್ಯಪ್'],
  ['booking', 'টিকিটের বুকিং অ্যাপ'],
  ['booking', 'முன்பதிவுக்கான செயலி'],
  ['booking', 'ٹکٹ بکنگ ایپ'],
  ['fitness', 'ব্যায়ামের ট্র্যাকার'],
  ['fitness', 'உடற்பயிற்சியை கண்காணிக்க'],
  ['fitness', 'ವ್ಯಾಯಾಮದ ಟ್ರ್ಯಾಕರ್'],
  ['game', 'একটি খেলার অ্যাপ'],
  ['game', 'ஒரு விளையாட்டு செயலி'],
];

describe('a domain named in the language of the market IS a domain', () => {
  it('every prompt resolves to its own domain, end to end', () => {
    for (const [expected, prompt] of POSITIVES) {
      expect(analyzeRequirementGaps(prompt).domain, prompt).toBe(expected);
    }
  });

  it('and the Indic table is what recognised it — not a stray English word in the prompt', () => {
    // Every prompt above is free of Latin letters, so no English alternative in the regex literals can
    // be what fired. This is the behavioural half of the reversion guard.
    for (const [expected, prompt] of POSITIVES) {
      expect(/[A-Za-z]/.test(prompt), `${prompt} contains Latin letters — not a proof`).toBe(false);
      expect(indicDomainMatches(expected, prompt), prompt).toBe(true);
    }
  });

  it('🔑 so the build is SIZED as the app it is: complex_app, not a greeting', () => {
    for (const [, prompt] of POSITIVES) {
      expect(namesBusinessDomain(prompt), prompt).toBe(true);
      const a = analyzeRequest({ prompt });
      expect(a.taskType, prompt).toBe('complex_app');
      expect(a.complexityScore, prompt).toBe(58);
      expect(a.startTier, prompt).toBe('sonnet');
    }
  });
});

/**
 * 🔒 THE COLLISION CORPUS — the whole reason the terms are not pasted into the regexes.
 *
 * JavaScript's `\b` is ASCII-only, so an unanchored Indic term matches inside longer, unrelated words.
 * Each line below is an ordinary sentence that CONTAINS a domain term, and must name no domain at all.
 */
const COLLISIONS: ReadonlyArray<readonly [string, string]> = [
  ['கடைசி பக்கத்தை சரி செய்', 'kadaisi (last) contains kadai (shop)'],
  ['நிலை காட்டும் பட்டி', 'nilai (status) shares its stem with nilam (land)'],
  ['ಈ ಆಲೋಚನೆ ಯೋಗ್ಯವಾಗಿದೆ', 'yogya (suitable) is yoga + virama + a letter — the mark trap'],
  ['ಸಾಲುಗಳನ್ನು ಜೋಡಿಸು', 'saalu (row) contains saala (loan)'],
  ['সুদানের পতাকা দেখাও', 'Sudan contains sud (interest)'],
  ['জিম্বাবুয়ের মানচিত্র', 'Zimbabwe contains jim (gym)'],
  ['দুটি সংখ্যা মেলানো', 'melano (to match) contains mela (fair)'],
  ['একটি পরীক্ষামূলক অ্যাপ', 'porikkhamulok (experimental) contains porikkha (exam)'],
  ['ডেটা সংরক্ষণ করার অ্যাপ', 'songrokkhon is data storage, not a reservation'],
  ['అప్పుడు ఏమి జరిగింది', 'appudu (then) contains appu (loan)'],
  ['ముందు పేజీ చూపించు', 'mundu (front) is one vowel from mandu (medicine)'],
  ['ഇത് കടലാസ് ആണ്', 'kadalaas (paper) contains kada (shop)'],
  ['ഈ കോഡ് പരീക്ഷിക്കുക', 'pareekshikkuka (to test) contains pareeksha (exam)'],
  ['मालिक का डैशबोर्ड बनाओ', 'malik (owner) contains maal (goods) — the original incident'],
  ['यह उपयोग करने में आसान है', 'upyog (use) contains yog (yoga)'],
  ['आरक्षण नीति पर एक लेख', 'aarakshan in India means quota far more often than a booking'],
];

describe('an ordinary word that merely CONTAINS a domain term names no domain', () => {
  it('not one collision fires, in any domain', () => {
    for (const [text, why] of COLLISIONS) {
      const fired = indicDomainKeys().filter((k) => indicDomainMatches(k, text));
      expect(fired, `${text} — ${why}`).toEqual([]);
      expect(analyzeRequirementGaps(text).domain, text).toBe('general');
    }
  });

  it('and an ordinary app request in each script stays small — the cost of a false positive', () => {
    // A wrong `complex_app` is not free: it raises the step cap, adds a blueprint and routes the build
    // to a dearer engine. These must stay exactly where they were before the languages were added.
    for (const prompt of [
      'একটি ছবি আঁকার অ্যাপ বানাও',
      'একটি সাধারণ টাইমার অ্যাপ',
      'ஒரு கால்குலேட்டர் செய்',
      'ஒரு வானிலை செயலி உருவாக்கு',
      'ఒక కాలిక్యులేటర్ యాప్ చేయండి',
      'ಒಂದು ಕ್ಯಾಲ್ಕುಲೇಟರ್ ಆ್ಯಪ್',
      'ഒരു കാൽക്കുലേറ്റർ ആപ്പ്',
      'ایک کیلکولیٹر ایپ بنائیں',
      'ਇੱਕ ਕੈਲਕੁਲੇਟਰ ਐਪ ਬਣਾਓ',
      'નમસ્તે, તમે કેમ છો?',
      'ନମସ୍କାର, ଆପଣ କେମିତି ଅଛନ୍ତି?',
    ]) {
      expect(analyzeRequirementGaps(prompt).domain, prompt).toBe('general');
      expect(namesBusinessDomain(prompt), prompt).toBe(false);
      expect(analyzeRequest({ prompt }).complexityScore, prompt).toBeLessThanOrEqual(20);
    }
  });

  it('🔒 the English corpus is untouched — this change only ADDS scripts', () => {
    for (const [prompt, expected] of [
      ['build a hospital management system with patient records', 'healthcare'],
      ['a restaurant POS with menu, KOT and GST billing', 'restaurant'],
      ['build me a photoshop clone', 'general'],
      ['good job! now fix the bug', 'general'],
      ['make a drawing app', 'general'],
      ['ek dukaan ke liye app banao', 'ecommerce'],
      ['अस्पताल के लिए ऐप बनाओ', 'healthcare'],
    ] as const) {
      expect(analyzeRequirementGaps(prompt).domain, prompt).toBe(expected);
    }
  });

  it('🔒 the same sentence resolves the SAME WAY in every language — ties are not re-decided per script', () => {
    // "a food order app" names two real domains, and `ecommerce` has won that tie in English since the
    // 2026-07-21 fix put the FEATURE score in charge (with no English feature word in an Indic prompt,
    // nothing breaks the tie and array order keeps the earlier domain). That is inherited deliberately:
    // giving the Indic path its own tie-break would make one sentence mean two things in two languages.
    // Fixing the tie itself belongs to whoever changes it for English — for everyone, in one place.
    for (const prompt of [
      'a food order app',
      'খাবার অর্ডার করার অ্যাপ',
      'ഭക്ഷണത്തിന്റെ ഓർഡർ ആപ്പ്',
    ]) expect(analyzeRequirementGaps(prompt).domain, prompt).toBe('ecommerce');
    // …and with no order word, the food word carries it — in English and in Malayalam alike.
    for (const prompt of ['a restaurant menu app', 'ഭക്ഷണത്തിന്റെ മെനു ആപ്പ്']) {
      expect(analyzeRequirementGaps(prompt).domain, prompt).toBe('restaurant');
    }
  });

  it('a pharmacy is healthcare, although its Hindi name ends in the restaurant word for food', () => {
    // `दवाखाना` contains `खाना`. The left boundary is what keeps the restaurant term out of it; this
    // pins the outcome so the tie is a decision rather than something the array order happens to give.
    expect(indicDomainMatches('restaurant', 'दवाखाना के लिए ऐप')).toBe(false);
    expect(analyzeRequirementGaps('दवाखाना के लिए ऐप बनाओ').domain).toBe('healthcare');
  });
});

describe('a prompt written in an Indian script is an Indian-market prompt', () => {
  it('all nine Indic scripts count, so ₹ / UPI / DD-MM-YYYY defaults reach the builder', () => {
    for (const t of [
      'अस्पताल', 'হাসপাতাল', 'ਹਸਪਤਾਲ', 'હોસ્પિટલ', 'ଡାକ୍ତରଖାନା',
      'மருத்துவமனை', 'ఆసుపత్రి', 'ಆಸ್ಪತ್ರೆ', 'ആശുപത്രി',
    ]) {
      expect(usesIndicScript(t), t).toBe(true);
      expect(detectIndiaContext(t), t).toBe(true);
    }
  });

  it('⚠️ Urdu is NOT claimed by script — it shares one with Arabic and Persian', () => {
    // The honest limit, stated in the module header: a script test on Arabic would declare an Arabic
    // prompt to be for the Indian market. Urdu's DOMAIN terms still work; only this signal abstains.
    expect(usesIndicScript('ہسپتال')).toBe(false);
    expect(detectIndiaContext('ہسپتال کے لیے ایپ')).toBe(false);
    expect(analyzeRequirementGaps('ہسپتال کے لیے ایپ').domain).toBe('healthcare');
  });

  it('🔎 the ranges AGREE with the per-language table that owns them, so the two copies cannot drift', () => {
    // `AgentV3/LanguageDetect.ts` enumerates these nine scripts to decide which language to write an
    // app's LABELS in. This module asks a different question (see its header) and so keeps its own
    // contiguous range — but the ranges themselves are the same fact, and a fact stated twice drifts.
    // This derives the invariant from the table that owns it rather than restating any number.
    const src = readFileSync(join(ROOT, 'src/server/AgentV3/LanguageDetect.ts'), 'utf8');
    const rows = [...src.matchAll(/\{ code: '(\w+)', name: '[^']+', ranges: \[\[0x([0-9a-f]+), 0x([0-9a-f]+)\]\]/g)];
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const INDIC = ['hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml'];
    const seen: string[] = [];
    for (const [, code, lo, hi] of rows) {
      const inside = usesIndicScript(String.fromCodePoint(parseInt(lo, 16) + 5))
        && usesIndicScript(String.fromCodePoint(parseInt(hi, 16) - 5));
      if (INDIC.includes(code)) { seen.push(code); expect(inside, `${code} must be Indic`).toBe(true); }
      else expect(inside, `${code} must NOT be Indic`).toBe(false);
    }
    expect(seen.sort()).toEqual([...INDIC].sort());
  });

  it('and neither Latin nor Sinhala is mistaken for one', () => {
    expect(usesIndicScript('build a hospital app')).toBe(false);
    expect(usesIndicScript('ශ්‍රී ලංකා')).toBe(false);
    expect(detectIndiaContext('build a hospital app')).toBe(false);
  });

  it('every existing India signal still fires on its own', () => {
    for (const t of ['₹500 pricing', 'add GST', 'pay by UPI', 'for the Indian market', 'in Hindi']) {
      expect(detectIndiaContext(t), t).toBe(true);
    }
  });
});
