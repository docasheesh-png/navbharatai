// The Free tier's silent fallback line, in the user's own language. PURE — no I/O, safe to import anywhere.
import { detectReplyLanguage } from './freeChatReplies';

/** Universes whose exhausted ladder answers with the localized Free busy line. */
export function isFreeTierUniverse(universe: string): boolean {
  return universe === 'free' || universe === 'professional-free-fallback';
}

/** The busy line in the user's own language (Hindi / Hinglish / English). PURE. */
export function freeBusyMessage(userText: string): string {
  switch (detectReplyLanguage(String(userText ?? '').slice(-2000))) {
    case 'hi': return 'अभी AI थोड़ा व्यस्त है। कृपया 1-2 मिनट बाद फिर से कोशिश करें। 🙏';
    case 'hinglish': return 'Abhi AI thoda busy hai. Kripya 1-2 minute baad dobara try karein. 🙏';
    default: return 'The AI service is temporarily busy. Please try again in 1-2 minutes. 🙏';
  }
}
