/**
 * NAVBHARATAI'S PUBLIC PRODUCT PAGES — the words, and the one place they are written (SEO audit
 * 2026-10-18).
 *
 * WHY THESE EXIST. Every path on navbharatai.com except the legal pages answered with the SPA shell:
 * a crawler that does not run JavaScript received "NavBharatAI — Starting up…" and nothing else, and
 * there was no page at all that explained, in words a search engine can read, what NavBharatAI is,
 * what it costs, or who makes it. These pages are rendered on the SERVER (lib/marketingPages.ts),
 * like the Privacy Policy, so the first response is the whole page.
 *
 * 🔒 EVERY CLAIM HERE IS ANCHORED IN THE CODE, the same discipline as src/content/about.ts:
 * - Languages (Hindi, English, Hinglish): the home screen's own product cards (HomeView.tsx).
 * - Live preview, publish on a link, export, App Mart behaviour: HomeView.tsx's App Mart card and
 *   about.ts. Plan numbers are IMPORTED from src/lib/hostingTiers.ts, never retyped.
 * - Build billing — TWO different rules, and the copy must never blur them (SEO verification
 *   2026-10-18, P1-B). The wording is FAILED_BUILD_RULE / STOPPED_BUILD_RULE below, and
 *   tests/theSiteHasOneIdentity.test.ts pins it against the code:
 *     · a build that FAILS (`!ok` for any cause except the user's Stop) bills ₹0 —
 *       `zeroBillForFailedBuild` in src/server/routes/agentv3.ts;
 *     · a build the USER STOPS is billed by `decideCancelledBuildBill`
 *       (src/server/AgentV3/cancelledBuildBilling.ts): ₹0 when nothing at all was written, when only our
 *       untouched template was in place AND nothing was seen running, or when it was an edit never verified
 *       running; the work done once files existed and an app was seen running — EVEN IF THAT APP IS STILL
 *       ONLY OUR STARTER (`working-app` sits above `seed-only`; round 3, B1); and
 *       `min(work done, max(real cost, work done / 2))` when a new app's own files were saved but nothing
 *       was seen running. Unsend and a typed "stop" are the same `user-stop`. A Stop that lands after the
 *       build already succeeded gets the same rules (`lateStopIsFree`, round 3, B2). Closing the app does
 *       not stop a build. tests/aStopIsBilledTheSameWheneverItLands.test.ts pins every case.
 *   "A build that does not produce a working app is not charged" is FALSE for a stopped build with
 *   files saved — never write it.
 * - AI infrastructure: the Privacy Policy, Section 4 — "NavBharatAI's engine, which runs on
 *   enterprise AI infrastructure". The White-Label Law (CLAUDE.md) forbids naming a model vendor on a
 *   user-facing page, and honesty forbids the opposite error: NOTHING here may say NavBharatAI trained
 *   or owns an Indian foundation model. "Made in India" means the PRODUCT is built in India.
 *
 * ⚠️ WHAT MUST NEVER BE ADDED: user counts, ratings, testimonials, awards, certifications, "#1",
 * speed or accuracy figures, or any guarantee about search ranking. A public page that charges money
 * is a public claim (about.ts says why). Keep the copy ENGLISH (the UI language rule); Hindi and
 * Hinglish appear only as EXAMPLES of what a user may type.
 */

import { HOSTING_TIERS, FREE_PUBLISHED_APPS, FREE_FRONTEND_GB } from '../lib/hostingTiers';
import { TOKENS_PER_RUPEE } from '../lib/walletPricing';

/** The official production origin — used in structured data, which must name ONE canonical site. */
export const OFFICIAL_SITE_URL = 'https://navbharatai.com/';
export const OFFICIAL_NAME = 'NavBharatAI';
export const OFFICIAL_ALT_NAMES: readonly string[] = ['NavBharat AI', 'Nav Bharat AI'];
export const OFFICIAL_CONTACT_EMAIL = 'info@navbharatai.com';
export const OFFICIAL_LOGO_URL = 'https://navbharatai.com/logo.png';

/** The public Google Play listing (src/lib/appDownload.ts PUBLIC_LISTING_URL — same value). */
export const PLAY_LISTING_URL = 'https://play.google.com/store/apps/details?id=com.navbharat.ai';

/**
 * OFFICIAL SOCIAL PROFILES. ⚠️ TODO(owner): EMPTY ON PURPOSE — no official profile URL exists anywhere
 * in this repo or on the live site, and inventing one would point search engines (schema `sameAs`)
 * and readers at an account we may not control. Add the real URLs here (X, Instagram, YouTube,
 * LinkedIn, Facebook…) and they appear on /about and in the Organization structured data by
 * construction. Only accounts the owner actually controls.
 */
export const OFFICIAL_SOCIAL_PROFILES: ReadonlyArray<{ label: string; url: string }> = [];

/** Every official profile a search engine may tie to the Organization: app listing + socials. */
export function officialSameAs(): string[] {
  return [PLAY_LISTING_URL, ...OFFICIAL_SOCIAL_PROFILES.map((p) => p.url)];
}

export interface MarketingSection {
  heading: string;
  /** Inline Markdown subset (renderInline): **bold**, *italic*, `code`, [text](/path or https://). */
  paragraphs?: string[];
  bullets?: string[];
}

export interface MarketingFaq { q: string; a: string }

export interface MarketingPage {
  path: string;
  /** The <title>. Under ~60 characters, brand last. */
  title: string;
  /** The meta description / search snippet. Under ~160 characters. */
  description: string;
  h1: string;
  intro: string[];
  sections: MarketingSection[];
  faq?: MarketingFaq[];
  cta: { label: string; href: string };
  /** Other public pages this one links to, so no page is an orphan. */
  related: string[];
}

/**
 * The two build-billing rules, in words a customer can rely on. ONE copy, used on /pricing and
 * /ai-app-builder, so the pages cannot drift apart. ⚠️ Change these only together with the code above.
 */
export const FAILED_BUILD_RULE =
  '**If a build fails, you are not charged for it.** "Fails" means the build ended without succeeding for any reason other than you stopping it.';
export const STOPPED_BUILD_RULE =
  '**If you stop a build, you pay only for work you keep.** Unsending your message or typing "stop" counts the same as pressing Stop. You pay nothing if nothing at all had been written yet; if only our untouched starter template was in place and no app had yet been seen running; or if you stopped a change to an existing app before it was seen working. Once files had been written and an app had been seen running in the preview, even if it was still only our starter template, you pay for the work done up to that point, not for a full build. If you were building a new app, files of your own were saved, and no app had yet been seen running, you pay half of the work done so far, or what that work actually cost to run if that is more, and never more than the work done. This holds even if your Stop arrives after the build has finished and only its final checks are still running. Closing the app or losing your signal does not stop a build: it carries on and is billed normally.';

/**
 * The same two rules without the bold markers, for plain-text readers: the in-app AI knowledge base
 * (src/server/AppContext/AppKnowledgeBase.ts) quotes them verbatim, so what an AI tells a user about a
 * failed or stopped build is the public rule, word for word (pre-deploy review round 4).
 */
export const FAILED_BUILD_RULE_PLAIN = FAILED_BUILD_RULE.replace(/\*\*/g, '');
export const STOPPED_BUILD_RULE_PLAIN = STOPPED_BUILD_RULE.replace(/\*\*/g, '');

const tierLine = (t: (typeof HOSTING_TIERS)[number]) =>
  `**${t.name} — ₹${t.priceInr} for ${t.days} days.** ${t.tagline}`;

export const AI_APP_BUILDER_PATH = '/ai-app-builder';
export const INDIAN_AI_ASSISTANT_PATH = '/indian-ai-assistant';
export const HINDI_AI_ASSISTANT_PATH = '/hindi-ai-assistant';
export const ABOUT_PATH = '/about';
export const PRICING_PATH = '/pricing';

export const AI_APP_BUILDER_PAGE: MarketingPage = {
  path: AI_APP_BUILDER_PATH,
  title: 'AI App Builder & AI Website Builder — NavBharatAI',
  description:
    'Describe the app, website or game you want in Hindi, English or Hinglish. NavBharatAI builds it, shows it running in a live preview and publishes it on a link.',
  h1: 'AI app builder: describe it, see it running, publish it',
  intro: [
    'NavBharatAI Pro is an AI app and website builder. You describe what you want in plain words — in Hindi, English or Hinglish — and NavBharatAI plans it, writes the code, shows it to you running in a live preview, and publishes it on its own link.',
    'You do not need to know how to code, and you do not need a laptop: the whole flow works in the browser on a phone, and in the NavBharatAI Android app.',
  ],
  sections: [
    {
      heading: 'How it works',
      bullets: [
        '**Describe it.** "Ek billing app banao for my kirana shop", "a booking page for my clinic", "a quiz game for class 8 science" — one or two sentences is enough to start.',
        '**Answer a question if it asks one.** When a request is too vague to build well, NavBharatAI asks what you mean before it spends your money.',
        '**Watch it in the live preview.** The app runs as soon as it is built, so you can tap through it, not just read code.',
        '**Change it by talking.** "Make the button green", "add a GST column", "add a login screen" — each change is another message.',
        '**Publish it.** One tap puts the app on its own link that anyone can open. With a hosting plan you can connect your own domain.',
      ],
    },
    {
      heading: 'What you can build',
      paragraphs: [
        'Websites, web apps and games. The kind of software India actually runs is what NavBharatAI is built around: a shop billing app, a clinic appointment book, a school fee register, an invoice maker, a landing page for a small business, a mock-test app, a simple game.',
        'Apps can be built as installable web apps, and as Android apps (.apk) you can download and install.',
      ],
    },
    {
      heading: 'Your app belongs to you',
      bullets: [
        'Export the full source code of anything you build, whenever you want.',
        `Free accounts can keep up to ${FREE_PUBLISHED_APPS} apps published. [Hosting plans](/pricing) add more apps, your own domain, apps with a real server, and remove the "Made with NavBharatAI" badge.`,
        'Apps you publish can be shared on [App Mart](/store), where other people can play them in the browser.',
      ],
    },
    {
      heading: 'What it costs, honestly',
      paragraphs: [
        'Building is paid from your NavBharatAI wallet, in rupees, by UPI or card. Your bill is built from the work your build actually used. Both rules below are enforced inside the engine. See [Pricing](/pricing) for the details.',
        FAILED_BUILD_RULE,
        STOPPED_BUILD_RULE,
      ],
    },
    {
      heading: 'What it is not',
      paragraphs: [
        'AI can get things wrong. A first build is rarely perfect, and some requests take a few rounds of changes. NavBharatAI tells you plainly when a build struggles instead of showing a green tick it has not earned. For anything important — money, health, legal or personal data — check the app carefully before you rely on it.',
      ],
    },
  ],
  faq: [
    { q: 'Do I need to know coding?', a: 'No. You describe the app in your own words. If you do know code, you can read and export everything NavBharatAI writes.' },
    { q: 'Can I build in Hindi?', a: 'Yes. Write your request in Hindi, Hinglish or English. The app itself can be in whichever language you ask for.' },
    { q: 'Can I use my own domain?', a: 'Yes, with a hosting plan. Free accounts publish on a NavBharatAI link.' },
    { q: 'What happens if a build fails?', a: 'You are not charged for it. A build fails when it ends without succeeding for any reason other than you stopping it.' },
    { q: 'What if I stop a build myself?', a: 'Stopping is not a failure, so it is not automatically free. Unsending your message or typing "stop" counts as stopping. You pay only for work you keep: nothing if none of your own app had been written yet and no app had been seen running, and otherwise nothing, part or all of the work done so far depending on what you keep, never more. If our starter template was already running in the preview, that counts as an app you keep. The exact rule is on the Pricing page.' },
  ],
  cta: { label: 'Start building', href: '/' },
  related: [PRICING_PATH, INDIAN_AI_ASSISTANT_PATH, HINDI_AI_ASSISTANT_PATH, ABOUT_PATH],
};

export const INDIAN_AI_ASSISTANT_PAGE: MarketingPage = {
  path: INDIAN_AI_ASSISTANT_PATH,
  title: 'Indian AI Assistant for Everyday Work — NavBharatAI',
  description:
    'NavBharatAI is an AI assistant built in India for Indian users: chat in Hindi, English or Hinglish, pay in rupees by UPI, and get help with study, work and business.',
  h1: 'An AI assistant built in India, for the way India works',
  intro: [
    'NavBharatAI is an AI platform made in India, by an Indian founder, for Indian users. It brings together an AI chat assistant, specialist assistants for everyday Indian needs, and an [AI app builder](/ai-app-builder) — in one app, on the web and on Android.',
  ],
  sections: [
    {
      heading: 'What the assistant helps with',
      bullets: [
        '**Everyday questions and learning** — explanations, ideas, summaries, translations and creative writing in **NavBharatAI Chat**.',
        '**Specialist assistants** for common Indian needs, for example Teacher AI, CA / Tax & Accounts, Govt Schemes Helper, Kisan / Agri Advisor, Resume & Job-Application AI and Spoken English tutor.',
        '**Turning an idea into software** — when the answer is "I need an app for this", the same account can build it.',
      ],
    },
    {
      heading: 'Built for India, not translated for it',
      bullets: [
        'Speaks the way India types: Hindi, English, or a mix of both. "Mujhe GST samjhao" is a normal question here.',
        'Pays the way India pays: top up your wallet in rupees by UPI or card, through an Indian payment gateway.',
        'Answers to Indian law, with a named [Grievance Officer](/grievance) and published response timelines.',
        'Works on the phone most people actually own — in the browser, or in the [Android app](https://play.google.com/store/apps/details?id=com.navbharat.ai).',
      ],
    },
    {
      heading: '"Made in India" — what that does and does not mean',
      paragraphs: [
        'The NavBharatAI product — the app, the builder, the assistants, the billing and the hosting — is designed and built in India. Like most AI products, the language models underneath run on enterprise AI infrastructure from AI providers, who process your prompts only to produce your answer and are contractually required not to use them for training. Our [Privacy Policy](/privacy) explains this in Section 4. NavBharatAI has not trained a foundation model of its own, and does not claim to.',
      ],
    },
    {
      heading: 'Your data',
      paragraphs: [
        'We do not sell your personal data, we do not show third-party advertising inside NavBharatAI, and we never use the private content of your chats, your files or your apps to train any AI model. The full details are in the [Privacy Policy](/privacy).',
      ],
    },
    {
      heading: 'Use it with care',
      paragraphs: [
        'AI answers can be wrong. For health, legal, tax or money decisions, treat the assistant as a starting point and confirm with a qualified professional.',
      ],
    },
  ],
  faq: [
    { q: 'Is NavBharatAI free?', a: 'NavBharatAI Chat is offered free. Building apps, some specialist assistants and voice features are paid from your wallet, and the price is shown before you spend. See Pricing.' },
    { q: 'Which languages does it understand?', a: 'Hindi, English and Hinglish (Hindi written in English letters) are the languages the product is designed around.' },
    { q: 'Is there an app?', a: 'Yes — NavBharatAI is on Google Play, and it also works in any modern browser.' },
  ],
  cta: { label: 'Open NavBharatAI', href: '/' },
  related: [HINDI_AI_ASSISTANT_PATH, AI_APP_BUILDER_PATH, PRICING_PATH, ABOUT_PATH],
};

export const HINDI_AI_ASSISTANT_PAGE: MarketingPage = {
  path: HINDI_AI_ASSISTANT_PATH,
  title: 'Hindi AI Assistant — Chat in Hindi & Hinglish | NavBharatAI',
  description:
    'Ask NavBharatAI anything in Hindi, in Hinglish (Hindi in English letters) or in English. Learn, write, translate and even build apps in the language you think in.',
  h1: 'A Hindi AI assistant that also understands Hinglish',
  intro: [
    'Most people in India do not type pure Hindi or pure English. They type both, often in the same sentence, and often in English letters. NavBharatAI is built for exactly that: write the way you speak, and it understands.',
  ],
  sections: [
    {
      heading: 'Three ways to write — all of them work',
      bullets: [
        // ⚠️ No Devanagari sample here: the UI language standard (tests/uiLanguageEnglishOnly.test.ts)
        // keeps every client file English-only. Whether a public SEO page may show one Devanagari
        // example is an OWNER decision, recorded in the SEO report.
        '**Hindi in Devanagari script:** type Hindi the way it is written, with a Hindi keyboard or voice typing — for example, a question asking for simple ways to cut your electricity bill.',
        '**Hinglish in English letters:** "Mujhe class 10 ke liye maths ka time table bana do"',
        '**English, or a mix:** "Explain GST in simple Hindi, with one example"',
      ],
      paragraphs: [
        'You can ask for the answer in a particular language — "Hindi me samjhao", "answer in simple English" — and switch any time in the same chat.',
      ],
    },
    {
      heading: 'What people use it for',
      bullets: [
        'Understanding a topic in simpler words — school and college subjects, exam preparation, government schemes.',
        'Writing and translating — applications, letters, messages, social posts, between Hindi and English.',
        'Everyday help — recipes, travel plans, a budget, a study plan.',
        'Building an app in Hindi — "Ek attendance app banao jisme students ke naam aur date ho" is a real instruction for the [AI app builder](/ai-app-builder).',
      ],
    },
    {
      heading: 'Speak instead of typing',
      paragraphs: [
        'Where voice input is available, NavBharatAI listens in your device\'s language rather than forcing English — so on a phone set to Hindi, what you say is transcribed as Hindi.',
      ],
    },
    {
      heading: 'Good to know',
      bullets: [
        'The NavBharatAI app\'s own buttons and menus are in English, so they can be read across India; your conversation can be in Hindi.',
        'AI answers can be wrong, in any language. Check anything important before you rely on it.',
      ],
    },
  ],
  faq: [
    { q: 'Can I type Hindi in English letters?', a: 'Yes. Hinglish such as "kal ka mausam kaisa rahega" is understood like any other question.' },
    { q: 'Will it answer in Hindi?', a: 'Ask for it — "Hindi me jawab do" — and the assistant is designed to reply in the language you ask for.' },
    { q: 'Is it free?', a: 'NavBharatAI Chat is offered free. Paid features show their price before you spend anything. See Pricing.' },
  ],
  cta: { label: 'Start a chat', href: '/' },
  related: [INDIAN_AI_ASSISTANT_PATH, AI_APP_BUILDER_PATH, PRICING_PATH, ABOUT_PATH],
};

export const PRICING_PAGE: MarketingPage = {
  path: PRICING_PATH,
  title: 'Pricing — NavBharatAI',
  description:
    `NavBharatAI pricing in rupees: free chat, pay-as-you-go app building from your wallet, and hosting plans from ₹${HOSTING_TIERS[0].priceInr} for ${HOSTING_TIERS[0].days} days.`,
  h1: 'Pricing',
  intro: [
    'NavBharatAI has no compulsory monthly subscription. You top up a wallet in rupees and pay for the work you actually use. Hosting plans are optional and add more published apps, your own domain and apps with a real server.',
  ],
  sections: [
    {
      heading: 'Free',
      bullets: [
        'NavBharatAI Chat, in Hindi, English and Hinglish.',
        'Playing apps and games on [App Mart](/store) — no account needed.',
        `Keep up to ${FREE_PUBLISHED_APPS} apps published on a NavBharatAI link, with up to ${FREE_FRONTEND_GB} GB of visitor traffic a month. Free apps carry a small "Made with NavBharatAI" badge and cannot run a server.`,
      ],
    },
    {
      heading: 'Pay as you go — your wallet',
      bullets: [
        `Top up your wallet in rupees by UPI or card. ₹1 buys ${TOKENS_PER_RUPEE} wallet tokens.`,
        'Building and changing apps is paid from the wallet, based on the work each build actually used.',
        FAILED_BUILD_RULE,
        STOPPED_BUILD_RULE,
        'Some features — voice chat, some specialist assistants, Android .apk builds — are paid, and the price is shown before you use them.',
        'Any platform fee on a top-up is shown on the payment screen before you pay.',
      ],
    },
    {
      heading: 'Hosting plans',
      paragraphs: [
        ...HOSTING_TIERS.map(tierLine),
        'A plan is paid from your wallet and renews only while auto-renew is on; you can switch auto-renew off at any time. If a plan ends, your first apps stay online free and none of your files are deleted.',
      ],
      bullets: HOSTING_TIERS.map((t) => `**${t.name}:** ${t.includes.join('; ')}.`),
    },
    {
      heading: 'Refunds',
      paragraphs: [
        'The exact rules for refunds and cancellations are in our [Refund & Cancellation Policy](/refund). Prices are in Indian Rupees (₹). The price shown inside the app at the moment you pay is the one that applies.',
      ],
    },
  ],
  cta: { label: 'Open NavBharatAI', href: '/' },
  related: [AI_APP_BUILDER_PATH, ABOUT_PATH, '/refund', '/contact'],
};

/** The four product pages (About is rendered from about.ts — see marketingPages.ts). */
export const MARKETING_PAGES: readonly MarketingPage[] = [
  AI_APP_BUILDER_PAGE, INDIAN_AI_ASSISTANT_PAGE, HINDI_AI_ASSISTANT_PAGE, PRICING_PAGE,
];

/** Every server-rendered product path, About included. */
export const MARKETING_PATHS: readonly string[] = [ABOUT_PATH, ...MARKETING_PAGES.map((p) => p.path)];

/** Labels for links between the public pages. */
export const PAGE_LABELS: Readonly<Record<string, string>> = {
  [ABOUT_PATH]: 'About NavBharatAI',
  [PRICING_PATH]: 'Pricing',
  [AI_APP_BUILDER_PATH]: 'AI App Builder',
  [INDIAN_AI_ASSISTANT_PATH]: 'Indian AI Assistant',
  [HINDI_AI_ASSISTANT_PATH]: 'Hindi AI Assistant',
  '/refund': 'Refund & Cancellation Policy',
  '/contact': 'Contact',
  '/store': 'App Mart',
};
