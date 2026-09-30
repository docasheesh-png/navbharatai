// FREE AND PAID, ON ONE SCREEN (admin 2026-09-30).
//
// Admin, verbatim: "pahle ek system tha, free + paid (dono the) wahi bana do! free wala sabhi ke liye
// free, agar pollination se image na bane, to likh kar aye, free server are too busy try on paid
// service (user ki bhasa me). aur paid wala system abhi apne jo banaya hai, aur old paid wala mila ke
// banao!!"
//
// So the image generator has TWO modes again, chosen by a toggle on the screen:
//  - FREE — for everybody, with no daily count and no charge. It uses only the free provider, fetched
//    from the user's own connection. When the free provider cannot make the picture, the answer is a
//    plain sentence in the user's own language pointing at Paid mode — never a quiet switch to a paid
//    engine, because the user did not choose to spend anything.
//  - PAID — the ladder of paid engines (the Cloudflare rung, the keyed free provider and the second
//    paid provider from the old Pro tier, then Gemini and Grok), with 5 free pictures a day and ₹1
//    each after that (`imageAllowance.ts`). An edit of the user's own picture is here too.
//
// 🔒 A request that names no tier is FREE. The phone apps are bundled, so every installed build sends
// no tier at all; for them the safe reading is the one that can never charge anybody.

import { detectLanguageHint } from '../AgentV3/LanguageDetect';

export type ImageTier = 'free' | 'paid';

export const FREE_BUSY_CODE = 'free_busy';
export const NEEDS_PAID_CODE = 'needs_paid';

/** Which mode this request is for. Anything but the word "paid" is Free. PURE. */
export function imageTierOf(body: unknown): ImageTier {
  const t = (body as { tier?: unknown } | null)?.tier;
  return typeof t === 'string' && t.trim().toLowerCase() === 'paid' ? 'paid' : 'free';
}

type Sentences = { busy: string; edit: string };

const EN: Sentences = {
  busy: 'The free image servers are too busy right now. Please try Paid mode: switch the toggle at the top to Paid.',
  edit: 'Changing your own picture is available in Paid mode. Switch the toggle at the top to Paid.',
};

const HINGLISH: Sentences = {
  busy: 'Free image server abhi bahut busy hain. Kripya Paid mode try kijiye: upar toggle ko Paid par kijiye.',
  edit: 'Apni photo badalna Paid mode me hota hai. Upar toggle ko Paid par kijiye.',
};

/** The sentence per language. Keyed by the codes `detectLanguageHint` returns. */
const BY_LANGUAGE: Record<string, Sentences> = {
  hi: {
    busy: 'फ़्री इमेज सर्वर अभी बहुत व्यस्त हैं। कृपया Paid मोड आज़माइए: ऊपर का टॉगल Paid पर कीजिए।',
    edit: 'अपनी फ़ोटो बदलना Paid मोड में होता है। ऊपर का टॉगल Paid पर कीजिए।',
  },
  mr: {
    busy: 'फ्री इमेज सर्व्हर सध्या खूप व्यस्त आहेत. कृपया Paid मोड वापरून पहा: वरचा टॉगल Paid वर करा.',
    edit: 'स्वतःचा फोटो बदलणे Paid मोडमध्ये होते. वरचा टॉगल Paid वर करा.',
  },
  bn: {
    busy: 'ফ্রি ইমেজ সার্ভার এখন খুব ব্যস্ত। অনুগ্রহ করে Paid মোড ব্যবহার করে দেখুন: উপরের টগলটি Paid-এ দিন।',
    edit: 'নিজের ছবি বদলানো Paid মোডে হয়। উপরের টগলটি Paid-এ দিন।',
  },
  ta: {
    busy: 'இலவச படச் சேவையகங்கள் இப்போது மிகவும் பிஸியாக உள்ளன. தயவுசெய்து Paid பயன்முறையை முயற்சிக்கவும்: மேலே உள்ள டாகிளை Paid-க்கு மாற்றவும்.',
    edit: 'உங்கள் சொந்தப் படத்தை மாற்றுவது Paid பயன்முறையில் கிடைக்கும். மேலே உள்ள டாகிளை Paid-க்கு மாற்றவும்.',
  },
  te: {
    busy: 'ఉచిత ఇమేజ్ సర్వర్లు ఇప్పుడు చాలా బిజీగా ఉన్నాయి. దయచేసి Paid మోడ్‌ను ప్రయత్నించండి: పైన ఉన్న టోగుల్‌ను Paidకి మార్చండి.',
    edit: 'మీ సొంత ఫోటోను మార్చడం Paid మోడ్‌లో ఉంటుంది. పైన ఉన్న టోగుల్‌ను Paidకి మార్చండి.',
  },
  kn: {
    busy: 'ಉಚಿತ ಇಮೇಜ್ ಸರ್ವರ್‌ಗಳು ಈಗ ತುಂಬಾ ಬ್ಯುಸಿಯಾಗಿವೆ. ದಯವಿಟ್ಟು Paid ಮೋಡ್ ಪ್ರಯತ್ನಿಸಿ: ಮೇಲಿನ ಟಾಗಲ್ ಅನ್ನು Paidಗೆ ಬದಲಾಯಿಸಿ.',
    edit: 'ನಿಮ್ಮ ಸ್ವಂತ ಫೋಟೋ ಬದಲಾಯಿಸುವುದು Paid ಮೋಡ್‌ನಲ್ಲಿ ಇದೆ. ಮೇಲಿನ ಟಾಗಲ್ ಅನ್ನು Paidಗೆ ಬದಲಾಯಿಸಿ.',
  },
  ml: {
    busy: 'സൗജന്യ ഇമേജ് സെർവറുകൾ ഇപ്പോൾ വളരെ തിരക്കിലാണ്. ദയവായി Paid മോഡ് പരീക്ഷിക്കൂ: മുകളിലെ ടോഗിൾ Paid ആക്കൂ.',
    edit: 'സ്വന്തം ഫോട്ടോ മാറ്റുന്നത് Paid മോഡിലാണ്. മുകളിലെ ടോഗിൾ Paid ആക്കൂ.',
  },
  gu: {
    busy: 'મફત ઇમેજ સર્વર અત્યારે બહુ વ્યસ્ત છે. કૃપા કરીને Paid મોડ અજમાવો: ઉપરનું ટૉગલ Paid પર કરો.',
    edit: 'પોતાનો ફોટો બદલવો Paid મોડમાં થાય છે. ઉપરનું ટૉગલ Paid પર કરો.',
  },
  pa: {
    busy: 'ਮੁਫ਼ਤ ਇਮੇਜ ਸਰਵਰ ਇਸ ਵੇਲੇ ਬਹੁਤ ਰੁੱਝੇ ਹੋਏ ਹਨ। ਕਿਰਪਾ ਕਰਕੇ Paid ਮੋਡ ਵਰਤ ਕੇ ਦੇਖੋ: ਉੱਪਰ ਵਾਲਾ ਟੌਗਲ Paid \'ਤੇ ਕਰੋ।',
    edit: 'ਆਪਣੀ ਫੋਟੋ ਬਦਲਣਾ Paid ਮੋਡ ਵਿੱਚ ਹੁੰਦਾ ਹੈ। ਉੱਪਰ ਵਾਲਾ ਟੌਗਲ Paid \'ਤੇ ਕਰੋ।',
  },
  or: {
    busy: 'ମାଗଣା ଇମେଜ୍ ସର୍ଭର ଏବେ ବହୁତ ବ୍ୟସ୍ତ ଅଛି। ଦୟାକରି Paid ମୋଡ୍ ଚେଷ୍ଟା କରନ୍ତୁ: ଉପର ଟଗଲ୍‌କୁ Paid କରନ୍ତୁ।',
    edit: 'ନିଜ ଫଟୋ ବଦଳାଇବା Paid ମୋଡ୍‌ରେ ହୁଏ। ଉପର ଟଗଲ୍‌କୁ Paid କରନ୍ତୁ।',
  },
  ar: {
    busy: 'مفت امیج سرورز اس وقت بہت مصروف ہیں۔ براہ کرم Paid موڈ آزمائیں: اوپر والا ٹوگل Paid پر کریں۔',
    edit: 'اپنی تصویر بدلنا Paid موڈ میں ہوتا ہے۔ اوپر والا ٹوگل Paid پر کریں۔',
  },
};

// Roman-script Hindi ("ek sher ki photo banao") carries no Devanagari, so the script detector cannot
// see it. Two of these everyday words is enough to answer in the same Roman Hindi; one is not, because
// "photo" and "banner" are English too.
const HINGLISH_WORDS = /\b(banao|bana do|banado|banaiye|chahiye|chaiye|dikhao|wala|wali|wale|mera|meri|mere|hamara|hamari|kar do|karo|kijiye|ki|ka|ke|aur|mein|nahi|hai|hain|ek|jaisa|jaisi)\b/gi;

function sentencesFor(text: string): Sentences {
  const said = String(text ?? '');
  const hint = detectLanguageHint(said);
  if (hint && BY_LANGUAGE[hint.code]) return BY_LANGUAGE[hint.code];
  const hits = new Set((said.toLowerCase().match(HINGLISH_WORDS) ?? []).map((w) => w.trim()));
  if (hits.size >= 2) return HINGLISH;
  return EN;
}

/** "The free servers are busy — try Paid", in the language the user wrote in. PURE. */
export function freeBusyMessage(prompt: string): string {
  return sentencesFor(prompt).busy;
}

/** "Changing your own picture is in Paid mode", in the language the user wrote in. PURE. */
export function editNeedsPaidMessage(prompt: string): string {
  return sentencesFor(prompt).edit;
}
