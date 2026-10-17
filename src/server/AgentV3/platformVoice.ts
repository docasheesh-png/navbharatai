// THE PLATFORM SPEAKS THE USER'S LANGUAGE TOO (autopsy eb58abaf, 2026-10-17).
//
// The user wrote "Mujhe ek app bnakar do". The MODEL's words were already governed by LANGUAGE_RULE — but
// every line the PLATFORM wrote ("Setting up your workspace…", "Planning the file list…", the ETA line,
// "Still working — 12s so far") was English, so 30 s in the user had to type "Hindi me bolo". Those lines
// are written in ~100 places; translating each call site would drift the day a new one is added. So the
// translation happens at the one door every build event leaves through (the route's `emit`), from a
// table of the platform's own sentence shapes. A line that matches no shape — the model's own prose,
// a file name — is passed through untouched, so this can never garble what the model wrote.
//
// PURE. `AGENTV3_PLATFORM_VOICE=off` keeps every platform line English with no deploy.

import { detectReplyLanguage } from '../lib/freeChatReplies';

export type PlatformVoice = 'en' | 'hinglish' | 'hindi';

export function platformVoiceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PLATFORM_VOICE ?? '').trim().toLowerCase() !== 'off';
}

/** The voice the user wrote in. Anything that is not clearly Hindi/Hinglish stays English. */
export function voiceOf(text: string): PlatformVoice {
  const l = detectReplyLanguage(String(text ?? ''));
  return l === 'hi' ? 'hindi' : l === 'hinglish' ? 'hinglish' : 'en';
}

/**
 * Did this message ask us to SWITCH language ("Hindi me bolo", "हिंदी में बताओ", "english please")?
 * Returns the voice asked for, or null. A Devanagari ask gets Devanagari; a Roman one gets Roman Hindi.
 */
export function voiceRequestedIn(message: string): PlatformVoice | null {
  const m = String(message ?? '').trim();
  if (/हिंदी|हिन्दी/.test(m)) return 'hindi';
  if (/\bhindi\b/i.test(m) && /\b(me|mein|mai|main|mei|m|mai|bolo|bol|batao|likho|please|pls|plz|in|baat|samjhao|bataiye|boliye)\b/i.test(m)) return 'hinglish';
  if (/\benglish\b/i.test(m) && /\b(me|mein|mai|main|bolo|please|pls|plz|in|speak|reply|batao)\b/i.test(m)) return 'en';
  return null;
}

type Rule = { re: RegExp; hinglish: (...g: string[]) => string; hindi: (...g: string[]) => string };

/** The platform's own sentence shapes. Each must match the WHOLE line, so model prose is never touched. */
export const PLATFORM_LINES: readonly Rule[] = [
  { re: /^Setting up your workspace…$/, hinglish: () => 'Aapka workspace taiyaar ho raha hai…', hindi: () => 'आपका वर्कस्पेस तैयार हो रहा है…' },
  { re: /^Planning the file list…$/, hinglish: () => 'Files ki list plan ho rahi hai…', hindi: () => 'फ़ाइलों की सूची तैयार हो रही है…' },
  { re: /^(\S+) Still working — (.+) so far$/, hinglish: (m, t) => `${m} Kaam chal raha hai — ab tak ${t}`, hindi: (m, t) => `${m} काम चल रहा है — अब तक ${t}` },
  { re: /^⏱️ Estimated build time: (.+?) — this is a first guess before I've planned your app\. .*$/s,
    hinglish: (r) => `⏱️ Andaazan build time: ${r} — yeh app plan hone se pehle ka pehla andaaza hai. Size pata chalte hi sahi samay bataunga.`,
    hindi: (r) => `⏱️ अनुमानित बिल्ड समय: ${r} — यह ऐप की योजना बनने से पहले का पहला अनुमान है। आकार पता चलते ही सही समय बताऊँगा।` },
  { re: /^⏱️ Estimated build time: (.+?) — based on your last (\d+) builds?\. .*$/s,
    hinglish: (r, n) => `⏱️ Andaazan build time: ${r} — aapke pichhle ${n} build ke hisaab se. Beech beech mein update deta rahunga.`,
    hindi: (r, n) => `⏱️ अनुमानित बिल्ड समय: ${r} — आपके पिछले ${n} बिल्ड के आधार पर। बीच-बीच में बताता रहूँगा।` },
  { re: /^⏱️ Estimated build time: (.+?) — how long (\d+) recent builds? of this kind of app took on NavBharatAI\. .*$/s,
    hinglish: (r, n) => `⏱️ Andaazan build time: ${r} — NavBharatAI par aise ${n} haaliya apps itne samay mein bane. Aapke app ka size pata chalte hi sahi samay bataunga.`,
    hindi: (r, n) => `⏱️ अनुमानित बिल्ड समय: ${r} — NavBharatAI पर ऐसे ${n} हाल के ऐप इतने समय में बने। आपके ऐप का आकार पता चलते ही सही समय बताऊँगा।` },
  { re: /^⏱️ Still building… (.+?) in · nothing has been written yet, so I can't give you a finish time\.(.*?) If it still produces nothing, I will stop and tell you honestly\.$/s,
    hinglish: (t) => `⏱️ Build chal raha hai… ${t} ho gaye · abhi tak kuch likha nahi gaya, isliye khatam hone ka samay nahi bata sakta. Agar ab bhi kuch nahi bana, to main rok kar saaf bata dunga.`,
    hindi: (t) => `⏱️ बिल्ड चल रहा है… ${t} हो गए · अभी तक कुछ लिखा नहीं गया, इसलिए खत्म होने का समय नहीं बता सकता। अगर अब भी कुछ नहीं बना, तो मैं रोककर साफ़ बता दूँगा।` },
  { re: /^⏱️ Still building… (.+?) in · ~(.+?) to go on my rough estimate of (.+?) \((.+)\)$/s,
    hinglish: (t, l, b) => `⏱️ Build chal raha hai… ${t} ho gaye · mere mote andaaze (${b}) se ~${l} aur`,
    hindi: (t, l, b) => `⏱️ बिल्ड चल रहा है… ${t} हो गए · मेरे मोटे अनुमान (${b}) से ~${l} और` },
  { re: /^📨 Message to the team queued — it will be picked up at the next step: “(.*)”$/s,
    hinglish: (q) => `📨 Aapka message mil gaya — agle step par us par kaam hoga: “${q}”`,
    hindi: (q) => `📨 आपका संदेश मिल गया — अगले चरण में उस पर काम होगा: “${q}”` },
  { re: /^⏸️ Waiting for your answer above(?: \((\d+) min so far\))? — the build carries on the moment you reply, and this time is not counted against it\.$/,
    hinglish: (n) => `⏸️ Upar aapke jawaab ka intezaar hai${n ? ` (${n} min se)` : ''} — jawaab dete hi build aage badhega, aur yeh samay ginti mein nahi aata.`,
    hindi: (n) => `⏸️ ऊपर आपके जवाब का इंतज़ार है${n ? ` (${n} मिनट से)` : ''} — जवाब देते ही बिल्ड आगे बढ़ेगा, और यह समय गिना नहीं जाता।` },
];

/** One platform line in the user's voice; any other text is returned unchanged. PURE. */
export function inUserVoice(text: string, voice: PlatformVoice | null | undefined): string {
  if (!voice || voice === 'en' || typeof text !== 'string') return text;
  for (const r of PLATFORM_LINES) {
    const m = text.match(r.re);
    if (m) return voice === 'hindi' ? r.hindi(...m.slice(1)) : r.hinglish(...m.slice(1));
  }
  return text;
}

/** Apply `inUserVoice` to a user-bound build event's text fields (narration/thinking/status). PURE. */
export function eventInUserVoice<T>(e: T, voice: PlatformVoice | null | undefined): T {
  if (!voice || voice === 'en' || !e || typeof e !== 'object') return e;
  const ev = e as unknown as { type?: string; text?: unknown; message?: unknown };
  if ((ev.type === 'narration' || ev.type === 'thinking') && typeof ev.text === 'string') {
    const t = inUserVoice(ev.text, voice);
    return t === ev.text ? e : ({ ...(e as object), text: t } as T);
  }
  return e;
}
