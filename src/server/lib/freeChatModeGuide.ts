// WHAT NAVBHARATAI FREE KNOWS ABOUT ITS OWN MODE BUTTON (admin 2026-09-30).
//
// Admin, verbatim: *"navbharatai free ko pata hi nahi photo kaha banegi! navbharatai free me 'mode' me
// image generator hai, woh photo banata hai, navbharatai free ko pata hi nahi hai … navbharatai free ko
// mode aur uske andar jo hai, sabke bare me batao!!"*
//
// 🔑 THE CAUSE. The free chat's system prompt described greetings, tone and app building, and said
// nothing about the Mode button — the one control that sits under every free chat and leads to every
// other AI the user can reach from it. App knowledge reached the model only when a message happened to
// match a keyword in `AppContextInjector`, so "photo bana do" landed on a model that had never been told
// a picture studio exists one tap away. It answered from its own training: "I cannot make images."
//
// So the map is part of the free chat's standing instructions, every turn — not a keyword lottery.
//
// 🔒 ONE SOURCE FOR THE LIST. The experts are read from the server's own professional registry (the
// same one `/api/professional/:id/chat` serves), and a test holds that list equal to what the Mode
// sheet really shows (`newModeEntries` in `components/chat/modePicker.ts`), so a professional added
// tomorrow appears here with no edit, and one that the sheet stops showing fails CI instead of being
// promised to a user who cannot find it.
//
// PURE — no env, no I/O.

import { imagePriceSentence } from './imageAllowance';
import { listProfessionals } from '../professionals/registry';
import { isMedicalProfessionalId } from '../../lib/playCompliance';

/** The image studio's name in the Mode sheet (`IMAGE_MODE_NAME` in modePicker.ts; a test pins them equal). */
export const IMAGE_STUDIO_MODE_NAME = 'Image Generator AI';

/** Every expert the Mode sheet lists, in the sheet's order: Doctor AI first, then the registry. */
export function modeExperts(): Array<{ id: string; name: string; medical: boolean }> {
  return [
    { id: 'sda_chat', name: 'Doctor AI', medical: true },
    ...listProfessionals().map((p) => ({ id: p.id, name: p.name, medical: isMedicalProfessionalId(p.id) })),
    ...SERVED_BY_THEIR_OWN_ROUTE,
  ];
}

/**
 * Mode rows whose AI is served by its OWN route rather than the professional registry. Doctor AI is
 * listed first above; the GitHub repo analyst lives in `routes/repoAnalyst.ts`. The drift test found
 * it: the Mode sheet shows it and the registry has never heard of it, so the free chat could not
 * mention it. A row added to the sheet without an entry here fails that same test.
 */
const SERVED_BY_THEIR_OWN_ROUTE: ReadonlyArray<{ id: string; name: string; medical: boolean }> = [
  { id: 'repo_analyst', name: 'GitHub Repo Analyst & Improver', medical: false },
];

/**
 * The standing instruction block. Written for the MODEL, in English; the model answers the user in the
 * user's own language, as the rest of the free prompt already requires.
 */
export function freeChatModeGuide(): string {
  const experts = modeExperts();
  const medical = experts.filter((e) => e.medical).map((e) => e.name);
  const names = experts.map((e) => e.name).join(', ');
  return [
    'WHERE THINGS ARE IN NAVBHARATAI — THE "MODE" BUTTON (you must know this and use it):',
    '• Under this chat there is a **Mode** button (in the bottom bar on a phone; beside the message box on a computer). Tapping it opens a list with two groups: "Recent chat" (every chat open right now — tap one to go straight back to it, ✕ closes it) and "New chat" (tap any row to start a fresh conversation with that AI). Up to 5 chats can be open at once.',
    '• "New chat" contains, in this order:',
    '  1. **NavBharatAI FREE** — a brand-new free chat like this one (the old one stays in History).',
    `  2. **${IMAGE_STUDIO_MODE_NAME}** — THE place where pictures are made (${imagePriceSentence()}): photos, logos, banners, app icons, posters, avatars, backgrounds, thumbnails. Choose Image type, Style and Size, describe the picture, press send. It can also change a photo the user attaches, and add text that is always spelled correctly (a shop name, a phone number, Hindi) with its "Add text" button.`,
    `  3. **Expert AIs**, each a separate chat that specialises in one field: ${names}.`,
    `• ${medical.join(', ')} are on the NavBharatAI website (navbharatai.com); the phone app does not show them.`,
    '• NavBharatAI Pro (the app builder) is NOT in Mode — it has its own tile on the Home screen.',
    'PICTURES: you do NOT make pictures in this chat — never pretend to, and never just say "I cannot make images". When the user wants any image or photo, tell them warmly and exactly where it is made: tap **Mode** → **' + IMAGE_STUDIO_MODE_NAME + '**, describe the picture there, and press send. Offer to help them write a good description if they like.',
    'EXPERTS: when a question clearly belongs to one of the expert AIs above (studies, law, tax, farming, cooking, and so on), answer it well yourself, then mention in one line that the matching expert is in **Mode** for deeper, dedicated help. Name only experts that are in the list above.',
  ].join('\n');
}

/**
 * Added to THIS turn when the free chat is asked for a picture. The standing guide already says it;
 * this makes it the one thing the reply must do, so the answer leads with the way to the studio.
 */
export const FREE_IMAGE_REQUEST_DIRECTIVE =
  'THIS MESSAGE ASKS FOR A PICTURE. Do not describe or imagine one, and do not say only that you cannot. '
  + `Reply briefly and warmly, in the user's language: pictures are made in **${IMAGE_STUDIO_MODE_NAME}** — `
  + `tap **Mode** (below this chat) → **${IMAGE_STUDIO_MODE_NAME}**, describe the picture, press send (${imagePriceSentence()}). `
  + 'Then, if it helps, give them a ready-to-paste description of the picture they asked for, in one or two lines.';
