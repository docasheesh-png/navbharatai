/**
 * THE SIZER READS HINDI THE WAY HINDI IS TYPED (queue Q-104, 2026-10-04).
 *
 * 🔴 THE DEFECT. Every size signal — `RequestAnalyser`'s lists, the shared `COMPLEX_APP_SIGNAL`, the ETA's
 * feature counter — is written in Latin letters. A Hindi request in Devanagari names the same features with
 * the same words, only spelled in Devanagari: "लॉगिन, पेमेंट, कार्ट और एडमिन पैनल" is login, payment, cart and
 * admin panel. Measured before this change, with the platform's own `new_build` decision passed in:
 *
 *   | request (Hindi)                                         | Hindi      | the same in English |
 *   |---------------------------------------------------------|------------|---------------------|
 *   | ई-कॉमर्स ऐप … लॉगिन, पेमेंट, कार्ट और एडमिन पैनल        | 30         | complex_app 58      |
 *   | चैट ऐप … रियल टाइम मैसेज                                | 15         | complex_app 58      |
 *   | एक कैलकुलेटर ऐप बनाओ                                     | app_unsized| simple_app          |
 *
 * So a Hindi user's complex app opened on the cheap rung with a small app's ETA — the price of writing in
 * their own script. The script-neutral floor (`signalsCouldNotRead`) only counts commas; it cannot tell a
 * payment from a colour.
 *
 * 🔑 THE CLASS: signals written in one script, read against a request in another. Adding Devanagari to each
 * list would be eleven drifting copies; this is ONE glossary, applied once where the request ENTERS each
 * sizer (`RequestAnalyser.classify`, `BuildTimeEstimator.complexityFromPrompt`), so every signal — and every
 * signal added later — reads it.
 *
 * 🔒 HOW IT IS READ. `withEnglishReading` keeps the original text and adds the English reading on its own
 * LINE: the Devanagari-reading guards (`DOCUMENT_DELIVERABLE_SIGNAL`, the domain words) still see the
 * original, the Latin signals see the English, and the proximity patterns (`[^.?!\n]{0,60}`) cannot join a
 * word from one reading to a word in the other. A text with nothing to gloss is returned unchanged — an
 * English or Hinglish request is byte-identical to before. A counter must use `glossDevanagari` alone, never
 * the two-line form, or every comma would count twice.
 *
 * ⚠️ PRECISION FIRST. Only words that MEAN one software thing are here — loanwords people type for app
 * features, and a few native words with one meaning in a request ("भुगतान" is payment). Nothing that is
 * also an everyday word in another sense.
 *
 * PURE.
 */

/** [English reading, Devanagari spellings]. Longest spellings first within a row does not matter: the
 *  pattern is built longest-first across the whole table. */
const GLOSSARY: ReadonlyArray<readonly [string, readonly string[]]> = [
  // What is being built.
  ['app', ['ऐप', 'एप', 'ऍप', 'ऐप्प', 'ऐप्स', 'एप्स', 'एप्लिकेशन', 'ऐप्लिकेशन', 'एप्लीकेशन', 'ऐप्लीकेशन']],
  ['website', ['वेबसाइट', 'वेबसाइटें', 'वेब साइट']],
  ['web app', ['वेब ऐप', 'वेब एप']],
  ['portal', ['पोर्टल']],
  ['dashboard', ['डैशबोर्ड', 'डेशबोर्ड']],
  ['admin panel', ['एडमिन पैनल', 'ऐडमिन पैनल']],
  ['admin', ['एडमिन', 'ऐडमिन']],
  ['game', ['गेम', 'गेम्स']],
  // Screens and pages (the ETA's module counter).
  ['landing page', ['लैंडिंग पेज', 'लेंडिंग पेज']],
  ['page', ['पेज', 'पेजेस', 'पृष्ठ']],
  ['screen', ['स्क्रीन', 'स्क्रीनें', 'स्क्रीन्स']],
  ['section', ['सेक्शन']],
  ['tab', ['टैब', 'टैब्स']],
  // The small self-contained apps (SIMPLE_APP_SIGNAL).
  ['todo', ['टूडू', 'टू-डू', 'टू डू', 'टुडू']],
  ['calculator', ['कैलकुलेटर', 'केलकुलेटर']],
  ['stopwatch', ['स्टॉपवॉच']],
  ['timer', ['टाइमर']],
  ['notes', ['नोट्स']],
  // Big software by name (BIG_SOFTWARE_NOUN): "स्कूल मैनेजमेंट सिस्टम" reads "management system".
  ['management', ['मैनेजमेंट', 'प्रबंधन']],
  ['system', ['सिस्टम', 'प्रणाली']],
  ['software', ['सॉफ्टवेयर', 'सोफ्टवेयर']],
  ['social network', ['सोशल नेटवर्क']],
  ['erp', ['ईआरपी']],
  ['crm', ['सीआरएम']],
  // More small self-contained apps (appScopeAnalyzer's CLEARLY_SMALL).
  ['quiz', ['क्विज़', 'क्विज']],
  ['tracker', ['ट्रैकर']],
  ['weather', ['मौसम']],
  ['recipe', ['रेसिपी']],
  ['converter', ['कन्वर्टर']],
  ['portfolio', ['पोर्टफोलियो']],
  // Scope-bearing features (COMPLEX_APP_SIGNAL).
  ['login', ['लॉगिन', 'लॉग इन', 'लॉगइन', 'लोगिन', 'साइन इन', 'साइनइन']],
  ['signup', ['साइन अप', 'साइनअप', 'रजिस्ट्रेशन', 'पंजीकरण']],
  ['authentication', ['ऑथेंटिकेशन', 'प्रमाणीकरण']],
  ['payment', ['पेमेंट', 'पेमेंट्स', 'भुगतान']],
  ['checkout', ['चेकआउट', 'चेक आउट']],
  ['cart', ['कार्ट']],
  ['ecommerce', ['ई-कॉमर्स', 'ईकॉमर्स', 'ई कॉमर्स', 'ई-कामर्स']],
  ['marketplace', ['मार्केटप्लेस']],
  ['database', ['डेटाबेस', 'डाटाबेस']],
  ['backend', ['बैकएंड', 'बैक एंड']],
  ['real time', ['रियल टाइम', 'रियल-टाइम', 'रीयल टाइम', 'रियलटाइम']],
  ['chat', ['चैट']],
  ['social', ['सोशल']],
  ['booking', ['बुकिंग']],
  ['inventory', ['इन्वेंटरी', 'इन्वेंट्री']],
  ['food delivery', ['फूड डिलीवरी', 'खाना डिलीवरी']],
  // Features the ETA's counter reads.
  ['upload', ['अपलोड']],
  ['search', ['सर्च']],
  ['notification', ['नोटिफिकेशन', 'सूचनाएं', 'सूचनाएँ']],
  ['profile', ['प्रोफाइल', 'प्रोफ़ाइल']],
  ['chart', ['चार्ट']],
  ['export', ['एक्सपोर्ट']],
  // Joining words, so "X, Y और Z" counts like "X, Y and Z" and "… जिसमें login" reads "… with login".
  ['and', ['और', 'तथा']],
  ['with', ['जिसमें', 'जिसमे', 'जिनमें', 'के साथ']],
];

const NOT_DEVANAGARI_BEFORE = '(?<![\\u0900-\\u097F])';
const NOT_DEVANAGARI_AFTER = '(?![\\u0900-\\u097F])';

const SPELLINGS: ReadonlyArray<readonly [string, string]> = GLOSSARY
  .flatMap(([en, hi]) => hi.map((h) => [h, en] as const))
  .sort((a, b) => b[0].length - a[0].length);
const ENGLISH_FOR = new Map(SPELLINGS);
const TERM = new RegExp(
  `${NOT_DEVANAGARI_BEFORE}(${SPELLINGS.map(([h]) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})${NOT_DEVANAGARI_AFTER}`,
  'gu',
);

/** The text with every glossary term replaced by its English reading; everything else untouched. PURE. */
export function glossDevanagari(text: string): string {
  const t = String(text ?? '');
  if (!/[\u0900-\u097F]/.test(t)) return t;
  return t.replace(TERM, (m) => ` ${ENGLISH_FOR.get(m.replace(/\s+/g, ' ')) ?? m} `).replace(/[ \t]{2,}/g, ' ');
}

/**
 * The text a size signal should read: unchanged when there is nothing to gloss, otherwise the original
 * plus the English reading on its own line. For PREDICATES only — never for a counter. PURE.
 */
export function withEnglishReading(text: string): string {
  const t = String(text ?? '');
  const g = glossDevanagari(t);
  return g === t ? t : `${t}\n${g}`;
}
