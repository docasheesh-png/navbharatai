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

export interface BuildResult {
  success: boolean;
  reply: string;
  files: Record<string, string>;
  fileList: AppFile[];
  previewHtml: string;
  appName: string;
  error?: string;
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
    const allText = (parsed.appType || '') + ' ' + (parsed.interactions || []).join(' ');
    const template = detectTemplate(parsed.appType || '', parsed.interactions || []);

    return {
      appName:        parsed.appName        || 'My App',
      appType:        parsed.appType        || 'web-app',
      template,
      description:    parsed.description    || userPrompt.slice(0, 80),
      complexity:     (parsed.complexity as Complexity) || 'medium',
      screens:        parsed.screens        || [{ id: 'page-home', purpose: 'main interface' }],
      dataModel:      parsed.dataModel      || {},
      interactions:   parsed.interactions   || [],
      cdnNeeded:      parsed.cdnNeeded      || ['font-awesome', 'inter-font'],
      dynamicElements:parsed.dynamicElements|| [],
    };
  } catch {
    // Fallback blueprint
    const template = detectTemplate(userPrompt, []);
    return {
      appName: 'My App', appType: 'web-app', template, complexity: 'medium',
      description: userPrompt.slice(0, 80),
      screens: [{ id: 'page-home', purpose: 'main interface' }],
      dataModel: {}, interactions: [],
      cdnNeeded: ['font-awesome', 'inter-font'], dynamicElements: [],
    };
  }
}

// ─── Step 2: Generate HTML (template-aware) ───────────────────────────────────

async function generateHTML(bp: AppBlueprint): Promise<string> {
  const hints = TEMPLATE_HINTS[bp.template];
  const screenList = bp.screens.map(s => `- ${s.id}: ${s.purpose}`).join('\n');
  const dataModelStr = Object.entries(bp.dataModel).map(([k, v]) => `  ${k}: ${v}`).join('\n');

  const sys = `You are a world-class frontend developer. Output ONLY raw HTML — no markdown fences, no explanation.`;

  const prompt = `Generate COMPLETE index.html for this app.

App Name: ${bp.appName}
Type: ${bp.appType} [Template: ${bp.template}]
Description: ${bp.description}
Complexity: ${bp.complexity}

SCREENS TO BUILD:
${screenList}

DATA MODEL:
${dataModelStr || '  (define as needed)'}

USER INTERACTIONS:
${bp.interactions.slice(0, 8).map(i => `- ${i}`).join('\n')}

TEMPLATE-SPECIFIC HTML REQUIREMENTS:
${hints.html}

UNIVERSAL RULES:
1. Link: <link rel="stylesheet" href="style.css"> and <script src="script.js" defer></script>
2. Every screen is a <div id="page-*"> — JS will show/hide them
3. EVERY interactive element has a unique id="" — JS attaches events via IDs
4. First screen (${bp.screens[0]?.id || 'page-home'}) visible, all others display:none inline
5. No inline onclick, no inline styles — JS and CSS handle those
6. Include ALL screens and ALL UI elements — nothing placeholder

Output ONLY the raw HTML:`;

  return callAI(prompt, sys, 7000);
}

// ─── Step 3: Generate JS (template-aware, knows HTML structure) ───────────────

async function generateJS(bp: AppBlueprint, htmlContent: string): Promise<string> {
  const hints = TEMPLATE_HINTS[bp.template];

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

TEMPLATE-SPECIFIC JS REQUIREMENTS:
${hints.js}

UNIVERSAL RULES (ALL MANDATORY):
1. Wrap ALL code in: document.addEventListener('DOMContentLoaded', () => { ... });
2. Multi-page navigation:
   function showPage(id) {
     document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
     const el = document.getElementById(id); if (el) el.style.display = 'block';
   }
3. Wire EVERY button from the HTML using addEventListener — no button left unwired
4. Dynamic elements you'll create at runtime: ${bp.dynamicElements.join(', ') || 'none'}
5. No TODO comments, no empty functions, no placeholder logic
6. Show first page on load: showPage('${bp.screens[0]?.id || 'page-home'}')

Output ONLY the raw JavaScript:`;

  return callAI(prompt, sys, 10000);
}

// ─── Step 4: Generate CSS (template-aware, knows HTML + dynamic elements) ────

async function generateCSS(bp: AppBlueprint, htmlContent: string): Promise<string> {
  const hints = TEMPLATE_HINTS[bp.template];

  const sys = `You are a world-class CSS designer. Output ONLY raw CSS — no markdown fences, no <style> tags.`;

  const prompt = `Generate beautiful style.css for this app.

App: ${bp.appName} [${bp.appType}, Template: ${bp.template}]

HTML STRUCTURE TO STYLE (use exact class names):
\`\`\`html
${htmlContent.slice(0, 6000)}
\`\`\`

JS WILL CREATE THESE DYNAMIC ELEMENTS AT RUNTIME (style them too):
${bp.dynamicElements.length > 0
  ? bp.dynamicElements.map(e => `- .${e}`).join('\n')
  : '- .toast-notification, .modal-overlay (standard dynamic elements)'}

TEMPLATE-SPECIFIC CSS REQUIREMENTS:
${hints.css}

UNIVERSAL RULES:
1. CSS custom properties at :root — define --bg, --surface, --accent, --accent-rgb, --text, --text-muted
2. Base: * { box-sizing: border-box; margin: 0; padding: 0; }
3. Dark theme: --bg: #0a0a0f; --surface: rgba(255,255,255,0.05); --accent: #6366f1; --accent-rgb: 99,102,241
4. [id^="page-"] { display: none; } — JS controls visibility
5. Beautiful buttons: gradient bg, transform on hover, active press scale
6. Fully responsive: works on mobile (min-width: 320px) through desktop (max-width: 1400px)
7. Smooth transitions on ALL interactive elements (0.2s ease)
8. Style every class in the HTML above — nothing left unstyled

Output ONLY the raw CSS:`;

  return callAI(prompt, sys, 6000);
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
    report('Analyzing', 1, 6, 'Building deep blueprint...');
    const bp = await generateBlueprint(userPrompt);
    console.log(`[AppEngine v4] Blueprint: ${bp.appName} | Template: ${bp.template} | Complexity: ${bp.complexity} | Screens: ${bp.screens.length}`);

    report('Planning', 2, 6, `${bp.appName} — ${bp.screens.length} screens, ${bp.template} template`);

    report('Generating', 3, 6, 'Writing HTML structure...');
    const htmlContent = await generateHTML(bp);
    const generatedFiles: Record<string, string> = { 'index.html': htmlContent };
    onFileGenerated?.('index.html', htmlContent);

    report('Generating', 4, 6, 'Writing JavaScript — wiring all buttons & game logic...');
    const jsContent = await generateJS(bp, htmlContent);
    generatedFiles['script.js'] = jsContent;
    onFileGenerated?.('script.js', jsContent);

    report('Generating', 5, 6, 'Writing CSS — styling & animations...');
    const cssContent = await generateCSS(bp, htmlContent);
    generatedFiles['style.css'] = cssContent;
    onFileGenerated?.('style.css', cssContent);

    report('Assembling', 6, 6, 'Building live preview...');
    const previewHtml = buildPreviewHtml(generatedFiles, bp);

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
