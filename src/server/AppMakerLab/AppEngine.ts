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
- <canvas id="game-canvas"> as the main game surface
- Overlay divs: id="overlay-start", id="overlay-pause", id="overlay-gameover"
- HUD strip: id="hud" containing id="score-display", id="lives-display", id="level-display"
- All overlays exist simultaneously in HTML — JS toggles visibility
- Buttons: id="btn-start", id="btn-pause", id="btn-restart", id="btn-resume"`,

    js: `Implementation requirements:
- Canvas 2D context: const ctx = canvas.getContext('2d')
- requestAnimationFrame game loop: function gameLoop(ts) { update(ts); draw(); requestAnimationFrame(gameLoop); }
- Game state machine: const STATE = { IDLE:'idle', PLAYING:'playing', PAUSED:'paused', GAMEOVER:'gameover' }; let state = STATE.IDLE;
- Keyboard events: document.addEventListener('keydown', handleKey)
- showOverlay(id) / hideOverlay(id) helpers for screen transitions
- All game objects as plain JS objects with x, y, w, h, vx, vy properties
- Collision: AABB — if (a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y)
- Score/lives update DOM in real-time: scoreDisplay.textContent = score`,

    css: `Design requirements:
- canvas { display: block; border-radius: 12px; box-shadow: 0 0 40px rgba(var(--accent-rgb), 0.3); }
- .overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); }
- .hud { display: flex; gap: 24px; padding: 12px 24px; background: rgba(255,255,255,0.05); border-radius: 50px; }
- Game container: position: relative so overlays stack on canvas
- Neon glow on score: text-shadow: 0 0 20px currentColor`,
  },

  GAME_LOGIC: {
    html: `Structure requirements:
- Game board as CSS grid or table: id="game-board"
- Turn indicator: id="turn-indicator" and id="current-player"
- Score panel: id="score-panel" with player scores
- Overlays: id="overlay-start", id="overlay-gameover", id="overlay-winner"
- Buttons: id="btn-start", id="btn-restart", id="btn-undo" (if applicable)
- Every interactive cell/piece gets data-attributes: data-row, data-col, data-piece`,

    js: `Implementation requirements:
- Game state as plain object: let gameState = { board: [], currentPlayer: 1, score: {1:0, 2:0}, moveCount: 0 }
- Immutable move: function makeMove(state, move) { return { ...state, board: newBoard, currentPlayer: next } }
- Win check after every move: function checkWin(board, lastMove) { ... }
- Event delegation on board: board.addEventListener('click', e => { const cell = e.target.closest('[data-row]'); })
- Animate moves: element.classList.add('animate-move'); setTimeout(() => el.classList.remove('animate-move'), 300)
- AI opponent (if single-player): simple minimax or random valid move`,

    css: `Design requirements:
- .game-board { display: grid; gap: 4px; aspect-ratio: 1; }
- .cell { cursor: pointer; transition: all 0.15s ease; border-radius: 8px; }
- .cell:hover { transform: scale(1.05); }
- .cell.animate-move { animation: piece-drop 0.3s ease; }
- @keyframes piece-drop { from { transform: scale(0) rotate(180deg); } to { transform: scale(1) rotate(0deg); } }
- Player colors: --p1-color: #6366f1; --p2-color: #f43f5e`,
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
- Top navbar: id="navbar" with app logo, search bar, profile avatar
- Feed section: id="feed" containing id="posts-container"
- Post card template (use JS to clone/create): class="post-card" with class="post-header", class="post-content", class="post-actions"
- Sidebar: trending tags, suggested users
- Create post modal: id="modal-create-post" (hidden by default)
- Profile page: id="section-profile" (switchable with JS)
- Buttons: id="btn-create-post", like/comment/share buttons generated dynamically`,

    js: `Implementation requirements:
- Sample data: const SAMPLE_POSTS = [ { id, author, avatar, content, likes, comments, time, tags } ]
- Render function: function renderPosts(posts) { container.innerHTML = posts.map(renderPostCard).join('') }
- Like toggle: event delegation on feed container, toggle liked state, update count
- Create post: modal form → prepend new post to feed with current timestamp
- Feed filtering by tags: filter SAMPLE_POSTS array, re-render
- Relative timestamps: "2 minutes ago", "yesterday" etc.`,

    css: `Design requirements:
- .post-card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 20px; margin-bottom: 16px; transition: transform 0.2s; }
- .post-card:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
- .avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: linear-gradient(135deg, var(--accent), #f43f5e); display: flex; align-items: center; justify-content: center; }
- .like-btn.liked { color: #f43f5e; }
- .like-btn.liked svg { fill: #f43f5e; animation: heart-pop 0.3s ease; }
- @keyframes heart-pop { 50% { transform: scale(1.4); } }`,
  },

  GENERIC: {
    html: `Structure requirements:
- Clean semantic HTML5 structure
- All sections present with proper IDs
- Every interactive element has an id for JS event wiring`,
    js: `Implementation requirements:
- Complete working logic for all features
- All buttons wired with addEventListener
- Multi-page navigation via showPage() pattern`,
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

// ─── AI Caller — Claude first, Gemini fallback ───────────────────────────────

async function callAI(prompt: string, systemPrompt: string, maxTokens = 6000): Promise<string> {
  const claudeKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (claudeKey) {
    try {
      const baseURL = process.env.ANTHROPIC_BASE_URL?.replace(/\/v1$/, '');
      const client = new Anthropic({ apiKey: claudeKey, ...(baseURL ? { baseURL } : {}) });
      const r = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = (r.content.find(c => c.type === 'text') as any)?.text || '';
      if (text.trim()) return text;
    } catch (e: any) {
      console.warn('[AppEngine] Claude failed:', e.message);
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const r = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + prompt }] }],
      });
      if (r.text?.trim()) return r.text;
    } catch (e: any) {
      console.warn('[AppEngine] Gemini failed:', e.message);
    }
  }

  throw new Error('Build service temporarily unavailable. Please try again.');
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
    const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
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
1. All shared state variables with initial values (e.g. let score = 0; let lives = 3;)
2. Function signatures as comments only (e.g. // function startGame() {} — implemented in logic module)
3. Constants (e.g. const CANVAS_WIDTH = 800;)

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

  const sys = `You are a world-class JavaScript developer. Output ONLY raw JavaScript — no markdown, no <script> tags.`;

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
${htmlContent.slice(0, 8000)}
\`\`\`

${cdnHints ? `CDN LIBRARIES:\n${cdnHints}\n` : ''}

SHARED CONTRACT:
${contract}

Rules:
- DOMContentLoaded wraps EVERYTHING
- Wire EVERY button using addEventListener
- Render functions update DOM from state variables
- Include:
${showPageFn}
- showPage('${bp.screens[0]?.id || 'page-home'}') on load
- Dynamic elements to create: ${bp.dynamicElements.join(', ') || 'toast-notification, modal-overlay'}
- Call logic functions, update DOM, show results

Output ONLY the UI module JavaScript:`;

  console.log('[AppEngine] Split generation: 3 modules in parallel...');
  const [stateJs, logicJs, uiJs] = await Promise.all([
    callAI(statePrompt, sys, 4000),
    callAI(logicPrompt, sys, 5000),
    callAI(uiPrompt,    sys, 6000),
  ]);

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

  const sys = `You are a JavaScript debugger. Fix ONLY the listed issues. Change no other logic. Output ONLY fixed JavaScript.`;
  const prompt = `Fix these issues in the JavaScript for "${appName}":

ISSUES TO FIX:
${issues.join('\n')}

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
  if (!css.includes('display: none') && !css.includes('display:none')) {
    cssIssues.push('CSS: no hidden page rule — multi-page navigation may not work');
  }

  const allIssues = [...domCheck.brokenIds.map(i => `Broken ID: #${i}`),
                     ...domCheck.missingWires.map(i => `Unwired button: #${i}`),
                     ...syntaxIssues,
                     ...cssIssues];

  // Quality score: start at 100, deduct per issue
  let score = 100;
  score -= domCheck.brokenIds.length * 15;
  score -= domCheck.missingWires.length * 10;
  score -= syntaxIssues.length * 5;
  score -= cssIssues.length * 3;
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

  const sys = `You are a world-class frontend developer. Output ONLY raw HTML — no markdown fences, no explanation.`;

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

USER INTERACTIONS:
${bp.interactions.slice(0, 8).map(i => `- ${i}`).join('\n')}

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
7. Include ALL screens and ALL UI elements — nothing placeholder

Output ONLY the raw HTML:`;

  return callAI(prompt, sys, 7000);
}

// ─── Step 3: Generate JS (template-aware, knows HTML structure) ───────────────

async function generateJS(bp: AppBlueprint, htmlContent: string): Promise<string> {
  const hints       = TEMPLATE_HINTS[bp.template];
  const cdnHints    = buildCdnJsHints(bp.cdnNeeded);

  const sys = `You are a world-class JavaScript developer. Output ONLY raw JavaScript — no markdown fences, no <script> tags.`;

  const prompt = `Generate COMPLETE script.js for this app.

App: ${bp.appName} [${bp.appType}, Template: ${bp.template}, Complexity: ${bp.complexity}]
Description: ${bp.description}

EXACT HTML STRUCTURE (use these exact IDs):
\`\`\`html
${htmlContent.slice(0, 9000)}
\`\`\`

USER INTERACTIONS TO IMPLEMENT:
${bp.interactions.map(i => `- ${i}`).join('\n')}

${cdnHints ? `AVAILABLE CDN LIBRARIES (already loaded, use them):\n${cdnHints}\n` : ''}
TEMPLATE-SPECIFIC JS REQUIREMENTS:
${hints.js}

UNIVERSAL RULES (ALL MANDATORY):
1. Wrap ALL code in: document.addEventListener('DOMContentLoaded', () => { ... });
2. Multi-page navigation pattern:
   function showPage(id) {
     document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
     const el = document.getElementById(id); if (el) el.style.display = 'block';
   }
3. Wire EVERY button from the HTML using addEventListener — no button left unwired
4. Dynamic elements you'll create at runtime: ${bp.dynamicElements.join(', ') || 'toast-notification, modal-overlay'}
5. No TODO comments, no empty functions, no placeholder logic
6. Show first page on load: showPage('${bp.screens[0]?.id || 'page-home'}')

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

  const sys = `You are a world-class CSS designer. Output ONLY raw CSS — no markdown fences, no <style> tags.`;

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
4. [id^="page-"] { display: none; }  ← JS controls page visibility
5. @keyframes spin { to { transform: rotate(360deg); } }
6. @keyframes slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
7. Fully responsive: mobile (320px) → desktop (1400px+)
8. ALL classes from the structure above must be styled — nothing left as browser default

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
    const htmlContent = await generateHTML(bp);
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

    // Fix #1: Validation loop — max 2 repair attempts
    let repairAttempts = 0;
    let validation = validateDOMConsistency(htmlContent, jsContent);
    while (!validation.valid && repairAttempts < 2) {
      const issues = [...validation.brokenIds, ...validation.missingWires, ...validation.syntaxIssues];
      console.log(`[AppEngine] Validation issues — brokenIds: [${validation.brokenIds}] missingWires: [${validation.missingWires}] syntax: [${validation.syntaxIssues}]`);
      report('Repairing', 5, 7, `Pass ${repairAttempts + 1}: fixing ${issues.length} issues (${validation.brokenIds.length} broken IDs, ${validation.missingWires.length} unwired buttons)...`);
      jsContent = await autoRepairJS(jsContent, htmlContent, validation, bp.appName);
      validation = validateDOMConsistency(htmlContent, jsContent);
      repairAttempts++;
    }
    if (validation.valid) {
      console.log('[AppEngine] Validation passed — all DOM references and button wires OK.');
    }

    generatedFiles['script.js']  = jsContent;
    generatedFiles['style.css']  = cssContent;
    onFileGenerated?.('script.js',  jsContent);
    onFileGenerated?.('style.css',  cssContent);

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
