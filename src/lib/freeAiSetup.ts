// "FREE AI CHALU KAREIN" — the three steps, their words, and what counts as done (admin 2026-11-25).
//
// Admin, verbatim: *"header me ❗ button me … 1. login - sirf login kare, aur band kar de (user ki
// language me) 2. ganerate api - api keys copy kare! 3. pest api keys … (sab user ki language me)"* and
// then *"AI chalu karein ki jagaha 'free ai chalu karen' ho to? glm 4.5 flash, glm 4.6v flash glm 4.7
// flash — yeh teeno free module hai. yahi use hone chahiye only!"*
//
// ONE BUTTON, THREE STEPS, NOT THREE BUTTONS. Three buttons in a header ask the user to remember an
// order nobody told them; the same three as numbered steps with a ✅ each tell them where they are. The
// third step is a paste box in the box itself, so nobody has to find Settings → Secrets & API Keys at
// all — which is the part of the old flow people actually got lost in.
//
// ⚠️ ENGLISH IS ALWAYS PRESENT, and the Hindi line sits BESIDE it, never instead of it. The admin asked
// for "user ki language", and their own correction of 2026-09-14 is why that cannot mean Hindi ALONE:
// *"ui me professional language (english only) honi chahiye … south india wale kaise padhenge isko??"*
// A Tamil or Telugu speaker cannot read Devanagari, so a Hindi-only step would be unreadable to the
// very person it was meant to help. Same shape as the NEXT STEP card (nextStepGuide.ts, #4045).
//
// PURE — no fetching, no state. The card renders this; the tests read it directly.

/** The model ids are NOT here on purpose: the user never picks one, and never sees one named. */
export type FreeAiStepId = 'login' | 'key' | 'paste';

export interface FreeAiStep {
  id: FreeAiStepId;
  /** 1, 2, 3 — shown to the user, so the order is a fact on screen rather than an assumption. */
  number: number;
  en: string;
  hi: string;
  /** The button on the step. A paste step has none — its action is the box beside it. */
  action?: { en: string; hi: string; url: string };
}

/** Z.ai's own pages, as its Quick Start gives them. The user's own account — nothing of ours is here. */
export const FREE_AI_LOGIN_URL = 'https://z.ai/model-api';
export const FREE_AI_KEY_URL = 'https://z.ai/manage-apikey/apikey-list';

export const FREE_AI_STEPS: readonly FreeAiStep[] = Object.freeze([
  {
    id: 'login',
    number: 1,
    en: 'Sign in (or sign up — it is free). Then come back here.',
    hi: 'साइन इन करें (खाता नहीं है तो बना लें — मुफ़्त है)। फिर यहीं वापस आ जाइए।',
    action: { en: 'Open sign-in', hi: 'साइन इन खोलें', url: FREE_AI_LOGIN_URL },
  },
  {
    id: 'key',
    number: 2,
    en: 'Make a key and copy it.',
    hi: 'एक key बनाइए और उसे copy कर लीजिए।',
    action: { en: 'Open the key page', hi: 'Key का पेज खोलें', url: FREE_AI_KEY_URL },
  },
  {
    id: 'paste',
    number: 3,
    en: 'Paste the key below. That is all — your app’s AI turns on.',
    hi: 'Key नीचे paste कर दीजिए। बस इतना ही — आपके app का AI चालू हो जाएगा।',
  },
]);

/** The one-line title on the ❗ row and on the button that opens the box. */
export const FREE_AI_TITLE = { en: 'Turn on free AI', hi: 'फ्री AI चालू करें' } as const;

/**
 * WHY THE ROW IS THERE AT ALL — said in terms of the user's app and their money, not ours.
 *
 * It is shown only when the app really does use AI and no free key is saved yet, so it can promise
 * something true: today every answer is charged to their balance, and this makes it free instead.
 */
export const FREE_AI_WHY = {
  en: 'Your app uses AI. Right now every answer is charged to your balance. Set this up once and your app’s AI is free.',
  hi: 'आपके app में AI है। अभी हर जवाब आपके balance से कटता है। यह एक बार कर लीजिए, फिर आपके app का AI मुफ़्त हो जाएगा।',
} as const;

/** What the box says when the key is saved and proven. The ✅ nobody gets without a working key. */
export const FREE_AI_DONE = {
  en: '✅ Free AI is on. Your app’s answers cost you nothing.',
  hi: '✅ फ्री AI चालू है। आपके app के जवाब अब मुफ़्त हैं।',
} as const;

/** The fine print under the paste box: where the key goes, and where to change it later. */
export const FREE_AI_FOOTNOTE = {
  en: 'Saved for this app in your own encrypted keys (Settings → Secrets & API Keys), used on our server only — never written into your app’s code. To use it in all your apps, open that screen and mark it “applies to all my apps”.',
  hi: 'यह key आपके ही encrypted keys में, इसी app के लिए सेव होती है (Settings → Secrets & API Keys), और सिर्फ़ हमारे server पर इस्तेमाल होती है — आपके app के code में कभी नहीं जाती। सभी apps में चलाने के लिए उसी स्क्रीन पर “applies to all my apps” कर दें।',
} as const;

export interface FreeAiProgress {
  /** The user has opened the sign-in page at least once. */
  loginOpened: boolean;
  /** The user has opened the key page at least once. */
  keyOpened: boolean;
  /** A key is saved AND proved to work by the server. The only ✅ that means the feature is on. */
  keySaved: boolean;
}

/**
 * Which step is the current one.
 *
 * 🔒 THE TICK ON STEPS 1 AND 2 MEANS "YOU DID THIS", NOT "THIS WORKED", because opening a page is all
 * there is to check — the browser cannot see whether a sign-in succeeded in another tab. Only step 3 is
 * verified, by a real call on the pasted key before it is saved (`/api/app-ai/free-key`). So the card
 * never shows a tick that stands for something nobody measured, and the FEATURE's own ✅ is step 3's.
 * PURE.
 */
export function currentFreeAiStep(p: FreeAiProgress): FreeAiStepId | null {
  if (p.keySaved) return null;
  if (!p.loginOpened) return 'login';
  if (!p.keyOpened) return 'key';
  return 'paste';
}

/** Is this step already done? Steps run in order, so an earlier step stays ticked. PURE. */
export function freeAiStepDone(step: FreeAiStepId, p: FreeAiProgress): boolean {
  if (p.keySaved) return true;
  if (step === 'login') return p.loginOpened;
  if (step === 'key') return p.keyOpened;
  return false;
}

/**
 * Should the ❗ tray offer this at all? Only when the app's assistant is really there and the free key
 * is not — never as a standing advert. `usesAi` and `ownKey` come from `/api/app-ai/settings`, which
 * reads the app's own file and the owner's vault. PURE.
 *
 * 🔒 NOT OFFERED TO AN OWNER WHO ALREADY USES A KEY OF THEIR OWN, and the reason is honesty rather than
 * tidiness: the row's own words are "every answer is charged to your balance", which is simply untrue
 * for someone whose OpenAI or Anthropic key is already answering. They can still set the free key up
 * from Keys & Secrets; what they are not shown is a sentence that is false about their app.
 */
export function offerFreeAi(view: { available: boolean; usesAi: boolean; ownKey: string | null } | null): boolean {
  if (!view || !view.available || !view.usesAi) return false;
  return view.ownKey === null;
}
