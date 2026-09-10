/**
 * CONSENT BANNER — DPDP (India) + GDPR cookie/consent banner for a USER's app, one click (ROADMAP §13, 4.4).
 *
 * `generate_consent` (ConsentGenerator.ts) is the BACKEND consent LOG — an append-only record of who agreed
 * to what. This is the other half, the one every visitor actually sees: the banner that asks, the switch
 * that keeps third-party scripts OFF until they said yes, and the link that lets them change their mind.
 * Every competitor ships a cookie banner as a generic GDPR widget; this one is written for India's Digital
 * Personal Data Protection Act as well, which is the moat — bilingual notice, a grievance contact, and
 * withdrawal as easy as consent.
 *
 * 🔒 THE RULES THE EMITTED BANNER ENFORCES (each is a legal requirement, not a style choice):
 *   • NOTHING non-essential loads before consent. A third-party script is written as
 *     `<script type="text/plain" data-consent="analytics" data-src="…">` — inert markup — and is activated
 *     only when every purpose it names is granted. A banner that loads the tracker and then asks is
 *     theatre, and the platform's own compliance check (`ComplianceAnalysis`) flags exactly that.
 *   • NO pre-ticked boxes; "Reject all" is as prominent as "Accept all" (GDPR: consent must be freely given;
 *     DPDP §6: free, specific, informed, unconditional, unambiguous, by clear affirmative action).
 *   • WITHDRAWAL as easy as giving (DPDP §6(4)): a persistent "Privacy choices" control reopens the panel.
 *   • RE-CONSENT when the policy changes: the stored choice carries the policy VERSION, and a different
 *     version means the question is asked again.
 *   • A NOTICE in English AND Hindi by default (DPDP §5 allows any scheduled language; most Indian visitors
 *     read Hindi); a Privacy Policy link; and the grievance / data-questions contact (DPDP Rules 2025).
 *   • Global Privacy Control honoured: a browser that signals GPC is treated as "no consent" without a
 *     banner — the visitor already answered — and can still opt IN from "Privacy choices".
 *
 * The logic that can be unit-tested (state, activation, choice) lives between the CORE markers as plain
 * JS with no DOM, so the test executes the REAL emitted code; the DOM shell below it is string-locked.
 * Dependency-free, framework-agnostic (a `public/` script works for Vanilla HTML and React alike). Pure
 * builder → the caller writes files.
 */

export type ConsentPurpose = 'analytics' | 'marketing' | 'personalization';
export type ConsentLanguage = 'en' | 'hi' | 'both';

export interface ConsentBannerOptions {
  appName?: string;
  /** Where the Privacy Policy lives in the app. Default `/privacy`. */
  policyUrl?: string;
  /** DPDP grievance / data-questions contact. Shown on the banner when given. */
  grievanceEmail?: string;
  language?: ConsentLanguage;
  /** Non-essential purposes the app actually uses. Default analytics + marketing. */
  purposes?: ConsentPurpose[];
  /** Policy version stamped on every stored choice; change it to ask everyone again. Default: today. */
  policyVersion?: string;
}

export interface ConsentBannerConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

export const CONSENT_BANNER_PATH = 'public/consent-banner.js';
export const CONSENT_BANNER_README_PATH = 'CONSENT_BANNER.md';
export const ALL_PURPOSES: readonly ConsentPurpose[] = ['analytics', 'marketing', 'personalization'];
export const CORE_BEGIN = '/* NAVCONSENT-CORE-BEGIN */';
export const CORE_END = '/* NAVCONSENT-CORE-END */';

/** The testable heart: state, activation and choice — no DOM, no globals. Emitted verbatim. */
export const CONSENT_CORE_SOURCE = `${CORE_BEGIN}
var NavConsentCore = (function () {
  var STORAGE_KEY = 'nav_consent_v1';
  function unique(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = String(list[i] || '').trim();
      if (p && out.indexOf(p) === -1) out.push(p);
    }
    return out;
  }
  /** A stored choice is valid only for the policy version it was made under. Anything else = undecided. */
  function parseStored(raw, policyVersion) {
    try {
      var o = JSON.parse(raw || 'null');
      if (!o || typeof o !== 'object' || o.v !== policyVersion || !Array.isArray(o.granted)) return null;
      return { granted: unique(o.granted), at: typeof o.at === 'string' ? o.at : null };
    } catch (e) { return null; }
  }
  function serialize(granted, policyVersion, nowIso) {
    return JSON.stringify({ v: policyVersion, granted: unique(granted), at: nowIso });
  }
  /**
   * What to do on page load. Stored and current → use it, no banner. Global Privacy Control → the visitor
   * has already said no; nothing loads and no banner nags, but "Privacy choices" still lets them opt in.
   * Otherwise → ask, with nothing granted meanwhile.
   */
  function initialState(raw, policyVersion, gpc) {
    var s = parseStored(raw, policyVersion);
    if (s) return { show: false, granted: s.granted, source: 'stored' };
    if (gpc) return { show: false, granted: [], source: 'gpc' };
    return { show: true, granted: [], source: 'undecided' };
  }
  /** A gated script names its purposes ("analytics marketing"); it runs only when EVERY one is granted. */
  function scriptAllowed(purposeAttr, granted) {
    var needed = unique(String(purposeAttr || '').split(/[\\s,]+/));
    if (!needed.length) return false;
    for (var i = 0; i < needed.length; i++) if (granted.indexOf(needed[i]) === -1) return false;
    return true;
  }
  /** The three ways to answer. "save" keeps only purposes the app actually offers. */
  function choose(kind, purposes, chosen) {
    if (kind === 'accept-all') return purposes.slice();
    if (kind === 'reject-all') return [];
    var out = [];
    for (var i = 0; i < (chosen || []).length; i++) if (purposes.indexOf(chosen[i]) !== -1 && out.indexOf(chosen[i]) === -1) out.push(chosen[i]);
    return out;
  }
  return { STORAGE_KEY: STORAGE_KEY, parseStored: parseStored, serialize: serialize, initialState: initialState, scriptAllowed: scriptAllowed, choose: choose };
})();
${CORE_END}`;

interface Copy {
  title: string;
  body: (app: string, purposes: string) => string;
  purposeNames: Record<ConsentPurpose | 'necessary', string>;
  alwaysOn: string;
  acceptAll: string;
  rejectAll: string;
  manage: string;
  save: string;
  policy: string;
  grievance: string;
  choices: string;
}

const EN: Copy = {
  title: 'Your privacy choices',
  body: (app, purposes) => `${app} uses cookies and similar tools. Necessary ones keep the site working. The others are used only with your consent, for ${purposes}. You can change or withdraw your choice at any time from "Privacy choices".`,
  purposeNames: { necessary: 'Necessary', analytics: 'Analytics', marketing: 'Marketing', personalization: 'Personalisation' },
  alwaysOn: 'always on',
  acceptAll: 'Accept all',
  rejectAll: 'Reject all',
  manage: 'Manage',
  save: 'Save my choices',
  policy: 'Privacy Policy',
  grievance: 'Questions about your data',
  choices: 'Privacy choices',
};

const HI: Copy = {
  title: 'आपकी प्राइवेसी पसंद',
  body: (app, purposes) => `${app} कुकीज़ और ऐसे ही टूल इस्तेमाल करता है। ज़रूरी कुकीज़ साइट चलाने के लिए हैं। बाकी सिर्फ़ आपकी सहमति से, ${purposes} के लिए इस्तेमाल होती हैं। आप अपनी पसंद कभी भी "प्राइवेसी विकल्प" से बदल या वापस ले सकते हैं।`,
  purposeNames: { necessary: 'ज़रूरी', analytics: 'एनालिटिक्स', marketing: 'मार्केटिंग', personalization: 'पर्सनलाइज़ेशन' },
  alwaysOn: 'हमेशा चालू',
  acceptAll: 'सभी स्वीकार करें',
  rejectAll: 'सभी अस्वीकार करें',
  manage: 'प्रबंधित करें',
  save: 'मेरी पसंद सेव करें',
  policy: 'प्राइवेसी पॉलिसी',
  grievance: 'अपने डेटा के बारे में सवाल',
  choices: 'प्राइवेसी विकल्प',
};

function joinNames(names: string[], and: string): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}

function copyFor(lang: 'en' | 'hi', app: string, purposes: ConsentPurpose[]) {
  const c = lang === 'hi' ? HI : EN;
  const names = purposes.map((p) => c.purposeNames[p].toLowerCase());
  return {
    title: c.title,
    body: c.body(app, joinNames(names, lang === 'hi' ? 'और' : 'and')),
    purposeNames: c.purposeNames,
    alwaysOn: c.alwaysOn,
    acceptAll: c.acceptAll,
    rejectAll: c.rejectAll,
    manage: c.manage,
    save: c.save,
    policy: c.policy,
    grievance: c.grievance,
    choices: c.choices,
  };
}

function sanitizePurposes(raw: unknown): ConsentPurpose[] {
  const list = Array.isArray(raw) ? raw : [];
  const out = list.filter((p): p is ConsentPurpose => (ALL_PURPOSES as readonly string[]).includes(String(p)));
  return out.length ? Array.from(new Set(out)) : ['analytics', 'marketing'];
}

function safeText(raw: unknown, max: number, fallback: string): string {
  const t = String(raw ?? '').replace(/[<>"'\\`$]/g, '').trim().slice(0, max);
  return t || fallback;
}

function safeUrl(raw: unknown): string {
  const t = String(raw ?? '').trim();
  return /^(?:\/(?!\/)[^\s"'<>`]*|https:\/\/[^\s"'<>`]+)$/.test(t) ? t : '/privacy';
}

function safeEmail(raw: unknown): string {
  const t = String(raw ?? '').trim();
  return /^[^\s@"'<>`]+@[^\s@"'<>`]+\.[^\s@"'<>`]+$/.test(t) ? t : '';
}

/** The whole banner: the core above, then a DOM shell that reads its configuration off its own <script> tag. */
export function buildConsentBannerScript(opts: ConsentBannerOptions = {}): string {
  const app = safeText(opts.appName, 60, 'This site');
  const purposes = sanitizePurposes(opts.purposes);
  const language: ConsentLanguage = opts.language === 'en' || opts.language === 'hi' ? opts.language : 'both';
  const policyUrl = safeUrl(opts.policyUrl);
  const grievance = safeEmail(opts.grievanceEmail);
  const version = safeText(opts.policyVersion, 40, new Date().toISOString().slice(0, 10));
  const copy = { en: copyFor('en', app, purposes), hi: copyFor('hi', app, purposes) };

  return `/* Consent banner — DPDP (India) + GDPR. Generated by NavBharatAI; dependency-free; edit freely.
 * HOW IT WORKS: nothing non-essential loads until the visitor agrees. Mark every third-party script as
 *   <script type="text/plain" data-consent="analytics" data-src="https://…"></script>
 * (or inline code with type="text/plain"). It is activated only when every purpose it names is granted.
 * Configure via attributes on THIS script tag: data-app, data-policy, data-version, data-grievance,
 * data-lang (en | hi | both), data-purposes ("analytics marketing"). Defaults were set when generated.
 * API: window.NavConsent.has('analytics'), .granted(), .open(), .onChange(fn). Event: 'nbconsent:change'.
 * Withdraw: any element with data-consent-open reopens the panel (e.g. a footer "Privacy choices" link).
 */
${CONSENT_CORE_SOURCE}
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var DEFAULTS = ${JSON.stringify({ app, policyUrl, version, grievance, language, purposes })};
  var COPY = ${JSON.stringify(copy)};
  var me = document.currentScript;
  var attr = function (name, fallback) { var v = me && me.getAttribute(name); return v === null || v === undefined || v === '' ? fallback : v; };
  var cfg = {
    app: attr('data-app', DEFAULTS.app),
    policyUrl: attr('data-policy', DEFAULTS.policyUrl),
    version: attr('data-version', DEFAULTS.version),
    grievance: attr('data-grievance', DEFAULTS.grievance),
    language: attr('data-lang', DEFAULTS.language),
    purposes: String(attr('data-purposes', DEFAULTS.purposes.join(' '))).split(/[\\s,]+/).filter(Boolean)
  };
  var langs = cfg.language === 'en' ? ['en'] : cfg.language === 'hi' ? ['hi'] : ['en', 'hi'];
  var listeners = [];
  var granted = [];

  function readRaw() { try { return window.localStorage.getItem(NavConsentCore.STORAGE_KEY); } catch (e) { return null; } }
  function writeRaw(value) { try { window.localStorage.setItem(NavConsentCore.STORAGE_KEY, value); } catch (e) { /* private mode: the choice lasts this page only */ } }
  function gpc() { try { return navigator.globalPrivacyControl === true; } catch (e) { return false; } }

  /** Turn inert text/plain scripts into real ones — once each, and only those fully covered by the grant. */
  function activateScripts() {
    var nodes = document.querySelectorAll('script[type="text/plain"][data-consent]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.getAttribute('data-consent-activated') === 'true') continue;
      if (!NavConsentCore.scriptAllowed(node.getAttribute('data-consent'), granted)) continue;
      var live = document.createElement('script');
      var src = node.getAttribute('data-src');
      if (src) live.src = src; else live.text = node.text || node.textContent || '';
      if (node.hasAttribute('async')) live.async = true;
      if (node.hasAttribute('defer')) live.defer = true;
      node.setAttribute('data-consent-activated', 'true');
      node.parentNode.insertBefore(live, node.nextSibling);
    }
  }
  function emit() {
    var detail = { granted: granted.slice() };
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](detail); } catch (e) { /* a listener must not break the banner */ } }
    try { window.dispatchEvent(new CustomEvent('nbconsent:change', { detail: detail })); } catch (e) { /* very old browser */ }
  }
  function apply(next, persist) {
    granted = next.slice();
    if (persist) writeRaw(NavConsentCore.serialize(granted, cfg.version, new Date().toISOString()));
    activateScripts();
    emit();
  }

  var STYLE = '.nbc-wrap{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;display:flex;justify-content:center;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
    '.nbc-card{max-width:640px;width:100%;background:#fff;color:#111;border:1px solid #d9d9d9;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:16px}' +
    '.nbc-title{font-weight:700;font-size:15px;margin:0 0 6px}.nbc-body{margin:0 0 6px;color:#333}' +
    '.nbc-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.nbc-row button{flex:1 1 140px;padding:10px 14px;border-radius:10px;border:1px solid #111;background:#fff;color:#111;font:inherit;font-weight:600;cursor:pointer}' +
    '.nbc-row button.nbc-primary{background:#111;color:#fff}.nbc-row button:focus-visible{outline:3px solid #4f46e5;outline-offset:2px}' +
    '.nbc-prefs{display:none;margin-top:10px;border-top:1px solid #eee;padding-top:10px}.nbc-prefs.nbc-open{display:block}' +
    '.nbc-pref{display:flex;align-items:center;gap:10px;padding:6px 0}.nbc-pref input{width:18px;height:18px}.nbc-muted{color:#666;font-size:12px}' +
    '.nbc-links{margin-top:10px;font-size:12px;color:#555}.nbc-links a{color:#1d4ed8}' +
    '.nbc-fab{position:fixed;left:12px;bottom:12px;z-index:2147482999;font:12px system-ui,sans-serif;background:#fff;color:#111;border:1px solid #ccc;border-radius:999px;padding:6px 10px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12)}' +
    '@media (prefers-color-scheme: dark){.nbc-card,.nbc-fab{background:#161616;color:#f2f2f2;border-color:#333}.nbc-body{color:#ddd}.nbc-row button{background:#161616;color:#f2f2f2;border-color:#f2f2f2}.nbc-row button.nbc-primary{background:#f2f2f2;color:#111}.nbc-links{color:#aaa}.nbc-links a{color:#93c5fd}}';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function t(key) { return langs.map(function (l) { return COPY[l][key]; }).join(' / '); }
  function purposeName(p) { return langs.map(function (l) { return COPY[l].purposeNames[p] || p; }).join(' / '); }

  var wrap = null, fab = null;
  function render(open) {
    if (wrap) wrap.parentNode.removeChild(wrap);
    wrap = document.createElement('div');
    wrap.className = 'nbc-wrap';
    var prefs = '';
    prefs += '<div class="nbc-pref"><input type="checkbox" checked disabled id="nbc-necessary"><label for="nbc-necessary">' + esc(purposeName('necessary')) + ' <span class="nbc-muted">(' + esc(t('alwaysOn')) + ')</span></label></div>';
    for (var i = 0; i < cfg.purposes.length; i++) {
      var p = cfg.purposes[i];
      var on = granted.indexOf(p) !== -1;
      // Never pre-ticked on a fresh visit; reflects the saved choice when reopened.
      prefs += '<div class="nbc-pref"><input type="checkbox" data-purpose="' + esc(p) + '" id="nbc-' + esc(p) + '"' + (on ? ' checked' : '') + '><label for="nbc-' + esc(p) + '">' + esc(purposeName(p)) + '</label></div>';
    }
    var body = langs.map(function (l) { return '<p class="nbc-body">' + esc(COPY[l].body) + '</p>'; }).join('');
    var links = '<a href="' + esc(cfg.policyUrl) + '">' + esc(t('policy')) + '</a>';
    if (cfg.grievance) links += ' · ' + esc(t('grievance')) + ': <a href="mailto:' + esc(cfg.grievance) + '">' + esc(cfg.grievance) + '</a>';
    wrap.innerHTML = '<div class="nbc-card" role="dialog" aria-modal="false" aria-labelledby="nbc-title">' +
      '<h2 class="nbc-title" id="nbc-title">' + esc(t('title')) + '</h2>' + body +
      '<div class="nbc-prefs' + (open ? ' nbc-open' : '') + '">' + prefs + '</div>' +
      '<div class="nbc-row">' +
        '<button type="button" data-act="reject-all">' + esc(t('rejectAll')) + '</button>' +
        '<button type="button" data-act="manage">' + esc(open ? t('save') : t('manage')) + '</button>' +
        '<button type="button" class="nbc-primary" data-act="accept-all">' + esc(t('acceptAll')) + '</button>' +
      '</div><div class="nbc-links">' + links + '</div></div>';
    document.body.appendChild(wrap);
    var prefsEl = wrap.querySelector('.nbc-prefs');
    wrap.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'manage' && !prefsEl.classList.contains('nbc-open')) { render(true); return; }
      var chosen = [];
      var boxes = wrap.querySelectorAll('input[data-purpose]');
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) chosen.push(boxes[i].getAttribute('data-purpose'));
      apply(NavConsentCore.choose(act === 'manage' ? 'save' : act, cfg.purposes, chosen), true);
      close();
    });
    var first = wrap.querySelector('button[data-act="reject-all"]');
    if (first) first.focus();
  }
  function close() { if (wrap) { wrap.parentNode.removeChild(wrap); wrap = null; } showFab(); }
  function showFab() {
    if (fab || document.querySelector('[data-consent-open]')) return; // the app has its own "Privacy choices" link
    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'nbc-fab';
    fab.setAttribute('aria-label', t('choices'));
    fab.textContent = t('choices');
    fab.addEventListener('click', function () { render(true); });
    document.body.appendChild(fab);
  }

  function boot() {
    var style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    var state = NavConsentCore.initialState(readRaw(), cfg.version, gpc());
    granted = state.granted;
    activateScripts();
    emit();
    if (state.show) render(false); else showFab();
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-consent-open]') : null;
      if (el) { e.preventDefault(); render(true); }
    });
  }

  window.NavConsent = {
    has: function (purpose) { return granted.indexOf(purpose) !== -1; },
    granted: function () { return granted.slice(); },
    open: function () { render(true); },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
`;
}

export function buildConsentBannerReadme(opts: ConsentBannerOptions = {}): string {
  const purposes = sanitizePurposes(opts.purposes);
  return `# Consent banner — DPDP (India) + GDPR

One script, no dependencies: \`${CONSENT_BANNER_PATH}\`.

## 1. Include it once, early in \`<head>\`

\`\`\`html
<script src="/consent-banner.js"
        data-app="Your App"
        data-policy="/privacy"
        data-version="${safeText(opts.policyVersion, 40, 'YYYY-MM-DD')}"
        data-grievance="privacy@yourapp.example"
        data-lang="both"
        data-purposes="${purposes.join(' ')}"></script>
\`\`\`

All attributes are optional — the defaults chosen when this was generated are baked in.
**Change \`data-version\` whenever the privacy policy changes**: every visitor is asked again.

## 2. Gate every non-essential script

Third-party analytics, ads, chat widgets, embeds: make them inert until consent.

\`\`\`html
<!-- before -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
<!-- after -->
<script type="text/plain" data-consent="analytics" async data-src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
<script type="text/plain" data-consent="analytics">
  window.dataLayer = window.dataLayer || []; /* … */
</script>
\`\`\`

A script that needs two purposes lists both: \`data-consent="analytics marketing"\`. It runs only when
every one is granted, and only once.

## 3. Let people change their mind (required)

Put a link in the footer: \`<a href="#" data-consent-open>Privacy choices</a>\`. If none exists the
banner shows its own small "Privacy choices" button instead.

## 4. From your code

\`\`\`js
if (window.NavConsent.has('analytics')) { /* send events */ }
window.NavConsent.onChange(({ granted }) => { /* start or stop */ });
window.addEventListener('nbconsent:change', (e) => console.log(e.detail.granted));
\`\`\`

## What it guarantees

- Nothing non-essential loads before consent; "Reject all" is as prominent as "Accept all"; no
  pre-ticked boxes; the choice is stored per policy version; Global Privacy Control is honoured.
- The notice is shown in English and Hindi (DPDP allows any scheduled language); the grievance contact
  and the Privacy Policy link are on the banner itself.
- Withdrawal stops FUTURE loads and fires the change event so your code can stop sending; a script
  already running in this page session cannot be unloaded by anyone — on the next page load it stays off.

This is a tool, not legal advice: keep the Privacy Policy accurate, and name every recipient of
visitors' data there.
`;
}

const INSTRUCTIONS =
  `DPDP + GDPR consent banner wired: ${CONSENT_BANNER_PATH} (dependency-free; works for plain HTML and React alike) ` +
  `and ${CONSENT_BANNER_README_PATH}. NOW DO THREE THINGS IN THE APP'S HTML: (1) add <script src="/consent-banner.js"></script> ` +
  'once, early in <head> of the entry HTML (index.html); (2) convert EVERY third-party analytics/ads/widget script to ' +
  '<script type="text/plain" data-consent="analytics" data-src="…"> (inline code: type="text/plain" data-consent="…") — ' +
  'nothing non-essential may load before consent; (3) add a footer link <a href="#" data-consent-open>Privacy choices</a> ' +
  'and make sure the Privacy Policy page the banner links to exists and names every data recipient. ' +
  'window.NavConsent.has(purpose) / onChange(fn) gate app code. Change data-version on the tag when the policy changes.';

export function generateConsentBannerIntegration(opts: ConsentBannerOptions = {}): ConsentBannerConfig {
  return {
    files: {
      [CONSENT_BANNER_PATH]: buildConsentBannerScript(opts),
      [CONSENT_BANNER_README_PATH]: buildConsentBannerReadme(opts),
    },
    dependencies: [],
    instructions: INSTRUCTIONS,
  };
}
