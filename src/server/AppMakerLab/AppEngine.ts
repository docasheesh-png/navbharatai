/**
 * NavBharatAI Pro — App Maker Engine v3
 *
 * Generation order: HTML → JS → CSS
 *   HTML defines the DOM (all element IDs, classes, structure)
 *   JS is written AFTER HTML so it uses the exact same IDs → buttons always work
 *   CSS is written AFTER HTML so selectors match actual classes
 *
 * Connected to /api/pro-build and /api/pro-chat in server.ts via buildApp()
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

// ─── Step 1: Analyze requirements ────────────────────────────────────────────

async function analyzeRequirements(prompt: string): Promise<{
  appName: string;
  appType: string;
  features: string[];
  description: string;
}> {
  const sys = `You are a software architect. Analyze the user's app request and return JSON only.
Return this exact JSON structure:
{
  "appName": "short app name",
  "appType": "web-app|game|tool|dashboard|calculator|etc",
  "features": ["feature1", "feature2", "feature3", "feature4", "feature5"],
  "description": "one sentence what this app does"
}
Return ONLY the JSON, no markdown, no explanation.`;

  const raw = await callAI(prompt, sys, 600);
  try {
    const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      appName: 'My App',
      appType: 'web-app',
      features: ['main functionality'],
      description: prompt.slice(0, 80),
    };
  }
}

// ─── Step 2: Generate HTML first (defines the DOM) ───────────────────────────

async function generateHTML(
  appName: string,
  appType: string,
  description: string,
  features: string[],
): Promise<string> {
  const isGame = appType.toLowerCase().includes('game');

  const sys = `You are a world-class frontend developer building a complete, fully functional HTML app.
Output ONLY raw HTML code — no markdown fences, no explanation, just the pure HTML.`;

  const prompt = `Generate a COMPLETE index.html for this app:

App Name: ${appName}
Type: ${appType}
Description: ${description}
Features: ${features.join(', ')}

CRITICAL REQUIREMENTS:
1. Full HTML5 document with <link rel="stylesheet" href="style.css"> and <script src="script.js" defer></script>
2. ALL sections/pages must exist as <div> elements — use id="" and class="" to identify each
3. Navigation/multi-page: use id="page-home", id="page-game", id="page-settings" etc. — JS will show/hide them
4. Every interactive element MUST have an id="" so JavaScript can attach event listeners
   Examples: <button id="btn-start-game">, <button id="btn-submit">, <input id="input-name">
5. ${isGame ? 'Include ALL game UI: score display, lives/health, game board/canvas, start/pause/restart buttons, win/lose overlays' : 'Include ALL UI sections for every feature listed'}
6. Dark theme classes: use class="card", class="btn", class="nav", etc. — CSS will style these
7. NO inline styles, NO inline onclick — CSS handles styling, JS handles events
8. Complete, production-ready HTML — not a placeholder or skeleton

Output ONLY the raw HTML:`;

  return callAI(prompt, sys, 6000);
}

// ─── Step 3: Generate JS (knows the exact HTML structure) ────────────────────

async function generateJS(
  appName: string,
  appType: string,
  description: string,
  features: string[],
  htmlContent: string,
): Promise<string> {
  const isGame = appType.toLowerCase().includes('game');

  const sys = `You are a world-class JavaScript developer. You write complete, working JavaScript.
Output ONLY raw JavaScript code — no markdown fences, no <script> tags, no explanation.`;

  const prompt = `Generate COMPLETE script.js for this app.

App Name: ${appName}
Description: ${description}
Features: ${features.join(', ')}

THE EXACT HTML YOU MUST WORK WITH:
\`\`\`html
${htmlContent.slice(0, 8000)}
\`\`\`

CRITICAL REQUIREMENTS — EVERY RULE IS MANDATORY:

1. EVERY BUTTON/LINK MUST WORK:
   - Find every element with an id="" in the HTML above
   - Add document.getElementById('...').addEventListener('click', ...) for every button
   - Use DOMContentLoaded: document.addEventListener('DOMContentLoaded', () => { ... all your code here ... })

2. MULTI-PAGE NAVIGATION (use this exact pattern):
   \`\`\`javascript
   function showPage(pageId) {
     document.querySelectorAll('[id^="page-"]').forEach(p => { p.style.display = 'none'; });
     const page = document.getElementById(pageId);
     if (page) page.style.display = 'block';
   }
   // Example: document.getElementById('btn-go-settings').addEventListener('click', () => showPage('page-settings'));
   \`\`\`

3. ${isGame ? `GAME MUST BE FULLY PLAYABLE:
   - Complete game loop with start, play, win/lose, restart states
   - Score/lives tracking with real-time DOM updates
   - All game mechanics implemented (not stubs)
   - Keyboard and/or click controls working
   - requestAnimationFrame for smooth animations where needed` :
   `APP MUST BE FULLY FUNCTIONAL:
   - All form submissions process data
   - All counters/timers actually run
   - Data persists in localStorage where relevant
   - All features listed are implemented and working`}

4. STRICT DOM MATCHING — use the EXACT same IDs as in the HTML above. No new IDs.

5. NO PLACEHOLDERS: No "// TODO", no empty functions, no "implement later" comments.

Output ONLY the raw JavaScript (no <script> tags, no markdown):`;

  return callAI(prompt, sys, 8000);
}

// ─── Step 4: Generate CSS (knows the exact HTML structure) ───────────────────

async function generateCSS(
  appName: string,
  description: string,
  htmlContent: string,
): Promise<string> {
  const sys = `You are a world-class CSS designer. You write beautiful, modern CSS.
Output ONLY raw CSS — no markdown fences, no <style> tags, no explanation.`;

  const prompt = `Generate beautiful style.css for this app.

App Name: ${appName}
Description: ${description}

THE EXACT HTML YOU MUST STYLE (use the exact same class names):
\`\`\`html
${htmlContent.slice(0, 5000)}
\`\`\`

REQUIREMENTS:
1. Dark theme: use #0a0a0f background, deep navy/purple gradients
2. Glassmorphism cards: background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1)
3. Beautiful buttons: gradient backgrounds, hover effects with transform/box-shadow, active press effect
4. Smooth animations: CSS transitions on all interactive elements (0.2-0.3s ease)
5. Fully responsive: mobile-first, works on all screen sizes
6. Every class from the HTML above must be styled — no unstyled elements
7. pages hidden by default: [id^="page-"] { display: none; } — JS shows them

Output ONLY the raw CSS:`;

  return callAI(prompt, sys, 5000);
}

// ─── Step 5: Assemble preview HTML ───────────────────────────────────────────

function buildPreviewHtml(files: Record<string, string>, appName: string): string {
  let html = files['index.html'] || '';
  const css = files['style.css'] || '';
  const js = files['script.js'] || '';

  if (!html) {
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${appName}</title></head><body></body></html>`;
  }

  if (css) {
    const styleTag = `<style>\n${css}\n</style>`;
    html = html.includes('</head>') ? html.replace('</head>', `${styleTag}\n</head>`) : styleTag + html;
  }
  html = html.replace(/<link[^>]+style\.css[^>]*>/gi, '');

  if (js) {
    const scriptTag = `<script>\n${js}\n</script>`;
    html = html.includes('</body>') ? html.replace('</body>', `${scriptTag}\n</body>`) : html + scriptTag;
  }
  html = html.replace(/<script[^>]+src=["']script\.js["'][^>]*><\/script>/gi, '');

  return html;
}

// ─── Main: buildApp() ─────────────────────────────────────────────────────────

export async function buildApp(
  userPrompt: string,
  onProgress?: ProgressCallback,
  onFileGenerated?: FileGeneratedCallback
): Promise<BuildResult> {
  const report = (stage: string, step: number, total: number, detail: string) => {
    console.log(`[AppEngine] [${step}/${total}] ${stage}: ${detail}`);
    onProgress?.({ stage, step, total, detail });
  };

  try {
    report('Analyzing', 1, 5, 'Understanding your requirements...');
    const analysis = await analyzeRequirements(userPrompt);
    console.log('[AppEngine] Analysis:', analysis);

    report('Generating', 2, 5, `Building ${analysis.appName} HTML structure...`);
    const htmlContent = await generateHTML(analysis.appName, analysis.appType, analysis.description, analysis.features);
    const generatedFiles: Record<string, string> = { 'index.html': htmlContent };
    onFileGenerated?.('index.html', htmlContent);

    // JS generated AFTER HTML — knows exact IDs and element structure
    report('Generating', 3, 5, 'Writing JavaScript — wiring all buttons & logic...');
    const jsContent = await generateJS(analysis.appName, analysis.appType, analysis.description, analysis.features, htmlContent);
    generatedFiles['script.js'] = jsContent;
    onFileGenerated?.('script.js', jsContent);

    // CSS generated AFTER HTML — knows exact class names
    report('Generating', 4, 5, 'Writing CSS — styling & animations...');
    const cssContent = await generateCSS(analysis.appName, analysis.description, htmlContent);
    generatedFiles['style.css'] = cssContent;
    onFileGenerated?.('style.css', cssContent);

    report('Assembling', 5, 5, 'Building live preview...');
    const previewHtml = buildPreviewHtml(generatedFiles, analysis.appName);

    const fileList: AppFile[] = Object.entries(generatedFiles).map(([path, content]) => ({
      path,
      content,
      description: path === 'index.html' ? 'HTML structure & layout'
        : path === 'style.css' ? 'Styles & animations'
        : 'Application logic & interactions',
    }));

    return {
      success: true,
      reply: `✅ ${analysis.appName} ready! ${analysis.description}`,
      files: generatedFiles,
      fileList,
      previewHtml,
      appName: analysis.appName,
    };

  } catch (err: any) {
    console.error('[AppEngine] Build failed:', err);
    return {
      success: false,
      reply: `Build failed: ${err.message}`,
      files: {},
      fileList: [],
      previewHtml: '',
      appName: 'App',
      error: err.message,
    };
  }
}
