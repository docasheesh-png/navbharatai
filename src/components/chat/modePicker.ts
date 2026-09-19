// modePicker — WHO can the Free chat's Mode button switch to? (admin 2026-08-25: "user mode par click
// kare aur professional ki list aa jaye … professional ki alag tile home page se hatani hai".)
//
// 🔴 REBUILT 2026-09-19 on the admin's spec. The old list opened with two hardcoded rows —
// "NavBharatAI FREE" (which RESUMED whatever was open) and "NavBharatAI FREE +" (a new chat) — and
// every expert row resumed its existing conversation. The admin's own words:
//
//   "1st jahan navbharatai likha hai, waha hardcod navbharatai nahi hoga, waha woh AI ayega jo
//    chatbox me active hai … agar teacher ai open hai, to 1st number par teacher ai ayega!"
//   "agar kisi bhi professional ya free par tap kiya jayega hamesa new chat hi open hoga
//    (exept : 1st option, jo ki open kon sa yeh batata hai)"
//
// So the list is now:
//   1. RECENT  — whichever AI is open in the chatbox right now, by its own name. Tapping it goes back
//      to THAT conversation. It is the one row that does not start anything; it says where you are.
//      Absent entirely when no AI is open (the Professionals hub), because there is nothing to return to.
//   2. "NavBharatAI FREE"   — always a BRAND-NEW free chat. (This is the old "FREE +", renamed; the
//      old resume-row's job moved to row 1, so the `+` had nothing left to distinguish.)
//   3. "Image Generator AI" — the SAME module Other Tools opens, free AND paid together, untouched.
//   4. Doctor AI, then every professional — the SAME real experts as the Professionals hub, opened
//      through the SAME navigation, so every engine, disclaimer, pass-gate and billing rule they have
//      today applies untouched. A new door, never a side-door. Each now starts a NEW chat.
//
// ⚠️ THE ACTIVE AI APPEARS TWICE, AND THAT IS THE DESIGN (admin, asked directly): Teacher AI open ⇒
// row 1 is "Teacher AI" (go back to it) and Teacher AI is ALSO in the list below (start a new one).
// The two rows carry different tags for exactly that reason.
//
// NavBharatAI Pro is deliberately NOT in this list — it has its own Home tile and its own surface
// (the admin's exact instruction: "navbharatai pro v5 list se hata dena, uski puri alag tile hai").
//
// PLAY COMPLIANCE RIDES ALONG: inside the native shell the medical-class experts (Doctor AI,
// Pharmacist, First Aid, Maternity) are filtered with the SAME rule the hub uses — the shipped app's
// declarations say those features do not exist, so no surface may offer them (playCompliance.ts).
//
// PURE: config in, list out — so the composition rules are pinned by tests.

import { PROFESSIONAL_CHATS } from '../professionals/professionalConfigs';
import { isMedicalProfessionalId } from '../../lib/playCompliance';

export type ModeKind = 'recent' | 'free' | 'image' | 'professional';

export interface ModeEntry {
  /**
   * What the CALLER acts on.
   *
   * 🔑 The recent row's id is PREFIXED (`recent:teacher_ai`) rather than being the bare view id, and
   * that prefix is the whole reason the feature works: the same AI can appear twice, and the caller
   * has to be able to tell "go back to the Teacher AI chat" from "start a new Teacher AI chat". Two
   * rows with one id would collapse into one behaviour, silently.
   */
  id: string;
  name: string;
  kind: ModeKind;
  /** The row's emoji logo (admin 2026-08-25: "emoji logo bhi sath me hon, maja aa jayega"). */
  emoji: string;
}

/**
 * One emoji per expert. The completeness test beside this map is the real rule: EVERY configured
 * professional must have its own emoji, so adding a professional without one fails CI instead of
 * silently rendering the generic fallback.
 */
export const MODE_EMOJI: Record<string, string> = {
  sda_chat: '🩺',
  teacher_ai: '👩‍🏫', mentor_ai: '🧭', thesis_ai: '📚', accountant_ai: '🧮', lawyer_ai: '⚖️',
  finance_ai: '💰', astrologer_ai: '🔮', govt_schemes_ai: '🏛️', kisan_ai: '🌾', nutritionist_ai: '🥗',
  wellness_ai: '💆', fitness_ai: '💪', vet_ai: '🐄', parenting_ai: '👶', cybersafety_ai: '🛡️',
  insurance_ai: '☂️', chef_ai: '👨‍🍳', travel_ai: '✈️', vastu_ai: '🧿', yoga_ai: '🧘',
  english_ai: '🔤', resume_ai: '📄', gardening_ai: '🌱', pharmacist_ai: '💊', business_ai: '📈',
  homerepair_ai: '🔧', realestate_ai: '🏢', driving_ai: '🚗', petcare_ai: '🐶', beauty_ai: '💄',
  music_ai: '🎵', sports_ai: '🏏', photography_ai: '📷', speaking_ai: '🎤', events_ai: '🎉',
  eldercare_ai: '🧓', interior_ai: '🛋️', studyabroad_ai: '🎓', disability_ai: '♿', fashion_ai: '👗',
  productivity_ai: '⏰', relationship_ai: '💞', vehicle_ai: '🛵', stocks_ai: '📊', techhelp_ai: '💻',
  mathscience_ai: '🔬', coding_ai: '👨‍💻', maternity_ai: '🤰', firstaid_ai: '🩹', environment_ai: '🌍',
  gk_ai: '🧠', safety_ai: '🦺', translate_ai: '🌐', civic_ai: '🏙️', sarkari_ai: '📋',
  spiritual_ai: '🕉️', crafts_ai: '🎨', festival_ai: '🪔', writing_ai: '✍️', aptitude_ai: '🧩',
  disaster_ai: '🚨', nature_ai: '🌳', freelance_ai: '🧑‍💼', babynames_ai: '🍼', hygiene_ai: '🧼',
  volunteer_ai: '🤝', astronomy_ai: '🔭', calligraphy_ai: '🖋️', dance_ai: '💃', games_ai: '🎮',
  techbuy_ai: '🛒', adventure_ai: '🏔️', budget_ai: '🧾', repo_analyst: '🔍',
};

/** The generic briefcase — reachable only if a professional ever ships without an emoji. */
export const FALLBACK_EMOJI = '💼';

/** Tapping this starts a BRAND-NEW free chat. (Was `free_new`; the resume job moved to row 1.) */
export const FREE_MODE_ID = 'free';

/**
 * The image studio's OWN view id, not a new one.
 *
 * Other Tools already opens `imagegen`, which renders `AIImageGenerator` — the component that carries
 * the Free/Pro toggle. Reusing the id is what makes the admin's "same to same" literal: this row is the
 * same surface reached by a second door, with the same tiers, the same price and the same billing. A
 * separate id would have been a second copy to keep in sync.
 */
export const IMAGE_MODE_ID = 'imagegen';

export const IMAGE_MODE_NAME = 'Image Generator AI';

/** What the recent row's id is built from. See ModeEntry.id for why it cannot be the bare view id. */
export const RECENT_MODE_PREFIX = 'recent:';

export const recentModeId = (viewId: string): string => `${RECENT_MODE_PREFIX}${viewId}`;
// Deliberately NOT exported: `viewFromRecentId` is the ONE public way to ask. A caller handed a bare
// predicate has to slice the prefix off itself, and a hand-rolled slice is exactly the drift that put a
// bare view id through onPick once already.
const isRecentModeId = (id: string): boolean => id.startsWith(RECENT_MODE_PREFIX);
/** The view a recent-row id points at, or null when the id is not a recent row. */
export const viewFromRecentId = (id: string): string | null =>
  isRecentModeId(id) ? id.slice(RECENT_MODE_PREFIX.length) : null;

/**
 * What is this view's AI called, in the list's own words? Null when the view is not an AI at all.
 *
 * ONE table, so row 1 and the list row for the same AI can never disagree about its name.
 */
export function modeNameFor(viewId: string): string | null {
  if (viewId === 'nbi_chat') return 'NavBharatAI FREE';
  if (viewId === 'sda_chat') return 'Doctor AI';
  if (viewId === IMAGE_MODE_ID) return IMAGE_MODE_NAME;
  return PROFESSIONAL_CHATS[viewId]?.name ?? null;
}

/** The emoji for a view, from the same table the rows use. */
export function modeEmojiFor(viewId: string): string {
  if (viewId === 'nbi_chat') return '💬';
  if (viewId === IMAGE_MODE_ID) return '🎨';
  return MODE_EMOJI[viewId] ?? FALLBACK_EMOJI;
}

export function modePickerEntries(opts: { hideMedical: boolean; activeView?: string }): ModeEntry[] {
  const entries: ModeEntry[] = [];

  // 1. WHERE YOU ARE. Only when an AI is genuinely open — the Professionals hub has no conversation to
  //    return to, and a row offering to resume nothing would be the fake-button class.
  const active = opts.activeView ?? '';
  const activeName = modeNameFor(active);
  const activeHidden = opts.hideMedical && (active === 'sda_chat' || isMedicalProfessionalId(active));
  if (activeName && !activeHidden) {
    entries.push({ id: recentModeId(active), name: activeName, kind: 'recent', emoji: modeEmojiFor(active) });
  }

  // 2. A NEW free chat. The old one stays in History — `startNewChat` mints a new session id and the
  //    previous record keeps its own, so nothing is overwritten.
  entries.push({ id: FREE_MODE_ID, name: 'NavBharatAI FREE', kind: 'free', emoji: '💬' });

  // 3. The image studio, above Doctor AI (admin: "images generator ai … doctor ai se upar").
  entries.push({ id: IMAGE_MODE_ID, name: IMAGE_MODE_NAME, kind: 'image', emoji: modeEmojiFor(IMAGE_MODE_ID) });

  // 4. Doctor AI, then every professional.
  if (!opts.hideMedical) entries.push({ id: 'sda_chat', name: 'Doctor AI', kind: 'professional', emoji: MODE_EMOJI.sda_chat });
  for (const [id, config] of Object.entries(PROFESSIONAL_CHATS)) {
    if (opts.hideMedical && isMedicalProfessionalId(id)) continue;
    entries.push({ id, name: config.name, kind: 'professional', emoji: MODE_EMOJI[id] ?? FALLBACK_EMOJI });
  }
  return entries;
}

/**
 * 🔴 WHICH ROWS START A FRESH CHAT BY ARCHIVING THE OLD ONE — and why Doctor AI is not one of them.
 *
 * Every config-driven professional restores itself from `localStorage` on mount, so a new chat is made
 * by ENDING the live one first: `endProfessionalChat` archives the transcript into Professional History
 * and clears the live slot. Nothing is lost.
 *
 * ✅ **DOCTOR AI STARTS FRESH TOO SINCE 2026-09-19 — but NOT through this function.**
 *
 * It was held back while its transcript lived in `sda_messages` plus ONE fixed Firestore document per
 * user (`sda_${uid}`): "always a new chat" would have deleted the previous case locally and overwritten
 * it in Firestore as soon as the new one had two messages. `src/lib/sdaCaseStore.ts` removed that —
 * every case now owns its own document and its own transcript key, so starting one deletes nothing and
 * the case before it keeps its row in History → SDA.
 *
 * ⚠️ IT IS STILL NOT `endProfessionalChat`, and that has not changed. Doctor AI's transcript is not in
 * the professional store at all, so archiving it there would write under a key NOTHING reads and leave
 * the real transcript untouched — a "new chat" that silently is not one. App.tsx calls `startFreshCase`
 * for it instead: the SAME call the ✕ makes, so there is one way to begin a case rather than a second
 * copy of the rule. This function stays exactly what its name says — which rows need the PROFESSIONAL
 * archive — and Doctor AI is correctly not one of them.
 */
/**
 * Does picking this row need its live conversation archived first? PURE.
 *
 * True for exactly the config-driven professionals, because `endProfessionalChat` is written for their
 * storage and nothing else's.
 *
 * ⚠️ AN EARLIER DRAFT OF THIS SHIPPED A LEVER THAT DID NOTHING, and the reversion proof is what caught
 * it. It read `id in PROFESSIONAL_CHATS && !RESUMES_INSTEAD_OF_STARTING_FRESH.has(id)` with Doctor AI
 * in that set — but Doctor AI is not in `PROFESSIONAL_CHATS`, so the set never decided anything.
 * Emptying it changed no behaviour and broke no test. A switch that looks like the control and is not
 * is worse than no switch: the next person flips it, sees nothing, and goes looking in the wrong file.
 * It is deleted rather than "fixed", because making it load-bearing would have been worse still — see
 * the note above, and `sdaCaseStore.ts` for how a Doctor AI new-chat is actually done.
 */
export function startsFreshOnPick(id: string): boolean {
  return id in PROFESSIONAL_CHATS;
}

/** Case-insensitive name filter for the search box — 70+ experts need one. PURE. */
export function filterModeEntries(entries: ModeEntry[], query: string): ModeEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  // The fixed rows always stay visible: they are the way BACK, and a search that hides the exit strands
  // the user inside the list. (Recent, free and the image studio — everything that is not an expert.)
  return entries.filter((e) => e.kind !== 'professional' || e.name.toLowerCase().includes(q));
}

/**
 * Which entry should show the ✓ for the surface the user is on right now? PURE.
 *
 * It is the RECENT row, never the list row of the same AI: the list row means "start a new one", which
 * is not the state the user is in. When no AI is open there is no recent row and nothing is ticked.
 */
export function activeModeId(activeView: string): string {
  return modeNameFor(activeView) ? recentModeId(activeView) : '';
}

/** Every view id whose footer carries the live Mode button (the chat surfaces this picker serves). */
export function isModeSurface(view: string): boolean {
  // `imagegen` joined the list, so it must also carry the button — a row that takes you somewhere with
  // no way back is a trap, and the Mode button IS the way back on every other surface here.
  return view === 'nbi_chat' || view === 'professionals' || view === 'sda_chat'
    || view === IMAGE_MODE_ID || view in PROFESSIONAL_CHATS;
}
