/**
 * ABOUT US — the page's real content, and the one place it is written.
 *
 * 🔴 WHY THIS FILE EXISTS (admin 2026-09-20, asked what About Us should contain).
 *
 * The page carried FOUR short lines — a headline, one sentence, "Built with ❤️ by a passionate
 * developer", and "To make Bharat a global leader in AI". Nothing a person could use to decide
 * whether to trust an app that takes their money: not what it does, not who made it, not what
 * happens to their data, not how to reach anybody.
 *
 * 🔒 EVERY CLAIM HERE IS ANCHORED IN SOMETHING THIS REPO CAN SHOW.
 * - The promises come from the Privacy Policy's own "What we do NOT do" paragraph, deliberately in
 *   ITS words, so the two pages can never say different things. `tests/aboutUsTellsTheTruth.test.ts`
 *   asserts that against the real policy text — the same discipline `privacyPolicyTruth.test.ts`
 *   already applies to the Meta pixel.
 * - "Working app or free" is a real billing rule (`zeroBillForFailedBuild`), not a slogan.
 * - The founder text is the admin's OWN wording, already shipped in `DEFAULT_DONATION_DATA`.
 *
 * ⚠️ WHAT MUST NEVER BE ADDED: a team size, a user count, an investor, a certification, an award, or
 * a company name before one legally exists. About Us looks like marketing and is in fact a PUBLIC
 * CLAIM by a business that charges money — and this account has already taken one Play policy strike.
 * A sentence nobody can prove does not belong on this page.
 *
 * ⚠️ ENGLISH ONLY, and the reason is the admin's own (2026-09-14): *"south india wale kaise padhenge
 * isko??"* Devanagari is not a national script. Romanised Hindi in a brand line ("Bharat Ka Apna AI")
 * is fine and is not what that rule forbids.
 */

/** The parts an admin may change from inside the app without a deploy. */
export interface AboutOverrides {
  logoUrl?: string;
  headline?: string;
  description?: string;
  team?: string;
  vision?: string;
  contactEmail?: string;
}

export interface AboutPromise {
  title: string;
  body: string;
}

export interface AboutContent {
  logoUrl: string;
  headline: string;
  tagline: string;
  description: string;
  whatWeBuildHeading: string;
  whatWeBuild: string[];
  indiaFirstHeading: string;
  indiaFirst: string[];
  teamHeading: string;
  team: string;
  visionHeading: string;
  vision: string;
  promisesHeading: string;
  promises: AboutPromise[];
  honestyHeading: string;
  honesty: string;
  contactHeading: string;
  contactEmail: string;
  ctaLabel: string;
}

/** The longest an override may be. Past this it is not a headline or a paragraph, it is a payload. */
export const ABOUT_FIELD_LIMITS: Record<keyof AboutOverrides, number> = {
  logoUrl: 500,
  headline: 80,
  description: 400,
  team: 800,
  vision: 500,
  contactEmail: 120,
};

export const DEFAULT_ABOUT: AboutContent = {
  logoUrl: '',
  headline: 'Bharat Ka Apna AI',

  // What it IS, in one line. The old description said "a mission to empower every Indian with the
  // power of Artificial Intelligence" — true in spirit and useless in practice: it never says what
  // the app does.
  tagline: 'Describe your app. NavBharatAI builds it.',
  description:
    'NavBharatAI is India\'s own AI app builder. Tell it what you want in Hindi or English — '
    + 'a shop billing app, a clinic appointment book, a school fee register — and a working app is '
    + 'built, shown to you running, and published on a real link. No coding, no setup, no laptop needed.',

  whatWeBuildHeading: 'What you can do here',
  whatWeBuild: [
    'Build a working app from a plain description, in Hindi, Hinglish or English.',
    'See it running in a live preview, then publish it on its own link in one tap.',
    'Get the code itself — export your project whenever you want, it is yours.',
    'Ask our professional assistants for help: Doctor AI, Engineer AI, and more.',
  ],

  indiaFirstHeading: 'Built for India, not translated for it',
  indiaFirst: [
    'Speaks the way India types. "Ek billing app banao" is a valid instruction here.',
    'Pays the way India pays. Top up with UPI or a card, in rupees, to an Indian account.',
    'Builds what India actually runs — shops, clinics, schools, invoices, GST, appointments.',
    'Answers to Indian law, with a named Grievance Officer you can write to.',
  ],

  teamHeading: 'Who builds it',
  // The admin's own words, already shipped inside the app's donation panel — not a story invented here.
  team:
    'NavBharatAI is built by Dr. Asheesh, a doctor by profession, who started building it alone and '
    + 'through sheer hard work — because India deserved an AI app builder made for India, not a '
    + 'translated copy of a tool built somewhere else. It is still built with that same care, in India.',

  visionHeading: 'Where we are going',
  vision:
    'That one day NavBharatAI is the most powerful, most intelligent and most useful AI app builder — '
    + 'not only in India, but in the world. And that a person with an idea and no technical background '
    + 'can turn it into a real, working app in minutes.',

  promisesHeading: 'What we promise you',
  promises: [
    {
      title: 'A working app, or it is free',
      body: 'If a build does not produce a working app, you are not charged for it. That is a rule inside the engine, not a goodwill gesture.',
    },
    {
      title: 'You pay what it really cost',
      body: 'Your bill is built from the real work your build actually used. No hidden charge, no monthly subscription you forgot to cancel.',
    },
    {
      title: 'Your app belongs to you',
      body: 'Export the full source code of anything you build, whenever you like. We never hold your work hostage.',
    },
    {
      title: 'Your data is not for sale',
      body: 'We do not sell your personal data, we do not show third-party advertising inside NavBharatAI, and we never use the private content of your chats, your files or your apps to train any AI model.',
    },
  ],

  honestyHeading: 'We are early, and we say so',
  honesty:
    'NavBharatAI is young and improves every week. Some things are not perfect yet, and when something '
    + 'does not work we would rather tell you plainly than hide it behind a green tick. If a build '
    + 'struggles, the app says so — and we fix the cause, not the message.',

  contactHeading: 'Reach us',
  // ⚠️ THE ADDRESS THE PRODUCT ALREADY PUBLISHES, not a new one. The first draft of this file invented
  // `support@navbharatai.com`; a grep of the legal pages shows `info@navbharatai.com` in fourteen
  // places and that one nowhere. An About page carrying a mailbox nobody reads is worse than no
  // address at all — it looks like a way to reach a human and is not one.
  contactEmail: 'info@navbharatai.com',
  ctaLabel: 'Start building',
};

/** A string that is present and not just whitespace — an empty override must never blank a field. */
function usable(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * The code copy, with the admin's saved overrides applied on top. PURE.
 *
 * 🔒 An override can only REPLACE a field that exists here — it can never add one, and a blank or
 * missing value falls back to the shipped copy rather than emptying the page. So a half-saved or
 * corrupt record degrades to the good default instead of showing a user an empty screen.
 */
export function aboutContent(overrides?: AboutOverrides | null): AboutContent {
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  return {
    ...DEFAULT_ABOUT,
    logoUrl: usable(o.logoUrl, ABOUT_FIELD_LIMITS.logoUrl) ?? DEFAULT_ABOUT.logoUrl,
    headline: usable(o.headline, ABOUT_FIELD_LIMITS.headline) ?? DEFAULT_ABOUT.headline,
    description: usable(o.description, ABOUT_FIELD_LIMITS.description) ?? DEFAULT_ABOUT.description,
    team: usable(o.team, ABOUT_FIELD_LIMITS.team) ?? DEFAULT_ABOUT.team,
    vision: usable(o.vision, ABOUT_FIELD_LIMITS.vision) ?? DEFAULT_ABOUT.vision,
    contactEmail: usable(o.contactEmail, ABOUT_FIELD_LIMITS.contactEmail) ?? DEFAULT_ABOUT.contactEmail,
  };
}

/** Keep only the fields an admin may set, trimmed and bounded. Anything else is dropped. */
export function sanitizeAboutOverrides(input: unknown): AboutOverrides {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out: AboutOverrides = {};
  for (const key of Object.keys(ABOUT_FIELD_LIMITS) as (keyof AboutOverrides)[]) {
    const value = usable(src[key], ABOUT_FIELD_LIMITS[key]);
    if (value !== null) out[key] = value;
  }
  return out;
}
