// SERVER-RENDERED PUBLIC PRODUCT PAGES — /about, /pricing, /ai-app-builder, /indian-ai-assistant,
// /hindi-ai-assistant (SEO audit 2026-10-18).
//
// Same architecture as the legal pages (legalMarkdown.ts), for the same reason: the SPA shell gives a
// crawler that does not run JavaScript one line — "Starting up…" — so a page that exists to be FOUND
// must arrive as complete HTML in the first response. No script runs here (the only <script> is
// JSON-LD data), no external stylesheet, no font host: it renders the same for a crawler, a link
// preview and a user on a slow phone, and nothing in the app can break it.
//
// The words live in src/content/marketing.ts and src/content/about.ts. Every string is HTML-escaped
// FIRST and then given the small inline-Markdown subset (renderInline), so content cannot inject
// markup. PURE.

import { escapeHtml, renderInline, publicFooterHtml } from './legalMarkdown';
import { jsonLdScript, pageJsonLd } from './siteSchema';
import {
  PAGE_LABELS, PLAY_LISTING_URL, OFFICIAL_SOCIAL_PROFILES, ABOUT_PATH,
  AI_APP_BUILDER_PATH, INDIAN_AI_ASSISTANT_PATH, HINDI_AI_ASSISTANT_PATH, PRICING_PATH,
  type MarketingPage, type MarketingSection,
} from '../../content/marketing';
import { aboutContent, type AboutOverrides } from '../../content/about';

const md = (text: string) => renderInline(escapeHtml(text));

/** Social / link-preview image. Absolute — crawlers do not reliably resolve a relative og:image. */
export const OG_IMAGE_PATH = '/og-image.png';

interface ShellInput {
  origin: string;
  path: string;
  title: string;
  description: string;
  bodyHtml: string;
  jsonLd: unknown;
}

function pageShell(i: ShellInput): string {
  const url = `${i.origin}${i.path}`;
  const t = escapeHtml(i.title);
  const d = escapeHtml(i.description);
  const img = `${i.origin}${OG_IMAGE_PATH}`;
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${escapeHtml(url)}">
<link rel="icon" type="image/png" href="/logo.png">
<meta name="theme-color" content="#4f46e5">
<meta property="og:site_name" content="NavBharatAI">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="NavBharatAI — AI chat in Hindi, English and Hinglish, and an AI app builder">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${escapeHtml(img)}">
${jsonLdScript(i.jsonLd)}
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #ffffff; color: #16161d;
    font: 17px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", sans-serif; }
  header.top { max-width: 46rem; margin: 0 auto; padding: 1rem 1.25rem 0; display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  header.top a.brand { font-weight: 800; letter-spacing: .04em; text-decoration: none; color: inherit; }
  header.top nav a { margin-left: .9rem; font-size: .95rem; }
  main { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1.25rem 2.5rem; }
  h1 { font-size: 2rem; line-height: 1.2; margin: .5rem 0 1rem; }
  h2 { font-size: 1.3rem; margin: 2.2rem 0 .6rem; }
  h3 { font-size: 1.05rem; margin: 1.2rem 0 .3rem; }
  p, li { margin: .6rem 0; }
  ul { padding-left: 1.4rem; }
  a { color: #4f46e5; }
  .cta { display: inline-block; margin: 1rem 0; padding: .75rem 1.3rem; border-radius: 12px; background: #4f46e5; color: #fff; text-decoration: none; font-weight: 700; }
  .related { border-top: 1px solid #e2e2ea; margin-top: 2.5rem; padding-top: 1rem; }
  .site-foot { max-width: 46rem; margin: 0 auto; padding: 0 1.25rem 3rem; font-size: .9rem; line-height: 2; }
  @media (prefers-color-scheme: dark) {
    body { background: #101017; color: #e9e9f2; }
    a { color: #9b95ff; }
    .cta { background: #6d66ff; color: #fff; }
    .related { border-top-color: #2c2c39; }
  }
</style>
</head>
<body>
<header class="top"><a class="brand" href="/">NavBharatAI</a><nav aria-label="Main"><a href="${AI_APP_BUILDER_PATH}">App Builder</a><a href="${INDIAN_AI_ASSISTANT_PATH}">AI Assistant</a><a href="${PRICING_PATH}">Pricing</a><a href="${ABOUT_PATH}">About</a></nav></header>
<main>
${i.bodyHtml}
</main>
${publicFooterHtml()}
</body>
</html>`;
}

function sectionHtml(s: MarketingSection): string {
  const parts = [`<h2>${md(s.heading)}</h2>`];
  for (const p of s.paragraphs ?? []) parts.push(`<p>${md(p)}</p>`);
  if (s.bullets?.length) parts.push(`<ul>\n${s.bullets.map((b) => `<li>${md(b)}</li>`).join('\n')}\n</ul>`);
  return parts.join('\n');
}

function relatedHtml(paths: readonly string[]): string {
  const links = paths.map((p) => `<li><a href="${escapeHtml(p)}">${escapeHtml(PAGE_LABELS[p] ?? p)}</a></li>`).join('\n');
  return `<section class="related"><h2>Related</h2>\n<ul>\n${links}\n</ul></section>`;
}

/** One of the four product pages in content/marketing.ts. */
export function renderMarketingPage(page: MarketingPage, origin: string): string {
  const body = [
    `<h1>${md(page.h1)}</h1>`,
    ...page.intro.map((p) => `<p>${md(p)}</p>`),
    `<p><a class="cta" href="${escapeHtml(page.cta.href)}">${escapeHtml(page.cta.label)}</a></p>`,
    ...page.sections.map(sectionHtml),
  ];
  if (page.faq?.length) {
    body.push('<h2>Questions people ask</h2>');
    for (const f of page.faq) body.push(`<h3>${md(f.q)}</h3>\n<p>${md(f.a)}</p>`);
  }
  body.push(relatedHtml(page.related));
  return pageShell({
    origin, path: page.path, title: page.title, description: page.description,
    bodyHtml: body.join('\n'),
    jsonLd: pageJsonLd({ url: `${origin}${page.path}`, name: page.title, description: page.description }),
  });
}

export const ABOUT_TITLE = 'About NavBharatAI — AI Assistant & App Builder Made in India';
export const ABOUT_DESCRIPTION =
  'What NavBharatAI is, who builds it, how it charges, what it promises about your data, and how to reach us. An AI platform built in India.';

/** /about — the shipped About Us copy (content/about.ts) with the admin's saved overrides on top. */
export function renderAboutPage(origin: string, overrides?: AboutOverrides | null): string {
  const a = aboutContent(overrides);
  const officialLinks: string[] = [
    `<li><a href="${PLAY_LISTING_URL}" rel="noopener">NavBharatAI on Google Play</a> (Android app <code>com.navbharat.ai</code>)</li>`,
    ...OFFICIAL_SOCIAL_PROFILES.map((p) => `<li><a href="${escapeHtml(p.url)}" rel="noopener me">${escapeHtml(p.label)}</a></li>`),
  ];
  const email = escapeHtml(a.contactEmail);
  const body = [
    `<h1>About NavBharatAI</h1>`,
    `<p><strong>${md(a.headline)}.</strong> ${md(a.tagline)}</p>`,
    `<p>${md(a.description)}</p>`,
    `<h2>${md(a.whatWeBuildHeading)}</h2>\n<ul>\n${a.whatWeBuild.map((x) => `<li>${md(x)}</li>`).join('\n')}\n</ul>`,
    `<p>Read more: <a href="${AI_APP_BUILDER_PATH}">the AI app builder</a> · <a href="${INDIAN_AI_ASSISTANT_PATH}">the AI assistant</a> · <a href="${HINDI_AI_ASSISTANT_PATH}">chatting in Hindi and Hinglish</a> · <a href="/store">App Mart</a>.</p>`,
    `<h2>${md(a.indiaFirstHeading)}</h2>\n<ul>\n${a.indiaFirst.map((x) => `<li>${md(x)}</li>`).join('\n')}\n</ul>`,
    `<h2>What runs underneath</h2>\n<p>NavBharatAI is designed and built in India. Its engine runs on enterprise AI infrastructure from AI providers, who process your prompts only to produce your answer or build; see Section 4 of our <a href="/privacy">Privacy Policy</a>. NavBharatAI does not claim to have trained its own foundation model.</p>`,
    `<h2>${md(a.teamHeading)}</h2>\n<p>${md(a.team)}</p>`,
    `<h2>${md(a.visionHeading)}</h2>\n<p>${md(a.vision)}</p>`,
    `<h2>${md(a.promisesHeading)}</h2>\n${a.promises.map((p) => `<h3>${md(p.title)}</h3>\n<p>${md(p.body)}</p>`).join('\n')}`,
    `<h2>Pricing</h2>\n<p>Chat is offered free; building is paid from a rupee wallet, and hosting plans are optional. The details are on the <a href="${PRICING_PATH}">Pricing</a> page.</p>`,
    `<h2>${md(a.honestyHeading)}</h2>\n<p>${md(a.honesty)}</p>`,
    `<h2>${md(a.contactHeading)}</h2>\n<p>Email <a href="mailto:${email}">${email}</a> — in English or Hindi. See <a href="/contact">Contact</a> for what to write about and how quickly we answer, and <a href="/grievance">Grievance Redressal</a> for formal complaints.</p>`,
    `<h2>Official links</h2>\n<ul>\n${officialLinks.join('\n')}\n</ul>`,
    `<p><a class="cta" href="/">${escapeHtml(a.ctaLabel)}</a></p>`,
  ];
  return pageShell({
    origin, path: ABOUT_PATH, title: ABOUT_TITLE, description: ABOUT_DESCRIPTION,
    bodyHtml: body.join('\n'),
    jsonLd: pageJsonLd({ url: `${origin}${ABOUT_PATH}`, name: ABOUT_TITLE, description: ABOUT_DESCRIPTION, type: 'AboutPage' }),
  });
}
