// modePicker — WHO can the Free chat's Mode button switch to? (admin 2026-08-25: "user mode par click
// kare aur professional ki list aa jaye … professional ki alag tile home page se hatani hai".)
//
// The Mode list is the new front door to every conversational AI EXCEPT the app builder:
//   1. "NavBharatAI FREE"   — the default general chat (stays the default; nothing changes on load).
//   2. "NavBharatAI FREE +" — starts a brand-NEW free chat (the old one stays saved in History).
//   3. Doctor AI, then every professional — the SAME real experts as the Professionals hub, opened
//      through the SAME navigation, so every engine, disclaimer, pass-gate and billing rule they have
//      today applies untouched. A new door, never a side-door.
//
// NavBharatAI Pro v5.0 is deliberately NOT in this list — it has its own Home tile and its own surface
// (the admin's exact instruction: "navbharatai pro v5 list se hata dena, uski puri alag tile hai").
//
// PLAY COMPLIANCE RIDES ALONG: inside the native shell the medical-class experts (Doctor AI,
// Pharmacist, First Aid, Maternity) are filtered with the SAME rule the hub uses — the shipped app's
// declarations say those features do not exist, so no surface may offer them (playCompliance.ts).
//
// PURE: config in, list out — so the composition rules are pinned by tests.

import { PROFESSIONAL_CHATS } from '../professionals/professionalConfigs';
import { isMedicalProfessionalId } from '../../lib/playCompliance';

export interface ModeEntry {
  /** 'free' | 'free_new' | a professional's ViewType id ('sda_chat', 'teacher_ai', …). */
  id: string;
  name: string;
  kind: 'free' | 'free_new' | 'professional';
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

/** The two fixed rows at the top — FREE is the default and always listed first. */
export const FREE_MODE_ID = 'free';
export const NEW_FREE_MODE_ID = 'free_new';

export function modePickerEntries(opts: { hideMedical: boolean }): ModeEntry[] {
  const entries: ModeEntry[] = [
    { id: FREE_MODE_ID, name: 'NavBharatAI FREE', kind: 'free', emoji: '💬' },
    { id: NEW_FREE_MODE_ID, name: 'NavBharatAI FREE +', kind: 'free_new', emoji: '➕' },
  ];
  if (!opts.hideMedical) entries.push({ id: 'sda_chat', name: 'Doctor AI', kind: 'professional', emoji: MODE_EMOJI.sda_chat });
  for (const [id, config] of Object.entries(PROFESSIONAL_CHATS)) {
    if (opts.hideMedical && isMedicalProfessionalId(id)) continue;
    entries.push({ id, name: config.name, kind: 'professional', emoji: MODE_EMOJI[id] ?? FALLBACK_EMOJI });
  }
  return entries;
}

/** Case-insensitive name filter for the search box — 70+ experts need one. PURE. */
export function filterModeEntries(entries: ModeEntry[], query: string): ModeEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  // The two FREE rows always stay visible: they are the way BACK, and a search that hides the exit
  // strands the user inside the list.
  return entries.filter((e) => e.kind !== 'professional' || e.name.toLowerCase().includes(q));
}

/** Which entry should show the ✓ for the surface the user is on right now? PURE. */
export function activeModeId(activeView: string): string {
  if (activeView === 'nbi_chat') return FREE_MODE_ID;
  if (activeView === 'sda_chat' || activeView in PROFESSIONAL_CHATS) return activeView;
  return '';
}

/** Every view id whose footer carries the live Mode button (the chat surfaces this picker serves). */
export function isModeSurface(view: string): boolean {
  return view === 'nbi_chat' || view === 'professionals' || view === 'sda_chat' || view in PROFESSIONAL_CHATS;
}
