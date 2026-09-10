/**
 * WEBSITE → APP — turn a public web page into a build spec (ROADMAP §13, 4.2).
 *
 * Lovable, Bolt, v0 and Replit all take a URL and hand back an editable app that looks like it. We
 * took a SCREENSHOT (`/api/screenshot/to-prompt`) and a GitHub repo (`importUrl`), never a live site —
 * so a user who wanted "my shop, but laid out like this one" had to screenshot it page by page.
 *
 * HOW THIS ONE IS BUILT, and why it is not the screenshot path again:
 *   • The page is fetched ONCE through `webFetchUrl` — the SSRF-guarded reader every other URL feature
 *     uses (public IPs only, no redirects, 2 MB cap, 15 s). No second fetcher.
 *   • The structure is read DETERMINISTICALLY from the markup: title, navigation, headings, calls to
 *     action, form fields, colours, fonts, and whether the page has a login / payment / search. No
 *     model call, so it costs the user nothing and answers in a second — and the same page always
 *     produces the same spec.
 *   • The VISUAL half is delegated to the builder itself: NavBharatAI Pro v5.0 already runs a real
 *     browser in its sandbox and can open a public site (`browser` tool). The spec tells it to look at
 *     the live page for proportions, spacing and imagery, and to fall back to the structure here if
 *     the page will not open. Markup gives the words and the skeleton; the browser gives the look.
 *
 * 🔒 WHAT IS NEVER COPIED. No image URL, logo, icon, font file or stylesheet is carried into the spec —
 * an `<img>` contributes its ALT TEXT and nothing else. Recreating a LAYOUT is ordinary design work;
 * hot-linking or downloading a site's assets is copying, and the spec says so in words the builder
 * reads. The route hard-appends the same intent-aware design & anti-phishing policy the screenshot
 * path uses (inspired-by for your own brand: build it; a deceptive real-brand clone: watermarked demo).
 *
 * PURE — regex over a string, no DOM, no dependencies, same discipline as `htmlToText`.
 */

import { htmlToText } from '../AgentV3/webFetch';

export interface SiteFormField {
  /** input type (text, email, password, search, …), or `select` / `textarea`. */
  type: string;
  /** The best human label available: <label>, placeholder, aria-label, then name. May be ''. */
  label: string;
}

export interface SiteForm {
  fields: SiteFormField[];
  /** Submit button text, if one was found. */
  submit: string;
}

export interface ExtractedSite {
  url: string;
  title: string;
  description: string;
  lang: string;
  /** Navigation link texts, in page order, de-duplicated. */
  nav: string[];
  headings: Array<{ level: 1 | 2 | 3; text: string }>;
  /** Button texts and button-styled links. */
  ctas: string[];
  forms: SiteForm[];
  /** Hex colours, most-used first, normalised to `#rrggbb`. Includes the theme colour when set. */
  colors: string[];
  /** Font family names (first family of each declaration, plus Google Fonts families). */
  fonts: string[];
  /** Alt texts of images — the only thing taken from an image. */
  imageAlts: string[];
  counts: { sections: number; images: number; links: number; forms: number };
  flags: { login: boolean; payment: boolean; search: boolean };
  /** A capped sample of the visible text, for content structure. */
  textSample: string;
  /**
   * True when the markup carried almost nothing visible — the page draws itself with JavaScript. The
   * spec then leans on the builder's live browser look, and the client says so.
   */
  thin: boolean;
}

export const MAX_NAV = 12;
export const MAX_HEADINGS = 40;
export const MAX_CTAS = 15;
export const MAX_FORMS = 5;
export const MAX_FIELDS_PER_FORM = 12;
export const MAX_COLORS = 8;
export const MAX_FONTS = 5;
export const MAX_IMAGE_ALTS = 10;
export const TEXT_SAMPLE_CHARS = 3_000;
const MAX_ITEM_CHARS = 120;

const STYLE_OPTIONS = ['Tailwind CSS', 'Plain CSS', 'Bootstrap'] as const;
const FRAMEWORK_OPTIONS = ['Vanilla HTML', 'React JSX'] as const;

function clean(text: string): string {
  return htmlToText(text).replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_CHARS);
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (m ? (m[1] ?? m[2] ?? m[3] ?? '') : '').trim();
}

function dedupe(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** `<script>`/`<style>`/`<svg>`/comments removed — a bundle must not be mistaken for page content. */
function bodyOnly(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

function inner(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out: string[] = [];
  for (const m of html.matchAll(re)) out.push(m[1]);
  return out;
}

/** `#abc` / `#aabbcc` → `#aabbcc` (lower-case). 8-digit (alpha) colours keep their 6 colour digits. */
export function normalizeHex(raw: string): string | null {
  const m = raw.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  if (h.length === 3) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  return `#${h.slice(0, 6)}`;
}

function extractColors(html: string, themeColor: string): string[] {
  const counts = new Map<string, number>();
  const bump = (c: string | null, by = 1) => { if (c) counts.set(c, (counts.get(c) ?? 0) + by); };
  const styleBlocks = inner(html, 'style').join('\n');
  const inlineStyles = Array.from(html.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)).map((m) => m[1]).join('\n');
  for (const m of `${styleBlocks}\n${inlineStyles}`.matchAll(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/gi)) bump(normalizeHex(m[0]));
  // The author's declared brand colour outranks a frequency count.
  bump(normalizeHex(themeColor), 1_000);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, MAX_COLORS);
}

function extractFonts(html: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*href\s*=\s*"([^"]*fonts\.googleapis\.com\/css[^"]*)"/gi)) {
    for (const fam of m[1].matchAll(/family=([^&:"]+)/gi)) found.push(decodeURIComponent(fam[1].replace(/\+/g, ' ')).split('|')[0]);
  }
  const css = inner(html, 'style').join('\n');
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(',')[0].replace(/["']/g, '').trim();
    if (first && !/^(inherit|initial|unset|var\()/i.test(first)) found.push(first);
  }
  return dedupe(found, MAX_FONTS);
}

function extractForms(html: string): SiteForm[] {
  const forms: SiteForm[] = [];
  const labels = new Map<string, string>();
  for (const m of html.matchAll(/<label\b[^>]*\bfor\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/label>/gi)) labels.set(m[1], clean(m[2]));
  for (const formHtml of inner(html, 'form').slice(0, MAX_FORMS)) {
    const fields: SiteFormField[] = [];
    for (const tag of formHtml.match(/<(?:input|select|textarea)\b[^>]*>/gi) ?? []) {
      const kind = tag.slice(1, 7).toLowerCase();
      const type = kind === 'select' ? 'select' : kind === 'textar' ? 'textarea' : (attr(tag, 'type') || 'text').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') continue;
      const id = attr(tag, 'id');
      const label = (id && labels.get(id)) || attr(tag, 'placeholder') || attr(tag, 'aria-label') || attr(tag, 'name');
      fields.push({ type, label: clean(label) });
      if (fields.length >= MAX_FIELDS_PER_FORM) break;
    }
    const submitTag = formHtml.match(/<button\b[^>]*>([\s\S]*?)<\/button>/i);
    const submitInput = formHtml.match(/<input\b[^>]*\btype\s*=\s*"submit"[^>]*>/i);
    const submit = submitTag ? clean(submitTag[1]) : submitInput ? clean(attr(submitInput[0], 'value')) : '';
    if (fields.length || submit) forms.push({ fields, submit });
  }
  return forms;
}

/** Read a page's structure. Never throws; an empty or hostile string yields an empty, `thin` result. */
export function extractSiteDesign(rawHtml: string, url: string): ExtractedSite {
  const html = String(rawHtml ?? '');
  const body = bodyOnly(html);
  const title = clean(inner(html, 'title')[0] ?? '');
  const metaTag = (name: string) => {
    const m = html.match(new RegExp(`<meta\\b[^>]*\\bname\\s*=\\s*"${name}"[^>]*>`, 'i'))
      ?? html.match(new RegExp(`<meta\\b[^>]*\\bproperty\\s*=\\s*"og:${name}"[^>]*>`, 'i'));
    return m ? clean(attr(m[0], 'content')) : '';
  };
  const description = metaTag('description');
  const themeMatch = html.match(/<meta\b[^>]*\bname\s*=\s*"theme-color"[^>]*>/i);
  const themeColor = themeMatch ? attr(themeMatch[0], 'content') : '';
  const langMatch = html.match(/<html\b[^>]*\blang\s*=\s*"([^"]*)"/i);
  const lang = (langMatch?.[1] ?? '').trim().slice(0, 12);

  const navRegions = [...inner(body, 'nav'), ...inner(body, 'header')].join('\n');
  const nav = dedupe(inner(navRegions, 'a').map(clean), MAX_NAV);

  const headings: ExtractedSite['headings'] = [];
  for (const m of body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = clean(m[2]);
    if (text) headings.push({ level: Number(m[1]) as 1 | 2 | 3, text });
    if (headings.length >= MAX_HEADINGS) break;
  }

  const buttonTexts = inner(body, 'button').map(clean);
  const buttonLinks = Array.from(body.matchAll(/<a\b[^>]*\bclass\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi))
    .filter((m) => /\b(btn|button|cta)\b/i.test(m[1]))
    .map((m) => clean(m[2]));
  const ctas = dedupe([...buttonTexts, ...buttonLinks], MAX_CTAS);

  const forms = extractForms(body);
  const imageTags = body.match(/<img\b[^>]*>/gi) ?? [];
  const imageAlts = dedupe(imageTags.map((t) => clean(attr(t, 'alt'))), MAX_IMAGE_ALTS);
  const counts = {
    sections: (body.match(/<section\b/gi) ?? []).length,
    images: imageTags.length,
    links: (body.match(/<a\b/gi) ?? []).length,
    forms: (body.match(/<form\b/gi) ?? []).length,
  };

  const text = htmlToText(body);
  const lower = `${text}\n${body}`.toLowerCase();
  const flags = {
    login: /type\s*=\s*"password"/i.test(body) || /\b(log ?in|sign ?in)\b/.test(lower),
    payment: /\b(checkout|payment|pay now|card number|upi|add to cart)\b/.test(lower),
    search: /type\s*=\s*"search"/i.test(body) || forms.some((f) => f.fields.some((x) => x.type === 'search')),
  };
  const textSample = text.slice(0, TEXT_SAMPLE_CHARS);
  const thin = headings.length + nav.length + ctas.length < 3 && text.length < 200;

  return {
    url, title, description, lang, nav, headings, ctas, forms,
    colors: extractColors(html, themeColor), fonts: extractFonts(html), imageAlts, counts, flags, textSample, thin,
  };
}

export interface SiteImportOptions {
  style?: string;
  framework?: string;
  includeJs?: boolean;
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
}

/**
 * The build spec the builder receives. Structure from the markup, the look from the live page, and the
 * asset rule in plain words. The route appends the design & anti-phishing policy after this. PURE.
 */
export function buildSiteImportPrompt(x: ExtractedSite, opts: SiteImportOptions = {}): string {
  const style = pick(opts.style, STYLE_OPTIONS, 'Tailwind CSS');
  const framework = pick(opts.framework, FRAMEWORK_OPTIONS, 'Vanilla HTML');
  const lines: string[] = [];
  lines.push(`Recreate the DESIGN of the web page at ${x.url} as a new, editable app — same layout, structure and visual style, as close to the original look as you can get.`);
  lines.push('');
  lines.push(`VISUAL REFERENCE — do this first: open ${x.url} in your browser tool and look at it (take a screenshot; scroll once). The markup summary below gives you the skeleton and the words; the live page gives you proportions, spacing, imagery placement and the real colours. If the page does not open, build from the summary alone and say so.`);
  lines.push('');
  lines.push('=== STRUCTURE READ FROM THE PAGE MARKUP ===');
  if (x.title) lines.push(`Page title: ${x.title}`);
  if (x.description) lines.push(`Description: ${x.description}`);
  if (x.lang) lines.push(`Language: ${x.lang}`);
  if (x.nav.length) lines.push(`Navigation (in order): ${x.nav.join(' · ')}`);
  if (x.headings.length) {
    lines.push('Headings (top to bottom):');
    for (const h of x.headings) lines.push(`${'  '.repeat(h.level - 1)}- H${h.level}: ${h.text}`);
  }
  if (x.ctas.length) lines.push(`Buttons / calls to action: ${x.ctas.join(' · ')}`);
  if (x.forms.length) {
    lines.push('Forms:');
    x.forms.forEach((f, i) => {
      const fields = f.fields.map((fl) => (fl.label ? `${fl.label} (${fl.type})` : fl.type)).join(', ');
      lines.push(`  - Form ${i + 1}: ${fields || 'no visible fields'}${f.submit ? ` → "${f.submit}"` : ''}`);
    });
  }
  if (x.colors.length) lines.push(`Colours used (most used first): ${x.colors.join(', ')}`);
  if (x.fonts.length) lines.push(`Fonts: ${x.fonts.join(', ')} (use a free font with the same feel if one is not freely available)`);
  lines.push(`Page has ${x.counts.sections} section(s), ${x.counts.images} image(s), ${x.counts.links} link(s), ${x.counts.forms} form(s).`);
  if (x.imageAlts.length) lines.push(`Image placements (by their alt text): ${x.imageAlts.join(' · ')}`);
  const kinds = [x.flags.login && 'a login / sign-in', x.flags.payment && 'checkout / payment', x.flags.search && 'search'].filter(Boolean);
  if (kinds.length) lines.push(`The page includes: ${kinds.join(', ')}.`);
  if (x.thin) {
    lines.push('NOTE: the markup carried almost no visible content — this site draws itself with JavaScript. Rely on what you see in the browser; treat the summary as partial.');
  } else if (x.textSample) {
    lines.push('');
    lines.push('Visible text sample (for content structure and tone — replace with the user\'s own content unless they own this site):');
    lines.push(x.textSample);
  }
  lines.push('');
  lines.push(`Target styling: ${style}. Target framework: ${framework}. ${opts.includeJs ? 'Include the interactive behaviour (menus, tabs, forms, toggles) the page visibly has.' : 'Static layout is enough unless interactivity is obvious.'}`);
  lines.push('Make it responsive: it must read well on a phone as well as on the desktop layout you see.');
  lines.push('');
  lines.push('ASSETS — COPYRIGHT RULE: do NOT download, hot-link or reproduce the site\'s images, logos, icons, videos, font files or stylesheets. Use neutral placeholders of the same size and position (or freely licensed stand-ins) and the user\'s own assets where given. Recreating a layout is design work; copying assets is not.');
  return lines.join('\n');
}

/** Accepts "example.com" as well as a full URL; anything that is not http(s) is returned as-is for the guard to refuse. */
export function normalizeSiteUrl(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  return `https://${t}`;
}
