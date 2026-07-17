// U-9 — Developer/User Docs Site, auto-generated from the AppKnowledgeBase.
//
// The AppKnowledgeBase (src/server/AppContext/AppKnowledgeBase.ts) is the single source of truth for
// what NavBharatAI can do — 150+ features with exact navigation paths and how-to steps. Every AI in
// the app already reads it. This turns that SAME real data into a browsable, searchable docs site
// (served at /guide) so humans get the same authoritative answers, always in sync with the app.
//
// HONESTY: the docs contain ONLY what the knowledge base declares — no invented features, no stale
// hand-written copy that can drift. Add a feature to the knowledge base and it appears here for free.
// The Template Gallery is intentionally NOT rebuilt here — it already ships as the in-app Templates
// panel (CURATED_TEMPLATES); the docs link to it rather than duplicate it.

import type { Express, Request, Response } from 'express';
import { APP_KNOWLEDGE_BASE, type AppFeature } from '../AppContext/AppKnowledgeBase';

export interface DocsGroup {
  key: string;
  title: string;
  features: AppFeature[];
}

export interface DocsModel {
  totalFeatures: number;
  groups: DocsGroup[];
}

/** Major surfaces get their own section; everything else is grouped generically. */
const MAJOR_SURFACES: Record<string, string> = {
  agentv3: 'NavBharatAI Pro v5.0 (App Builder)',
  engineer_ai: 'Engineer AI',
  pro_chat: 'Pro Chat',
  nbi_chat: 'Free Chat (NBI)',
  sda_chat: 'Software Doctor (SDA)',
  repo_analyst: 'Repository Analyst',
};

const PROFESSIONALS_KEY = 'professionals';
const PROFESSIONALS_TITLE = 'Professional AI Assistants';
const PLATFORM_KEY = 'platform';
const PLATFORM_TITLE = 'Platform & App Features';

/** Order sections deliberately: builders first, then chats, professionals, platform. */
const GROUP_ORDER = ['agentv3', 'engineer_ai', 'pro_chat', 'nbi_chat', 'sda_chat', 'repo_analyst', PROFESSIONALS_KEY, PLATFORM_KEY];

/** Which group a feature belongs to. `agentv3_*` ids and the pro-v3 surface map to the builder group. */
export function groupKeyFor(feature: AppFeature): string {
  const surface = feature.aiSurface;
  if (feature.id.startsWith('agentv3')) return 'agentv3';
  if (surface && MAJOR_SURFACES[surface]) return surface;
  if (surface && surface.endsWith('_ai')) return PROFESSIONALS_KEY;
  if (surface) return PROFESSIONALS_KEY; // any other owned surface → professionals
  return PLATFORM_KEY;
}

function titleFor(key: string): string {
  return MAJOR_SURFACES[key] || (key === PROFESSIONALS_KEY ? PROFESSIONALS_TITLE : PLATFORM_TITLE);
}

/** Build the grouped docs model from the knowledge base. Pure — every feature appears exactly once. */
export function buildDocsModel(features: AppFeature[]): DocsModel {
  const byKey = new Map<string, AppFeature[]>();
  for (const f of features) {
    const key = groupKeyFor(f);
    const arr = byKey.get(key) || [];
    arr.push(f);
    byKey.set(key, arr);
  }

  const groups: DocsGroup[] = [];
  const seenOrder = [...GROUP_ORDER, ...[...byKey.keys()].filter((k) => !GROUP_ORDER.includes(k))];
  for (const key of seenOrder) {
    const list = byKey.get(key);
    if (!list || list.length === 0) continue;
    groups.push({
      key,
      title: titleFor(key),
      features: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return { totalFeatures: features.length, groups };
}

const esc = (s: string): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function featureHtml(f: AppFeature): string {
  const kw = (f.keywords || []).slice(0, 12).map((k) => `<span class="kw">${esc(k)}</span>`).join('');
  const search = esc([f.name, f.description, (f.keywords || []).join(' ')].join(' ').toLowerCase());
  return `<article class="feat" data-search="${search}" id="${esc(f.id)}">
    <h3>${esc(f.name)}</h3>
    <div class="path">${esc(f.path)}</div>
    <p class="desc">${esc(f.description)}</p>
    <p class="how"><b>How to use:</b> ${esc(f.howToUse)}</p>
    <div class="kws">${kw}</div>
  </article>`;
}

// The knowledge base is static, so build the model + HTML once and reuse across requests.
let _model: DocsModel | null = null;
let _html: string | null = null;

export function registerKnowledgeDocsRoutes(app: Express): void {
  // Machine-readable grouped docs model.
  app.get('/api/knowledge-base', (_req: Request, res: Response) => {
    if (!_model) _model = buildDocsModel(APP_KNOWLEDGE_BASE);
    res.json(_model);
  });
  // Human-facing docs site.
  app.get('/guide', (_req: Request, res: Response) => {
    if (!_html) _html = renderDocsHtml(buildDocsModel(APP_KNOWLEDGE_BASE));
    res.type('html').send(_html);
  });
}

/** Render the docs model to a self-contained (no external CDN → CSP-safe) HTML page. */
export function renderDocsHtml(model: DocsModel): string {
  const nav = model.groups
    .map((g) => `<a href="#grp-${esc(g.key)}">${esc(g.title)} <span class="n">${g.features.length}</span></a>`)
    .join('');
  const sections = model.groups
    .map((g) => `<section class="grp" id="grp-${esc(g.key)}">
      <h2>${esc(g.title)} <span class="n">${g.features.length}</span></h2>
      ${g.features.map(featureHtml).join('\n')}
    </section>`)
    .join('\n');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NavBharatAI — User & Developer Guide</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font:15px/1.55 system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9}
header{padding:28px 24px 16px;border-bottom:1px solid #21262d;position:sticky;top:0;background:#0d1117;z-index:5}
h1{margin:0 0 4px;font-size:22px;color:#58a6ff}
.sub{color:#8b949e;font-size:13px}
#q{width:100%;margin-top:14px;padding:11px 14px;background:#161b22;border:1px solid #30363d;border-radius:10px;color:#fff;font-size:14px}
#q:focus{outline:none;border-color:#388bfd}
nav{display:flex;flex-wrap:wrap;gap:8px;padding:14px 24px;border-bottom:1px solid #21262d}
nav a{color:#8b949e;text-decoration:none;font-size:12px;background:#161b22;border:1px solid #30363d;border-radius:999px;padding:5px 11px}
nav a:hover{color:#58a6ff;border-color:#388bfd}
.n{color:#6e7681;font-weight:400}
main{max-width:920px;margin:0 auto;padding:8px 24px 60px}
.grp{margin-top:34px}
.grp>h2{font-size:16px;color:#e6edf3;border-bottom:1px solid #21262d;padding-bottom:8px}
.feat{background:#161b22;border:1px solid #21262d;border-radius:14px;padding:16px 18px;margin:12px 0}
.feat h3{margin:0 0 6px;font-size:15px;color:#fff}
.path{font-family:ui-monospace,monospace;font-size:12px;color:#58a6ff;background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:5px 9px;display:inline-block;margin-bottom:8px}
.desc{margin:6px 0;color:#c9d1d9}
.how{margin:6px 0 8px;color:#8b949e;font-size:13px}
.kws{display:flex;flex-wrap:wrap;gap:5px}
.kw{font-size:10px;color:#6e7681;background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:2px 6px}
.empty{color:#6e7681;padding:40px 0;text-align:center}
footer{padding:24px;text-align:center;color:#484f58;font-size:12px;border-top:1px solid #21262d}
</style></head><body>
<header>
  <h1>NavBharatAI — User &amp; Developer Guide</h1>
  <div class="sub">${model.totalFeatures} features, auto-generated from the live app knowledge base. Machine-readable: <a href="/api/knowledge-base" style="color:#58a6ff">/api/knowledge-base</a></div>
  <input id="q" type="search" placeholder="Search features, e.g. deploy, database, build history, cost…" autocomplete="off">
</header>
<nav>${nav}</nav>
<main>${sections}<div class="empty" id="none" style="display:none">No features match your search.</div></main>
<footer>NavBharatAI — every entry here reflects a real, shipped capability. Add a feature to the knowledge base and it appears here automatically.</footer>
<script>
(function(){
  var q=document.getElementById('q'),feats=[].slice.call(document.querySelectorAll('.feat')),
      grps=[].slice.call(document.querySelectorAll('.grp')),none=document.getElementById('none');
  q.addEventListener('input',function(){
    var t=q.value.trim().toLowerCase(),shown=0;
    feats.forEach(function(f){
      var ok=!t||f.getAttribute('data-search').indexOf(t)>-1;
      f.style.display=ok?'':'none';if(ok)shown++;
    });
    grps.forEach(function(g){
      var any=g.querySelector('.feat:not([style*="display: none"])');
      g.style.display=any?'':'none';
    });
    none.style.display=shown?'none':'';
  });
})();
</script>
</body></html>`;
}
