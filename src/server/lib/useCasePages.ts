// Server-rendered use-case pages, the same idea as the marketing pages: a crawler
// that does not run JavaScript receives the whole page. No user app is listed.
// The only script is JSON-LD. White-label: the copy says NavBharatAI, never an AI vendor.

import { escapeHtml, publicFooterHtml } from './legalMarkdown';
import { jsonLdScript, ORGANIZATION_ID } from './siteSchema';
import {
  USE_CASE_CTA_EN, USE_CASE_CTA_HI, USE_CASE_INDEX_PATH, USE_CASES,
  useCaseBuilderHref, useCasePath, type UseCasePage,
} from './useCaseCatalog';

const esc = escapeHtml;

function pageShell(opts: { origin: string; path: string; title: string; description: string; body: string; jsonLd: unknown }): string {
  const url = `${opts.origin}${opts.path}`;
  const t = esc(opts.title);
  const d = esc(opts.description);
  const img = `${opts.origin}/og-image.png`;
  return `<!doctype html>
<html lang="hi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${esc(url)}">
<link rel="alternate" hreflang="hi" href="${esc(url)}">
<link rel="alternate" hreflang="en" href="${esc(url)}">
<link rel="alternate" hreflang="x-default" href="${esc(url)}">
<link rel="icon" type="image/png" href="/logo-160.png">
<meta name="theme-color" content="#4f46e5">
<meta property="og:site_name" content="NavBharatAI">
<meta property="og:type" content="website">
<meta property="og:locale" content="hi_IN">
<meta property="og:locale:alternate" content="en_IN">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${esc(img)}">
${jsonLdScript(opts.jsonLd)}
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #fff; color: #16161d; font: 17px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif; }
  header.top, main, footer.site-foot { max-width: 46rem; margin: 0 auto; padding-left: 1.25rem; padding-right: 1.25rem; }
  header.top { padding-top: 1rem; display: flex; gap: 1rem; justify-content: space-between; flex-wrap: wrap; align-items: center; }
  header.top a.brand { font-weight: 800; color: inherit; text-decoration: none; }
  main { padding-top: 1.25rem; padding-bottom: 2.5rem; }
  h1 { font-size: 1.8rem; line-height: 1.25; margin: .4rem 0 1rem; }
  h2 { font-size: 1.25rem; margin: 1.8rem 0 .4rem; }
  a { color: #4f46e5; }
  .cta { display: flex; flex-direction: column; align-items: center; gap: .15rem; margin: 1rem 0; padding: .85rem 1.2rem; border-radius: 12px; background: #4f46e5; color: #fff; text-decoration: none; font-weight: 800; text-align: center; min-height: 44px; }
  .cta small { font-weight: 600; font-size: .85rem; opacity: .92; }
  .mock { border: 1px solid #e2e2ea; border-radius: 16px; padding: 1rem; margin: 1rem 0; }
  .mock figcaption { font-size: .9rem; margin-bottom: .6rem; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .35rem 0; border-bottom: 1px solid #e2e2ea; vertical-align: top; }
  td.r { text-align: right; white-space: nowrap; padding-left: .75rem; }
  ul { padding-left: 1.2rem; }
  .cards { list-style: none; padding: 0; }
  .cards li { margin: .8rem 0; }
  .note { font-size: .95rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #101017; color: #e9e9f2; }
    a { color: #b3adff; }
    .cta { background: #6d66ff; color: #fff; }
    .mock, td { border-color: #2c2c39; }
  }
</style>
</head>
<body>
<header class="top"><a class="brand" href="/">NavBharatAI</a><nav aria-label="Main"><a href="${USE_CASE_INDEX_PATH}">App ideas</a><a href="/ai-app-builder">App builder</a><a href="/pricing">Pricing</a></nav></header>
<main>
${opts.body}
</main>
${publicFooterHtml()}
</body>
</html>`;
}

function faqLd(page: UseCasePage, origin: string) {
  return {
    '@type': 'FAQPage',
    '@id': `${origin}${useCasePath(page.slug)}#faq`,
    mainEntity: page.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

function softwareLd(page: UseCasePage, origin: string) {
  const url = `${origin}${useCasePath(page.slug)}`;
  return {
    '@type': 'SoftwareApplication',
    '@id': `${url}#app`,
    name: page.title,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: page.description,
    inLanguage: ['hi', 'en'],
    url,
    publisher: { '@id': ORGANIZATION_ID },
    isPartOf: { '@id': `${origin}/#website` },
  };
}

function mockHtml(page: UseCasePage): string {
  const rows = page.mockRows.map((r) => `<tr><td>${esc(r.item)}</td><td class="r">${esc(r.detail)}</td></tr>`).join('');
  return `<figure class="mock"><figcaption>${esc(page.mockTitle)} — उदाहरण, काल्पनिक आंकड़े</figcaption><table>${rows}</table><p class="note">${esc(page.mockFoot)}</p></figure>`;
}

export function renderUseCasePage(page: UseCasePage, origin: string): string {
  const siblings = USE_CASES.filter((p) => p.slug !== page.slug).slice(0, 3);
  const body = [
    `<h1>${esc(page.h1)}</h1>`,
    `<p>${esc(page.storyHi)}</p>`,
    `<h2>इस ऐप में क्या होगा</h2>`,
    `<ul>${page.stepsHi.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`,
    `<h2>यह किसके लिए है</h2>`,
    `<p>${esc(page.forWhomHi)}</p>`,
    `<h2>यह क्या नहीं करता</h2>`,
    `<p>${esc(page.limitHi)}</p>`,
    mockHtml(page),
    `<p><a class="cta" href="${esc(useCaseBuilderHref(page.slug))}">${esc(USE_CASE_CTA_HI)}<small>${esc(USE_CASE_CTA_EN)}</small></a></p>`,
    `<p class="note">बटन बिल्डर खोलता है और यह विवरण लिखकर रख देता है। आप उसे पढ़कर भेजते हैं। साइन-इन माँगा जाए तो साइन-इन के बाद वही विवरण बिल्डर में रहता है। NavBharatAI engine वही विवरण पढ़कर ऐप बनाता है।</p>`,
    `<h2>सवाल</h2>`,
    ...page.faqs.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`),
    `<h2>In English</h2>`,
    `<p>${esc(page.storyEn)}</p>`,
    `<ul>${page.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`,
    `<p>The NavBharatAI engine writes the app from the description you send. The sample numbers on this page are invented. This is not a page from someone else's published app.</p>`,
    `<h2>और ऐप</h2>`,
    `<ul>${siblings.map((s) => `<li><a href="${esc(useCasePath(s.slug))}">${esc(s.h1)}</a></li>`).join('')}<li><a href="${USE_CASE_INDEX_PATH}">सारी सूची</a></li></ul>`,
  ].join('\n');
  return pageShell({
    origin, path: useCasePath(page.slug), title: page.title, description: page.description, body,
    jsonLd: { '@context': 'https://schema.org', '@graph': [softwareLd(page, origin), faqLd(page, origin)] },
  });
}

export function renderUseCaseIndex(origin: string): string {
  const cards = USE_CASES.map((p) => `<li><a href="${esc(useCasePath(p.slug))}">${esc(p.h1)}</a> — ${esc(p.description)}</li>`).join('\n');
  const title = 'Indian small-business apps you can build — NavBharatAI';
  const description = 'Curated Hindi-first app ideas for kirana, clinic, tuition, GST, gym, salon and other Indian shops. None of these are a user\'s published app.';
  const body = [
    `<h1>Apps for Indian small businesses</h1>`,
    `<p>ये पेज NavBharatAI के अपने उदाहरण हैं। किसी यूज़र की बनी हुई ऐप यहाँ प्रकाशित नहीं है, और कोई असली दुकान का डेटा नहीं है। हर पेज पर काल्पनिक स्क्रीन है, और एक बटन जो बिल्डर में वही काम लिखकर खोलता है।</p>`,
    `<p>These pages are written by NavBharatAI. They are not a public directory of apps people have published. Each one describes a single shop's job, shows made-up figures, and opens the builder with that description filled in. The NavBharatAI engine builds from what you send.</p>`,
    `<ul class="cards">${cards}</ul>`,
  ].join('\n');
  return pageShell({
    origin, path: USE_CASE_INDEX_PATH, title, description, body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      description,
      url: `${origin}${USE_CASE_INDEX_PATH}`,
      mainEntity: { '@type': 'ItemList', numberOfItems: USE_CASES.length, itemListElement: USE_CASES.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}${useCasePath(p.slug)}`, name: p.title })) },
    },
  });
}

export function renderUseCaseMissing(origin: string): string {
  const body = `<h1>That app idea is not on this list</h1><p>The public ideas are the ones NavBharatAI wrote. A person's own app is not published here.</p><p><a href="${USE_CASE_INDEX_PATH}">See the list</a></p>`;
  const html = pageShell({
    origin, path: '/app/not-found', title: 'App idea not found — NavBharatAI',
    description: 'This address is not one of NavBharatAI\'s curated app ideas.',
    body, jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Not found' },
  });
  return html.replace('</title>', '</title>\n<meta name="robots" content="noindex">');
}
