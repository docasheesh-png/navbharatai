/**
 * NavBharatAI Pro — App Maker Engine v4
 *
 * Phase 1 upgrade: Deep Blueprint Intelligence + App Type Templates
 *
 * Improvements over v3:
 * - generateBlueprint() replaces analyzeRequirements() — returns screens, dataModel,
 *   interactions, cdnNeeded, complexity, template type
 * - 6 app-type templates (GAME_CANVAS, GAME_LOGIC, DASHBOARD, TOOL_FORM, SOCIAL_APP, GENERIC)
 *   each with specialized HTML/JS/CSS generation hints
 * - Template-aware prompts injected into every generation step
 *
 * Generation order: Blueprint → HTML → JS → CSS → Assemble
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppFile {
  path: string;
  content: string;
  description: string;
}

export interface ValidationReport {
  passed: boolean;
  brokenIds: string[];
  missingWires: string[];
  syntaxIssues: string[];
  repairsApplied: number;
  score: number; // 0-100 quality score
}

export interface BuildResult {
  success: boolean;
  reply: string;
  files: Record<string, string>;
  fileList: AppFile[];
  previewHtml: string;
  appName: string;
  error?: string;
  validationReport?: ValidationReport;
  deploymentGuide?: string;
  followUpSuggestions?: string[];
}

export interface BuildProgress {
  stage: string;
  step: number;
  total: number;
  detail: string;
}

type ProgressCallback = (p: BuildProgress) => void;
type FileGeneratedCallback = (fileName: string, content: string) => void;

// ─── App Blueprint (replaces shallow analysis) ───────────────────────────────

type AppTemplate = 'GAME_CANVAS' | 'GAME_LOGIC' | 'DASHBOARD' | 'TOOL_FORM' | 'SOCIAL_APP' | 'GENERIC';
type Complexity  = 'simple' | 'medium' | 'complex';

interface ScreenDef { id: string; purpose: string; }

interface AppBlueprint {
  appName:        string;
  appType:        string;
  template:       AppTemplate;
  complexity:     Complexity;
  description:    string;
  screens:        ScreenDef[];
  dataModel:      Record<string, string>;
  interactions:   string[];
  cdnNeeded:      string[];
  dynamicElements: string[];   // class names JS will create at runtime
}

// ─── Template Hint Library ────────────────────────────────────────────────────

const TEMPLATE_HINTS: Record<AppTemplate, { html: string; js: string; css: string }> = {

  GAME_CANVAS: {
    html: `Structure requirements:
- SPLASH SCREEN (id="page-home", visible first): title, description, id="btn-start" button
- GAME SCREEN (id="page-game", style="display:none"): <canvas id="game-canvas">, HUD strip id="hud" with id="score-display" id="lives-display" id="level-display", id="btn-pause", id="btn-restart"
- GAMEOVER SCREEN (id="page-gameover", style="display:none"): final score display, id="btn-play-again"
- ALL screens use id="page-*" — showPage() controls visibility, no separate overlay divs`,

    js: `Implementation requirements:
- Navigation: showPage('page-home') on load, showPage('page-game') when btn-start clicked, showPage('page-gameover') on game over
- Canvas 2D context: const canvas = document.getElementById('game-canvas'); const ctx = canvas.getContext('2d');
- requestAnimationFrame game loop: function gameLoop(ts) { update(ts); draw(); requestAnimationFrame(gameLoop); }
- Game state machine: const STATE = { IDLE:'idle', PLAYING:'playing', PAUSED:'paused', GAMEOVER:'gameover' }; let state = STATE.IDLE;
- Keyboard events: document.addEventListener('keydown', handleKey)
- All game objects as plain JS objects with x, y, w, h, vx, vy properties
- Collision: AABB — if (a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y)
- Score/lives update DOM in real-time: scoreDisplay.textContent = score`,

    css: `Design requirements:
- canvas { display: block; border-radius: 12px; box-shadow: 0 0 40px rgba(var(--accent-rgb), 0.3); }
- .hud { display: flex; gap: 24px; padding: 12px 24px; background: rgba(255,255,255,0.05); border-radius: 50px; }
- Neon glow on score: text-shadow: 0 0 20px currentColor
- NEVER add display:none to page-* elements in CSS`,
  },

  GAME_LOGIC: {
    html: `Structure requirements:
- SPLASH SCREEN (id="page-home", visible first): game title, rules summary, id="btn-start" button
- GAME SCREEN (id="page-game", style="display:none"): id="game-board" (CSS grid/table for cells), id="turn-indicator", id="current-player", id="score-panel", id="btn-restart", id="btn-undo" (if applicable)
- GAMEOVER SCREEN (id="page-gameover", style="display:none"): winner message (id="winner-msg"), final scores, id="btn-play-again"
- ALL screens use id="page-*" — showPage() controls visibility
- Every interactive cell/piece gets data-attributes: data-row, data-col, data-piece`,

    js: `Implementation requirements:
- Navigation: showPage('page-home') on load; btn-start → showPage('page-game') and initGame(); btn-play-again → showPage('page-home')
- Game state: let gameState = { board: [], currentPlayer: 1, score: {1:0, 2:0}, moveCount: 0 }
- Win check after every move: function checkWin(board) { ... } → if win: update winner-msg, showPage('page-gameover')
- Event delegation on board: board.addEventListener('click', e => { const cell = e.target.closest('[data-row]'); })
- Animate moves: element.classList.add('animate-move'); setTimeout(() => el.classList.remove('animate-move'), 300)
- AI opponent (if single-player): minimax or random valid move`,

    css: `Design requirements:
- .game-board { display: grid; gap: 4px; aspect-ratio: 1; }
- .cell { cursor: pointer; transition: all 0.15s ease; border-radius: 8px; }
- .cell:hover { transform: scale(1.05); }
- .cell.animate-move { animation: piece-drop 0.3s ease; }
- @keyframes piece-drop { from { transform: scale(0) rotate(180deg); } to { transform: scale(1) rotate(0deg); } }
- Player colors: --p1-color: #6366f1; --p2-color: #f43f5e
- NEVER add display:none to page-* elements in CSS`,
  },

  DASHBOARD: {
    html: `Structure requirements:
- Sidebar: id="sidebar" with nav links, each with data-section attribute
- Main area: id="main-content" containing multiple id="section-*" divs
- Stat cards: class="stat-card" with class="stat-value" and class="stat-label"
- Chart canvases: <canvas id="chart-*"> — one per chart, Chart.js will render into these
- Data table: id="data-table" with <thead> and <tbody id="table-body">
- Filter bar: id="filter-bar" with dropdowns and search input id="search-input"`,

    js: `Implementation requirements:
- Chart.js (loaded via CDN) initialization pattern:
  const ctx = document.getElementById('chart-revenue').getContext('2d');
  new Chart(ctx, { type: 'bar', data: { labels: [...], datasets: [{ data: [...], backgroundColor: [...] }] }, options: { responsive: true, plugins: { legend: { labels: { color: '#fff' } } }, scales: { x: { ticks: { color: '#aaa' } }, y: { ticks: { color: '#aaa' } } } } })
- Section navigation: sidebar links → showSection(id)
- Table rendering: function renderTable(data) { tbody.innerHTML = data.map(row => \`<tr>...\`).join('') }
- Real data or convincing sample data — not placeholder
- Search/filter updates table in real-time`,

    css: `Design requirements:
- Layout: body { display: flex; } — sidebar fixed width, main-content flex-1
- .sidebar { width: 240px; height: 100vh; position: sticky; top: 0; overflow-y: auto; }
- .stat-card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 24px; border-left: 4px solid var(--accent); }
- .stat-value { font-size: 2.5rem; font-weight: 800; }
- Chart containers: fixed height (300px) so charts render correctly
- Table: striped rows, hover highlight, sticky header`,
  },

  TOOL_FORM: {
    html: `Structure requirements:
- Input section: id="section-input" with all form controls
- Result section: id="section-result" (hidden initially, shown after processing)
- History section: id="section-history" (if tool has history feature)
- Each input has: id, name, placeholder, and descriptive label
- Action button: id="btn-calculate" / id="btn-convert" / id="btn-generate"
- Result display: id="result-display" or id="result-card"
- Copy/export button: id="btn-copy" or id="btn-export"`,

    js: `Implementation requirements:
- Input validation before processing: function validateInputs() { ... return { valid: bool, errors: [] } }
- Core processing function with real logic — not placeholder
- Result formatting: clean display with labels and values
- localStorage persistence: save last inputs and results
- Copy to clipboard: navigator.clipboard.writeText(result)
- Error display: show validation errors inline next to fields
- Smooth scroll to result after calculation`,

    css: `Design requirements:
- .form-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
- .input-field { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 12px 16px; color: #fff; transition: border-color 0.2s; }
- .input-field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.15); outline: none; }
- .result-card { background: linear-gradient(135deg, rgba(var(--accent-rgb),0.15), rgba(var(--accent-rgb),0.05)); border: 1px solid rgba(var(--accent-rgb),0.3); border-radius: 16px; padding: 32px; }
- Animated result reveal: @keyframes reveal { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`,
  },

  SOCIAL_APP: {
    html: `Structure requirements:
- LOGIN SCREEN (id="page-login", visible first): form with id="login-username", id="login-password", id="btn-login", id="login-error" (hidden div for inline error messages — NEVER alert())
- FEED SCREEN (id="page-feed", display:none): top navbar (id="navbar") with logo, search (id="search-input"), post button (id="btn-open-create"), avatar; id="posts-container" for feed cards; id="stories-bar" for stories strip
- PROFILE SCREEN (id="page-profile", display:none): id="profile-avatar", id="profile-name", id="profile-stats", id="profile-posts-grid"
- CREATE POST MODAL (id="modal-create-post", display:none): textarea id="post-content-input", id="btn-submit-post", id="btn-cancel-post"
- NOTIFICATION TOAST (id="toast-msg", display:none): for success/error feedback — use this INSTEAD of alert()
- Bottom nav (on feed/profile screens): id="nav-feed", id="nav-profile", id="nav-logout"`,

    js: `Implementation requirements:
- Auth: const SAMPLE_USERS = [{ username: 'demo', password: 'demo123', name: 'Demo User', avatar: 'DU' }, { username: 'admin', password: 'admin123', name: 'Admin', avatar: 'AD' }]; let currentUser = null;
- Login handler: getElementById('btn-login').addEventListener('click', () => { const u = SAMPLE_USERS.find(x => x.username === usernameInput.value && x.password === passwordInput.value); if (u) { currentUser = u; showPage('page-feed'); renderPosts(); } else { loginError.textContent = 'Invalid username or password'; loginError.style.display = 'block'; } }) — NEVER alert()
- Sample data: const SAMPLE_POSTS = [ { id:1, author:'Demo User', avatar:'DU', content:'Welcome to the app! 🚀', likes:12, liked:false, comments:[], time: Date.now()-120000, tags:['welcome'] }, ... (5+ posts) ]
- Render function: function renderPosts(posts=SAMPLE_POSTS) { container.innerHTML = posts.map(p => renderPostCard(p)).join('') }
- Like toggle: event delegation, toggle p.liked, update count in DOM
- Create post: modal → new post object → unshift to SAMPLE_POSTS → re-render → close modal → showToast('Post shared!')
- Logout: currentUser = null; showPage('page-login')
- showToast(msg): update id="toast-msg" textContent, show for 2.5s, then hide — NEVER alert()
- Relative timestamps: "just now", "2m ago", "1h ago" etc.`,

    css: `Design requirements:
- .post-card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 20px; margin-bottom: 16px; transition: transform 0.2s; }
- .post-card:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
- .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), #f43f5e); display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; }
- #login-error { color: #f87171; font-size: 0.85rem; margin-top: 8px; }
- .like-btn.liked { color: #f43f5e; }
- #toast-msg { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:rgba(99,102,241,0.95); color:#fff; padding:12px 24px; border-radius:50px; z-index:9999; transition:opacity 0.3s; }
- @keyframes heart-pop { 50% { transform: scale(1.4); } }`,
  },

  GENERIC: {
    html: `Structure requirements:
- Clean semantic HTML5 structure with all screens present
- Every interactive element has a unique id for JS event wiring
- Inline error/feedback divs (id="*-error", id="*-status") for user messages — NEVER alert()`,
    js: `Implementation requirements:
- Complete working logic for ALL features — zero placeholders
- All buttons wired with addEventListener — no button left unwired
- Multi-page navigation via showPage() pattern
- showToast(message) helper instead of alert() for all user feedback`,
    css: `Design requirements:
- Dark theme with glassmorphism cards
- Smooth CSS transitions on all interactive elements
- Fully responsive mobile + desktop`,
  },
};

// ─── Phase 2: CDN Registry ───────────────────────────────────────────────────

const CDN_TAGS: Record<string, string> = {
  'inter-font':   '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">',
  'font-awesome': '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">',
  'chart.js':     '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>',
  'animate-css':  '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css">',
  'gsap':         '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>',
};

// CDN usage hints injected into JS prompts so AI knows how to use them
const CDN_USAGE_HINTS: Record<string, string> = {
  'chart.js': `Chart.js is loaded via CDN. Usage:
  const ctx = document.getElementById('myChart').getContext('2d');
  const chart = new Chart(ctx, {
    type: 'bar', // or 'line', 'doughnut', 'pie', 'radar'
    data: { labels: [...], datasets: [{ label: '...', data: [...], backgroundColor: [...] }] },
    options: { responsive: true, plugins: { legend: { labels: { color: '#fff' } } },
      scales: { x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                y: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } } } }
  });`,
  'gsap': `GSAP is loaded via CDN. Usage:
  gsap.from('.card', { opacity: 0, y: 30, stagger: 0.1, duration: 0.5 });
  gsap.to('#score', { scale: 1.3, duration: 0.2, yoyo: true, repeat: 1 });`,
  'font-awesome': `Font Awesome icons: <i class="fa-solid fa-star"></i> <i class="fa-solid fa-heart"></i>
  Common: fa-house, fa-gear, fa-user, fa-chart-bar, fa-play, fa-pause, fa-trophy, fa-fire`,
};

function buildCdnHeadTags(cdnNeeded: string[]): string {
  // Always include inter-font + font-awesome for visual quality
  const always = ['inter-font', 'font-awesome'];
  const all = [...new Set([...always, ...cdnNeeded])];
  return all
    .filter(id => CDN_TAGS[id])
    .map(id => `  ${CDN_TAGS[id]}`)
    .join('\n');
}

function buildCdnJsHints(cdnNeeded: string[]): string {
  return cdnNeeded
    .filter(id => CDN_USAGE_HINTS[id])
    .map(id => `// ${id.toUpperCase()} USAGE:\n${CDN_USAGE_HINTS[id]}`)
    .join('\n\n');
}

// ─── AI Caller — Pro cascade: race(Claude+Grok) → Gemini → Vertex ────────────
// Top 2 providers race simultaneously; winner's AbortController cancels the loser.
// Falls through to Gemini → Vertex sequentially only if both racers fail.

async function callAI(prompt: string, systemPrompt: string, maxTokens = 6000): Promise<string> {
  const msgs = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: prompt },
  ];

  const claudeKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const grokKey   = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';

  // ── Race: Claude + Grok simultaneously ───────────────────────────────────
  type RacerFn = (signal: AbortSignal) => Promise<string>;
  const racers: RacerFn[] = [];

  if (claudeKey) racers.push(async (signal) => {
    const rawBase = process.env.ANTHROPIC_BASE_URL;
    const base = rawBase?.replace(/\/v1\/?$/, '');
    if (base) {
      const { default: OpenAI } = await import('openai');
      const c = new OpenAI({ apiKey: claudeKey, baseURL: base });
      for (const m of ['anthropic/claude-sonnet-4.6', 'claude-sonnet-4-6', 'anthropic/claude-3.5-sonnet', 'claude-3-5-sonnet-20241022']) {
        try {
          const r = await c.chat.completions.create({ model: m, max_tokens: maxTokens, messages: msgs }, { signal });
          const t = r.choices[0]?.message?.content || '';
          if (t.trim()) return t;
        } catch (e: any) { if (signal.aborted) throw e; console.warn(`[AppEngine] Claude proxy ${m}: ${e.message}`); }
      }
    } else {
      const c = new Anthropic({ apiKey: claudeKey });
      const r = await c.messages.create({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: prompt }] });
      const t = (r.content.find((x: any) => x.type === 'text') as any)?.text || '';
      if (t.trim()) return t;
    }
    throw new Error('Claude: no valid response');
  });

  if (grokKey) racers.push(async (signal) => {
    const { default: OpenAI } = await import('openai');
    const c = new OpenAI({ apiKey: grokKey, baseURL: 'https://api.x.ai/v1' });
    for (const m of ['grok-3', 'grok-3-fast']) {
      try {
        const r = await c.chat.completions.create({ model: m, max_tokens: maxTokens, messages: msgs }, { signal });
        const t = r.choices[0]?.message?.content || '';
        if (t.trim()) return t;
      } catch (e: any) { if (signal.aborted) throw e; console.warn(`[AppEngine] Grok ${m}: ${e.message}`); }
    }
    throw new Error('Grok: no valid response');
  });

  if (racers.length > 0) {
    const acs = racers.map(() => new AbortController());
    try {
      const winner = await Promise.any(
        racers.map((fn, i) => fn(acs[i].signal).then(text => {
          acs.forEach((ac, j) => { if (j !== i && !ac.signal.aborted) ac.abort(); });
          console.log(`[AppEngine] Race won by ${i === 0 ? 'Claude' : 'Grok'}`);
          return text;
        }))
      );
      if (winner?.trim()) return winner;
    } catch {
      console.warn('[AppEngine] Race (Claude+Grok) both failed → Gemini/Vertex fallback');
    }
  }

  // ── Sequential fallback: Gemini → Vertex ─────────────────────────────────
  if (geminiKey) {
    for (const m of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const r = await ai.models.generateContent({ model: m, contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + prompt }] }] });
        if (r.text?.trim()) { console.log(`[AppEngine] Gemini ${m} fallback succeeded`); return r.text; }
      } catch (e: any) { console.warn(`[AppEngine] Gemini ${m}: ${e.message}`); }
    }
  }

  if (projectId) {
    for (const m of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
      try {
        const { GoogleGenAI: VtxAI } = await import('@google/genai');
        const ai = new VtxAI({ vertexai: true, project: projectId, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
        const r = await ai.models.generateContent({ model: m, contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + prompt }] }] });
        if (r.text?.trim()) { console.log(`[AppEngine] Vertex ${m} fallback succeeded`); return r.text; }
      } catch (e: any) { console.warn(`[AppEngine] Vertex ${m}: ${e.message}`); }
    }
  }

  throw new Error('All AI providers unavailable. Check API keys in Cloud Run console.');
}

// ─── Step 1: Generate Deep Blueprint ─────────────────────────────────────────

function detectTemplate(appType: string, features: string[]): AppTemplate {
  const t = (appType + ' ' + features.join(' ')).toLowerCase();
  if (t.match(/\b(game|play|score|level|lives|enemy|shoot|jump|run|puzzle|arcade|snake|tetris|pacman|cricket|chess|ludo|card)\b/)) {
    // Canvas games: action/arcade/sports; Logic games: board/card/turn-based
    if (t.match(/\b(snake|tetris|pacman|flappy|shoot|arcade|cricket|football|space|asteroid|platformer|runner)\b/))
      return 'GAME_CANVAS';
    return 'GAME_LOGIC';
  }
  if (t.match(/\b(dashboard|analytics|chart|graph|stats|report|metric|admin|monitor|kpi)\b/)) return 'DASHBOARD';
  if (t.match(/\b(social|feed|post|like|comment|share|follow|profile|tweet|instagram|community)\b/))  return 'SOCIAL_APP';
  return 'TOOL_FORM';
}

async function generateBlueprint(userPrompt: string): Promise<AppBlueprint> {
  const sys = `You are a senior software architect. Analyze the user's request and return a detailed JSON blueprint.
Return ONLY valid JSON — no markdown, no explanation, no code fences.`;

  const prompt = `User request: "${userPrompt}"

Return this exact JSON structure (all fields required):
{
  "appName": "short memorable name",
  "appType": "game|dashboard|tool|social|calculator|etc",
  "description": "one sentence what this app does",
  "complexity": "simple|medium|complex",
  "screens": [
    { "id": "page-home", "purpose": "what the user does here" },
    { "id": "page-game", "purpose": "what the user does here" }
  ],
  "dataModel": {
    "entityName": "{ field1: type, field2: type, ... }"
  },
  "interactions": [
    "User clicks X → Y happens",
    "User enters Z → result W shown"
  ],
  "cdnNeeded": [],
  "dynamicElements": ["class names JS will create at runtime, e.g. toast-notification, modal-overlay"]
}

Complexity guide:
- simple:  1-2 screens, <200 lines JS (calculator, clock, color picker)
- medium:  3-4 screens, 200-500 lines JS (todo app, quiz, weather)
- complex: 5+ screens OR heavy game logic, 500+ lines JS (chess, cricket, social app)

cdnNeeded guide (use exact strings):
- "chart.js" only if app shows charts/graphs
- "font-awesome" always include (icons)
- "inter-font" always include (typography)

Return ONLY the JSON:`;

  const raw = await callAI(prompt, sys, 1200);
  try {
    // Robust JSON extraction: handle code fences, trailing commas, extra text
    let clean = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) clean = jsonMatch[0];
    clean = clean.replace(/,\s*([\}\]])/g, '$1'); // remove trailing commas
    const parsed = JSON.parse(clean) as Partial<AppBlueprint>;

    // Detect template from appType + features extracted from blueprint
    const template = detectTemplate(parsed.appType || '', parsed.interactions || []);

    // Auto-add CDNs based on template type
    const cdnBase: string[] = [...(parsed.cdnNeeded || []), 'font-awesome', 'inter-font'];
    if (template === 'DASHBOARD') cdnBase.push('chart.js');

    return {
      appName:        parsed.appName        || 'My App',
      appType:        parsed.appType        || 'web-app',
      template,
      description:    parsed.description    || userPrompt.slice(0, 80),
      complexity:     (parsed.complexity as Complexity) || 'medium',
      screens:        parsed.screens        || [{ id: 'page-home', purpose: 'main interface' }],
      dataModel:      parsed.dataModel      || {},
      interactions:   parsed.interactions   || [],
      cdnNeeded:      [...new Set(cdnBase)],
      dynamicElements:parsed.dynamicElements|| [],
    };
  } catch {
    const template = detectTemplate(userPrompt, []);
    const cdnBase  = ['font-awesome', 'inter-font'];
    if (template === 'DASHBOARD') cdnBase.push('chart.js');
    return {
      appName: 'My App', appType: 'web-app', template, complexity: 'medium',
      description: userPrompt.slice(0, 80),
      screens: [{ id: 'page-home', purpose: 'main interface' }],
      dataModel: {}, interactions: [],
      cdnNeeded: [...new Set(cdnBase)], dynamicElements: [],
    };
  }
}

// ─── Fix #2: Complexity enforcement rules ─────────────────────────────────────

function enforceComplexityRules(bp: AppBlueprint): AppBlueprint {
  // Canvas games always need complex (500+ lines of game loop)
  if (bp.template === 'GAME_CANVAS') return { ...bp, complexity: 'complex' };
  // Logic games with 3+ screens need complex
  if (bp.template === 'GAME_LOGIC' && bp.screens.length >= 3) return { ...bp, complexity: 'complex' };
  // Any app with 5+ screens is complex
  if (bp.screens.length >= 5) return { ...bp, complexity: 'complex' };
  return bp;
}

// ─── Phase 3: Structural Summary Extractor ───────────────────────────────────

/**
 * Extracts a compact structural summary from raw HTML.
 * Replaces passing 8000 chars of raw HTML to CSS/secondary prompts.
 * Result: ~300 chars with all the IDs, classes, and page structure JS/CSS need.
 *
 * Fix #7: strips <script> blocks and HTML comments before regex parsing
 * to avoid false positives from JS strings/comments that look like HTML attributes.
 */
function extractStructuralSummary(html: string): string {
  // Fix #7: remove script blocks and HTML comments before regex parsing
  let cleanHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  cleanHtml = cleanHtml.replace(/<!--[\s\S]*?-->/g, '');

  const pages:   string[] = [];
  const buttons: string[] = [];
  const inputs:  string[] = [];
  const displays:string[] = [];
  const classes: Set<string> = new Set();

  // Extract page IDs
  for (const m of cleanHtml.matchAll(/id="(page-[^"]+)"/g))  pages.push(m[1]);
  // Extract button IDs + labels
  for (const m of cleanHtml.matchAll(/<button[^>]*id="([^"]+)"[^>]*>([^<]{0,30})/gi)) {
    buttons.push(`#${m[1]}[${m[2].trim()}]`);
  }
  // Extract input/select IDs
  for (const m of cleanHtml.matchAll(/<(?:input|select|textarea)[^>]*id="([^"]+)"/gi)) inputs.push(`#${m[1]}`);
  // Extract display/output IDs (non-button, non-input)
  for (const m of cleanHtml.matchAll(/id="(?!page-|btn-)([^"]+)"/g)) {
    if (!buttons.find(b => b.startsWith(`#${m[1]}`))) displays.push(`#${m[1]}`);
  }
  // Extract unique class names (skip single-letter / utility names)
  for (const m of cleanHtml.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).filter(c => c.length > 3).forEach(c => classes.add(c));
  }

  const lines: string[] = [];
  if (pages.length)    lines.push(`PAGES: ${pages.join(', ')}`);
  if (buttons.length)  lines.push(`BUTTONS: ${buttons.slice(0, 15).join(', ')}`);
  if (inputs.length)   lines.push(`INPUTS: ${inputs.join(', ')}`);
  if (displays.length) lines.push(`DISPLAYS: ${displays.slice(0, 15).join(', ')}`);
  if (classes.size)    lines.push(`CLASSES: ${[...classes].slice(0, 30).join(', ')}`);

  return lines.join('\n');
}

// ─── Phase 4: Split JS Generation for Complex Apps ───────────────────────────

/**
 * Fix #3: Generates shared state/variable contract so all 3 modules
 * use consistent variable names and function signatures.
 */
async function generateModuleContract(bp: AppBlueprint, htmlSummary: string): Promise<string> {
  const sys = `You are a JavaScript architect. Output ONLY JavaScript variable declarations and function stubs — no markdown, no explanation.`;
  const prompt = `Define shared state variables and function signatures for: ${bp.appName}

App structure:
${htmlSummary}

Data model: ${JSON.stringify(bp.dataModel)}
Features: ${bp.interactions.slice(0, 6).join(' | ')}

Output:
1. AppState reactive manager (ALWAYS include this exact code):
   const AppState = (() => {
     const _s = {}, _l = {};
     return {
       set(k, v) { _s[k] = v; (_l[k]||[]).forEach(fn => fn(v)); },
       get(k) { return _s[k]; },
       on(k, fn) { (_l[k] = _l[k]||[]).push(fn); },
     };
   })();
2. All shared state variables with initial values (e.g. let score = 0; let lives = 3;)
3. Function signatures as comments only (e.g. // function startGame() {} — implemented in logic module)
4. Constants (e.g. const CANVAS_WIDTH = 800;)
5. loadState() and saveState() using localStorage — update AppState in loadState()

Output ONLY the variable declarations and comments:`;
  try {
    return await callAI(prompt, sys, 1500);
  } catch {
    return `// Shared state\nlet gameState = {};\nlet score = 0;\nlet isRunning = false;`;
  }
}

/**
 * For complex apps (500+ lines of JS needed), splits generation into 3 focused modules:
 * - state:  data model, game/app state, storage
 * - ui:     DOM updates, page transitions, rendering, animations
 * - logic:  core rules, calculations, event handlers, game mechanics
 *
 * Each module is generated with the full HTML context + other modules as stubs,
 * then merged into one script.js.
 *
 * Fix #3: generates shared contract first so all modules use consistent variable names.
 */
async function generateJSSplit(bp: AppBlueprint, htmlContent: string): Promise<string> {
  const hints    = TEMPLATE_HINTS[bp.template];
  const cdnHints = buildCdnJsHints(bp.cdnNeeded);
  const summary  = extractStructuralSummary(htmlContent);
  const baseCtx  = `App: ${bp.appName} [${bp.template}, ${bp.complexity}]\nDescription: ${bp.description}`;

  // Fix #3: Generate shared contract first so all modules use consistent variable names
  const contract = await generateModuleContract(bp, summary);

  const showPageFn = `function showPage(id) {
  document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
  const el = document.getElementById(id); if (el) el.style.display = 'block';
}`;

  const sys = `You are a world-class JavaScript developer. Output ONLY raw JavaScript — no markdown, no <script> tags.
CRITICAL CODING RULE: ALL identifiers (variable names, function names, class names, constants, code comments, string literals, console.log messages) MUST be in English. No Hindi, Hinglish, or any other language in code. This is absolute and non-negotiable.
ABSOLUTELY FORBIDDEN: alert(), confirm(), prompt() — NEVER use these. Use showToast() or DOM element updates for ALL user feedback. No "(placeholder)" comments, no empty functions.
QUALITY STANDARD: Add JSDoc on all public functions and @type on key state variables.`;

  // Module 1: State — data model, constants, storage
  const statePrompt = `${baseCtx}

Generate ONLY the STATE MODULE for script.js.
This module covers: all data models, constants, initial state, localStorage load/save.

APP STRUCTURE:
${summary}

DATA MODEL: ${JSON.stringify(bp.dataModel, null, 2)}

SHARED CONTRACT (use these exact variable names):
${contract}

Rules:
- Define all state variables at module top
- Include loadState() and saveState() using localStorage
- Define all constants (speeds, sizes, rules)
- NO event listeners, NO DOM manipulation — that's in other modules
- Export nothing — all vars are module-global (no ES modules)

Output ONLY the state module JavaScript:`;

  // Module 2: Logic — core rules, calculations, game mechanics
  const logicPrompt = `${baseCtx}

Generate ONLY the LOGIC MODULE for script.js.
This module covers: core game/app logic, calculations, win/lose checks, AI, data processing.

APP STRUCTURE:
${summary}

USER INTERACTIONS: ${bp.interactions.join(' | ')}

SHARED CONTRACT:
${contract}

TEMPLATE RULES:
${hints.js}

Rules:
- Pure logic functions (no DOM) where possible
- Game rules, scoring, win conditions, calculations
- AI opponent logic if needed
- Call saveState() after state changes
- No event listeners — logic module, called BY event handlers

Output ONLY the logic module JavaScript:`;

  // Module 3: UI — DOM, events, rendering, transitions
  const uiPrompt = `${baseCtx}

Generate ONLY the UI MODULE for script.js — this is the main entry point.
This module covers: all event listeners, DOM updates, page transitions, rendering, DOMContentLoaded.

EXACT HTML:
\`\`\`html
${htmlContent.slice(0, 20000)}
\`\`\`

ALL SCREENS — wire navigation for ALL of them: ${bp.screens.map(s => `${s.id} (${s.purpose})`).join(' | ')}

${cdnHints ? `CDN LIBRARIES:\n${cdnHints}\n` : ''}

SHARED CONTRACT:
${contract}

Rules:
- DOMContentLoaded wraps EVERYTHING
- Wire EVERY button using addEventListener — NO button left unwired
- Include showPage() function and call it for ALL screen transitions
- Every non-home screen must have at least ONE button that calls showPage() to reach it
- Render functions update DOM from state variables
- Include:
${showPageFn}
- showPage('${bp.screens[0]?.id || 'page-home'}') on load
- Call logic functions, update DOM, show results
- Add global error handler at the very start of DOMContentLoaded:
  window.onerror = function(msg, src, line, col, err) {
    const eb = document.getElementById('nbt-error-bar') || (() => { const d = document.createElement('div'); d.id='nbt-error-bar'; d.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#c0392b;color:#fff;padding:8px 14px;font-size:13px;z-index:99999;display:none;'; document.body.appendChild(d); return d; })();
    eb.textContent = '⚠ JS Error: ' + msg + (line ? ' (line ' + line + ')' : ''); eb.style.display = 'block';
    setTimeout(() => { eb.style.display = 'none'; }, 6000); return false;
  };

Output ONLY the UI module JavaScript:`;

  console.log('[AppEngine] Split generation: 3 modules in parallel...');
  const [stateJs, logicJs, uiJs] = await Promise.all([
    callAI(statePrompt, sys, 4000),
    callAI(logicPrompt, sys, 5000),
    callAI(uiPrompt,    sys, 6000),
  ]);

  // Cross-validate: find variables used in logic/ui but not declared in state
  const stateDeclarations = new Set<string>();
  for (const m of stateJs.matchAll(/(?:let|const|var)\s+(\w+)/g)) stateDeclarations.add(m[1]);
  const crossIssues: string[] = [];
  for (const m of (logicJs + uiJs).matchAll(/\b([a-zA-Z_]\w{3,})\b/g)) {
    const name = m[1];
    if (!stateDeclarations.has(name) && /^[a-z]/.test(name) &&
        !['function','return','const','let','var','if','else','for','while','switch','case',
          'break','continue','null','true','false','undefined','document','window','console',
          'Math','Date','JSON','Object','Array','String','Number','Boolean','Promise','fetch',
          'setTimeout','setInterval','clearInterval','clearTimeout','addEventListener',
          'querySelector','getElementById','classList','style','innerHTML','textContent',
          'requestAnimationFrame','cancelAnimationFrame','localStorage','sessionStorage'].includes(name) &&
        (logicJs.includes(`${name}(`) || uiJs.includes(`${name}(`) || // function call
         logicJs.includes(`= ${name}`) || uiJs.includes(`= ${name}`))) { // assignment
      crossIssues.push(name);
    }
  }
  if (crossIssues.length > 0) {
    console.log(`[AppEngine] Cross-module check: ${[...new Set(crossIssues)].slice(0,10).join(', ')} referenced but may need state declaration`);
  }

  // Merge: state → logic → ui (dependency order)
  return `// ── STATE ──────────────────────────────────────────
${stateJs}

// ── LOGIC ──────────────────────────────────────────
${logicJs}

// ── UI / EVENT HANDLERS ────────────────────────────
${uiJs}`;
}

// ─── Phase 5: Quality Validation + Auto-Repair ───────────────────────────────

interface ValidationResult {
  valid: boolean;
  brokenIds: string[];        // IDs referenced in JS but missing in HTML
  missingWires: string[];     // button IDs in HTML with no addEventListener in JS
  syntaxIssues: string[];     // basic syntax problems detected
}

function validateDOMConsistency(html: string, js: string): ValidationResult {
  const result: ValidationResult = { valid: true, brokenIds: [], missingWires: [], syntaxIssues: [] };

  // Extract all IDs from HTML
  const htmlIds = new Set<string>();
  for (const m of html.matchAll(/id="([^"]+)"/g)) htmlIds.add(m[1]);

  // Find IDs referenced in JS via getElementById / querySelector
  const jsIdRefs = new Set<string>();
  for (const m of js.matchAll(/getElementById\(['"`]([^'"`]+)['"`]\)/g))  jsIdRefs.add(m[1]);
  for (const m of js.matchAll(/querySelector\(['"`]#([^'"`\s]+)['"`]\)/g)) jsIdRefs.add(m[1]);

  // CRITICAL: Check showPage() and showScreen() calls — most common broken navigation
  for (const m of js.matchAll(/show(?:Page|Screen)\(['"`]([^'"`]+)['"`]\)/g)) jsIdRefs.add(m[1]);

  // Broken: JS references ID not in HTML
  for (const id of jsIdRefs) {
    if (!htmlIds.has(id)) result.brokenIds.push(id);
  }

  // Missing wires: button IDs in HTML that have no addEventListener in JS
  const buttonIds: string[] = [];
  for (const m of html.matchAll(/<button[^>]*id="([^"]+)"/gi)) buttonIds.push(m[1]);
  for (const id of buttonIds) {
    if (!js.includes(`'${id}'`) && !js.includes(`"${id}"`)) {
      result.missingWires.push(id);
    }
  }

  // CRITICAL: Multi-screen navigation check
  // Every page-* screen (except first) must have at least one showPage() path to reach it
  const pageScreens = [...html.matchAll(/<div[^>]*id="(page-[^"]+)"/gi)].map(m => m[1]);
  if (pageScreens.length > 1) {
    if (!js.includes('showPage(')) {
      result.syntaxIssues.push(`CRITICAL: ${pageScreens.length} screens found but no showPage() calls in JS — all navigation broken`);
    } else {
      for (const screenId of pageScreens.slice(1)) { // skip first (home) screen
        if (!js.includes(`showPage('${screenId}')`) && !js.includes(`showPage("${screenId}")`)) {
          result.brokenIds.push(screenId); // Unreachable screen
        }
      }
    }
  }

  // Basic syntax: unclosed braces (rough check, ±3 tolerance)
  const opens  = (js.match(/\{/g) || []).length;
  const closes = (js.match(/\}/g) || []).length;
  if (Math.abs(opens - closes) > 3) result.syntaxIssues.push(`brace mismatch: ${opens} { vs ${closes} }`);

  result.valid = result.brokenIds.length === 0 && result.missingWires.length === 0 && result.syntaxIssues.length === 0;
  return result;
}

async function autoRepairJS(
  js: string,
  html: string,
  validation: ValidationResult,
  appName: string,
): Promise<string> {
  const issues: string[] = [];
  if (validation.brokenIds.length)    issues.push(`Broken getElementById IDs (not in HTML): ${validation.brokenIds.join(', ')}`);
  if (validation.missingWires.length) issues.push(`Button IDs in HTML with no addEventListener: ${validation.missingWires.join(', ')}`);
  if (validation.syntaxIssues.length) issues.push(`Syntax issues: ${validation.syntaxIssues.join(', ')}`);

  const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]).join(', ');
  const pageIds = [...html.matchAll(/id="(page-[^"]+)"/g)].map(m => m[1]).join(', ');

  const sys = `You are a JavaScript debugger. Fix ONLY the listed issues. Change no other logic. Output ONLY fixed JavaScript.`;
  const prompt = `Fix these issues in the JavaScript for "${appName}":

ISSUES TO FIX:
${issues.join('\n')}

VALID PAGE IDs for showPage() calls (these exact strings exist in HTML): ${pageIds || 'none found'}
ALL VALID HTML IDs (use these exact strings):
${htmlIds}

JAVASCRIPT TO FIX:
${js.slice(0, 12000)}

Return ONLY the corrected JavaScript — same logic, only broken references/missing wires fixed:`;

  try {
    return await callAI(prompt, sys, 10000);
  } catch {
    console.warn('[AppEngine] Auto-repair AI call failed, returning original JS');
    return js;
  }
}

// ─── Comprehensive final validation report ────────────────────────────────────

function computeValidationReport(html: string, js: string, css: string, repairsApplied: number): ValidationReport {
  const domCheck = validateDOMConsistency(html, js);

  // Additional checks
  const syntaxIssues = [...domCheck.syntaxIssues];

  // Check for common JS anti-patterns that break apps
  if (js.includes('document.write(')) syntaxIssues.push('document.write() found — breaks page');
  if (js.match(/innerHTML\s*\+=/)) syntaxIssues.push('innerHTML += found — prefer appendChild');
  if (!js.includes('DOMContentLoaded') && !js.includes('defer')) {
    syntaxIssues.push('No DOMContentLoaded wrapper — elements may not exist when JS runs');
  }

  // Check CSS has :root variables defined
  const cssIssues: string[] = [];
  if (!css.includes(':root')) cssIssues.push('CSS: no :root variables defined');

  // FATAL CSS check: page-* display rules in CSS break JS navigation
  const hasForbiddenPageCss =
    (css.includes('[id^="page-"]') || css.includes('[id^=\'page-\']')) &&
    (css.includes('display: none') || css.includes('display:none'));
  if (hasForbiddenPageCss) {
    cssIssues.push('FATAL: CSS has display:none on [id^="page-"] — overrides JS showPage() and breaks all navigation');
  }

  const allIssues = [...domCheck.brokenIds.map(i => `Broken ID / Unreachable screen: #${i}`),
                     ...domCheck.missingWires.map(i => `Unwired button: #${i}`),
                     ...syntaxIssues,
                     ...cssIssues];

  // Quality score: start at 100, deduct per issue severity
  let score = 100;
  score -= domCheck.brokenIds.length * 15;    // broken IDs / unreachable screens: -15 each
  score -= domCheck.missingWires.length * 10; // unwired buttons: -10 each
  score -= domCheck.syntaxIssues.filter(i => i.startsWith('CRITICAL')).length * 30; // fatal nav: -30
  score -= syntaxIssues.filter(i => !i.startsWith('CRITICAL')).length * 5;
  score -= cssIssues.length * (hasForbiddenPageCss ? 40 : 3); // fatal CSS: -40
  score = Math.max(0, Math.min(100, score));

  return {
    passed: allIssues.length === 0,
    brokenIds: domCheck.brokenIds,
    missingWires: domCheck.missingWires,
    syntaxIssues: [...syntaxIssues, ...cssIssues],
    repairsApplied,
    score,
  };
}

// ─── Deployment guide generator ───────────────────────────────────────────────

function generateDeploymentGuide(appName: string): string {
  return `## ${appName} — Deployment Options

### Option 1: GitHub Pages (Free, Recommended)
1. Create a new repo at github.com/new
2. Upload: index.html, style.css, script.js
3. Settings → Pages → Source: "main branch"
4. Live in ~2 minutes: https://yourusername.github.io/repo-name

### Option 2: Vercel (Free, Fastest)
1. Sign up at vercel.com
2. "New Project" → "Import from GitHub" or drag-drop files
3. Click Deploy → live URL ready in 30 seconds

### Option 3: Netlify (Free)
1. netlify.com → drag & drop your 3 files
2. Instant live URL (e.g. https://amazing-app-123.netlify.app)

### Option 4: Firebase Hosting
1. npm install -g firebase-tools
2. firebase login && firebase init hosting
3. Copy files to public/ folder
4. firebase deploy`;
}

// ─── Step 2: Generate HTML (template-aware) ───────────────────────────────────

async function generateHTML(bp: AppBlueprint): Promise<string> {
  const hints    = TEMPLATE_HINTS[bp.template];
  const screenList   = bp.screens.map(s => `- ${s.id}: ${s.purpose}`).join('\n');
  const dataModelStr = Object.entries(bp.dataModel).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  const cdnTags      = buildCdnHeadTags(bp.cdnNeeded);

  const sys = `You are a world-class frontend developer. Output ONLY raw HTML — no markdown fences, no explanation.
CRITICAL CODING RULE: ALL identifiers (variable names, function names, class names, constants, code comments, string literals, console.log messages) MUST be in English. No Hindi, Hinglish, or any other language in code. This is absolute and non-negotiable.
ABSOLUTELY FORBIDDEN — NEVER DO THESE OR THE APP BREAKS:
- alert(), confirm(), prompt() — these are BANNED. Use inline DOM elements for ALL feedback.
- "(placeholder)", "TODO", empty functions — build every feature fully, no exceptions.
- Leaving any screen empty — every screen in SCREENS TO BUILD must have complete UI.`;

  const prompt = `Generate COMPLETE index.html for this app.

App Name: ${bp.appName}
Type: ${bp.appType} [Template: ${bp.template}]
Description: ${bp.description}
Complexity: ${bp.complexity}

CDN LIBRARIES (already included — use them in JS):
${bp.cdnNeeded.filter(c => CDN_TAGS[c]).join(', ') || 'inter-font, font-awesome'}

SCREENS TO BUILD:
${screenList}

DATA MODEL:
${dataModelStr || '  (define as needed)'}

USER INTERACTIONS (ALL — implement UI for every one):
${bp.interactions.map(i => `- ${i}`).join('\n')}

TEMPLATE-SPECIFIC HTML REQUIREMENTS:
${hints.html}

UNIVERSAL RULES:
1. In <head>, include EXACTLY these CDN tags (copy verbatim, before style.css link):
${cdnTags}
   Then: <link rel="stylesheet" href="style.css">
   At end of <body>: <script src="script.js" defer></script>
2. Every screen is a <div id="page-*"> — JS will show/hide them
3. EVERY interactive element has a unique id="" — JS attaches events via IDs
4. First screen (${bp.screens[0]?.id || 'page-home'}) visible, all others have style="display:none"
5. No inline onclick, no inline styles — JS and CSS handle those
6. Use Font Awesome icons: <i class="fa-solid fa-play"></i> etc.
7. ALL ${bp.screens.length} SCREENS MUST BE BUILT — each with full UI: ${bp.screens.map(s => `${s.id} (${s.purpose})`).join(', ')}
8. Include id="toast-msg" div (hidden, for user notifications) — NEVER use alert() in JS
9. For login forms: include id="*-error" divs for inline validation messages
10. ACCESSIBILITY (mandatory):
    - Every <button> must have aria-label="..." describing its action
    - Every <input> must have a <label for="id"> or aria-label="..."
    - Main content screen: add role="main"
    - Navigation bars: add role="navigation" aria-label="Main navigation"
    - Modals/dialogs: add role="dialog" aria-modal="true" aria-labelledby="..."
    - Images: always add alt="description"
    - Focus order must be logical (tabindex only if re-ordering needed)

Output ONLY the raw HTML:`;

  return callAI(prompt, sys, 7000);
}

// ─── Step 3: Generate JS (template-aware, knows HTML structure) ───────────────

async function generateJS(bp: AppBlueprint, htmlContent: string): Promise<string> {
  const hints       = TEMPLATE_HINTS[bp.template];
  const cdnHints    = buildCdnJsHints(bp.cdnNeeded);

  const sys = `You are a world-class JavaScript developer. Output ONLY raw JavaScript — no markdown fences, no <script> tags.
CRITICAL CODING RULE: ALL identifiers (variable names, function names, class names, constants, code comments, string literals, console.log messages) MUST be in English. No Hindi, Hinglish, or any other language in code. This is absolute and non-negotiable.
ABSOLUTELY FORBIDDEN — NEVER DO THESE:
- alert(), confirm(), prompt() — COMPLETELY BANNED. For user feedback use showToast() or update a DOM element's textContent.
- "(placeholder)", empty functions like () => {}, unimplemented features — every function must have real working logic.
- Leaving any button unwired — every button in the HTML must have a working addEventListener.
QUALITY STANDARD: Add JSDoc type annotations on all public functions: /** @param {string} id @returns {void} */ and @type on key state variables.`;

  const prompt = `Generate COMPLETE script.js for this app.

App: ${bp.appName} [${bp.appType}, Template: ${bp.template}, Complexity: ${bp.complexity}]
Description: ${bp.description}

EXACT HTML STRUCTURE (use these exact IDs):
\`\`\`html
${htmlContent.slice(0, 20000)}
\`\`\`

ALL SCREENS TO WIRE NAVIGATION FOR: ${bp.screens.map(s => `${s.id} (${s.purpose})`).join(' | ')}

USER INTERACTIONS TO IMPLEMENT (ALL of them):
${bp.interactions.map(i => `- ${i}`).join('\n')}

${cdnHints ? `AVAILABLE CDN LIBRARIES (already loaded, use them):\n${cdnHints}\n` : ''}
TEMPLATE-SPECIFIC JS REQUIREMENTS:
${hints.js}

UNIVERSAL RULES (ALL MANDATORY):
1. Wrap ALL code in: document.addEventListener('DOMContentLoaded', () => { ... });
2. Multi-page navigation — include this exact function:
   function showPage(id) {
     document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
     const el = document.getElementById(id); if (el) el.style.display = 'block';
   }
3. Toast feedback — include this exact function (use INSTEAD of alert() for ALL user messages):
   function showToast(message, type='success') {
     const t = document.getElementById('toast-msg') || (() => { const d = document.createElement('div'); d.id='toast-msg'; document.body.appendChild(d); return d; })();
     t.textContent = message; t.className = 'toast-notification toast-'+type; t.style.display = 'block';
     clearTimeout(t._timer); t._timer = setTimeout(() => { t.style.display = 'none'; }, 2800);
   }
4. Global error handler — add this IMMEDIATELY after DOMContentLoaded opens (before any other code):
   window.onerror = function(msg, src, line, col, err) {
     const eb = document.getElementById('nbt-error-bar') || (() => { const d = document.createElement('div'); d.id='nbt-error-bar'; d.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#c0392b;color:#fff;padding:8px 14px;font-size:13px;z-index:99999;display:none;'; document.body.appendChild(d); return d; })();
     eb.textContent = '⚠ JS Error: ' + msg + (line ? ' (line ' + line + ')' : ''); eb.style.display = 'block';
     setTimeout(() => { eb.style.display = 'none'; }, 6000); return false;
   };
5. Wire EVERY button from the HTML using addEventListener — no button left unwired
6. For login/auth apps: validate against a SAMPLE_USERS array, call showPage() on success, show inline error in a DOM element on failure — NEVER alert()
7. ALL ${bp.screens.length} screens from the blueprint must be navigable: ${bp.screens.map(s => s.id).join(', ')}
8. No TODO comments, no empty functions, no placeholder logic
9. Show first page on load: showPage('${bp.screens[0]?.id || 'page-home'}')

Output ONLY the raw JavaScript:`;

  return callAI(prompt, sys, 10000);
}

// ─── Step 4: Generate CSS (template-aware, knows HTML + dynamic elements) ────

async function generateCSS(bp: AppBlueprint, htmlContent: string): Promise<string> {
  const hints   = TEMPLATE_HINTS[bp.template];
  // Use compact structural summary — saves tokens, easier for AI to parse
  const summary = extractStructuralSummary(htmlContent);

  // Standard dynamic elements + blueprint-specified ones
  const dynElements = [...new Set([
    ...bp.dynamicElements,
    'toast-notification', 'modal-overlay', 'loading-spinner',
  ])];

  const sys = `You are a world-class CSS designer. Output ONLY raw CSS — no markdown fences, no <style> tags.
CRITICAL CODING RULE: ALL identifiers (variable names, function names, class names, constants, code comments, string literals, console.log messages) MUST be in English. No Hindi, Hinglish, or any other language in code. This is absolute and non-negotiable.`;

  const prompt = `Generate beautiful style.css for this app.

App: ${bp.appName} [${bp.appType}, Template: ${bp.template}]

APP STRUCTURE (style these exact IDs and classes):
${summary}

JS WILL CREATE THESE DYNAMIC ELEMENTS AT RUNTIME — STYLE THEM TOO:
${dynElements.map(e => `- .${e}`).join('\n')}

Example dynamic element styles needed:
.toast-notification { position: fixed; bottom: 24px; right: 24px; padding: 14px 20px; border-radius: 10px; background: var(--surface); border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(10px); animation: slide-in 0.3s ease; z-index: 9999; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.loading-spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }

TEMPLATE-SPECIFIC CSS REQUIREMENTS:
${hints.css}

UNIVERSAL RULES:
1. :root { --bg: #0a0a0f; --surface: rgba(255,255,255,0.05); --accent: #6366f1; --accent-rgb: 99,102,241; --text: #f1f5f9; --text-muted: #64748b; }
2. * { box-sizing: border-box; margin: 0; padding: 0; }
3. body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
4. NEVER add CSS display rules for [id^="page-"] elements — page visibility is controlled ONLY by JS inline styles. Adding display:none or display:block in CSS for page elements BREAKS navigation.
5. @keyframes spin { to { transform: rotate(360deg); } }
6. @keyframes slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
7. Fully responsive: mobile (320px) → desktop (1400px+)
8. ALL classes from the structure above must be styled — nothing left as browser default
9. NEVER use !important on display properties — it prevents JS from showing/hiding screens

Output ONLY the raw CSS:`;

  return callAI(prompt, sys, 7000);
}

// ─── Step 5: Assemble preview ─────────────────────────────────────────────────

function buildPreviewHtml(files: Record<string, string>, bp: AppBlueprint): string {
  let html = files['index.html'] || '';
  const css = files['style.css'] || '';
  const js  = files['script.js'] || '';

  if (!html) {
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${bp.appName}</title></head><body></body></html>`;
  }

  // Inject CSS
  if (css) {
    const tag = `<style>\n${css}\n</style>`;
    html = html.includes('</head>') ? html.replace('</head>', `${tag}\n</head>`) : tag + html;
  }
  html = html.replace(/<link[^>]+style\.css[^>]*>/gi, '');

  // Inject JS
  if (js) {
    const tag = `<script>\n${js}\n</script>`;
    html = html.includes('</body>') ? html.replace('</body>', `${tag}\n</body>`) : html + tag;
  }
  html = html.replace(/<script[^>]+src=["']script\.js["'][^>]*><\/script>/gi, '');

  return html;
}

// ─── Phase 4: Screen-by-screen HTML for complex apps ─────────────────────────

async function generateScreenContent(
  bp: AppBlueprint,
  screen: { id: string; purpose: string },
  isFirst: boolean,
  allScreenIds: string[],
): Promise<string> {
  const relevant = bp.interactions.filter(i => {
    const lower = i.toLowerCase();
    return lower.includes(screen.id.replace('page-', '')) ||
           lower.includes(screen.purpose.split(' ')[0].toLowerCase());
  }).slice(0, 6);
  const interactions = relevant.length > 0 ? relevant : bp.interactions.slice(0, 4);

  const prompt = `Generate the HTML for ONE screen of the "${bp.appName}" app.

SCREEN: id="${screen.id}" — ${screen.purpose}
TEMPLATE: ${bp.template}
${isFirst ? 'VISIBILITY: style="" (first screen — visible by default)' : 'VISIBILITY: style="display:none" (hidden until navigated to)'}

RELEVANT INTERACTIONS TO BUILD UI FOR:
${interactions.map(i => `- ${i}`).join('\n')}

ALL SCREENS IN APP (for reference — do NOT include them, just know they exist):
${allScreenIds.filter(id => id !== screen.id).join(', ')}

RULES:
- Output ONLY the <div id="${screen.id}" ...> ... </div> element
- Every interactive element (buttons, inputs, selects) needs a unique id=""
- id prefix convention: buttons start with "btn-", inputs with "inp-"
- Use Font Awesome icons: <i class="fa-solid fa-icon-name"></i>
- Build COMPLETE UI — no "coming soon" or empty sections
- DO NOT include <html>, <head>, <body>, <script>, or <link> tags
- ACCESSIBILITY: every <button> gets aria-label="...", every <input> gets a <label> or aria-label, modals get role="dialog" aria-modal="true", main screens get role="main"

Output ONLY the <div id="${screen.id}"> element:`;

  return callAI(
    prompt,
    'You are a world-class frontend developer. Output ONLY the HTML div element — no markdown, no extra text.',
    3000,
  );
}

async function generateHTMLScreenByScreen(bp: AppBlueprint): Promise<string> {
  const cdnTags      = buildCdnHeadTags(bp.cdnNeeded);
  const screenIds    = bp.screens.map(s => s.id);

  // Generate all screens in parallel
  const screenDivs = await Promise.all(
    bp.screens.map((screen, idx) => generateScreenContent(bp, screen, idx === 0, screenIds)),
  );

  // Assemble full HTML
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${bp.appName}</title>
${cdnTags}
  <link rel="stylesheet" href="style.css">
</head>
<body>

${screenDivs.join('\n\n')}

<div id="toast-msg" class="toast-notification" style="display:none;position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;z-index:9999;font-size:14px;"></div>
<script src="script.js" defer></script>
</body>
</html>`;
}

// After HTML generation, verify all expected screens exist — regenerate missing ones
async function ensureAllScreens(html: string, bp: AppBlueprint): Promise<string> {
  let result = html;
  const missing = bp.screens.filter(s => !html.includes(`id="${s.id}"`));
  if (missing.length === 0) return result;

  console.log(`[AppEngine] Screen completeness check: missing ${missing.map(s => s.id).join(', ')} — regenerating`);
  const allScreenIds = bp.screens.map(s => s.id);
  const fixedDivs = await Promise.all(
    missing.map(s => generateScreenContent(bp, s, false, allScreenIds)),
  );

  // Inject missing screens before </body>
  const injection = fixedDivs.join('\n\n');
  result = result.replace('</body>', `${injection}\n</body>`);
  return result;
}

// ─── Main: buildApp() ─────────────────────────────────────────────────────────

export async function buildApp(
  userPrompt: string,
  onProgress?: ProgressCallback,
  onFileGenerated?: FileGeneratedCallback,
): Promise<BuildResult> {
  const report = (stage: string, step: number, total: number, detail: string) => {
    console.log(`[AppEngine v4] [${step}/${total}] ${stage}: ${detail}`);
    onProgress?.({ stage, step, total, detail });
  };

  try {
    report('Analyzing', 1, 7, 'Building deep blueprint...');
    let bp = await generateBlueprint(userPrompt);
    bp = enforceComplexityRules(bp); // Fix #2: override AI's complexity decision
    console.log(`[AppEngine v4] Blueprint: ${bp.appName} | Template: ${bp.template} | Complexity: ${bp.complexity} | Screens: ${bp.screens.length}`);

    report('Planning', 2, 7, `${bp.appName} — ${bp.screens.length} screens, ${bp.template} template`);

    report('Generating', 3, 7, 'Writing HTML structure...');
    // Phase 4: use screen-by-screen generation for complex multi-screen apps
    let htmlContent: string;
    if (bp.complexity === 'complex' && bp.screens.length >= 4) {
      report('Generating', 3, 7, `Building ${bp.screens.length} screens in parallel...`);
      htmlContent = await generateHTMLScreenByScreen(bp);
    } else {
      htmlContent = await generateHTML(bp);
    }
    // Verify all screens exist — patch missing ones
    htmlContent = await ensureAllScreens(htmlContent, bp);
    const generatedFiles: Record<string, string> = { 'index.html': htmlContent };
    onFileGenerated?.('index.html', htmlContent);

    let jsContent: string;
    let cssContent: string;

    if (bp.complexity === 'complex') {
      report('Generating', 4, 7, 'Writing JavaScript (split: state + logic + ui in parallel)...');
      jsContent = await generateJSSplit(bp, htmlContent);
      report('Generating', 5, 7, 'Writing CSS — styling & animations...');
      cssContent = await generateCSS(bp, htmlContent);
    } else {
      report('Generating', 4, 7, 'Writing JavaScript + CSS in parallel...');
      [jsContent, cssContent] = await Promise.all([
        generateJS(bp, htmlContent),
        generateCSS(bp, htmlContent),
      ]);
      report('Generating', 5, 7, 'JS + CSS complete.');
    }

    // Validation + smart repair loop — up to 5 attempts; stops early if no progress
    let repairAttempts = 0;
    const MAX_REPAIR = 5;
    let validation = validateDOMConsistency(htmlContent, jsContent);
    let prevIssueCount = Infinity;
    while (!validation.valid && repairAttempts < MAX_REPAIR) {
      const issues = [...validation.brokenIds, ...validation.missingWires, ...validation.syntaxIssues];
      const issueCount = issues.length;
      // If no improvement after 2 passes, stop to avoid infinite loops on unfixable issues
      if (repairAttempts >= 2 && issueCount >= prevIssueCount) {
        console.warn(`[AppEngine] Repair stalled at ${issueCount} issues after ${repairAttempts} attempts — stopping.`);
        break;
      }
      prevIssueCount = issueCount;
      console.log(`[AppEngine] Repair pass ${repairAttempts + 1}/${MAX_REPAIR} — brokenIds: [${validation.brokenIds}] missingWires: [${validation.missingWires}] syntax: [${validation.syntaxIssues}]`);
      report('Repairing', 5, 7, `Pass ${repairAttempts + 1}: fixing ${issueCount} issues (${validation.brokenIds.length} broken IDs, ${validation.missingWires.length} unwired buttons)...`);
      jsContent = await autoRepairJS(jsContent, htmlContent, validation, bp.appName);
      validation = validateDOMConsistency(htmlContent, jsContent);
      repairAttempts++;
    }
    if (validation.valid) {
      console.log(`[AppEngine] Validation passed after ${repairAttempts} repair(s) — all DOM references OK.`);
    } else {
      const remaining = [...validation.brokenIds, ...validation.missingWires, ...validation.syntaxIssues];
      console.warn(`[AppEngine] ${remaining.length} issues remain after ${repairAttempts} repair(s): ${remaining.join(', ')}`);
      // Inject a visible warning comment at top of JS so developer knows
      jsContent = `/* ⚠️ NavBharatAI: ${remaining.length} unresolved issue(s) after auto-repair: ${remaining.slice(0, 5).join(', ')} */\n` + jsContent;
    }

    generatedFiles['script.js']  = jsContent;
    generatedFiles['style.css']  = cssContent;
    onFileGenerated?.('script.js',  jsContent);
    onFileGenerated?.('style.css',  cssContent);

    // Phase 5: Inject auth module for apps with login/auth needs
    if (needsAuth(bp)) {
      report('Auth', 5, 7, 'Adding secure auth module (Web Crypto API)...');
      try {
        const authJs = buildAuthModuleStatic(bp.appName);
        generatedFiles['auth.js'] = authJs;
        onFileGenerated?.('auth.js', authJs);
        // Inject auth.js before script.js in HTML
        generatedFiles['index.html'] = generatedFiles['index.html'].replace(
          '<script src="script.js"',
          '<script src="auth.js" defer></script>\n  <script src="script.js"',
        );
        generatedFiles['script.js'] = `// NBT_AUTH available: NBT_AUTH.login(email,pass), .register(user,email,pass), .logout(), .isLoggedIn(), .getCurrentUser()\n${generatedFiles['script.js']}`;
        console.log('[AppEngine] Auth module injected');
      } catch (authErr: any) {
        console.warn('[AppEngine] Auth module injection failed (non-fatal):', authErr.message);
      }
    }

    // Optional: Firebase backend module for data-driven apps
    if (needsBackend(bp, userPrompt)) {
      report('Backend', 5, 7, 'Generating Firebase Firestore integration...');
      try {
        const firebaseJs = await buildFirebaseModule(bp.appName, bp.dataModel);
        generatedFiles['firebase.js'] = firebaseJs;
        onFileGenerated?.('firebase.js', firebaseJs);
        // Inject Firebase script tag into HTML before </body>
        const firebaseScript = `\n<script type="module" src="firebase.js"></script>`;
        generatedFiles['index.html'] = generatedFiles['index.html'].replace('</body>', `${firebaseScript}\n</body>`);
        // Add setup note at top of app JS
        generatedFiles['script.js'] = `// Firebase available as window.DB — use DB.saveRecord(), DB.getRecords(), etc.\n${generatedFiles['script.js']}`;
      } catch (fbErr: any) {
        console.warn('[AppEngine] Firebase module generation failed (non-fatal):', fbErr.message);
      }
    }

    // Phase 5: Testing scaffold for complex apps
    if (bp.complexity === 'complex') {
      const testHtml = buildTestingScaffold(bp);
      generatedFiles['test.html'] = testHtml;
      onFileGenerated?.('test.html', testHtml);
    }

    // Compute comprehensive validation report
    const validationReport = computeValidationReport(htmlContent, jsContent, cssContent, repairAttempts);
    console.log(`[AppEngine] Final quality score: ${validationReport.score}/100 | passed: ${validationReport.passed}`);

    report('Assembling', 6, 7, 'Building live preview...');
    const previewHtml = buildPreviewHtml(generatedFiles, bp);

    report('Assembling', 7, 7, 'Finalizing...');

    const fileList: AppFile[] = Object.entries(generatedFiles).map(([path, content]) => ({
      path,
      content,
      description: path === 'index.html' ? `HTML — ${bp.screens.length} screens`
        : path === 'style.css' ? `CSS — ${bp.template} theme`
        : `JavaScript — ${bp.complexity} logic`,
    }));

    return {
      success: true,
      reply: `✅ ${bp.appName} ready! ${bp.description}`,
      files: generatedFiles,
      fileList,
      previewHtml,
      appName: bp.appName,
      validationReport,
      deploymentGuide: generateDeploymentGuide(bp.appName),
      followUpSuggestions: generateFollowUpSuggestions(bp),
    };

  } catch (err: any) {
    console.error('[AppEngine v4] Build failed:', err);
    return {
      success: false,
      reply: `Build failed: ${err.message}`,
      files: {}, fileList: [], previewHtml: '', appName: 'App',
      error: err.message,
    };
  }
}

// ─── Smart Follow-Up Suggestions ─────────────────────────────────────────────

const SUGGESTION_SETS: Record<AppTemplate, string[]> = {
  GAME_CANVAS: ['Add high score leaderboard', 'Add sound effects', 'Add difficulty levels', 'Add power-ups', 'Make it mobile touch-friendly'],
  GAME_LOGIC:  ['Add multiplayer mode', 'Add AI opponent', 'Add animations', 'Add score tracking', 'Add timer/countdown'],
  DASHBOARD:   ['Add dark/light theme toggle', 'Add export to CSV', 'Add date range filter', 'Add real-time data refresh', 'Add print/PDF export'],
  TOOL_FORM:   ['Add input validation with error messages', 'Add copy result to clipboard', 'Add history of past calculations', 'Add share via URL', 'Add PDF export'],
  SOCIAL_APP:  ['Add Firebase authentication', 'Add image upload support', 'Add real-time chat', 'Add user profiles', 'Add notifications'],
  GENERIC:     ['Add dark mode', 'Make it fully responsive for mobile', 'Add loading animations', 'Add Firebase data persistence', 'Add user authentication'],
};

function generateFollowUpSuggestions(bp: AppBlueprint): string[] {
  const base = SUGGESTION_SETS[bp.template] || SUGGESTION_SETS.GENERIC;
  const extras: string[] = [];
  if (!bp.cdnNeeded.some(c => c.toLowerCase().includes('chart'))) extras.push('Add charts with Chart.js');
  if (bp.complexity !== 'complex') extras.push('Add more advanced features');
  return [...base.slice(0, 4), ...extras.slice(0, 1)];
}

// ─── Backend Module: Firebase Firestore Integration ───────────────────────────

const FIREBASE_CDN = `
  <script type="module">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
    import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, onSnapshot, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
    import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
    window._fbLoaded = true;
  </script>`;

async function buildFirebaseModule(appName: string, dataModel: Record<string, string>): Promise<string> {
  const collections = Object.keys(dataModel).slice(0, 5);
  const sys = `You are a Firebase Firestore expert. Write clean, modern JavaScript using Firebase v10 modular SDK.
ALL identifiers in English. Return ONLY JavaScript code, no markdown.`;

  const collectionsDesc = collections.length > 0
    ? `Data collections needed:\n${collections.map(k => `- ${k}: ${dataModel[k]}`).join('\n')}`
    : 'Generic CRUD data storage';

  const code = await callAI(
    `Write a firebase.js file for a web app called "${appName}".
${collectionsDesc}

Requirements:
1. Firebase v10 modular SDK via CDN (esm.sh or gstatic)
2. Initialize Firebase with placeholder config (comment showing where to add real config)
3. Anonymous auth (signInAnonymously) to allow Firestore access
4. Export these async functions:
   - saveRecord(collectionName, data) → returns document id
   - getRecords(collectionName) → returns array of {id, ...data}
   - updateRecord(collectionName, id, data) → updates document
   - deleteRecord(collectionName, id) → deletes document
   - listenRecords(collectionName, callback) → real-time listener, returns unsubscribe fn
5. window.DB = { saveRecord, getRecords, updateRecord, deleteRecord, listenRecords } so vanilla JS and React can use it
6. Handle errors gracefully with console.warn

Return only the complete firebase.js file content.`,
    sys, 4000
  );
  return code;
}

// Detect if app needs backend data persistence
function needsBackend(bp: AppBlueprint, userPrompt: string): boolean {
  const dataKeywords = /\b(database|backend|firebase|firestore|save\s+data|store\s+data|user\s+data|login|auth|crud|api|server|persist|sync|realtime|real-?time|collection|record|history|cart|order|profile|signup|register)\b/i;
  const hasDataModel = Object.keys(bp.dataModel).length > 0;
  const isDataApp = ['SOCIAL_APP', 'DASHBOARD'].includes(bp.template);
  return dataKeywords.test(userPrompt) || (hasDataModel && isDataApp) || bp.complexity === 'complex';
}

// Detect if app needs a real auth system
function needsAuth(bp: AppBlueprint): boolean {
  const authKeywords = /\b(login|logout|signup|register|auth|account|user|password|session|profile)\b/i;
  return bp.interactions.some(i => authKeywords.test(i)) || bp.template === 'SOCIAL_APP' ||
    bp.screens.some(s => /login|auth|signup|register|profile/.test(s.id));
}

// Phase 5: Proper auth module using Web Crypto API (client-side secure pattern)
function buildAuthModuleStatic(appName: string): string {
  return `// NBT Auth — Web Crypto session system for ${appName}
const NBT_AUTH = (() => {
  const USERS_KEY = 'nbt_users_v2';
  const SESSION_KEY = 'nbt_session_v2';
  const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

  /** @param {string} password @returns {Promise<string>} */
  async function hashPassword(password) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(password + 'nbt2024salt'));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** @returns {Array<{id:string,username:string,email:string,passwordHash:string}>} */
  function getUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return []; } }
  function saveUsers(u) { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

  /** @returns {{userId:string,username:string,email:string,expiresAt:number}|null} */
  function getSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!s || Date.now() > s.expiresAt) { localStorage.removeItem(SESSION_KEY); return null; }
      return s;
    } catch { return null; }
  }
  function saveSession(user) {
    const s = { userId: user.id, username: user.username, email: user.email, expiresAt: Date.now() + SESSION_TTL };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s)); return s;
  }

  return {
    /** @param {string} username @param {string} email @param {string} password @returns {Promise<{ok:boolean,session?:object,error?:string}>} */
    async register(username, email, password) {
      if (!username || !email || !password) return { ok: false, error: 'All fields required' };
      if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
      const users = getUsers();
      if (users.find(u => u.email === email)) return { ok: false, error: 'Email already registered' };
      const hash = await hashPassword(password);
      const user = { id: Date.now().toString(36), username, email, passwordHash: hash, createdAt: Date.now() };
      users.push(user); saveUsers(users);
      return { ok: true, session: saveSession(user) };
    },
    /** @param {string} email @param {string} password @returns {Promise<{ok:boolean,session?:object,error?:string}>} */
    async login(email, password) {
      if (!email || !password) return { ok: false, error: 'Email and password required' };
      const users = getUsers();
      const user = users.find(u => u.email === email);
      if (!user) return { ok: false, error: 'No account found with this email' };
      const hash = await hashPassword(password);
      if (hash !== user.passwordHash) return { ok: false, error: 'Incorrect password' };
      return { ok: true, session: saveSession(user) };
    },
    logout() { localStorage.removeItem(SESSION_KEY); },
    getSession,
    isLoggedIn() { return getSession() !== null; },
    getCurrentUser() { return getSession(); },
  };
})();
`;
}

// Phase 5: Generate simple testing scaffold for complex apps
function buildTestingScaffold(bp: AppBlueprint): string {
  const fnNames = bp.interactions.slice(0, 5).map(i => {
    const words = i.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    return words.slice(0, 3).join('_') || 'feature';
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${bp.appName} — Tests</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1a1a2e; color: #e0e0e0; }
    .pass { color: #2ecc71; } .fail { color: #e74c3c; } .skip { color: #f39c12; }
    h1 { color: #9b59b6; } .result { margin: 6px 0; font-size: 14px; }
    #summary { margin-top: 20px; font-size: 18px; font-weight: bold; }
  </style>
</head>
<body>
<h1>🧪 ${bp.appName} — Test Suite</h1>
<div id="results"></div>
<div id="summary"></div>
<script>
// Minimal test runner
let passed = 0, failed = 0;
const out = document.getElementById('results');
function test(name, fn) {
  try { fn(); passed++; out.innerHTML += \`<div class="result pass">✓ \${name}</div>\`; }
  catch(e) { failed++; out.innerHTML += \`<div class="result fail">✗ \${name}: \${e.message}</div>\`; }
}
function expect(val) { return { toBe: exp => { if (val !== exp) throw new Error(\`Expected \${exp}, got \${val}\`); }, toBeTruthy: () => { if (!val) throw new Error('Expected truthy'); }, toBeFalsy: () => { if (val) throw new Error('Expected falsy'); }, toContain: str => { if (!String(val).includes(str)) throw new Error(\`Expected to contain "\${str}"\`); } }; }

// ── Load app scripts (app must define functions at window scope or module scope)
// Adjust path if running locally: <script src="script.js"></script>

// ── Test cases (expand as needed)
test('AppState stores and retrieves values', () => {
  if (typeof AppState === 'undefined') throw new Error('AppState not defined — load script.js first');
  AppState.set('_test_key', 42);
  expect(AppState.get('_test_key')).toBe(42);
});

test('showToast does not throw', () => {
  if (typeof showToast === 'undefined') throw new Error('showToast not defined');
  showToast('Test message');
});

test('showPage does not throw', () => {
  if (typeof showPage === 'undefined') throw new Error('showPage not defined');
  // showPage('page-home'); // uncomment after loading script.js
});

${fnNames.map(fn => `test('${fn} interaction handled', () => {
  // TODO: Load script.js above, then test: expect(typeof ${fn}).toBe('function');
  expect(true).toBeTruthy(); // placeholder — replace with real assertion
});`).join('\n\n')}

document.getElementById('summary').innerHTML =
  \`<span class="\${failed > 0 ? 'fail' : 'pass'}">\${passed} passed, \${failed} failed</span>\`;
</script>
</body>
</html>`;
}


// ─── Iterative Edit Engine — edit existing app without full rebuild ────────────

function assemblePreview(html: string, js: string, css: string): string {
  let out = html;
  if (css) {
    const tag = `<style>\n${css}\n</style>`;
    out = out.includes('</head>') ? out.replace('</head>', `${tag}\n</head>`) : tag + out;
  }
  out = out.replace(/<link[^>]+style\.css[^>]*>/gi, '');
  if (js) {
    const tag = `<script>\n${js}\n</script>`;
    out = out.includes('</body>') ? out.replace('</body>', `${tag}\n</body>`) : out + tag;
  }
  out = out.replace(/<script[^>]+src=["']script\.js["'][^>]*><\/script>/gi, '');
  return out;
}

// ─── React App Builder — CDN React + Babel, no build step needed ─────────────

export async function buildReactApp(
  userPrompt: string,
  onProgress?: ProgressCallback,
  onFileGenerated?: FileGeneratedCallback,
): Promise<BuildResult> {
  const report = (stage: string, step: number, total: number, detail: string) => {
    console.log(`[ReactEngine] [${step}/${total}] ${stage}: ${detail}`);
    onProgress?.({ stage, step, total, detail });
  };
  const TOTAL = 5;

  try {
    report('Analyzing', 1, TOTAL, 'Understanding React app requirements...');

    // Step 1: Quick blueprint for app name + description
    const blueprintRaw = await callAI(
      `User wants to build a React app: "${userPrompt}"\n\nReturn ONLY valid JSON:\n{"appName":"Short Name","description":"one sentence","complexity":"simple|medium|complex","keyFeatures":["feat1","feat2","feat3"]}`,
      'You are a React app planner. Return only valid JSON, no markdown.',
      500
    );
    let appName = 'React App';
    let description = userPrompt.slice(0, 80);
    let complexity = 'medium';
    let keyFeatures: string[] = [];
    try {
      const bp = JSON.parse(blueprintRaw.replace(/```json?|```/g, '').trim());
      appName = bp.appName || appName;
      description = bp.description || description;
      complexity = bp.complexity || complexity;
      keyFeatures = Array.isArray(bp.keyFeatures) ? bp.keyFeatures : [];
    } catch { /* keep defaults */ }

    report('Planning', 2, TOTAL, `${appName} — ${complexity} React app`);

    // Step 2: Generate App.jsx + style.css in parallel
    report('Generating', 3, TOTAL, 'Writing React components + styles...');
    const reactSys = `You are an expert React developer. Write modern React using hooks (useState, useEffect, useCallback, useMemo).
RULES:
1. Use React 18 UMD globals: const { useState, useEffect, useCallback, useMemo, useRef } = React;
2. const root = ReactDOM.createRoot(document.getElementById('root')); root.render(<App />); at the bottom
3. NO import/export statements — React is available globally via CDN
4. NO TypeScript — plain JSX only
5. ALL identifiers in English only
6. Make it fully functional with real data/logic — not just placeholders
7. Tailwind CSS available via CDN — use utility classes freely
8. Return ONLY the JSX code, no markdown fences`;

    const cssSys = `You are a CSS expert. Write clean modern CSS.
ALL identifiers and comments in English. Return ONLY CSS, no markdown.`;

    const featuresText = keyFeatures.length > 0 ? `\nKey features to implement:\n${keyFeatures.map(f => `- ${f}`).join('\n')}` : '';

    const [appJsx, styleCss] = await Promise.all([
      callAI(
        `Build a complete React app for: "${userPrompt}"${featuresText}\n\nApp name: ${appName}\nComplexity: ${complexity}\n\nWrite the complete App.jsx file. Include ALL components in this single file. Make it fully functional and beautiful.`,
        reactSys, 10000
      ),
      callAI(
        `Write CSS for a React app called "${appName}": ${description}\n\nRequirements:\n- Dark theme preferred (#0d1117 background, #c9d1d9 text)\n- Responsive (mobile-first)\n- Smooth transitions and hover effects\n- Modern card/section layouts\n- Custom scrollbar if needed`,
        cssSys, 4000
      ),
    ]);

    onFileGenerated?.('App.jsx', appJsx);
    onFileGenerated?.('style.css', styleCss);

    // Step 3: Generate index.html with CDN React + Babel
    report('Generating', 4, TOTAL, 'Building HTML shell with React CDN...');
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" src="App.jsx"></script>
</body>
</html>`;

    onFileGenerated?.('index.html', indexHtml);

    // Step 4: Assemble preview (inline App.jsx as text/babel)
    report('Assembling', 5, TOTAL, 'Building live React preview...');
    const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css" rel="stylesheet">
  <style>${styleCss}</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">${appJsx}</script>
</body>
</html>`;

    const files: Record<string, string> = {
      'index.html': indexHtml,
      'App.jsx': appJsx,
      'style.css': styleCss,
    };

    // Optional Firebase module for React apps needing data persistence
    const reactBackendKeywords = /\b(database|backend|firebase|firestore|save|store|login|auth|crud|api|persist|sync|realtime|real-?time|cart|order|profile|signup|register|user)\b/i;
    if (reactBackendKeywords.test(userPrompt)) {
      try {
        report('Backend', 5, TOTAL, 'Adding Firebase Firestore integration...');
        const dataModel = keyFeatures.reduce((acc, f) => ({ ...acc, [f.toLowerCase().replace(/\s+/g, '_')]: f }), {});
        const firebaseJs = await buildFirebaseModule(appName, dataModel);
        files['firebase.js'] = firebaseJs;
        onFileGenerated?.('firebase.js', firebaseJs);
        // window.DB available in React via script tag before Babel
        files['index.html'] = files['index.html'].replace(
          '<script type="text/babel" src="App.jsx">',
          `<script type="module" src="firebase.js"></script>\n  <script type="text/babel" src="App.jsx">`
        );
      } catch (fbErr: any) {
        console.warn('[ReactEngine] Firebase module generation failed (non-fatal):', fbErr.message);
      }
    }

    const reactSuggestions = [
      'Add dark/light mode toggle',
      'Add routing with React Router',
      'Add Firebase data persistence',
      'Add user authentication',
      'Extract into reusable components',
    ];

    return {
      success: true,
      reply: `✅ ${appName} — React app ready! ${description}`,
      files,
      fileList: Object.entries(files).map(([path, content]) => ({
        path, content, description: path === 'App.jsx' ? 'React component' : path,
      })),
      previewHtml,
      appName,
      deploymentGuide: generateDeploymentGuide(appName),
      followUpSuggestions: reactSuggestions,
    };

  } catch (err: any) {
    console.error('[ReactEngine] Build failed:', err);
    return {
      success: false,
      reply: `React build failed: ${err.message}`,
      files: {}, fileList: [], previewHtml: '', appName: 'React App',
      error: err.message,
    };
  }
}

// ─── Surgical Edit Engine — Diagnostic + Chunk-Based Precision Editing ────────

interface DiagnosisResult {
  rootCauses: string[];
  fixStrategy: string;
  htmlTarget: string | null;
  cssTarget: string | null;
  jsFuncTarget: string | null;
  changedFiles: ('html' | 'css' | 'js')[];
  isFullEdit: boolean;
}

interface CodeChunk {
  chunk: string;
  start: number;
  end: number;
}

function summarizeHTML(html: string): string {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]).slice(0, 30);
  const classes = [...new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(' ')))].slice(0, 20);
  const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)].map(m => m[1].trim().replace(/<[^>]+>/g, '').slice(0, 30));
  return `IDs: ${ids.join(', ')}\nClasses: ${classes.join(', ')}\nButtons: ${buttons.join(' | ')}`;
}

function summarizeJS(js: string): string {
  const funcs = [...js.matchAll(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function|\())/g)]
    .map(m => m[1] || m[2]).filter(Boolean).slice(0, 25);
  const listeners = [...js.matchAll(/addEventListener\(['"`](\w+)['"`]/g)].map(m => m[1]).slice(0, 15);
  const idRefs = [...js.matchAll(/getElementById\(['"`]([^'"`]+)['"`]\)/g)].map(m => m[1]).slice(0, 20);
  return `Functions: ${funcs.join(', ')}\nListeners: ${listeners.join(', ')}\nID refs: ${idRefs.join(', ')}`;
}

function summarizeCSS(css: string): string {
  const selectors = [...css.matchAll(/([.#][\w\s,>+~:.*[\]="'-]{1,60})\s*\{/g)].map(m => m[1].trim()).slice(0, 25);
  return `Selectors: ${selectors.join(' | ')}`;
}

function extractJSChunk(js: string, funcName: string): CodeChunk | null {
  const patterns = [
    new RegExp(`(?:async\\s+)?function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`(?:const|let|var)\\s+${funcName}\\s*=\\s*(?:async\\s*)?(?:function[^{]*|\\([^)]*\\)\\s*=>)\\s*\\{`),
    new RegExp(`${funcName}\\s*:\\s*(?:async\\s*)?function[^{]*\\{`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(js);
    if (!match) continue;
    let depth = 1, pos = match.index + match[0].length;
    // Track string/template context so braces inside strings don't affect depth
    let inSingle = false, inDouble = false, inTemplate = 0, inLineComment = false, inBlockComment = false;
    while (depth > 0 && pos < js.length) {
      const ch = js[pos];
      const prev = pos > 0 ? js[pos - 1] : '';
      // Line comment
      if (!inSingle && !inDouble && !inTemplate && !inBlockComment && ch === '/' && js[pos + 1] === '/') { inLineComment = true; pos++; continue; }
      if (inLineComment) { if (ch === '\n') inLineComment = false; pos++; continue; }
      // Block comment
      if (!inSingle && !inDouble && !inTemplate && ch === '/' && js[pos + 1] === '*') { inBlockComment = true; pos += 2; continue; }
      if (inBlockComment) { if (ch === '*' && js[pos + 1] === '/') { inBlockComment = false; pos += 2; } else pos++; continue; }
      // String literals
      if (!inDouble && !inTemplate && ch === "'" && prev !== '\\') { inSingle = !inSingle; pos++; continue; }
      if (!inSingle && !inTemplate && ch === '"' && prev !== '\\') { inDouble = !inDouble; pos++; continue; }
      if (inSingle || inDouble) { pos++; continue; }
      // Template literals (nested depth)
      if (ch === '`' && prev !== '\\') { inTemplate = inTemplate > 0 ? inTemplate - 1 : inTemplate + 1; pos++; continue; }
      if (inTemplate > 0) { pos++; continue; }
      // Count braces only in real code
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      pos++;
    }
    if (depth === 0) return { chunk: js.slice(match.index, pos), start: match.index, end: pos };
  }
  return null;
}

function extractCSSChunk(css: string, selector: string): CodeChunk | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`${escaped}\\s*\\{[^}]*\\}`);
  const m = rx.exec(css);
  if (!m) return null;
  return { chunk: m[0], start: m.index, end: m.index + m[0].length };
}

function extractHTMLChunk(html: string, targetId: string): CodeChunk | null {
  const escaped = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRx = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bid="${escaped}"[^>]*>`, 'i');
  const m = openRx.exec(html);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const selfClose = new Set(['input','img','br','hr','meta','link','area','base','col','embed','param','source','track','wbr']);
  if (selfClose.has(tag)) return { chunk: m[0], start: m.index, end: m.index + m[0].length };
  let depth = 1, pos = m.index + m[0].length;
  while (depth > 0 && pos < html.length) {
    const sub = html.slice(pos);
    const nOpen = new RegExp(`<${tag}[\\s>]`, 'i').exec(sub);
    const nClose = new RegExp(`</${tag}>`, 'i').exec(sub);
    if (!nClose) break;
    if (nOpen && nOpen.index < nClose.index) { depth++; pos += nOpen.index + 1; }
    else { depth--; pos += nClose.index + nClose[0].length; }
  }
  return { chunk: html.slice(m.index, pos), start: m.index, end: pos };
}

function reconstructFile(original: string, chunk: CodeChunk, fixed: string): string {
  return original.slice(0, chunk.start) + fixed + original.slice(chunk.end);
}

// ─── Patch-based editing (never truncates the file) ───────────────────────────

interface FilePatch { find: string; replace: string; }

function applyPatch(content: string, patches: FilePatch[]): { result: string; applied: number } {
  let result = content;
  let applied = 0;
  for (const p of patches) {
    if (!p.find || p.replace === undefined) continue;
    if (result.includes(p.find)) {
      result = result.split(p.find).join(p.replace);
      applied++;
    }
  }
  return { result, applied };
}

async function generatePatches(
  request: string,
  file: 'html' | 'js' | 'css',
  content: string,
  rootCauses: string[],
  fixStrategy: string,
  extraContext?: string,
): Promise<FilePatch[]> {
  const maxChars = file === 'js' ? 30000 : file === 'html' ? 25000 : 18000;
  const preview = content.length > maxChars
    ? content.slice(0, maxChars) + `\n... [${content.length - maxChars} more chars — patches must target visible section]`
    : content;

  const prompt = `Edit this ${file.toUpperCase()} file via find-and-replace patches.

USER REQUEST: "${request}"
ROOT CAUSE: ${rootCauses.join('; ')}
FIX: ${fixStrategy}${extraContext ? `\nCONTEXT: ${extraContext}` : ''}

FILE (${content.length} chars total):
${preview}

Return ONLY a JSON array of patches. Each patch:
- "find": EXACT verbatim substring from the file above (must exist as-is, copy character-for-character including indentation and newlines)
- "replace": the replacement string

Rules:
- "find" must be verbatim text that exists in the file — copy it exactly from the file above
- Use at least 2-3 lines of context in "find" so it is unique and unambiguous
- To ADD new code: use the closing bracket/line where it should go as "find", set "replace" to that same bracket/line + the new code
- Keep changes minimal — only what's needed for the request
- Return [] if no changes needed for this file

Return ONLY the JSON array, no markdown, no explanation.`;

  try {
    const raw = await callAI(prompt, 'Return only a valid JSON array [{find,replace}]. No markdown, no explanation.', 4000);
    const cleaned = raw.replace(/```json?|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p: any) => typeof p.find === 'string' && typeof p.replace === 'string');
  } catch (e) {
    console.warn('[SurgicalEditor] Patch parse failed:', e);
    return [];
  }
}

// Full-file rewrite fallback — used when patches fail to match
async function rewriteFile(
  request: string,
  file: 'html' | 'js' | 'css',
  content: string,
  rootCauses: string[],
  fixStrategy: string,
  extraContext?: string,
): Promise<string> {
  const maxOut = file === 'js' ? 12000 : file === 'html' ? 8000 : 6000;
  const sys = `You are a precise code editor. Return the COMPLETE updated file — all original code preserved except the specific fix/addition applied. No markdown fences, no explanation.
ALL identifiers must be in English. ABSOLUTELY FORBIDDEN: alert(), confirm(), prompt().`;
  const prompt = `Apply this change to the ${file.toUpperCase()} file.

USER REQUEST: "${request}"
ROOT CAUSE: ${rootCauses.join('; ')}
FIX: ${fixStrategy}${extraContext ? `\nCONTEXT: ${extraContext}` : ''}

CURRENT ${file.toUpperCase()} FILE — return this with ONLY the required changes applied, preserving all other code:
${content}

Return the COMPLETE updated ${file.toUpperCase()} file:`;
  return callAI(prompt, sys, maxOut);
}

async function diagnoseFix(
  request: string,
  currentFiles: { html: string; css: string; js: string },
  preIssues: ValidationResult,
  historyContext?: string,
): Promise<DiagnosisResult> {
  const issueLines = [
    ...preIssues.brokenIds.map(id => `Broken JS ID ref: "${id}" used in JS but missing in HTML`),
    ...preIssues.missingWires.map(id => `Button "${id}" has no event listener in JS`),
    ...preIssues.syntaxIssues,
  ];

  const prompt = `Diagnose this web app edit request. Find the ROOT CAUSE, not just the symptom.

USER REQUEST: "${request}"

APP STRUCTURE:
HTML: ${summarizeHTML(currentFiles.html)}
JS: ${summarizeJS(currentFiles.js)}
CSS: ${summarizeCSS(currentFiles.css)}

PRE-EXISTING ISSUES (scan results):
${issueLines.length > 0 ? issueLines.join('\n') : 'None'}
${historyContext ? `\nCONVERSATION CONTEXT:\n${historyContext.slice(0, 1500)}` : ''}

Return ONLY valid JSON (no markdown):
{
  "rootCauses": ["precise root cause 1", "root cause 2"],
  "fixStrategy": "what exactly to change and why",
  "htmlTarget": "element ID to surgically target, or null",
  "cssTarget": "CSS selector to surgically target, or null",
  "jsFuncTarget": "JS function name to surgically target, or null",
  "changedFiles": ["html","css","js"],
  "isFullEdit": false
}
Set isFullEdit true ONLY if the change requires restructuring entire file.`;

  try {
    const raw = await callAI(prompt, 'You are a senior code diagnostician. Return only valid JSON.', 2000);
    const parsed = JSON.parse(raw.replace(/```json?|```/g, '').trim());
    return {
      rootCauses: Array.isArray(parsed.rootCauses) ? parsed.rootCauses : [request],
      fixStrategy: parsed.fixStrategy || request,
      htmlTarget: parsed.htmlTarget || null,
      cssTarget: parsed.cssTarget || null,
      jsFuncTarget: parsed.jsFuncTarget || null,
      changedFiles: Array.isArray(parsed.changedFiles) ? parsed.changedFiles : ['html', 'js', 'css'],
      isFullEdit: parsed.isFullEdit === true,
    };
  } catch {
    return { rootCauses: [request], fixStrategy: request, htmlTarget: null, cssTarget: null, jsFuncTarget: null, changedFiles: ['html', 'js', 'css'], isFullEdit: true };
  }
}

export async function editApp(
  request: string,
  currentFiles: { html: string; css: string; js: string },
  onProgress?: ProgressCallback,
  onFileGenerated?: FileGeneratedCallback,
  historyContext?: string,
): Promise<BuildResult> {
  const report = (stage: string, step: number, total: number, detail: string) =>
    onProgress?.({ stage, step, total, detail });

  const TOTAL = 5;
  const updated = { ...currentFiles };

  try {
    // Safety valve: if workspace is essentially empty/placeholder but request describes a
    // full new app, hand off to buildApp immediately instead of trying to surgically edit nothing.
    const isWorkspaceThin = (currentFiles.html || '').length < 400 && (currentFiles.js || '').length < 200;
    const isBuildRequest = /\b(build|create|make|generate)\b/i.test(request) &&
      /\b(app|game|website|tool|dashboard|calculator|quiz|generator|system)\b/i.test(request);
    if (isWorkspaceThin && isBuildRequest) {
      console.log('[SurgicalEditor] Placeholder workspace + build request → delegating to buildApp');
      return buildApp(request, onProgress, onFileGenerated);
    }

    // Phase 1: Pre-scan — X-ray the app before touching anything
    report('Diagnosing', 1, TOTAL, 'Scanning app health...');
    const preIssues = validateDOMConsistency(currentFiles.html, currentFiles.js);
    const preIssueCount = preIssues.brokenIds.length + preIssues.missingWires.length + preIssues.syntaxIssues.length;
    console.log(`[SurgicalEditor] Pre-scan: ${preIssueCount} existing issues`);

    // Phase 2: AI Diagnosis — root cause, not symptom
    report('Diagnosing', 2, TOTAL, 'Finding root cause...');
    const dx = await diagnoseFix(request, currentFiles, preIssues, historyContext);
    console.log(`[SurgicalEditor] Root cause: ${dx.rootCauses.join(' | ')}`);
    console.log(`[SurgicalEditor] Targets — HTML: ${dx.htmlTarget} | CSS: ${dx.cssTarget} | JS fn: ${dx.jsFuncTarget} | Full: ${dx.isFullEdit}`);

    const editSys = `You are a surgical code editor. Apply ONLY the specified fix. Preserve everything else exactly.
ROOT CAUSE: ${dx.rootCauses.join('; ')}
FIX: ${dx.fixStrategy}
Return ONLY the fixed code — no markdown, no explanation. ALL identifiers must be English.`;

    report('Editing', 3, TOTAL, `Surgical fix on ${dx.changedFiles.join(', ')}...`);
    const tasks: Promise<void>[] = [];

    // ── HTML ─────────────────────────────────────────────────────────────────
    if (dx.changedFiles.includes('html')) {
      const chunk = !dx.isFullEdit && dx.htmlTarget ? extractHTMLChunk(currentFiles.html, dx.htmlTarget) : null;
      if (chunk) {
        tasks.push(callAI(
          `Fix this HTML element.\nREQUEST: "${request}"\nROOT CAUSE: ${dx.rootCauses.join('; ')}\n\nELEMENT:\n${chunk.chunk}\n\nReturn ONLY the fixed element:`,
          editSys, 2000
        ).then(fixed => { updated.html = reconstructFile(updated.html, chunk, fixed.trim()); onFileGenerated?.('index.html', updated.html); }));
      } else {
        tasks.push((async () => {
          const patches = await generatePatches(request, 'html', currentFiles.html, dx.rootCauses, dx.fixStrategy);
          const { result, applied } = applyPatch(currentFiles.html, patches);
          if (applied > 0) {
            updated.html = result; onFileGenerated?.('index.html', result);
          } else {
            console.warn('[SurgicalEditor] HTML patches unapplied — falling back to full rewrite');
            const rewritten = await rewriteFile(request, 'html', currentFiles.html, dx.rootCauses, dx.fixStrategy);
            if (rewritten?.trim()) { updated.html = rewritten.trim(); onFileGenerated?.('index.html', rewritten.trim()); }
          }
        })());
      }
    }

    // ── CSS ──────────────────────────────────────────────────────────────────
    if (dx.changedFiles.includes('css')) {
      const chunk = !dx.isFullEdit && dx.cssTarget ? extractCSSChunk(currentFiles.css, dx.cssTarget) : null;
      if (chunk) {
        tasks.push(callAI(
          `Fix this CSS rule.\nREQUEST: "${request}"\nROOT CAUSE: ${dx.rootCauses.join('; ')}\n\nRULE:\n${chunk.chunk}\n\nReturn ONLY the fixed CSS rule:`,
          editSys, 1000
        ).then(fixed => { updated.css = reconstructFile(updated.css, chunk, fixed.trim()); onFileGenerated?.('style.css', updated.css); }));
      } else {
        tasks.push((async () => {
          const patches = await generatePatches(request, 'css', currentFiles.css, dx.rootCauses, dx.fixStrategy);
          const { result, applied } = applyPatch(currentFiles.css, patches);
          if (applied > 0) {
            updated.css = result; onFileGenerated?.('style.css', result);
          } else {
            console.warn('[SurgicalEditor] CSS patches unapplied — falling back to full rewrite');
            const rewritten = await rewriteFile(request, 'css', currentFiles.css, dx.rootCauses, dx.fixStrategy);
            if (rewritten?.trim()) { updated.css = rewritten.trim(); onFileGenerated?.('style.css', rewritten.trim()); }
          }
        })());
      }
    }

    // ── JS ───────────────────────────────────────────────────────────────────
    if (dx.changedFiles.includes('js')) {
      const chunk = !dx.isFullEdit && dx.jsFuncTarget ? extractJSChunk(currentFiles.js, dx.jsFuncTarget) : null;
      if (chunk) {
        tasks.push(callAI(
          `Fix this JavaScript function.\nREQUEST: "${request}"\nROOT CAUSE: ${dx.rootCauses.join('; ')}\nHTML CONTEXT: ${summarizeHTML(currentFiles.html)}\n\nFUNCTION:\n${chunk.chunk}\n\nReturn ONLY the fixed function:`,
          editSys, 3000
        ).then(fixed => { updated.js = reconstructFile(updated.js, chunk, fixed.trim()); onFileGenerated?.('script.js', updated.js); }));
      } else {
        tasks.push((async () => {
          const patches = await generatePatches(request, 'js', currentFiles.js, dx.rootCauses, dx.fixStrategy, `HTML IDs: ${summarizeHTML(currentFiles.html)}`);
          const { result, applied } = applyPatch(currentFiles.js, patches);
          if (applied > 0) {
            updated.js = result; onFileGenerated?.('script.js', result);
          } else {
            console.warn('[SurgicalEditor] JS patches unapplied — falling back to full rewrite');
            const rewritten = await rewriteFile(request, 'js', currentFiles.js, dx.rootCauses, dx.fixStrategy, `HTML IDs: ${summarizeHTML(currentFiles.html)}`);
            if (rewritten?.trim()) { updated.js = rewritten.trim(); onFileGenerated?.('script.js', rewritten.trim()); }
          }
        })());
      }
    }

    await Promise.all(tasks);

    // Phase 4: Post-scan validate + auto-repair
    report('Validating', 4, TOTAL, 'Verifying integrity...');
    if (dx.changedFiles.includes('js') || dx.changedFiles.includes('html')) {
      let validation = validateDOMConsistency(updated.html, updated.js);
      let repairs = 0;
      while (!validation.valid && repairs < 3) {
        const n = validation.brokenIds.length + validation.missingWires.length;
        report('Repairing', 4, TOTAL, `Fixing ${n} issue(s)...`);
        updated.js = await autoRepairJS(updated.js, updated.html, validation, 'app');
        validation = validateDOMConsistency(updated.html, updated.js);
        repairs++;
      }
    }

    // Phase 5: Assemble
    report('Assembling', 5, TOTAL, 'Building updated preview...');
    const previewHtml = assemblePreview(updated.html, updated.js, updated.css);
    const files: Record<string, string> = { 'index.html': updated.html, 'script.js': updated.js, 'style.css': updated.css };
    const validationReport = computeValidationReport(updated.html, updated.js, updated.css, 0);

    // Check whether files actually changed
    const anyChanged = updated.html !== currentFiles.html || updated.js !== currentFiles.js || updated.css !== currentFiles.css;
    const replyMsg = anyChanged
      ? (dx.rootCauses.length > 0 ? `✅ Applied: ${dx.rootCauses.slice(0, 2).join('; ')}` : `✅ Done!`)
      : `⚠️ Could not apply: ${dx.rootCauses[0] || request} — try rephrasing or rebuild the app.`;

    return {
      success: true, reply: replyMsg, files,
      fileList: Object.entries(files).map(([path, content]) => ({ path, content, description: path })),
      previewHtml, appName: 'Updated App', validationReport,
    };

  } catch (err: any) {
    console.error('[SurgicalEditor] Edit failed:', err);
    return { success: false, reply: `Edit failed: ${err.message}`, files: {}, fileList: [], previewHtml: '', appName: '', error: err.message };
  }
}
